import { Emitter } from './emitter';
import {
    CHUNK_HEADER_BYTES,
    DEFAULT_CHUNK_SIZE,
    MIN_CHUNK_SIZE,
    PROTOCOL_VERSION,
    decodeChunk,
    encodeChunk,
    encodeControl,
    parseControl,
    type Control,
} from './protocol';
import type { ItemKind, ItemMeta, TransferItem } from './types';

/** Abstract bidirectional channel — a real RTCDataChannel adapter or a test fake. */
export interface Channel {
    send(data: string | ArrayBuffer): void;
    bufferedAmount(): number;
    maxMessageSize(): number;
    onMessage(cb: (data: string | ArrayBuffer) => void): void;
    onDrain(cb: () => void): void;
    setLowThreshold(bytes: number): void;
}

/** A readable byte source for sending (a File, or a buffer in tests). */
export interface SendSource {
    size: number;
    slice(start: number, end: number): Promise<Uint8Array>;
}

/** A destination for received bytes (OPFS, memory, or a test buffer). */
export interface Sink {
    writeAt(offset: number, data: Uint8Array): Promise<void>;
    close(): Promise<void>;
}

export type SinkFactory = (meta: ItemMeta) => Promise<Sink>;

export interface EngineEvents extends Record<string, unknown> {
    change: void;
    added: TransferItem;
    done: TransferItem;
    error: { id?: string; message: string };
}

interface SendState {
    meta: ItemMeta;
    item: TransferItem;
    source: SendSource;
    sent: number;
    acked: number;
    eofSent: boolean;
    done: boolean;
    canceled: boolean;
}

interface RecvState {
    meta: ItemMeta;
    item: TransferItem;
    sink: Sink | null;
    received: number;
    lastAck: number;
    complete: boolean;
    canceled: boolean;
}

const HIGH_WATER = 8 * 1024 * 1024;
const LOW_WATER = 1 * 1024 * 1024;
const ACK_INTERVAL = 256 * 1024;

export class TransferEngine {
    readonly emitter = new Emitter<EngineEvents>();

    private channel: Channel | null = null;
    private gen = 0;
    private pumping = false;
    private drainResolvers: Array<() => void> = [];

    private readonly sendByIndex = new Map<number, SendState>();
    private readonly recvByIndex = new Map<number, RecvState>();
    private readonly order: TransferItem[] = [];
    private sendCounter = 0;

    private queue: Promise<void> = Promise.resolve();
    private changeScheduled = false;

    constructor(private readonly sinkFactory: SinkFactory) {}

    // ── channel lifecycle ────────────────────────────────────────────────────

    attachChannel(channel: Channel, opts: { resume?: boolean } = {}): void {
        this.channel = channel;
        this.gen += 1;
        channel.onMessage((data) => this.enqueueMessage(data));
        channel.onDrain(() => this.resolveDrains());
        channel.setLowThreshold(LOW_WATER);
        channel.send(encodeControl({ t: 'hello', v: PROTOCOL_VERSION }));

        if (opts.resume) {
            const metas: ItemMeta[] = [];
            for (const s of this.sendByIndex.values()) {
                if (s.done || s.canceled) continue;
                s.sent = Math.min(s.sent, s.acked);
                s.eofSent = false;
                s.item.status = 'active';
                s.item.transferred = s.sent;
                metas.push(s.meta);
            }
            if (metas.length > 0) channel.send(encodeControl({ t: 'batch', items: metas }));

            const resumeItems: Array<{ i: number; have: number }> = [];
            for (const r of this.recvByIndex.values()) {
                if (r.complete || r.canceled) continue;
                r.item.status = 'active';
                resumeItems.push({ i: r.meta.i, have: r.received });
            }
            if (resumeItems.length > 0) channel.send(encodeControl({ t: 'resume', items: resumeItems }));
        }

        this.scheduleChange();
        void this.pump();
    }

