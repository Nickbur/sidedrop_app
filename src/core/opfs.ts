import type { ItemMeta } from './types';
import type { Sink, SinkFactory } from './transfer';

/** A fully received item, ready to be handed to the OS (save picker / download / zip). */
export interface ReceivedFile {
    id: string;
    name: string;
    relPath: string;
    mime: string;
    size: number;
    getBlob(): Promise<Blob>;
    cleanup(): Promise<void>;
}

export interface SinkStore {
    readonly mode: 'opfs' | 'memory';
    factory: SinkFactory;
    get(id: string): ReceivedFile | undefined;
    all(): ReceivedFile[];
    dispose(): Promise<void>;
}

export function opfsSupported(): boolean {
    try {
        return (
            typeof navigator !== 'undefined' &&
            !!navigator.storage?.getDirectory &&
            typeof FileSystemFileHandle !== 'undefined' &&
            'createWritable' in FileSystemFileHandle.prototype
        );
    } catch {
        return false;
    }
}

const DIR = 'sidedrop';

export function createSinkStore(): SinkStore {
    const useOpfs = opfsSupported();
    const received = new Map<string, ReceivedFile>();

    const factory: SinkFactory = async (meta) => {
        if (useOpfs) {
            try {
                const { sink, file } = await opfsSink(meta);
                received.set(meta.id, file);
                return sink;
            } catch {
                /* fall through to memory */
            }
        }
        const { sink, file } = memorySink(meta);
        received.set(meta.id, file);
        return sink;
    };

    return {
        mode: useOpfs ? 'opfs' : 'memory',
        factory,
        get: (id) => received.get(id),
        all: () => [...received.values()],
        async dispose() {
            for (const f of received.values()) await f.cleanup().catch(() => undefined);
            received.clear();
        },
    };
}

async function opfsSink(meta: ItemMeta): Promise<{ sink: Sink; file: ReceivedFile }> {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(DIR, { create: true });
    const fname = `${meta.id}.part`;
    const handle = await dir.getFileHandle(fname, { create: true });
    const writable = await handle.createWritable({ keepExistingData: true });

    const sink: Sink = {
        async writeAt(offset, data) {
            await writable.write({ type: 'write', position: offset, data: data as unknown as BufferSource });
        },
        async close() {
            await writable.close();
        },
    };
    const file: ReceivedFile = {
        id: meta.id,
        name: meta.name,
        relPath: meta.relPath ?? meta.name,
        mime: meta.mime,
        size: meta.size,
        async getBlob() {
            return handle.getFile();
        },
        async cleanup() {
            try {
                await dir.removeEntry(fname);
            } catch {
                /* already gone */
            }
        },
    };
    return { sink, file };
}

function memorySink(meta: ItemMeta): { sink: Sink; file: ReceivedFile } {
    const buf = new Uint8Array(meta.size);
    let max = 0;
    const sink: Sink = {
        async writeAt(offset, data) {
            buf.set(data, offset);
            max = Math.max(max, offset + data.byteLength);
        },
        async close() {},
    };
    const file: ReceivedFile = {
        id: meta.id,
        name: meta.name,
        relPath: meta.relPath ?? meta.name,
        mime: meta.mime,
        size: meta.size,
        async getBlob() {
            return new Blob([buf.subarray(0, max || meta.size)], { type: meta.mime || 'application/octet-stream' });
        },
        async cleanup() {},
    };
    return { sink, file };
}
