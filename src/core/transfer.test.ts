import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { decodeChunk, encodeChunk, encodeControl, type Control } from './protocol';
import { TransferEngine, type Channel, type SendSource, type Sink } from './transfer';
import type { ItemMeta, TransferItem } from './types';

class FakeChannel implements Channel {
    peer: FakeChannel | null = null;
    open = true;
    limit = Infinity;
    private sends = 0;
    private msgCb: ((d: string | ArrayBuffer) => void) | null = null;

    onMessage(cb: (d: string | ArrayBuffer) => void): void {
        this.msgCb = cb;
    }
    onDrain(): void {}
    setLowThreshold(): void {}
    bufferedAmount(): number {
        return 0;
    }
    maxMessageSize(): number {
        return 256 * 1024;
    }
    send(data: string | ArrayBuffer): void {
        if (!this.open) return;
        this.sends += 1;
        if (this.sends > this.limit) {
            this.open = false;
            if (this.peer) this.peer.open = false;
            return;
        }
        const peer = this.peer;
        if (!peer || !peer.open) return;
        const copy = typeof data === 'string' ? data : data.slice(0);
        queueMicrotask(() => {
            if (peer.open) peer.deliver(copy);
        });
    }
    deliver(data: string | ArrayBuffer): void {
        this.msgCb?.(data);
    }
}

function pair(): [FakeChannel, FakeChannel] {
    const a = new FakeChannel();
    const b = new FakeChannel();
    a.peer = b;
    b.peer = a;
    return [a, b];
}

class MemorySink implements Sink {
    readonly data: Uint8Array;
    received = 0;
    constructor(size: number) {
        this.data = new Uint8Array(size);
    }
    async writeAt(offset: number, d: Uint8Array): Promise<void> {
        this.data.set(d, offset);
        this.received = Math.max(this.received, offset + d.byteLength);
    }
    async close(): Promise<void> {}
}

function bufSource(buf: Uint8Array): SendSource {
    return {
        size: buf.byteLength,
        async slice(s, e) {
            return buf.subarray(s, e);
        },
    };
}

function metaOf(name: string, buf: Uint8Array): Omit<ItemMeta, 'i'> {
    return { id: name, name, size: buf.byteLength, mime: 'application/octet-stream', kind: 'file' };
}

function waitUntil(pred: () => boolean, ms = 4000): Promise<void> {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const tick = (): void => {
            if (pred()) return resolve();
            if (Date.now() - start > ms) return reject(new Error('timeout'));
            setTimeout(tick, 4);
        };
        tick();
    });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const equal = (a: Uint8Array, b: Uint8Array): boolean => Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;

