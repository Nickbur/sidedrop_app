import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TransferEngine, type Channel, type SendSource, type Sink } from './transfer';
import type { ItemMeta } from './types';

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

        await waitUntil(() => engA.getItems().filter((i) => i.dir === 'send').every((i) => i.status === 'done'));
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
