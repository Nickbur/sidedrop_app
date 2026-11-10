import { describe, expect, it } from 'vitest';
import { MAX_NAME_CHARS, MAX_REL_PATH_CHARS, safeFileName, safeRelPath } from './safePath';

/**
 * A peer names the files it sends. The receiver writes them into a folder it picked, or into a zip —
 * so a name or path must never climb out of that folder, start at the root, or carry control characters.
 */

describe('safeRelPath', () => {
    it('keeps an ordinary relative path as it is', () => {
        expect(safeRelPath('photos/2026/beach.jpg')).toBe('photos/2026/beach.jpg');
    });

    it('drops the segments that would leave the folder or start at the root (zip-slip)', () => {
        expect(safeRelPath('../../etc/passwd')).toBe('etc/passwd');
        expect(safeRelPath('/abs/x.txt')).toBe('abs/x.txt');
        expect(safeRelPath('a/./b//c.txt')).toBe('a/b/c.txt');
        expect(safeRelPath('docs/../../../secret')).toBe('docs/secret');
    });

    it('reads backslashes as separators, so a Windows-style climb is caught too', () => {
        expect(safeRelPath('a\\..\\b\\c.txt')).toBe('a/b/c.txt');
        expect(safeRelPath('C:\\..\\x')).toBe('C:/x');
    });

    it('strips control characters', () => {
        expect(safeRelPath('a\u0000b/c\u001f.txt\u007f')).toBe('ab/c.txt');
    });

    it('bounds each segment and the whole path, and leaves nothing for a path of only climbs', () => {
        expect(safeRelPath(`${'d'.repeat(300)}/f.txt`)).toBe(`${'d'.repeat(MAX_NAME_CHARS)}/f.txt`);
        expect(safeRelPath(Array.from({ length: 20 }, () => 'x'.repeat(100)).join('/'))).toHaveLength(
            MAX_REL_PATH_CHARS,
        );
        expect(safeRelPath('../..//.')).toBe('');
        expect(safeRelPath(undefined as unknown as string)).toBe('');
    });
});

describe('safeFileName', () => {
    it('keeps an ordinary name', () => {
        expect(safeFileName('report final (2).pdf')).toBe('report final (2).pdf');
    });

    it('turns path separators into underscores, so a name stays one name', () => {
        expect(safeFileName('../../x.sh')).toBe('.._.._x.sh');
        expect(safeFileName('a\\b')).toBe('a_b');
    });

    it('never leaves an empty, "." or ".." name, nor control characters, and bounds the length', () => {
        expect(safeFileName('')).toBe('file');
        expect(safeFileName('.')).toBe('file');
        expect(safeFileName('..')).toBe('file');
        expect(safeFileName('\u0000\u0001')).toBe('file');
        expect(safeFileName(undefined as unknown as string)).toBe('file');
        expect(safeFileName('n'.repeat(400))).toHaveLength(MAX_NAME_CHARS);
    });
});