describe('TransferEngine', () => {
    it('transfers multiple files intact', async () => {
        const received = new Map<string, MemorySink>();
        const [ca, cb] = pair();
        const engA = new TransferEngine(async (m) => new MemorySink(m.size));
        const engB = new TransferEngine(async (m) => {
            const s = new MemorySink(m.size);
            received.set(m.name, s);
            return s;
        });
        engA.attachChannel(ca);
        engB.attachChannel(cb);

        const a = new Uint8Array(randomBytes(300 * 1024));
        const b = new Uint8Array(randomBytes(70 * 1024));
        engA.enqueue([
            { meta: metaOf('a.bin', a), source: bufSource(a) },
            { meta: metaOf('b.bin', b), source: bufSource(b) },
        ]);

        await waitUntil(() =>
            engA
                .getItems()
                .filter((i) => i.dir === 'send')
                .every((i) => i.status === 'done'),
        );
        expect(received.has('a.bin') && received.has('b.bin')).toBe(true);
        expect(equal(received.get('a.bin')!.data, a)).toBe(true);
        expect(equal(received.get('b.bin')!.data, b)).toBe(true);
        const recvB = engB.getItems().filter((i) => i.dir === 'recv');
        expect(recvB.every((i) => i.status === 'ready')).toBe(true);
    });

    it('delivers text instantly', async () => {
        const [ca, cb] = pair();
        const engA = new TransferEngine(async (m) => new MemorySink(m.size));
        const engB = new TransferEngine(async (m) => new MemorySink(m.size));
        engA.attachChannel(ca);
        engB.attachChannel(cb);

        engA.sendText('note.txt', 'hello sidedrop — привет');
        await waitUntil(() => engB.getItems().some((i) => i.dir === 'recv' && i.kind === 'text'));
        const text = engB.getItems().find((i) => i.kind === 'text');
        expect(text?.text).toBe('hello sidedrop — привет');
        expect(text?.status).toBe('completed');
    });

    it('resumes a dropped transfer from where it left off', async () => {
        const received = new Map<string, MemorySink>();
        const [ca, cb] = pair();
        ca.limit = 6; // deliver hello + batch + a few chunks to B, then drop the link
        const engA = new TransferEngine(async (m) => new MemorySink(m.size));
        const engB = new TransferEngine(async (m) => {
            const s = new MemorySink(m.size);
            received.set(m.name, s);
            return s;
        });
        engA.attachChannel(ca);
        engB.attachChannel(cb);

        const big = new Uint8Array(randomBytes(800 * 1024));
        engA.enqueue([{ meta: metaOf('big.bin', big), source: bufSource(big) }]);

        // Let the partial burst land, then confirm it really is partial.
        await sleep(30);
        const before = engB.getItems().find((i) => i.dir === 'recv')?.transferred ?? 0;
        expect(before).toBeGreaterThan(0);
        expect(before).toBeLessThan(big.byteLength);

        // Simulate the network switch: drop, then re-attach a fresh channel and resume.
        engA.detachChannel();
        engB.detachChannel();
        const [ca2, cb2] = pair();
        engA.attachChannel(ca2, { resume: true });
        engB.attachChannel(cb2, { resume: true });

        await waitUntil(() => engA.getItems().some((i) => i.dir === 'send' && i.status === 'done'));
        expect(equal(received.get('big.bin')!.data, big)).toBe(true);
    });
});

/**
 * The engine driven from one side only: a scripted channel records everything
 * the engine sends and lets the test play the other browser message by message,
 * so each control message and each failure path can be checked on its own.
 */
class ScriptedChannel implements Channel {
    readonly sent: Array<string | ArrayBuffer> = [];
    buffered = 0;
    max = 256 * 1024;
    threshold = 0;
    private msgCb: ((d: string | ArrayBuffer) => void) | null = null;
    private drainCb: (() => void) | null = null;

    send(data: string | ArrayBuffer): void {
        this.sent.push(data);
    }
    bufferedAmount(): number {
        return this.buffered;
    }
    maxMessageSize(): number {
        return this.max;
    }
    onMessage(cb: (d: string | ArrayBuffer) => void): void {
        this.msgCb = cb;
    }
    onDrain(cb: () => void): void {
        this.drainCb = cb;
    }
    setLowThreshold(bytes: number): void {
        this.threshold = bytes;
    }

    deliver(data: string | ArrayBuffer): void {
        this.msgCb?.(data);
    }
    control(msg: Control): void {
        this.deliver(encodeControl(msg));
    }
    drain(): void {
        this.drainCb?.();
    }
    controls(): Control[] {
        return this.sent.filter((d): d is string => typeof d === 'string').map((d) => JSON.parse(d) as Control);
    }
    frames(): Array<{ index: number; offset: number; length: number }> {
        return this.sent
            .filter((d): d is ArrayBuffer => typeof d !== 'string')
            .map((d) => decodeChunk(d)!)
            .map((f) => ({ index: f.index, offset: f.offset, length: f.payload.byteLength }));
    }
}

/** A source whose reads stay pending until the test releases them — a slow disk. */
function gatedSource(size: number): { source: SendSource; reads: Array<[number, number]>; release: () => void } {
    const reads: Array<[number, number]> = [];
    let pending: Array<() => void> = [];
    return {
        reads,
        source: {
            size,
            slice(s, e) {
                reads.push([s, e]);
                return new Promise((resolve) => pending.push(() => resolve(new Uint8Array(e - s))));
            },
        },
        release() {
            const now = pending;
            pending = [];
            for (const resolve of now) resolve();
        },
    };
}

