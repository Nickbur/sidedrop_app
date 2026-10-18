import { vi, type Mock } from 'vitest';

/**
 * Stand-ins for the browser networking APIs happy-dom does not provide (or would
 * use to reach a real server). Each fake records what the code under test did to
 * it and exposes small "driver" methods so a test plays the remote side: the
 * signaling server opening, answering or dropping a socket; the other browser
 * offering, sending ICE or opening the data channel. Nothing here touches the
 * network.
 */

// ── WebSocket ────────────────────────────────────────────────────────────────

export class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;

    static instances: FakeWebSocket[] = [];

    /** The most recently constructed socket. */
    static last(): FakeWebSocket {
        const ws = FakeWebSocket.instances.at(-1);
        if (!ws) throw new Error('no WebSocket was opened');
        return ws;
    }

    readyState = FakeWebSocket.CONNECTING;
    readonly sent: string[] = [];
    closeCalls = 0;
    /** When set, `close()` throws — the way a browser can on an already-broken socket. */
    throwOnClose = false;

    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(readonly url: string) {
        FakeWebSocket.instances.push(this);
    }

    send(data: string): void {
        if (this.readyState !== FakeWebSocket.OPEN) throw new Error('InvalidStateError: socket is not open');
        this.sent.push(data);
    }

    close(): void {
        this.closeCalls += 1;
        if (this.throwOnClose) throw new Error('close failed');
        if (this.readyState === FakeWebSocket.CLOSED) return;
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
    }

    /** Every frame the client sent, parsed. */
    messages(): Array<Record<string, unknown>> {
        return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
    }

    // drivers — the server side

    open(): void {
        this.readyState = FakeWebSocket.OPEN;
        this.onopen?.();
    }

    receive(message: unknown): void {
        this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
    }

    receiveRaw(data: unknown): void {
        this.onmessage?.({ data });
    }

    /** The server (or the network) closes the socket without the client asking. */
    drop(): void {
        this.readyState = FakeWebSocket.CLOSED;
        this.onclose?.();
    }

    fail(): void {
        this.onerror?.();
    }
}

export function installWebSocket(): void {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
}

// ── WebRTC ───────────────────────────────────────────────────────────────────

export class FakeDataChannel {
    binaryType = 'blob';
    readyState: RTCDataChannelState = 'connecting';
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    readonly sent: Array<string | ArrayBuffer> = [];
    closeCalls = 0;
    throwOnClose = false;

    onopen: (() => void) | null = null;
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onbufferedamountlow: (() => void) | null = null;

    constructor(
        readonly label = 'sidedrop',
        readonly options: RTCDataChannelInit = {},
    ) {}

    send(data: string | ArrayBuffer): void {
        this.sent.push(data);
    }

    close(): void {
        this.closeCalls += 1;
        if (this.throwOnClose) throw new Error('close failed');
        this.readyState = 'closed';
    }

    /** The JSON control messages sent so far, parsed (binary chunk frames skipped). */
    controls(): Array<Record<string, unknown>> {
        return this.sent
            .filter((d): d is string => typeof d === 'string')
            .map((raw) => JSON.parse(raw) as Record<string, unknown>);
    }

    // drivers — the other browser

    open(): void {
        this.readyState = 'open';
        this.onopen?.();
    }

    receive(data: unknown): void {
        this.onmessage?.({ data });
    }

    drain(): void {
        this.onbufferedamountlow?.();
    }
}

export class FakeRTCPeerConnection {
    static instances: FakeRTCPeerConnection[] = [];

    static last(): FakeRTCPeerConnection {
        const pc = FakeRTCPeerConnection.instances.at(-1);
        if (!pc) throw new Error('no RTCPeerConnection was created');
        return pc;
    }

    connectionState: RTCPeerConnectionState = 'new';
    sctp: { maxMessageSize: number } | null = { maxMessageSize: 256 * 1024 };
    readonly channels: FakeDataChannel[] = [];
    readonly candidates: RTCIceCandidateInit[] = [];
    localDescription: RTCSessionDescriptionInit | null = null;
    remoteDescription: RTCSessionDescriptionInit | null = null;
    closeCalls = 0;
    throwOnClose = false;
    /** Make the next remote description / ICE candidate be refused, as for a stale negotiation. */
    rejectRemote = false;
    rejectIce = false;

    onicecandidate: ((e: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    ondatachannel: ((e: { channel: FakeDataChannel }) => void) | null = null;

    constructor(readonly config: RTCConfiguration) {
        FakeRTCPeerConnection.instances.push(this);
    }

    createDataChannel(label: string, options: RTCDataChannelInit): FakeDataChannel {
        const dc = new FakeDataChannel(label, options);
        this.channels.push(dc);
        return dc;
    }

    async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'offer', sdp: `offer-${FakeRTCPeerConnection.instances.indexOf(this)}` };
    }

    async createAnswer(): Promise<RTCSessionDescriptionInit> {
        return { type: 'answer', sdp: `answer-${FakeRTCPeerConnection.instances.indexOf(this)}` };
    }

    async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
        this.localDescription = desc;
    }

    async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
        if (this.rejectRemote) throw new Error('InvalidStateError: wrong signaling state');
        this.remoteDescription = desc;
    }

    async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
        if (this.rejectIce) throw new Error('OperationError: unknown ufrag');
        this.candidates.push(candidate);
    }

    close(): void {
        this.closeCalls += 1;
        if (this.throwOnClose) throw new Error('close failed');
        this.connectionState = 'closed';
    }

    // drivers — the network / the other browser

    setState(state: RTCPeerConnectionState): void {
        this.connectionState = state;
        this.onconnectionstatechange?.();
    }

    emitCandidate(candidate: RTCIceCandidateInit | null): void {
        this.onicecandidate?.({ candidate: candidate ? { toJSON: () => candidate } : null });
    }

    /** The remote side's data channel arrives (guest side). */
    emitDataChannel(channel = new FakeDataChannel()): FakeDataChannel {
        this.ondatachannel?.({ channel });
        return channel;
    }
}

export function installWebRtc(): void {
    FakeRTCPeerConnection.instances = [];
    vi.stubGlobal('RTCPeerConnection', FakeRTCPeerConnection);
}

// ── Clipboard ────────────────────────────────────────────────────────────────

/** Replaces `navigator.clipboard.writeText` for one test; the returned mock records what was copied. */
export function stubClipboard(result: 'ok' | 'blocked' = 'ok'): Mock<(text: string) => Promise<void>> {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
        if (result === 'blocked') throw new Error('NotAllowedError');
    });
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(writeText);
    return writeText;
}
