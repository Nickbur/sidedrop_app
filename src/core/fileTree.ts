export interface Dropped {
    file: File;
    relPath: string;
}

/** Flatten a drop (files and/or whole folders, recursively) into files with relative paths. */
export async function fromDataTransfer(dt: DataTransfer): Promise<Dropped[]> {
    const out: Dropped[] = [];
    const items = dt.items;
    const supportsEntries =
        items && items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function';

    if (supportsEntries) {
        const roots: FileSystemEntry[] = [];
        for (let i = 0; i < items.length; i += 1) {
            const it = items[i];
            if (it && it.kind === 'file') {
                const entry = it.webkitGetAsEntry();
                if (entry) roots.push(entry);
            }
        }
        for (const entry of roots) await walk(entry, '', out);
        if (out.length > 0) return out;
    }

    for (const file of Array.from(dt.files ?? [])) out.push({ file, relPath: file.name });
    return out;
}

/** Files from an <input type=file> (with webkitdirectory the paths are recreated). */
export function fromFileList(list: FileList | null): Dropped[] {
    const out: Dropped[] = [];
    for (const file of Array.from(list ?? [])) {
        const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
        out.push({ file, relPath: rel && rel.length > 0 ? rel : file.name });
    }
    return out;
}

async function walk(entry: FileSystemEntry, prefix: string, out: Dropped[]): Promise<void> {
    if (entry.isFile) {
        const file = await fileOf(entry as FileSystemFileEntry);
        out.push({ file, relPath: prefix + entry.name });
    } else if (entry.isDirectory) {
        const reader = (entry as FileSystemDirectoryEntry).createReader();
        const children = await readAll(reader);
        for (const child of children) await walk(child, `${prefix}${entry.name}/`, out);
    }
}

function fileOf(entry: FileSystemFileEntry): Promise<File> {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
}

function readAll(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
    return new Promise((resolve, reject) => {
        const all: FileSystemEntry[] = [];
        const step = (): void => {
            reader.readEntries((batch) => {
                if (batch.length === 0) {
                    resolve(all);
                    return;
                }
                all.push(...batch);
                step();
            }, reject);
        };
        step();
    });
}