const fileMeta = (id: string, size: number): Omit<ItemMeta, 'i'> => ({
    id,
    name: `${id}.bin`,
    size,
    mime: 'application/octet-stream',
    kind: 'file',
});

const zeros = (size: number): SendSource => bufSource(new Uint8Array(size));
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const sendItem = (engine: TransferEngine, id: string): TransferItem | undefined =>
    engine.getItems().find((it) => it.id === id && it.dir === 'send');
const recvItem = (engine: TransferEngine, id: string): TransferItem | undefined =>
    engine.getItems().find((it) => it.id === id && it.dir === 'recv');

function memorySinks(): {
    factory: (m: ItemMeta) => Promise<MemorySink & { closed: boolean }>;
    sinks: Map<string, MemorySink & { closed: boolean }>;
} {
    const sinks = new Map<string, MemorySink & { closed: boolean }>();
    return {
        sinks,
        factory: async (m) => {
            const sink = Object.assign(new MemorySink(m.size), { closed: false });
            sink.close = async () => {
                sink.closed = true;
            };
            sinks.set(m.id, sink);
            return sink;
        },
    };
}

describe('TransferEngine — attaching a channel', () => {
    it('greets the other side and asks to be told when the buffer drains to 1 MiB', () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        expect(ch.controls()).toEqual([{ t: 'hello', v: 1 }]);
        expect(ch.threshold).toBe(1024 * 1024);
    });

    it('queues files offered before the other device is connected', () => {
        const engine = new TransferEngine(memorySinks().factory);
        const added: string[] = [];
        engine.emitter.on('added', (it) => added.push(`${it.id}:${it.status}`));

        engine.enqueue([
            { meta: fileMeta('a', 10), source: zeros(10) },
            { meta: fileMeta('empty', 0), source: zeros(0) },
        ]);

        expect(added).toEqual(['a:queued', 'empty:active']);
        expect(engine.getItems().map((it) => it.i)).toEqual([0, 1]);
    });

    it('announces new files and streams them in chunks capped by the message size', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        ch.max = 20 * 1024;
        engine.attachChannel(ch);

        engine.enqueue([{ meta: fileMeta('a', 50 * 1024), source: zeros(50 * 1024) }]);
        await settle();

        const chunk = 20 * 1024 - 12;
        expect(ch.controls().slice(1, 2)).toEqual([{ t: 'batch', items: [{ ...fileMeta('a', 50 * 1024), i: 0 }] }]);
        expect(ch.frames()).toEqual([
            { index: 0, offset: 0, length: chunk },
            { index: 0, offset: chunk, length: chunk },
            { index: 0, offset: 2 * chunk, length: 50 * 1024 - 2 * chunk },
        ]);
        expect(ch.controls().at(-1)).toEqual({ t: 'eof', i: 0 });
        expect(sendItem(engine, 'a')).toMatchObject({ status: 'active', transferred: 50 * 1024 });
    });

    it('never uses chunks smaller than 16 KiB or larger than 64 KiB', async () => {
        for (const [max, expected] of [
            [1000, 16 * 1024],
            [1024 * 1024, 64 * 1024],
        ] as const) {
            const engine = new TransferEngine(memorySinks().factory);
            const ch = new ScriptedChannel();
            ch.max = max;
            engine.attachChannel(ch);
            engine.enqueue([{ meta: fileMeta('a', 100 * 1024), source: zeros(100 * 1024) }]);
            await settle();
            expect(ch.frames()[0]?.length).toBe(expected);
        }
    });
});

