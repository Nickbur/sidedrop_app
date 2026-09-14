import { Emitter } from './emitter';
import { SignalingClient } from './signaling';
import { Peer, type PeerRole, type PeerSignal } from './peer';
import { TransferEngine, type SendSource } from './transfer';
import { createSinkStore, type ReceivedFile, type SinkStore } from './opfs';
import { saveAll, saveReceived, saveText } from './save';
import { signalingWsUrl, roomLink } from '../api';
import type { ConnectionStatus, IceServerConfig, TransferItem } from './types';
import type { Dropped } from './fileTree';

export type Intent = { mode: 'create' } | { mode: 'join'; room?: string; code?: string };

export interface SessionState {
    status: ConnectionStatus;
    roomId: string | null;
    code: string | null;
    link: string | null;
    role: PeerRole | null;
    peerConnected: boolean;
    sinkMode: 'opfs' | 'memory';
    errorCode: string | null;
}

export interface SessionEvents extends Record<string, unknown> {
    state: SessionState;
    items: void;
}

type IncomingSignal = PeerSignal | { kind: 'rebuild' };

const RECOVER_DELAY = 1200;

function fileSource(file: File): SendSource {
    return {
        size: file.size,
        async slice(start, end) {
            return new Uint8Array(await file.slice(start, end).arrayBuffer());
        },
    };
}

