import { Emitter } from './emitter';
import type { IceServerConfig } from './types';

export type SignalRole = 'host' | 'guest';

export interface SignalingEvents extends Record<string, unknown> {
    created: { roomId: string; code: string; token: string; iceServers: IceServerConfig[] };
    joined: {
        roomId: string;
        code: string;
        token: string;
        role: SignalRole;
        peerPresent: boolean;
        iceServers: IceServerConfig[];
    };
    'peer-joined': void;
    'peer-left': void;
    signal: unknown;
    reconnected: void;
    status: 'connecting' | 'open' | 'reconnecting' | 'closed';
    error: { code: string };
}

type Intent = { mode: 'create' } | { mode: 'join'; room?: string; code?: string };

/** WebSocket signaling client with auto-reconnect and token-based room reclaim. */
export class SignalingClient {
    readonly emitter = new Emitter<SignalingEvents>();

    private ws: WebSocket | null = null;
    private intent: Intent | null = null;
    private token: string | null = null;
    private roomId: string | null = null;
    private manualClose = false;
    private backoff = 500;
    private everConnected = false;

    constructor(private readonly url: string) {}

    create(): void {
        this.intent = { mode: 'create' };
        this.open();
    }

    join(opts: { room?: string; code?: string }): void {
        this.intent = { mode: 'join', ...opts };
        this.open();
    }

    sendSignal(data: unknown): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ t: 'signal', data }));
        }
    }

    close(): void {
        this.manualClose = true;
        try {
            this.ws?.send(JSON.stringify({ t: 'bye' }));
        } catch {
            /* ignore */
        }
        try {
            this.ws?.close();
        } catch {
            /* ignore */
        }
        this.ws = null;
    }

    private open(): void {
        this.manualClose = false;
        this.emitter.emit('status', this.everConnected ? 'reconnecting' : 'connecting');
        const ws = new WebSocket(this.url);
        this.ws = ws;

        ws.onopen = () => {
            this.backoff = 500;
            this.emitter.emit('status', 'open');
            this.sendIntent();
            if (this.everConnected) this.emitter.emit('reconnected', undefined as void);
            this.everConnected = true;
        };
        ws.onmessage = (e) => this.onMessage(e.data);
        ws.onclose = () => {
            if (this.manualClose) {
                this.emitter.emit('status', 'closed');
                return;
            }
            this.emitter.emit('status', 'reconnecting');
            setTimeout(() => this.open(), this.backoff);
            this.backoff = Math.min(this.backoff * 2, 8000);
        };
        ws.onerror = () => {
            try {
                ws.close();
            } catch {
                /* ignore */
            }
        };
    }

    private sendIntent(): void {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN || !this.intent) return;
        if (this.token && this.roomId) {
            ws.send(JSON.stringify({ t: 'join', room: this.roomId, token: this.token }));
        } else if (this.intent.mode === 'create') {
            ws.send(JSON.stringify({ t: 'create' }));
        } else {
            ws.send(JSON.stringify({ t: 'join', room: this.intent.room, code: this.intent.code }));
        }
    }

    private onMessage(raw: unknown): void {
        if (typeof raw !== 'string') return;
        let m: Record<string, unknown>;
        try {
            m = JSON.parse(raw) as Record<string, unknown>;
        } catch {
            return;
        }
        const t = m.t;
        if (t === 'created') {
            this.token = String(m.token);
            this.roomId = String(m.roomId);
            this.emitter.emit('created', {
                roomId: this.roomId,
                code: String(m.code),
                token: this.token,
                iceServers: (m.iceServers as IceServerConfig[]) ?? [],
            });
        } else if (t === 'joined') {
            this.token = String(m.token);
            this.roomId = String(m.roomId);
            this.emitter.emit('joined', {
                roomId: this.roomId,
                code: String(m.code),
                token: this.token,
                role: m.role === 'host' ? 'host' : 'guest',
                peerPresent: Boolean(m.peerPresent),
                iceServers: (m.iceServers as IceServerConfig[]) ?? [],
            });
        } else if (t === 'peer-joined') {
            this.emitter.emit('peer-joined', undefined as void);
        } else if (t === 'peer-left') {
            this.emitter.emit('peer-left', undefined as void);
        } else if (t === 'signal') {
            this.emitter.emit('signal', m.data);
        } else if (t === 'error') {
            this.emitter.emit('error', { code: String(m.code) });
        }
    }
}
