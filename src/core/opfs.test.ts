import { describe, expect, it, vi } from 'vitest';
import { createSinkStore, opfsSupported } from './opfs';
import { meta } from '../test/fixtures';

/**
 * Where incoming bytes land before the user saves them: the browser's private
 * file system (OPFS) when it can write positioned chunks, memory otherwise. A
 * chunk written at the wrong offset corrupts the file; a part-file never removed
 * fills the user's disk. A small in-memory OPFS stands in for the browser's.
 */

class FakeWritable {
    readonly writes: Array<{ position: number; data: number[] }> = [];
    closed = false;

    async write(cmd: { type: string; position: number; data: Uint8Array }): Promise<void> {
        this.writes.push({ position: cmd.position, data: [...cmd.data] });
    }

    async close(): Promise<void> {
        this.closed = true;
    }
}

class FakeFileHandle {
    readonly writable = new FakeWritable();
    readonly writableOptions: unknown[] = [];

    constructor(readonly name: string) {}

    async createWritable(options: unknown): Promise<FakeWritable> {
        this.writableOptions.push(options);
        return this.writable;
    }

    async getFile(): Promise<File> {
        return new File(['from-opfs'], this.name);
    }
}

class FakeDirectory {
    readonly dirs = new Map<string, FakeDirectory>();
    readonly files = new Map<string, FakeFileHandle>();
    readonly removed: string[] = [];

    async getDirectoryHandle(name: string, options: { create: boolean }): Promise<FakeDirectory> {
        expect(options).toEqual({ create: true });
        let dir = this.dirs.get(name);
        if (!dir) {
            dir = new FakeDirectory();
            this.dirs.set(name, dir);
        }
        return dir;
    }

    async getFileHandle(name: string, options: { create: boolean }): Promise<FakeFileHandle> {
        expect(options).toEqual({ create: true });
        const handle = new FakeFileHandle(name);
        this.files.set(name, handle);
        return handle;
    }

    async removeEntry(name: string): Promise<void> {
        if (!this.files.delete(name)) throw new Error('NotFoundError');
        this.removed.push(name);
    }
}

/** Gives the page an OPFS root (and, unless told otherwise, a writable file handle class). */
function installOpfs(root: FakeDirectory | Error, opts: { createWritable?: boolean } = {}): void {
    const getDirectory = async (): Promise<FakeDirectory> => {
        if (root instanceof Error) throw root;
        return root;
    };
    vi.stubGlobal('navigator', { storage: { getDirectory } });
    const Handle =
        opts.createWritable === false
            ? class {}
            : class {
                  createWritable(): void {}
              };
    vi.stubGlobal('FileSystemFileHandle', Handle);
}

async function blobText(blob: Blob): Promise<string> {
    return new TextDecoder().decode(await blob.arrayBuffer());
}

describe('opfsSupported', () => {
    it('is false in a browser without OPFS', () => {
        expect(opfsSupported()).toBe(false);
    });

    it('is true when there is an OPFS root and file handles can be written to', () => {
        installOpfs(new FakeDirectory());
        expect(opfsSupported()).toBe(true);
    });

    it('is false when file handles cannot be written to (older Safari)', () => {
        installOpfs(new FakeDirectory(), { createWritable: false });
        expect(opfsSupported()).toBe(false);
    });

    it('is false when merely asking for storage throws', () => {
        vi.stubGlobal('navigator', {
            get storage(): never {
                throw new Error('SecurityError');
            },
        });
        expect(opfsSupported()).toBe(false);
    });
});

