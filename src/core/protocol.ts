import type { ItemMeta } from './types';

/**
 * The data-channel wire protocol. Two message shapes ride the same
 * RTCDataChannel: JSON control strings, and binary chunk frames. The signaling
 * server never sees any of this — it is end-to-end between the two browsers.
 */

export const PROTOCOL_VERSION = 1;

/** Binary chunk frame: [u8 type][u16 index][u8 flags][f64 offset][...payload]. */
export const FRAME_CHUNK = 0x01;
export const CHUNK_HEADER_BYTES = 12;

/** Default payload size per chunk; clamped at runtime to the channel's maxMessageSize. */
export const DEFAULT_CHUNK_SIZE = 64 * 1024;
export const MIN_CHUNK_SIZE = 16 * 1024;

export interface ChunkFrame {
    index: number;
    offset: number;
    payload: Uint8Array;
}

export function encodeChunk(index: number, offset: number, payload: Uint8Array): ArrayBuffer {
    const buf = new ArrayBuffer(CHUNK_HEADER_BYTES + payload.byteLength);
    const view = new DataView(buf);
    view.setUint8(0, FRAME_CHUNK);
    view.setUint16(1, index, false);
    view.setUint8(3, 0);
    view.setFloat64(4, offset, false);
    new Uint8Array(buf, CHUNK_HEADER_BYTES).set(payload);
    return buf;
}

/** Decode a chunk frame, copying the payload so it is safe to keep past this tick. */
export function decodeChunk(buf: ArrayBuffer): ChunkFrame | null {
    if (buf.byteLength < CHUNK_HEADER_BYTES) return null;
    const view = new DataView(buf);
    if (view.getUint8(0) !== FRAME_CHUNK) return null;
    const index = view.getUint16(1, false);
    const offset = view.getFloat64(4, false);
    const payload = new Uint8Array(buf.slice(CHUNK_HEADER_BYTES));
    return { index, offset, payload };
}

/** JSON control messages exchanged over the same channel. */
export type Control =
    | { t: 'hello'; v: number }
    | { t: 'batch'; items: ItemMeta[] }
    | { t: 'text'; id: string; name: string; content: string }
    | { t: 'eof'; i: number }
    | { t: 'cancel-send'; i: number }
    | { t: 'ack'; i: number; recv: number }
    | { t: 'got'; i: number }
    | { t: 'resume'; items: Array<{ i: number; have: number }> }
    | { t: 'cancel-recv'; i: number };

const CONTROL_TYPES = new Set([
    'hello',
    'batch',
    'text',
    'eof',
    'cancel-send',
    'ack',
    'got',
    'resume',
    'cancel-recv',
]);

export function encodeControl(msg: Control): string {
    return JSON.stringify(msg);
}

export function parseControl(raw: string): Control | null {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null) return null;
    const t = (value as { t?: unknown }).t;
    if (typeof t !== 'string' || !CONTROL_TYPES.has(t)) return null;
    return value as Control;
}
