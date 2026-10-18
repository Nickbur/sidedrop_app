import * as fflate from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canUseSavePicker, downloadBlob, saveAll, saveReceived, saveText } from './save';
import { collectingStream, decodeChunks, receivedFile } from '../test/fixtures';

/**
 * Handing received files to the user: the native "save as" / folder picker on
 * Chromium, a plain download (or one zip) everywhere else. The part-file must be
 * released only after the bytes are out, and a folder must come back as a folder.
 */

vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>();
    return { ...actual, zip: vi.fn() };
});

const { strFromU8, unzipSync, zip: realZip } = await vi.importActual<typeof import('fflate')>('fflate');

interface Download {
    href: string;
    name: string;
    blob: Blob;
}

let downloads: Download[];
let blobs: Map<string, Blob>;

beforeEach(() => {
    downloads = [];
    blobs = new Map();
    vi.mocked(fflate.zip).mockImplementation(realZip as never);
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
        const url = `blob:test/${blobs.size + 1}`;
        blobs.set(url, blob as Blob);
        return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.isConnected).toBe(true);
        downloads.push({ href: this.href, name: this.download, blob: blobs.get(this.href)! });
    });
});

/** A `showSaveFilePicker` that records the suggested name and collects what was written. */
function stubSavePicker(): { suggested: string[]; written: () => string } {
    const suggested: string[] = [];
    const { stream, chunks } = collectingStream();
    vi.stubGlobal('showSaveFilePicker', async (opts?: { suggestedName?: string }) => {
        suggested.push(opts?.suggestedName ?? '');
        return { createWritable: async () => stream };
    });
    return { suggested, written: () => decodeChunks(chunks) };
}

/** A `showDirectoryPicker` over an in-memory folder tree; `tree` maps "a/b.txt" → content. */
function stubDirectoryPicker(): { tree: Map<string, string> } {
    const tree = new Map<string, string>();
    const dir = (prefix: string): unknown => ({
        getDirectoryHandle: async (name: string, opts: { create: boolean }) => {
            expect(opts).toEqual({ create: true });
            return dir(`${prefix}${name}/`);
        },
        getFileHandle: async (name: string, opts: { create: boolean }) => {
            expect(opts).toEqual({ create: true });
            const chunks: Uint8Array[] = [];
            return {
                createWritable: async () =>
                    new WritableStream<Uint8Array>({
                        write(chunk) {
                            chunks.push(chunk);
                        },
                        close() {
                            tree.set(`${prefix}${name}`, decodeChunks(chunks));
                        },
                    }),
            };
        },
    });
    vi.stubGlobal('showDirectoryPicker', async () => dir(''));
    return { tree };
}

async function textOf(blob: Blob): Promise<string> {
    return new TextDecoder().decode(await blob.arrayBuffer());
}

describe('canUseSavePicker', () => {
    it('is true only where the browser offers a native save dialog', () => {
        expect(canUseSavePicker()).toBe(false);
        stubSavePicker();
        expect(canUseSavePicker()).toBe(true);
    });
});

describe('downloadBlob', () => {
    it('downloads through a temporary link and releases the object URL later', async () => {
        vi.useFakeTimers();
        const blob = new Blob(['x']);
        downloadBlob(blob, 'x.bin');

        expect(downloads).toEqual([{ href: 'blob:test/1', name: 'x.bin', blob }]);
        expect(document.querySelector('a')).toBeNull();
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(10_000);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    });
});

describe('saveReceived', () => {
    it('writes the file where the user chose and then releases the part-file', async () => {
        const picker = stubSavePicker();
        const file = receivedFile({ name: 'report.pdf', content: 'pdf-bytes' });

        await saveReceived(file);

        expect(picker.suggested).toEqual(['report.pdf']);
        expect(picker.written()).toBe('pdf-bytes');
        expect(downloads).toEqual([]);
        expect(file.cleanups).toBe(1);
    });

    it('downloads the file when there is no save dialog', async () => {
        const file = receivedFile({ name: 'report.pdf', content: 'pdf-bytes' });

        await saveReceived(file);

        expect(downloads.map((d) => d.name)).toEqual(['report.pdf']);
        expect(await textOf(downloads[0]!.blob)).toBe('pdf-bytes');
        expect(file.cleanups).toBe(1);
    });

    it('keeps the part-file when the user dismisses the dialog', async () => {
        vi.stubGlobal('showSaveFilePicker', async () => {
            throw new DOMException('The user aborted a request.', 'AbortError');
        });
        const file = receivedFile();

        await expect(saveReceived(file)).rejects.toThrow('aborted');
        expect(file.cleanups).toBe(0);
    });
});

describe('saveText', () => {
    it('writes the text where the user chose', async () => {
        const picker = stubSavePicker();
        await saveText('text.txt', 'привет');
        expect(picker.suggested).toEqual(['text.txt']);
        expect(picker.written()).toBe('привет');
    });

    it('downloads the text as a plain-text file when there is no save dialog', async () => {
        await saveText('text.txt', 'hello');
        expect(downloads.map((d) => d.name)).toEqual(['text.txt']);
        expect(downloads[0]!.blob.type).toBe('text/plain');
        expect(await textOf(downloads[0]!.blob)).toBe('hello');
    });
});

describe('saveAll', () => {
    it('does nothing for an empty list', async () => {
        const { tree } = stubDirectoryPicker();
        await saveAll([]);
        expect(tree.size).toBe(0);
        expect(downloads).toEqual([]);
    });

    it('recreates the folder structure inside the chosen folder', async () => {
        const { tree } = stubDirectoryPicker();
        const files = [
            receivedFile({ id: 'a', name: 'a.txt', relPath: 'album/raw/a.txt', content: 'A' }),
            receivedFile({ id: 'b', name: 'b.txt', relPath: 'b.txt', content: 'B' }),
            receivedFile({ id: 'c', name: 'c.txt', relPath: '/', content: 'C' }),
        ];

        await saveAll(files);

        expect(Object.fromEntries(tree)).toEqual({ 'album/raw/a.txt': 'A', 'b.txt': 'B', file: 'C' });
        expect(files.map((f) => f.cleanups)).toEqual([1, 1, 1]);
        expect(downloads).toEqual([]);
    });

    it('downloads one uncompressed zip keyed by relative path when there is no folder picker', async () => {
        const files = [
            receivedFile({ id: 'a', name: 'a.txt', relPath: 'album/a.txt', content: 'A' }),
            receivedFile({ id: 'b', name: 'b.txt', relPath: '', content: 'B' }),
        ];

        await saveAll(files);

        expect(downloads.map((d) => d.name)).toEqual(['sidedrop.zip']);
        expect(downloads[0]!.blob.type).toBe('application/zip');
        const entries = unzipSync(new Uint8Array(await downloads[0]!.blob.arrayBuffer()));
        expect(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strFromU8(v)]))).toEqual({
            'album/a.txt': 'A',
            'b.txt': 'B',
        });
        expect(vi.mocked(fflate.zip).mock.calls[0]?.[1]).toEqual({ level: 0 });
        expect(files.map((f) => f.cleanups)).toEqual([1, 1]);
    });

    it('keeps the part-files and downloads nothing when zipping fails', async () => {
        vi.mocked(fflate.zip).mockImplementation(((_data: unknown, _opts: unknown, cb: fflate.FlateCallback) => {
            cb(new Error('zip failed') as fflate.FlateError, new Uint8Array());
            return () => undefined;
        }) as never);
        const file = receivedFile();

        await expect(saveAll([file])).rejects.toThrow('zip failed');
        expect(downloads).toEqual([]);
        expect(file.cleanups).toBe(0);
    });
});
