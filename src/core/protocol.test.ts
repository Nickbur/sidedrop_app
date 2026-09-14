import { describe, expect, it } from 'vitest';
import {
    CHUNK_HEADER_BYTES,
    decodeChunk,
    encodeChunk,
    encodeControl,
    parseControl,
} from './protocol';

describe('chunk frame codec', () => {
    it('round-trips index, offset and payload', () => {
        const payload = new Uint8Array([1, 2, 3, 250, 0, 99]);
        const buf = encodeChunk(42, 1024 * 1024 * 1024 + 7, payload);
        const frame = decodeChunk(buf);
        expect(frame).not.toBeNull();
        expect(frame!.index).toBe(42);
        expect(frame!.offset).toBe(1024 * 1024 * 1024 + 7);
        expect([...frame!.payload]).toEqual([...payload]);
    });

    it('copies the payload (independent of the source buffer)', () => {
        const payload = new Uint8Array([9, 9, 9]);
        const buf = encodeChunk(0, 0, payload);
        const frame = decodeChunk(buf)!;
        new Uint8Array(buf, CHUNK_HEADER_BYTES).fill(0); // mutate original after decode
        expect([...frame.payload]).toEqual([9, 9, 9]);
    });

    it('rejects too-short or wrong-type buffers', () => {
        expect(decodeChunk(new ArrayBuffer(4))).toBeNull();
        const bad = new ArrayBuffer(CHUNK_HEADER_BYTES + 1);
        new DataView(bad).setUint8(0, 0x99);
        expect(decodeChunk(bad)).toBeNull();
    });
});

describe('control message codec', () => {
    it('round-trips a batch', () => {
        const msg = encodeControl({
            t: 'batch',
            items: [{ i: 0, id: 'x', name: 'a.txt', size: 10, mime: 'text/plain', kind: 'file' }],
        });
        const parsed = parseControl(msg);
        expect(parsed?.t).toBe('batch');
    });

    it('rejects non-JSON and unknown types', () => {
        expect(parseControl('not json')).toBeNull();
        expect(parseControl(JSON.stringify({ t: 'evil' }))).toBeNull();
        expect(parseControl(JSON.stringify({ nope: 1 }))).toBeNull();
    });
});
