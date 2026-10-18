import { describe, expect, it } from 'vitest';
import { en } from './en';
import { ru } from './ru';

/**
 * The two translation bundles are data the screens trust blindly: a key missing
 * from Russian silently shows English, and a placeholder renamed in one language
 * prints `{value}` to the reader. These checks catch that before a reader does.
 */

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Map<string, string> {
    const out = new Map<string, string>();
    for (const [key, value] of Object.entries(tree)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out.set(path, value);
        else for (const [k, v] of flatten(value, path)) out.set(k, v);
    }
    return out;
}

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? '').sort();

const english = flatten(en);
const russian = flatten(ru);

describe('translation bundles', () => {
    it('have exactly the same keys', () => {
        expect([...russian.keys()].sort()).toEqual([...english.keys()].sort());
    });

    it('keep the same placeholders', () => {
        for (const [key, text] of english) {
            expect(placeholders(russian.get(key) ?? ''), key).toEqual(placeholders(text));
        }
    });

    it('leave a string empty only where English deliberately does', () => {
        for (const [key, text] of russian) {
            expect(text.trim().length === 0, key).toBe((english.get(key) ?? '').trim().length === 0);
        }
        expect([...english].filter(([, text]) => text === '').map(([key]) => key)).toEqual([
            'table.dir',
            'table.actions',
        ]);
    });

    it('translate every status a transfer can be in', () => {
        for (const status of ['queued', 'active', 'paused', 'ready', 'done', 'completed', 'failed', 'canceled']) {
            expect(english.has(`status.${status}`), status).toBe(true);
        }
    });
});
