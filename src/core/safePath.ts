/**
 * Names and relative paths a peer announces for its files, made safe to write into the folder the
 * receiver picked and to put into a zip: a malicious peer must not reach outside that folder
 * (`../x`, `/etc/x`, `a\..\x` — "zip-slip") or smuggle control characters into a name.
 */

/** Most file systems allow at most 255 characters in one name. */
export const MAX_NAME_CHARS = 255;
/** A generous bound for a whole relative path (folders + name). */
export const MAX_REL_PATH_CHARS = 1024;

// Control characters (C0 + DEL): never part of a real file name.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** One file name: no path separators, no control characters, never empty, `.` or `..`. */
export function safeFileName(raw: string): string {
    const name = String(raw ?? '')
        .replace(CONTROL_CHARS, '')
        .replace(/[/\\]/g, '_')
        .slice(0, MAX_NAME_CHARS);
    return name === '' || name === '.' || name === '..' ? 'file' : name;
}

/**
 * A relative path inside the receiver's folder: forward slashes only, no root, no `.` / `..` / empty
 * segments, no control characters, each segment and the whole path bounded. Empty when nothing is left.
 */
export function safeRelPath(raw: string): string {
    return String(raw ?? '')
        .replace(CONTROL_CHARS, '')
        .replace(/\\/g, '/')
        .split('/')
        .filter((part) => part !== '' && part !== '.' && part !== '..')
        .map((part) => part.slice(0, MAX_NAME_CHARS))
        .join('/')
        .slice(0, MAX_REL_PATH_CHARS);
}