    detachChannel(): void {
        this.channel = null;
        this.gen += 1;
        this.resolveDrains();
        for (const s of this.sendByIndex.values()) {
            if (!s.done && !s.canceled) s.item.status = 'paused';
        }
        for (const r of this.recvByIndex.values()) {
            if (!r.complete && !r.canceled) r.item.status = 'paused';
        }
        this.scheduleChange();
    }

    // ── sending ──────────────────────────────────────────────────────────────

    enqueue(entries: Array<{ meta: Omit<ItemMeta, 'i'>; source: SendSource }>): void {
        const metas: ItemMeta[] = [];
        for (const entry of entries) {
            const i = this.sendCounter;
            this.sendCounter += 1;
            const meta: ItemMeta = { ...entry.meta, i };
            const item: TransferItem = {
                ...meta,
                dir: 'send',
                status: 'queued',
                transferred: 0,
                speed: 0,
                eta: Infinity,
            };
            const state: SendState = {
                meta,
                item,
                source: entry.source,
                sent: 0,
                acked: 0,
                eofSent: false,
                done: meta.size === 0,
                canceled: false,
            };
            if (meta.size === 0) item.status = 'active';
            this.sendByIndex.set(i, state);
            this.order.push(item);
            metas.push(meta);
            this.emitter.emit('added', item);
        }
        if (this.channel && metas.length > 0) {
            this.channel.send(encodeControl({ t: 'batch', items: metas }));
        }
        this.scheduleChange();
        void this.pump();
    }

    sendText(name: string, content: string): void {
        const i = this.sendCounter;
        this.sendCounter += 1;
        const id = cryptoId();
        const size = new TextEncoder().encode(content).length;
        const item: TransferItem = {
            i,
            id,
            name,
            size,
            mime: 'text/plain',
            kind: 'text',
            dir: 'send',
            status: 'done',
            transferred: size,
            speed: 0,
            eta: 0,
            text: content,
        };
        this.order.push(item);
        this.emitter.emit('added', item);
        this.channel?.send(encodeControl({ t: 'text', id, name, content }));
        this.emitter.emit('done', item);
        this.scheduleChange();
    }

    private chunkSize(): number {
        const max = this.channel ? this.channel.maxMessageSize() : DEFAULT_CHUNK_SIZE + CHUNK_HEADER_BYTES;
        const usable = Math.max(MIN_CHUNK_SIZE, max - CHUNK_HEADER_BYTES);
        return Math.min(DEFAULT_CHUNK_SIZE, usable);
    }

    private nextActiveSend(): SendState | null {
        for (const s of this.sendByIndex.values()) {
            if (s.done || s.canceled) continue;
            if (s.sent < s.meta.size) return s;
        }
        return null;
    }

    private async pump(): Promise<void> {
        if (this.pumping) return;
        this.pumping = true;
        const gen = this.gen;
        try {
            while (this.channel && gen === this.gen) {
                const channel = this.channel;
                const s = this.nextActiveSend();
                if (!s) break;
                if (channel.bufferedAmount() > HIGH_WATER) {
                    await this.waitDrain(gen);
                    continue;
                }
                const start = s.sent;
                const end = Math.min(s.meta.size, start + this.chunkSize());
                const data = await s.source.slice(start, end);
                if (gen !== this.gen || this.channel !== channel) break;
                channel.send(encodeChunk(s.meta.i, start, data));
                s.sent = end;
                s.item.status = 'active';
                s.item.transferred = s.sent;
                if (s.sent >= s.meta.size && !s.eofSent) {
                    channel.send(encodeControl({ t: 'eof', i: s.meta.i }));
                    s.eofSent = true;
                }
                this.scheduleChange();
            }
        } catch (err) {
            this.emitter.emit('error', { message: err instanceof Error ? err.message : 'send failed' });
        } finally {
            this.pumping = false;
        }
    }