describe('TransferEngine — flow control', () => {
    it('stops sending while the channel buffer is over 8 MiB and resumes on drain', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        ch.buffered = 9 * 1024 * 1024;
        engine.attachChannel(ch);
        engine.enqueue([{ meta: fileMeta('a', 1024), source: zeros(1024) }]);
        await settle();
        expect(ch.frames()).toEqual([]);

        ch.buffered = 0;
        ch.drain();
        await settle();
        expect(ch.frames()).toEqual([{ index: 0, offset: 0, length: 1024 }]);
    });

    it('pauses everything unfinished when the channel goes away, even mid-wait', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        ch.buffered = 9 * 1024 * 1024;
        engine.attachChannel(ch);
        engine.enqueue([{ meta: fileMeta('a', 1024), source: zeros(1024) }]);
        ch.control({ t: 'batch', items: [{ ...fileMeta('in', 10), i: 0 }] });
        await settle();

        engine.detachChannel();
        await settle();

        expect(sendItem(engine, 'a')?.status).toBe('paused');
        expect(recvItem(engine, 'in')?.status).toBe('paused');
        expect(ch.frames()).toEqual([]);
    });

    it('reports a file that cannot be read as an engine error', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const errors: Array<{ message: string }> = [];
        engine.emitter.on('error', (e) => errors.push(e));
        engine.attachChannel(new ScriptedChannel());

        const failing = (reason: unknown): SendSource => ({ size: 10, slice: () => Promise.reject(reason) });
        engine.enqueue([{ meta: fileMeta('a', 10), source: failing(new Error('NotReadableError')) }]);
        await settle();
        engine.cancel('a');
        engine.enqueue([{ meta: fileMeta('b', 10), source: failing('gone') }]);
        await settle();

        expect(errors).toEqual([{ message: 'NotReadableError' }, { message: 'send failed' }]);
    });
});