function uuid(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export class Session {
    readonly emitter = new Emitter<SessionEvents>();
    readonly engine: TransferEngine;

    private readonly sinkStore: SinkStore;
    private signaling: SignalingClient | null = null;
    private peer: Peer | null = null;
    private iceServers: IceServerConfig[] = [];
    private epoch = 0;
    private hadChannel = false;
    private recoverTimer: ReturnType<typeof setTimeout> | null = null;

    private status: ConnectionStatus = 'idle';
    private role: PeerRole | null = null;
    private roomId: string | null = null;
    private code: string | null = null;
    private peerPresent = false;
    private peerConnected = false;
    private errorCode: string | null = null;

    constructor() {
        this.sinkStore = createSinkStore();
        this.engine = new TransferEngine(this.sinkStore.factory);
        this.engine.emitter.on('change', () => this.emitter.emit('items', undefined as void));
        this.engine.emitter.on('added', () => this.emitter.emit('items', undefined as void));
        this.engine.emitter.on('done', () => this.emitter.emit('items', undefined as void));
    }

    // ── lifecycle ──────────────────────────────────────────────────────────────

    start(intent: Intent): void {
        this.setStatus(intent.mode === 'create' ? 'connecting' : 'connecting');
        const signaling = new SignalingClient(signalingWsUrl());
        this.signaling = signaling;
        const e = signaling.emitter;
        e.on('created', (d) => this.onRoom('host', d));
        e.on('joined', (d) => this.onRoom(d.role, d));
        e.on('peer-joined', () => this.onPeerJoined());
        e.on('peer-left', () => this.onPeerLeft());
        e.on('signal', (data) => void this.onSignal(data));
        e.on('reconnected', () => this.onReconnected());
        e.on('error', ({ code }) => this.onError(code));
        e.on('status', (s) => {
            if (s === 'reconnecting' && this.status !== 'error') this.setStatus('reconnecting');
        });
        if (intent.mode === 'create') signaling.create();
        else signaling.join({ room: intent.room, code: intent.code });
    }

    private onRoom(
        role: PeerRole,
        d: { roomId: string; code: string; iceServers: IceServerConfig[]; peerPresent?: boolean },
    ): void {
        this.iceServers = d.iceServers ?? [];
        const firstTime = this.roomId === null;
        this.role = role;
        this.roomId = d.roomId;
        this.code = d.code;
        this.errorCode = null;
        const present = 'peerPresent' in d ? Boolean(d.peerPresent) : this.peerPresent;
        this.peerPresent = present;

        if (firstTime) {
            this.setStatus(present ? 'connecting' : 'waiting');
        }
        if (present) {
            if (role === 'host') this.hostNegotiate();
            else this.signaling?.sendSignal({ kind: 'rebuild' });
        }
        this.emitState();
    }

    private onPeerJoined(): void {
        this.peerPresent = true;
        if (this.status === 'waiting') this.setStatus('connecting');
        if (this.role === 'host') this.hostNegotiate();
        this.emitState();
    }

    private onPeerLeft(): void {
        this.peerPresent = false;
        this.peerConnected = false;
        this.clearRecover();
        this.teardownPeer();
        this.engine.detachChannel();
        this.setStatus('waiting');
        this.emitState();
    }

    private onReconnected(): void {
        if (!this.peerConnected && this.peerPresent) {
            if (this.role === 'host') this.hostNegotiate();
            else this.signaling?.sendSignal({ kind: 'rebuild' });
        }
    }

    private onError(code: string): void {
        this.errorCode = code;
        this.setStatus('error');
        this.emitState();
    }

    // ── negotiation ────────────────────────────────────────────────────────────

    private hostNegotiate(): void {
        this.epoch += 1;
        this.teardownPeer();
        const peer = new Peer('host', this.epoch, this.iceServers, this.peerCallbacks());
        this.peer = peer;
        if (this.status !== 'connected') this.setStatus('connecting');
        void peer.start();
    }

    private async onSignal(data: unknown): Promise<void> {
        const signal = asIncoming(data);
        if (!signal) return;
        if (signal.kind === 'rebuild') {
            if (this.role === 'host') this.hostNegotiate();
            return;
        }
        if (signal.kind === 'offer') {
            if (this.role !== 'guest') return;
            if (signal.epoch < this.epoch) return;
            this.epoch = signal.epoch;
            this.teardownPeer();
            const peer = new Peer('guest', this.epoch, this.iceServers, this.peerCallbacks());
            this.peer = peer;
            if (this.status !== 'connected') this.setStatus('connecting');
            await peer.handleSignal(signal);
            return;
        }
        if (this.peer && signal.epoch === this.peer.epoch) {
            await this.peer.handleSignal(signal);
        }
    }

    private peerCallbacks() {
        return {
            onSignal: (s: PeerSignal) => this.signaling?.sendSignal(s),
            onChannel: (channel: Parameters<TransferEngine['attachChannel']>[0]) => {
                this.clearRecover();
                this.engine.attachChannel(channel, { resume: this.hadChannel });
                this.hadChannel = true;
                this.peerConnected = true;
                this.setStatus('connected');
                this.emitState();
            },
            onState: (state: RTCPeerConnectionState) => {
                if (state === 'connected') {
                    this.peerConnected = true;
                    this.setStatus('connected');
                    this.emitState();
                } else if (state === 'failed' || state === 'closed') {
                    this.onConnectionLost();
                } else if (state === 'disconnected') {
                    this.scheduleRecover();
                }
            },
        };
    }

    private onConnectionLost(): void {
        if (!this.peerPresent) return;
        this.peerConnected = false;
        this.engine.detachChannel();
        this.setStatus('reconnecting');
        this.emitState();
        this.scheduleRecover();
    }

    private scheduleRecover(): void {
        if (this.recoverTimer) return;
        this.recoverTimer = setTimeout(() => {
            this.recoverTimer = null;
            if (this.peerConnected || !this.peerPresent) return;
            if (this.role === 'host') this.hostNegotiate();
            else this.signaling?.sendSignal({ kind: 'rebuild' });
        }, RECOVER_DELAY);
    }

    private clearRecover(): void {
        if (this.recoverTimer) {
            clearTimeout(this.recoverTimer);
            this.recoverTimer = null;
        }
    }

    private teardownPeer(): void {
        this.peer?.close();
        this.peer = null;
    }

    // ── transfers (UI-facing) ────────────────────────────────────────────────────

    sendFiles(dropped: Dropped[]): void {
        const entries = dropped.map((d) => ({
            meta: {
                id: uuid(),
                name: d.file.name,
                size: d.file.size,
                mime: d.file.type || 'application/octet-stream',
                kind: 'file' as const,
                relPath: d.relPath,
            },
            source: fileSource(d.file),
        }));
        this.engine.enqueue(entries);
    }

    sendText(content: string): void {
        this.engine.sendText('text.txt', content);
    }

    async save(id: string): Promise<void> {
        const item = this.engine.getItems().find((it) => it.id === id);
        if (item?.kind === 'text' && item.text !== undefined) {
            await saveText(item.name, item.text);
            this.engine.markSaved(id);
            return;
        }
        const file = this.sinkStore.get(id);
        if (!file) return;
        await saveReceived(file);
        this.engine.markSaved(id);
    }

    async saveAllReady(): Promise<void> {
        const ready = this.engine.getItems().filter((it) => it.dir === 'recv' && it.status === 'ready' && it.kind === 'file');
        const files: ReceivedFile[] = [];
        for (const it of ready) {
            const f = this.sinkStore.get(it.id);
            if (f) files.push(f);
        }
        if (files.length === 0) return;
        await saveAll(files);
        for (const it of ready) this.engine.markSaved(it.id);
    }

    cancel(id: string): void {
        this.engine.cancel(id);
    }

    clearFinished(): void {
        this.engine.clearFinished();
    }

    getItems(): TransferItem[] {
        return this.engine.getItems();
    }

    get canSend(): boolean {
        return this.peerConnected;
    }

    // ── state plumbing ───────────────────────────────────────────────────────────

    private setStatus(status: ConnectionStatus): void {
        if (this.status !== status) this.status = status;
    }

    private emitState(): void {
        this.emitter.emit('state', this.snapshot());
    }

    snapshot(): SessionState {
        return {
            status: this.status,
            roomId: this.roomId,
            code: this.code,
            link: this.roomId ? roomLink(this.roomId) : null,
            role: this.role,
            peerConnected: this.peerConnected,
            sinkMode: this.sinkStore.mode,
            errorCode: this.errorCode,
        };
    }

    dispose(): void {
        this.clearRecover();
        this.teardownPeer();
        this.signaling?.close();
        this.signaling = null;
        this.engine.dispose();
        void this.sinkStore.dispose();
        this.emitter.clear();
    }
}

function asIncoming(data: unknown): IncomingSignal | null {
    if (typeof data !== 'object' || data === null) return null;
    const kind = (data as { kind?: unknown }).kind;
    if (kind === 'offer' || kind === 'answer' || kind === 'ice' || kind === 'rebuild') {
        return data as IncomingSignal;
    }
    return null;
}
