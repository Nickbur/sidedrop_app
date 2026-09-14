import type { Channel } from './transfer';
import type { IceServerConfig } from './types';

export type PeerRole = 'host' | 'guest';

export type PeerSignal =
    | { kind: 'offer'; epoch: number; sdp: RTCSessionDescriptionInit }
    | { kind: 'answer'; epoch: number; sdp: RTCSessionDescriptionInit }
    | { kind: 'ice'; epoch: number; candidate: RTCIceCandidateInit | null };

export interface PeerCallbacks {
    onSignal: (signal: PeerSignal) => void;
    onChannel: (channel: Channel) => void;
    onState: (state: RTCPeerConnectionState) => void;
}

function channelAdapter(pc: RTCPeerConnection, dc: RTCDataChannel): Channel {
    dc.binaryType = 'arraybuffer';
    let onMsg: ((d: string | ArrayBuffer) => void) | null = null;
    let onDrain: (() => void) | null = null;
    dc.onmessage = (e) => {
        const d = e.data;
        if (typeof d === 'string' || d instanceof ArrayBuffer) onMsg?.(d);
    };
    dc.onbufferedamountlow = () => onDrain?.();
    return {
        send(data) {
            if (typeof data === 'string') dc.send(data);
            else dc.send(data);
        },
        bufferedAmount: () => dc.bufferedAmount,
        maxMessageSize: () => {
            const m = pc.sctp?.maxMessageSize;
            return m && m > 0 && m < 1e9 ? m : 256 * 1024;
        },
        onMessage: (cb) => {
            onMsg = cb;
        },
        onDrain: (cb) => {
            onDrain = cb;
        },
        setLowThreshold: (bytes) => {
            dc.bufferedAmountLowThreshold = bytes;
        },
    };
}

/**
 * One WebRTC negotiation. The host creates the data channel and offers; the guest
 * answers. Each Peer carries an `epoch` so the session can discard stale signals
 * from a previous connection after a reconnect (see session.ts).
 */
export class Peer {
    private readonly pc: RTCPeerConnection;
    private dc: RTCDataChannel | null = null;
    private closed = false;

    constructor(
        private readonly role: PeerRole,
        readonly epoch: number,
        iceServers: IceServerConfig[],
        private readonly cb: PeerCallbacks,
    ) {
        this.pc = new RTCPeerConnection({ iceServers: iceServers as RTCIceServer[] });
        this.pc.onicecandidate = (e) => {
            this.cb.onSignal({
                kind: 'ice',
                epoch: this.epoch,
                candidate: e.candidate ? e.candidate.toJSON() : null,
            });
        };
        this.pc.onconnectionstatechange = () => {
            if (!this.closed) this.cb.onState(this.pc.connectionState);
        };
        if (role === 'host') {
            this.setupChannel(this.pc.createDataChannel('sidedrop', { ordered: true }));
        } else {
            this.pc.ondatachannel = (e) => this.setupChannel(e.channel);
        }
    }

    async start(): Promise<void> {
        if (this.role !== 'host' || this.closed) return;
        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        this.cb.onSignal({ kind: 'offer', epoch: this.epoch, sdp: offer });
    }

    async handleSignal(signal: PeerSignal): Promise<void> {
        if (this.closed) return;
        try {
            if (signal.kind === 'offer' && this.role === 'guest') {
                await this.pc.setRemoteDescription(signal.sdp);
                const answer = await this.pc.createAnswer();
                await this.pc.setLocalDescription(answer);
                this.cb.onSignal({ kind: 'answer', epoch: this.epoch, sdp: answer });
            } else if (signal.kind === 'answer' && this.role === 'host') {
                await this.pc.setRemoteDescription(signal.sdp);
            } else if (signal.kind === 'ice' && signal.candidate) {
                await this.pc.addIceCandidate(signal.candidate).catch(() => undefined);
            }
        } catch {
            /* a stale/failed negotiation step; the session rebuilds on failure */
        }
    }

    private setupChannel(dc: RTCDataChannel): void {
        this.dc = dc;
        const adapter = channelAdapter(this.pc, dc);
        if (dc.readyState === 'open') this.cb.onChannel(adapter);
        else
            dc.onopen = () => {
                if (!this.closed) this.cb.onChannel(adapter);
            };
    }

    get connectionState(): RTCPeerConnectionState {
        return this.pc.connectionState;
    }

    close(): void {
        this.closed = true;
        try {
            this.dc?.close();
        } catch {
            /* ignore */
        }
        try {
            this.pc.close();
        } catch {
            /* ignore */
        }
    }
}