describe('TransferEngine — receiving', () => {
    it('creates a sink per announced file, acknowledges progress and marks it ready', async () => {
        const { factory, sinks } = memorySinks();
        const engine = new TransferEngine(factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const done: string[] = [];
        engine.emitter.on('done', (it) => done.push(it.id));

        const size = 300 * 1024;
        ch.control({ t: 'batch', items: [{ ...fileMeta('a', size), i: 4 }] });
        ch.control({ t: 'batch', items: [{ ...fileMeta('a', size), i: 4 }] });
        ch.control({ t: 'hello', v: 1 });
        for (let offset = 0; offset < size; offset += 64 * 1024) {
            ch.deliver(encodeChunk(4, offset, new Uint8Array(Math.min(64 * 1024, size - offset)).fill(7)));
        }
        ch.control({ t: 'eof', i: 4 });
        await settle();

        expect(engine.getItems()).toHaveLength(1);
        expect(recvItem(engine, 'a')).toMatchObject({ status: 'ready', transferred: size, i: 4 });
        expect(sinks.get('a')?.data.every((b) => b === 7)).toBe(true);
        expect(sinks.get('a')?.closed).toBe(true);
        expect(ch.controls().slice(1)).toEqual([
            { t: 'ack', i: 4, recv: 256 * 1024 },
            { t: 'ack', i: 4, recv: size },
            { t: 'got', i: 4 },
        ]);
        expect(done).toEqual(['a']);
    });

    it('marks an empty file ready at once without a sink', async () => {
        const { factory, sinks } = memorySinks();
        const engine = new TransferEngine(factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);

        ch.control({ t: 'batch', items: [{ ...fileMeta('empty', 0), i: 0 }] });
        await settle();

        expect(recvItem(engine, 'empty')?.status).toBe('ready');
        expect(sinks.size).toBe(0);
        expect(ch.controls().at(-1)).toEqual({ t: 'got', i: 0 });
    });

    it('marks a file failed when no sink can be created for it', async () => {
        let call = 0;
        const engine = new TransferEngine(async () => {
            call += 1;
            throw call === 1 ? new Error('QuotaExceededError') : 'nope';
        });
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);

        ch.control({
            t: 'batch',
            items: [
                { ...fileMeta('a', 10), i: 0 },
                { ...fileMeta('b', 10), i: 1 },
            ],
        });
        ch.deliver(encodeChunk(0, 0, new Uint8Array(10)));
        await settle();

        expect(recvItem(engine, 'a')).toMatchObject({ status: 'failed', error: 'QuotaExceededError', transferred: 0 });
        expect(recvItem(engine, 'b')).toMatchObject({ status: 'failed', error: 'sink error' });
    });

    it('reports a failed write and keeps processing the next messages', async () => {
        const errors: string[] = [];
        let fail: unknown = new Error('disk full');
        const engine = new TransferEngine(async () => ({
            writeAt: async () => {
                if (fail) throw fail;
            },
            close: async () => undefined,
        }));
        engine.emitter.on('error', (e) => errors.push(e.message));
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);

        ch.control({ t: 'batch', items: [{ ...fileMeta('a', 20), i: 0 }] });
        ch.deliver(encodeChunk(0, 0, new Uint8Array(10)));
        ch.deliver(encodeChunk(0, 0, new Uint8Array(10)));
        await settle();
        fail = 'gone';
        ch.deliver(encodeChunk(0, 0, new Uint8Array(10)));
        await settle();
        fail = null;
        ch.deliver(encodeChunk(0, 0, new Uint8Array(20)));
        await settle();

        expect(errors).toEqual(['disk full', 'disk full', 'receive failed']);
        expect(recvItem(engine, 'a')?.status).toBe('ready');
    });

    it('ignores chunks for unknown files, garbage frames and unknown control messages', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);

        ch.deliver(encodeChunk(9, 0, new Uint8Array(4)));
        ch.deliver(new ArrayBuffer(3));
        ch.deliver('{"t":"party"}');
        ch.control({ t: 'ack', i: 9, recv: 10 });
        ch.control({ t: 'got', i: 9 });
        ch.control({ t: 'cancel-send', i: 9 });
        ch.control({ t: 'cancel-recv', i: 9 });
        await settle();

        expect(engine.getItems()).toEqual([]);
        expect(ch.sent).toHaveLength(1);
    });

    it('keeps received text as a completed item with its content', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);

        ch.control({ t: 'text', id: 't1', name: 'text.txt', content: 'héllo' });
        ch.control({ t: 'text', id: 't2', name: 'text.txt', content: 'again' });
        await settle();

        const texts = engine.getItems();
        expect(texts.map((t) => [t.id, t.status, t.size, t.text, t.dir])).toEqual([
            ['t1', 'completed', 6, 'héllo', 'recv'],
            ['t2', 'completed', 5, 'again', 'recv'],
        ]);
        expect(new Set(texts.map((t) => t.i)).size).toBe(2);
        expect(texts.every((t) => t.i < 0)).toBe(true);
    });
});

describe('TransferEngine — completion', () => {
    it('marks a sent file delivered when the receiver confirms it, once', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const done: string[] = [];
        engine.emitter.on('done', (it) => done.push(it.id));
        engine.enqueue([{ meta: fileMeta('a', 10), source: zeros(10) }]);
        await settle();

        ch.control({ t: 'got', i: 0 });
        ch.control({ t: 'got', i: 0 });
        await settle();

        expect(sendItem(engine, 'a')).toMatchObject({ status: 'done', transferred: 10 });
        expect(done).toEqual(['a']);
    });

    it('marks a zero-byte file delivered once the receiver confirms it', async () => {
        const [ca, cb] = pair();
        const sender = new TransferEngine(memorySinks().factory);
        const receiver = new TransferEngine(memorySinks().factory);
        sender.attachChannel(ca);
        receiver.attachChannel(cb);
        const done: string[] = [];
        sender.emitter.on('done', (it) => done.push(it.id));

        sender.enqueue([{ meta: fileMeta('empty', 0), source: zeros(0) }]);
        await waitUntil(() => recvItem(receiver, 'empty')?.status === 'ready');
        await settle();

        expect(sendItem(sender, 'empty')?.status).toBe('done');
        expect(done).toEqual(['empty']);
    });

    it('sends text instantly and records it as done', () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const done: string[] = [];
        engine.emitter.on('done', (it) => done.push(it.name));

        engine.sendText('text.txt', 'hi');

        const sent = ch.controls().at(-1) as Extract<Control, { t: 'text' }>;
        expect(sent).toMatchObject({ t: 'text', name: 'text.txt', content: 'hi' });
        expect(engine.getItems()[0]).toMatchObject({ id: sent.id, dir: 'send', status: 'done', text: 'hi' });
        expect(done).toEqual(['text.txt']);
    });

    it('falls back to a random id where crypto.randomUUID is missing', () => {
        vi.stubGlobal('crypto', {});
        const engine = new TransferEngine(memorySinks().factory);
        engine.sendText('a.txt', 'a');
        engine.sendText('b.txt', 'b');
        const [a, b] = engine.getItems();
        expect(a?.id).toMatch(/^[a-z0-9]+$/);
        expect(a?.id).not.toBe(b?.id);
    });
});