    private waitDrain(gen: number): Promise<void> {
        return new Promise((resolve) => {
            if (gen !== this.gen) {
                resolve();
                return;
            }
            this.drainResolvers.push(resolve);
        });
    }

    private resolveDrains(): void {
        const resolvers = this.drainResolvers;
        this.drainResolvers = [];
        for (const resolve of resolvers) resolve();
    }

    // ── receiving ──────────────────────────────────────────────────────────────

    private enqueueMessage(data: string | ArrayBuffer): void {
        this.queue = this.queue
            .then(() => this.process(data))
            .catch((err) => {
                this.emitter.emit('error', { message: err instanceof Error ? err.message : 'receive failed' });
            });
    }

    private async process(data: string | ArrayBuffer): Promise<void> {
        if (typeof data === 'string') {
            const msg = parseControl(data);
            if (msg) await this.handleControl(msg);
            return;
        }
        const frame = decodeChunk(data);
        if (frame) await this.handleChunk(frame.index, frame.offset, frame.payload);
    }

    private async handleControl(msg: Control): Promise<void> {
        switch (msg.t) {
            case 'hello':
                return;
            case 'batch':
                for (const meta of msg.items) await this.ensureRecv(meta);
                return;
            case 'text':
                this.addRecvText(msg.id, msg.name, msg.content);
                return;
            case 'eof':
                return;
            case 'ack': {
                const s = this.sendByIndex.get(msg.i);
                if (s) s.acked = Math.max(s.acked, msg.recv);
                return;
            }
            case 'got': {
                const s = this.sendByIndex.get(msg.i);
                if (s && !s.done) {
                    s.done = true;
                    s.item.status = 'done';
                    s.item.transferred = s.meta.size;
                    this.emitter.emit('done', s.item);
                    this.scheduleChange();
                }
                return;
            }
            case 'resume': {
                for (const { i, have } of msg.items) {
                    const s = this.sendByIndex.get(i);
                    if (s && !s.done && !s.canceled) {
                        s.sent = Math.min(s.meta.size, Math.max(s.sent, have));
                        s.acked = Math.max(s.acked, have);
                        s.eofSent = false;
                        s.item.status = 'active';
                        s.item.transferred = s.sent;
                    }
                }
                this.scheduleChange();
                void this.pump();
                return;
            }
            case 'cancel-send': {
                const r = this.recvByIndex.get(msg.i);
                if (r && !r.complete) {
                    r.canceled = true;
                    r.item.status = 'canceled';
                    if (r.sink) void r.sink.close();
                    this.scheduleChange();
                }
                return;
            }
            case 'cancel-recv': {
                const s = this.sendByIndex.get(msg.i);
                if (s && !s.done) {
                    s.canceled = true;
                    s.item.status = 'canceled';
                    this.scheduleChange();
                }
                return;
            }
        }
    }

    private async ensureRecv(meta: ItemMeta): Promise<void> {
        if (this.recvByIndex.has(meta.i)) return;
        const item: TransferItem = {
            ...meta,
            dir: 'recv',
            status: 'active',
            transferred: 0,
            speed: 0,
            eta: Infinity,
        };
        const state: RecvState = {
            meta,
            item,
            sink: null,
            received: 0,
            lastAck: 0,
            complete: false,
            canceled: false,
        };
        this.recvByIndex.set(meta.i, state);
        this.order.push(item);
        this.emitter.emit('added', item);
        if (meta.size === 0) {
            state.complete = true;
            item.status = 'ready';
            this.sendControl({ t: 'got', i: meta.i });
            this.emitter.emit('done', item);
        } else {
            try {
                state.sink = await this.sinkFactory(meta);
            } catch (err) {
                item.status = 'failed';
                item.error = err instanceof Error ? err.message : 'sink error';
            }
        }
        this.scheduleChange();
    }

