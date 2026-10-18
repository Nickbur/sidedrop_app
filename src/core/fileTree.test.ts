import { describe, expect, it } from 'vitest';
import { fromDataTransfer, fromFileList } from './fileTree';
import { textFile } from '../test/fixtures';

/**
 * Turning a drop or a file picker into "these files, at these relative paths".
 * A folder flattened wrong arrives on the other device as a pile of loose files
 * (or with half its contents missing), so the walk is pinned here against fake
 * FileSystemEntry trees shaped like the ones Chromium, Firefox and Safari hand over.
 */

function fileEntry(name: string, fail?: Error): FileSystemEntry {
    return {
        isFile: true,
        isDirectory: false,
        name,
        file: (ok: (f: File) => void, err?: (e: Error) => void) => (fail ? err?.(fail) : ok(textFile(name))),
    } as unknown as FileSystemEntry;
}

/** A folder whose reader hands its children over in `batches`, like readEntries() does for big folders. */
function dirEntry(name: string, batches: FileSystemEntry[][], fail?: Error): FileSystemEntry {
    return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => {
            let call = 0;
            return {
                readEntries: (ok: (batch: FileSystemEntry[]) => void, err?: (e: Error) => void) => {
                    if (fail) {
                        err?.(fail);
                        return;
                    }
                    const batch = batches[call] ?? [];
                    call += 1;
                    ok(batch);
                },
            };
        },
    } as unknown as FileSystemEntry;
}

/** Neither a file nor a folder (what some browsers report for unreadable items). */
function oddEntry(name: string): FileSystemEntry {
    return { isFile: false, isDirectory: false, name } as unknown as FileSystemEntry;
}

function fileItem(entry: FileSystemEntry | null): DataTransferItem {
    return { kind: 'file', webkitGetAsEntry: () => entry } as unknown as DataTransferItem;
}

function drop(items: unknown, files: File[] | undefined = []): DataTransfer {
    return { items, files } as unknown as DataTransfer;
}

const paths = (list: Array<{ relPath: string }>): string[] => list.map((d) => d.relPath);

describe('fromDataTransfer', () => {
    it('flattens dropped files and nested folders into paths relative to the drop', async () => {
        const tree = dirEntry('album', [
            [fileEntry('a.jpg'), dirEntry('raw', [[fileEntry('a.cr2')]])],
            [fileEntry('b.jpg')],
        ]);
        const dropped = await fromDataTransfer(drop([fileItem(fileEntry('readme.txt')), fileItem(tree)]));

        expect(paths(dropped)).toEqual(['readme.txt', 'album/a.jpg', 'album/raw/a.cr2', 'album/b.jpg']);
        expect(dropped[0]?.file.name).toBe('readme.txt');
    });

    it('skips dragged text, items without an entry and entries that are neither file nor folder', async () => {
        const text = { kind: 'string', webkitGetAsEntry: () => fileEntry('ignored.txt') };
        const dropped = await fromDataTransfer(
            drop([text, fileItem(null), fileItem(oddEntry('socket')), fileItem(fileEntry('kept.txt'))]),
        );
        expect(paths(dropped)).toEqual(['kept.txt']);
    });

    it('falls back to the plain file list when the browser has no entries API', async () => {
        const plain = [textFile('one.txt'), textFile('two.txt')];
        const withoutEntries = await fromDataTransfer(drop([{ kind: 'file' }], plain));
        const withoutItems = await fromDataTransfer(drop(undefined, plain));
        const emptyItems = await fromDataTransfer(drop([], plain));

        for (const dropped of [withoutEntries, withoutItems, emptyItems]) {
            expect(paths(dropped)).toEqual(['one.txt', 'two.txt']);
        }
    });

    it('falls back to the plain file list when walking the entries found nothing', async () => {
        const dropped = await fromDataTransfer(drop([fileItem(dirEntry('empty', []))], [textFile('empty')]));
        expect(paths(dropped)).toEqual(['empty']);
    });

    it('returns nothing for a drop that carries no files at all', async () => {
        expect(await fromDataTransfer(drop([], undefined))).toEqual([]);
    });

    it('rejects when a dropped file or folder cannot be read', async () => {
        const denied = new Error('NotReadableError');
        await expect(fromDataTransfer(drop([fileItem(fileEntry('locked.bin', denied))]))).rejects.toBe(denied);
        await expect(fromDataTransfer(drop([fileItem(dirEntry('locked', [], denied))]))).rejects.toBe(denied);
    });
});

describe('fromFileList', () => {
    it('keeps the folder path a directory picker reports, and the bare name otherwise', () => {
        const nested = textFile('a.txt');
        Object.defineProperty(nested, 'webkitRelativePath', { value: 'docs/a.txt' });
        const loose = textFile('b.txt');
        Object.defineProperty(loose, 'webkitRelativePath', { value: '' });
        const list = [nested, loose] as unknown as FileList;

        expect(fromFileList(list)).toEqual([
            { file: nested, relPath: 'docs/a.txt' },
            { file: loose, relPath: 'b.txt' },
        ]);
    });

    it('returns nothing when the picker was dismissed', () => {
        expect(fromFileList(null)).toEqual([]);
    });
});