describe('TransferEngine — cancelling', () => {
    it('stops sending a file the sender cancels and tells the receiver', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        ch.buffered = 9 * 1024 * 1024;
        engine.attachChannel(ch);
        engine.enqueue([{ meta: fileMeta('a', 10), source: zeros(10) }]);
        await settle();

        engine.cancel('a');
        engine.cancel('a');
        ch.buffered = 0;
        ch.drain();
        await settle();

        expect(sendItem(engine, 'a')?.status).toBe('canceled');
        expect(ch.controls().filter((c) => c.t === 'cancel-send')).toEqual([{ t: 'cancel-send', i: 0 }]);
        expect(ch.frames()).toEqual([]);
    });

    it('keeps a file canceled while its next chunk is still being read', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const gated = gatedSource(100 * 1024);
        engine.enqueue([{ meta: fileMeta('a', 100 * 1024), source: gated.source }]);
        await settle();
        expect(gated.reads).toEqual([[0, 64 * 1024]]);

        engine.cancel('a');
        gated.release();
        await settle();

        expect(sendItem(engine, 'a')?.status).toBe('canceled');
        expect(ch.frames()).toEqual([]);
    });

    it('stops sending when the receiver cancels', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const gated = gatedSource(100 * 1024);
        engine.enqueue([{ meta: fileMeta('a', 100 * 1024), source: gated.source }]);
        await settle();

        ch.control({ t: 'cancel-recv', i: 0 });
        await settle();
        gated.release();
        await settle();

        expect(sendItem(engine, 'a')?.status).toBe('canceled');
        expect(ch.frames()).toEqual([]);
    });

    it('drops a file the receiver cancels, closes its sink and tells the sender', async () => {
        const { factory, sinks } = memorySinks();
        const engine = new TransferEngine(factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        ch.control({ t: 'batch', items: [{ ...fileMeta('a', 100), i: 2 }] });
        await settle();

        engine.cancel('a');
        ch.deliver(encodeChunk(2, 0, new Uint8Array(100)));
        await settle();

        expect(recvItem(engine, 'a')).toMatchObject({ status: 'canceled', transferred: 0 });
        expect(sinks.get('a')?.closed).toBe(true);
        expect(ch.controls().at(-1)).toEqual({ t: 'cancel-recv', i: 2 });
    });

    it('drops an incoming file the sender cancels', async () => {
        const { factory, sinks } = memorySinks();
        const engine = new TransferEngine(factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        ch.control({ t: 'batch', items: [{ ...fileMeta('a', 100), i: 0 }] });
        ch.control({ t: 'cancel-send', i: 0 });
        await settle();

        expect(recvItem(engine, 'a')?.status).toBe('canceled');
        expect(sinks.get('a')?.closed).toBe(true);
    });

    it('does nothing for finished, unknown or sink-less items', async () => {
        const engine = new TransferEngine(async () => {
            throw new Error('no sink');
        });
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        ch.control({ t: 'batch', items: [{ ...fileMeta('failed', 10), i: 0 }] });
        ch.control({ t: 'text', id: 'txt', name: 'text.txt', content: 'x' });
        await settle();
        const before = ch.sent.length;

        engine.cancel('nope');
        engine.cancel('txt');
        ch.control({ t: 'cancel-send', i: 0 });
        await settle();
        engine.cancel('failed');

        expect(recvItem(engine, 'failed')?.status).toBe('canceled');
        expect(ch.sent.length).toBe(before);
    });
});