describe('OPFS-backed store', () => {
    it('writes each chunk at its offset into a part-file in the sidedrop folder', async () => {
        const root = new FakeDirectory();
        installOpfs(root);
        const store = createSinkStore();
        expect(store.mode).toBe('opfs');

        const sink = await store.factory(meta({ id: 'abc', size: 4 }));
        await sink.writeAt(2, new Uint8Array([3, 4]));
        await sink.writeAt(0, new Uint8Array([1, 2]));
        await sink.close();

        const handle = root.dirs.get('sidedrop')?.files.get('abc.part');
        expect(handle?.writableOptions).toEqual([{ keepExistingData: true }]);
        expect(handle?.writable.writes).toEqual([
            { position: 2, data: [3, 4] },
            { position: 0, data: [1, 2] },
        ]);
        expect(handle?.writable.closed).toBe(true);
    });

    it('describes the received file and reads it back from OPFS', async () => {
        installOpfs(new FakeDirectory());
        const store = createSinkStore();
        await store.factory(meta({ id: 'abc', name: 'a.txt', relPath: 'docs/a.txt', mime: 'text/plain', size: 9 }));
        await store.factory(meta({ id: 'def', name: 'b.txt', relPath: undefined }));

        const file = store.get('abc');
        expect(file).toMatchObject({ id: 'abc', name: 'a.txt', relPath: 'docs/a.txt', mime: 'text/plain', size: 9 });
        expect(await blobText(await file!.getBlob())).toBe('from-opfs');
        expect(store.get('def')?.relPath).toBe('b.txt');
        expect(store.all().map((f) => f.id)).toEqual(['abc', 'def']);
        expect(store.get('nope')).toBeUndefined();
    });

    it('removes the part-file on cleanup, and shrugs when it is already gone', async () => {
        const root = new FakeDirectory();
        installOpfs(root);
        const store = createSinkStore();
        await store.factory(meta({ id: 'abc' }));
        const file = store.get('abc')!;

        await file.cleanup();
        await file.cleanup();

        expect(root.dirs.get('sidedrop')?.removed).toEqual(['abc.part']);
    });

    it('removes every part-file and forgets them on dispose', async () => {
        const root = new FakeDirectory();
        installOpfs(root);
        const store = createSinkStore();
        await store.factory(meta({ id: 'a' }));
        await store.factory(meta({ id: 'b' }));

        await store.dispose();

        expect(root.dirs.get('sidedrop')?.removed).toEqual(['a.part', 'b.part']);
        expect(store.all()).toEqual([]);
        expect(store.get('a')).toBeUndefined();
    });

    it('keeps receiving into memory when OPFS refuses a file', async () => {
        installOpfs(new Error('QuotaExceededError'));
        const store = createSinkStore();
        expect(store.mode).toBe('opfs');

        const sink = await store.factory(meta({ id: 'abc', size: 3, mime: 'text/plain' }));
        await sink.writeAt(0, new TextEncoder().encode('hey'));

        expect(await blobText(await store.get('abc')!.getBlob())).toBe('hey');
    });
});

describe('memory-backed store', () => {
    it('reassembles chunks written out of order', async () => {
        const store = createSinkStore();
        expect(store.mode).toBe('memory');

        const sink = await store.factory(meta({ id: 'm', size: 5, mime: 'text/plain' }));
        await sink.writeAt(3, new TextEncoder().encode('lo'));
        await sink.writeAt(0, new TextEncoder().encode('hel'));
        await sink.close();

        const blob = await store.get('m')!.getBlob();
        expect(await blobText(blob)).toBe('hello');
        expect(blob.type).toBe('text/plain');
    });

    it('hands over only what arrived when the transfer stopped early', async () => {
        const store = createSinkStore();
        const sink = await store.factory(meta({ id: 'm', size: 10 }));
        await sink.writeAt(0, new Uint8Array([1, 2, 3]));

        expect((await store.get('m')!.getBlob()).size).toBe(3);
    });

    it('hands over a full-size blob of an untyped file nothing was written to', async () => {
        const store = createSinkStore();
        await store.factory(meta({ id: 'm', size: 4, mime: '', relPath: 'x/y.bin', name: 'y.bin' }));

        const file = store.get('m')!;
        const blob = await file.getBlob();
        expect(blob.size).toBe(4);
        expect(blob.type).toBe('application/octet-stream');
        expect(file.relPath).toBe('x/y.bin');
        await expect(file.cleanup()).resolves.toBeUndefined();
    });

    it('forgets everything on dispose', async () => {
        const store = createSinkStore();
        await store.factory(meta({ id: 'm' }));
        await store.dispose();
        expect(store.all()).toEqual([]);
    });
});
