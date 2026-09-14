import { zip } from 'fflate';
import type { ReceivedFile } from './opfs';

interface PickerWindow {
    showSaveFilePicker?: (opts?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
}

function picker(): PickerWindow {
    return window as unknown as PickerWindow;
}

export function canUseSavePicker(): boolean {
    return typeof picker().showSaveFilePicker === 'function';
}

export function downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Save one received file — native "save as" dialog on Chromium, download elsewhere. */
export async function saveReceived(file: ReceivedFile): Promise<void> {
    const blob = await file.getBlob();
    const save = picker().showSaveFilePicker;
    if (save) {
        const handle = await save({ suggestedName: file.name });
        const writable = await handle.createWritable();
        await blob.stream().pipeTo(writable);
    } else {
        downloadBlob(blob, file.name);
    }
    await file.cleanup();
}

export async function saveText(name: string, content: string): Promise<void> {
    const blob = new Blob([content], { type: 'text/plain' });
    const save = picker().showSaveFilePicker;
    if (save) {
        const handle = await save({ suggestedName: name });
        const writable = await handle.createWritable();
        await blob.stream().pipeTo(writable);
    } else {
        downloadBlob(blob, name);
    }
}

/** Save many files — pick a destination folder once (Chromium) or download a zip. */
export async function saveAll(files: ReceivedFile[]): Promise<void> {
    if (files.length === 0) return;
    const pickDir = picker().showDirectoryPicker;
    if (pickDir) {
        const dir = await pickDir();
        for (const file of files) {
            const blob = await file.getBlob();
            await writeIntoDir(dir, file.relPath, blob);
            await file.cleanup();
        }
    } else {
        await zipDownload(files);
    }
}

async function writeIntoDir(dir: FileSystemDirectoryHandle, relPath: string, blob: Blob): Promise<void> {
    const parts = relPath.split('/').filter(Boolean);
    const name = parts.pop() ?? 'file';
    let target = dir;
    for (const part of parts) target = await target.getDirectoryHandle(part, { create: true });
    const handle = await target.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await blob.stream().pipeTo(writable);
}

async function zipDownload(files: ReceivedFile[]): Promise<void> {
    const entries: Record<string, Uint8Array> = {};
    for (const file of files) {
        const buf = new Uint8Array(await (await file.getBlob()).arrayBuffer());
        entries[file.relPath || file.name] = buf;
    }
    const data = await new Promise<Uint8Array>((resolve, reject) => {
        zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
    });
    downloadBlob(new Blob([data as unknown as BlobPart], { type: 'application/zip' }), 'sidedrop.zip');
    for (const file of files) await file.cleanup();
}