describe('TransferEngine — resuming after a reconnect', () => {
    it('restarts each unfinished send from the last acknowledged byte', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const first = new ScriptedChannel();
        engine.attachChannel(first);
        engine.enqueue([
            { meta: fileMeta('a', 200 * 1024), source: zeros(200 * 1024) },
            { meta: fileMeta('b', 10), source: zeros(10) },
            { meta: fileMeta('c', 10), source: zeros(10) },
        ]);
        await settle();
        first.control({ t: 'ack', i: 0, recv: 64 * 1024 });
        first.control({ t: 'ack', i: 0, recv: 10 });
        first.control({ t: 'got', i: 1 });
        await settle();
        engine.cancel('c');
        engine.detachChannel();

        const second = new ScriptedChannel();
        engine.attachChannel(second, { resume: true });
        await settle();

        expect(second.controls()[1]).toEqual({ t: 'batch', items: [{ ...fileMeta('a', 200 * 1024), i: 0 }] });
        expect(second.frames()[0]).toEqual({ index: 0, offset: 64 * 1024, length: 64 * 1024 });
        expect(second.controls().at(-1)).toEqual({ t: 'eof', i: 0 });
        expect(sendItem(engine, 'a')?.status).toBe('active');
    });

    it('tells the sender how much of each unfinished file it already has', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const first = new ScriptedChannel();
        engine.attachChannel(first);
        first.control({
            t: 'batch',
            items: [
                { ...fileMeta('part', 100), i: 0 },
                { ...fileMeta('full', 10), i: 1 },
                { ...fileMeta('dropped', 10), i: 2 },
            ],
        });
        first.deliver(encodeChunk(0, 0, new Uint8Array(40)));
        first.deliver(encodeChunk(1, 0, new Uint8Array(10)));
        first.control({ t: 'cancel-send', i: 2 });
        await settle();
        engine.detachChannel();

        const second = new ScriptedChannel();
        engine.attachChannel(second, { resume: true });

        expect(second.controls()).toEqual([
            { t: 'hello', v: 1 },
            { t: 'resume', items: [{ i: 0, have: 40 }] },
        ]);
        expect(recvItem(engine, 'part')?.status).toBe('active');
        expect(recvItem(engine, 'full')?.status).toBe('ready');
    });

    it('sends nothing extra on a resume with nothing pending', () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch, { resume: true });
        expect(ch.controls()).toEqual([{ t: 'hello', v: 1 }]);
    });

    it("skips ahead to what the receiver reports it has, never past the file's end", async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        ch.buffered = 9 * 1024 * 1024;
        engine.attachChannel(ch);
        engine.enqueue([
            { meta: fileMeta('a', 100 * 1024), source: zeros(100 * 1024) },
            { meta: fileMeta('b', 10), source: zeros(10) },
            { meta: fileMeta('c', 10), source: zeros(10) },
        ]);
        engine.cancel('c');
        ch.control({ t: 'got', i: 1 });
        await settle();

        ch.buffered = 0;
        ch.control({
            t: 'resume',
            items: [
                { i: 0, have: 70 * 1024 },
                { i: 1, have: 5 },
                { i: 2, have: 5 },
                { i: 7, have: 5 },
            ],
        });
        ch.drain();
        await settle();
        expect(ch.frames()).toEqual([{ index: 0, offset: 70 * 1024, length: 30 * 1024 }]);

        ch.control({ t: 'resume', items: [{ i: 0, have: 999 * 1024 }] });
        await settle();
        expect(sendItem(engine, 'a')?.transferred).toBe(100 * 1024);
    });
});

