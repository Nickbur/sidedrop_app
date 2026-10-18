import type { ReceivedFile } from '../core/opfs';
import type { SessionState } from '../core/session';
import type { ItemMeta, TransferItem } from '../core/types';

/**
 * Test data in the shapes the app passes around. Every factory returns a
 * complete, valid object and takes overrides for the one or two fields a test
 * cares about — so a test reads as "a received file ready to save", not as a
 * dozen lines of setup.
 */

export function meta(overrides: Partial<ItemMeta> = {}): ItemMeta {
    return {
        i: 0,
        id: 'item-1',
        name: 'photo.jpg',
        size: 1024,
        mime: 'image/jpeg',
        kind: 'file',
        ...overrides,
    };
}

export function item(overrides: Partial<TransferItem> = {}): TransferItem {
    return {
        ...meta(),
        dir: 'recv',
        status: 'active',
        transferred: 0,
        speed: 0,
        eta: Infinity,
        ...overrides,
    };
}

export function sessionState(overrides: Partial<SessionState> = {}): SessionState {
    return {
        status: 'idle',
        roomId: null,
        code: null,
        link: null,
        role: null,
        peerConnected: false,
        sinkMode: 'opfs',
        errorCode: null,
        ...overrides,
    };
}

/** A received file held in memory; `cleanups` counts how often it was released. */
export function receivedFile(
    overrides: Partial<Omit<ReceivedFile, 'getBlob' | 'cleanup'>> & { content?: string } = {},
): ReceivedFile & { cleanups: number } {
    const { content = 'hello', ...rest } = overrides;
    const file = {
        id: 'item-1',
        name: 'notes.txt',
        relPath: 'notes.txt',
        mime: 'text/plain',
        size: content.length,
        ...rest,
        cleanups: 0,
        async getBlob(): Promise<Blob> {
            return new Blob([content], { type: file.mime });
        },
        async cleanup(): Promise<void> {
            file.cleanups += 1;
        },
    };
    return file;
}

/** A browser File with the given text content. */
export function textFile(name: string, content = name, type = 'text/plain'): File {
    return new File([content], name, { type });
}

/** Concatenates collected stream chunks into one string. */
export function decodeChunks(chunks: Uint8Array[]): string {
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const all = new Uint8Array(total);
    let at = 0;
    for (const c of chunks) {
        all.set(c, at);
        at += c.byteLength;
    }
    return new TextDecoder().decode(all);
}

/** A WritableStream that keeps every chunk written to it. */
export function collectingStream(): { stream: WritableStream<Uint8Array>; chunks: Uint8Array[] } {
    const chunks: Uint8Array[] = [];
    const stream = new WritableStream<Uint8Array>({
        write(chunk) {
            chunks.push(chunk);
        },
    });
    return { stream, chunks };
}