    private addRecvText(id: string, name: string, content: string): void {
        const i = -1 - this.order.length; // synthetic index, never collides with sender indices
        const size = new TextEncoder().encode(content).length;
        const item: TransferItem = {
            i,
            id,
            name,
            size,
            mime: 'text/plain',
            kind: 'text',
            dir: 'recv',
            status: 'completed',
            transferred: size,
            speed: 0,
            eta: 0,
            text: content,
        };
        this.order.push(item);
        this.emitter.emit('added', item);
        this.emitter.emit('done', item);
        this.scheduleChange();
    }

    private async handleChunk(index: number, offset: number, payload: Uint8Array): Promise<void> {
        const r = this.recvByIndex.get(index);
        if (!r || r.canceled || r.complete || !r.sink) return;
        await r.sink.writeAt(offset, payload);
        r.received = Math.max(r.received, offset + payload.byteLength);
        r.item.transferred = r.received;
        r.item.status = 'active';
        if (r.received - r.lastAck >= ACK_INTERVAL) {
            r.lastAck = r.received;
            this.sendControl({ t: 'ack', i: index, recv: r.received });
        }
        if (r.received >= r.meta.size) {
            r.complete = true;
            await r.sink.close();
            r.item.status = 'ready';
            this.sendControl({ t: 'ack', i: index, recv: r.received });
            this.sendControl({ t: 'got', i: index });
            this.emitter.emit('done', r.item);
        }
        this.scheduleChange();
    }

    private sendControl(msg: Control): void {
        this.channel?.send(encodeControl(msg));
    }

    // ── UI-facing ────────────────────────────────────────────────────────────

    cancel(id: string): void {
        for (const s of this.sendByIndex.values()) {
            if (s.item.id === id && !s.done && !s.canceled) {
                s.canceled = true;
                s.item.status = 'canceled';
                this.sendControl({ t: 'cancel-send', i: s.meta.i });
                this.scheduleChange();
                return;
            }
        }
        for (const r of this.recvByIndex.values()) {
            if (r.item.id === id && !r.complete && !r.canceled) {
                r.canceled = true;
                r.item.status = 'canceled';
                if (r.sink) void r.sink.close();
                this.sendControl({ t: 'cancel-recv', i: r.meta.i });
                this.scheduleChange();
                return;
            }
        }
    }

    markSaved(id: string): void {
        const item = this.order.find((it) => it.id === id);
        if (item && item.dir === 'recv') {
            item.status = 'done';
            this.scheduleChange();
        }
    }

    sinkFor(id: string): RecvState | undefined {
        for (const r of this.recvByIndex.values()) if (r.item.id === id) return r;
        return undefined;
    }

    getItems(): TransferItem[] {
        return this.order.map((it) => ({ ...it }));
    }

    clearFinished(): void {
        const drop = new Set<string>();
        for (const it of this.order) {
            if (it.status === 'done' || it.status === 'completed' || it.status === 'canceled' || it.status === 'failed') {
                drop.add(it.id);
            }
        }
        for (let idx = this.order.length - 1; idx >= 0; idx -= 1) {
            const it = this.order[idx];
            if (it && drop.has(it.id)) this.order.splice(idx, 1);
        }
        for (const [i, s] of [...this.sendByIndex]) if (drop.has(s.item.id)) this.sendByIndex.delete(i);
        for (const [i, r] of [...this.recvByIndex]) if (drop.has(r.item.id)) this.recvByIndex.delete(i);
        this.scheduleChange();
    }

    private scheduleChange(): void {
        if (this.changeScheduled) return;
        this.changeScheduled = true;
        const flush = (): void => {
            this.changeScheduled = false;
            this.emitter.emit('change', undefined as void);
        };
        if (typeof queueMicrotask === 'function') queueMicrotask(flush);
        else void Promise.resolve().then(flush);
    }

    dispose(): void {
        this.detachChannel();
        this.emitter.clear();
    }
}

function cryptoId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export type { ItemKind };