describe('TransferEngine — the transfer list', () => {
    it('marks received items saved, and leaves sent ones and unknown ids alone', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        ch.control({ t: 'batch', items: [{ ...fileMeta('in', 0), i: 0 }] });
        engine.sendText('text.txt', 'x');
        await settle();
        const outId = engine.getItems().find((it) => it.dir === 'send')!.id;

        engine.markSaved('in');
        engine.markSaved(outId);
        engine.markSaved('nope');

        expect(recvItem(engine, 'in')?.status).toBe('done');
        expect(sendItem(engine, outId)?.status).toBe('done');
    });

    it('finds the receive state of an incoming file by id', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        ch.control({ t: 'batch', items: [{ ...fileMeta('in', 10), i: 3 }] });
        await settle();

        expect(engine.sinkFor('in')?.meta.i).toBe(3);
        expect(engine.sinkFor('nope')).toBeUndefined();
    });

    it('clears finished, canceled and failed items and keeps the rest', async () => {
        const engine = new TransferEngine(async (m) => {
            if (m.id === 'bad') throw new Error('no sink');
            return new MemorySink(m.size);
        });
        const ch = new ScriptedChannel();
        ch.buffered = 9 * 1024 * 1024;
        engine.attachChannel(ch);
        engine.enqueue([
            { meta: fileMeta('sending', 10), source: zeros(10) },
            { meta: fileMeta('stopped', 10), source: zeros(10) },
        ]);
        engine.cancel('stopped');
        ch.control({
            t: 'batch',
            items: [
                { ...fileMeta('ready', 0), i: 0 },
                { ...fileMeta('bad', 10), i: 1 },
                { ...fileMeta('saved', 0), i: 2 },
            ],
        });
        ch.control({ t: 'text', id: 'note', name: 'text.txt', content: 'x' });
        await settle();
        engine.markSaved('saved');

        engine.clearFinished();
        ch.control({ t: 'cancel-recv', i: 1 });
        await settle();

        expect(engine.getItems().map((it) => it.id)).toEqual(['sending', 'ready']);
        expect(sendItem(engine, 'sending')?.status).toBe('queued');
    });

    it('hands out copies, so callers cannot change the engine state', () => {
        const engine = new TransferEngine(memorySinks().factory);
        engine.enqueue([{ meta: fileMeta('a', 10), source: zeros(10) }]);
        const [copy] = engine.getItems();
        copy!.status = 'done';
        expect(engine.getItems()[0]?.status).toBe('queued');
    });

    it('coalesces changes into one notification per tick', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        let changes = 0;
        engine.emitter.on('change', () => (changes += 1));

        engine.enqueue([{ meta: fileMeta('a', 10), source: zeros(10) }]);
        engine.enqueue([{ meta: fileMeta('b', 10), source: zeros(10) }]);
        engine.clearFinished();
        await settle();
        expect(changes).toBe(1);

        engine.clearFinished();
        await settle();
        expect(changes).toBe(2);
    });

    it('still notifies where queueMicrotask is missing', async () => {
        vi.stubGlobal('queueMicrotask', undefined);
        const engine = new TransferEngine(memorySinks().factory);
        let changes = 0;
        engine.emitter.on('change', () => (changes += 1));

        engine.clearFinished();
        await settle();

        expect(changes).toBe(1);
    });

    it('goes quiet after dispose', async () => {
        const engine = new TransferEngine(memorySinks().factory);
        const ch = new ScriptedChannel();
        engine.attachChannel(ch);
        const seen = vi.fn();
        engine.emitter.on('change', seen);
        engine.emitter.on('added', seen);

        engine.dispose();
        engine.enqueue([{ meta: fileMeta('a', 10), source: zeros(10) }]);
        await settle();

        expect(seen).not.toHaveBeenCalled();
        expect(ch.frames()).toEqual([]);
        expect(sendItem(engine, 'a')?.status).toBe('queued');
    });
});
