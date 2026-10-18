import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useThemeStore } from './theme';

/**
 * Light or dark: a remembered choice wins, then the system preference, then
 * dark. The theme lands on `<html data-theme>` before the app mounts, so a wrong
 * pick shows up as a flash of the wrong colours on every visit.
 */

/** Storage that refuses every read and write, as in a locked-down private window. */
function blockStorage(reason: string): void {
    const refuse = (): never => {
        throw new Error(reason);
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, clear: () => undefined });
}

function prefersLight(matches: boolean): void {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches && query === '(prefers-color-scheme: light)' }));
}

beforeEach(() => {
    setActivePinia(createPinia());
});

describe('theme store — init', () => {
    it('defaults to dark', () => {
        prefersLight(false);
        const theme = useThemeStore();
        theme.init();
        expect(theme.theme).toBe('dark');
        expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('follows a system that prefers light', () => {
        prefersLight(true);
        const theme = useThemeStore();
        theme.init();
        expect(theme.theme).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('prefers the remembered choice over the system', () => {
        prefersLight(true);
        localStorage.setItem('sidedrop_theme', 'dark');
        const theme = useThemeStore();
        theme.init();
        expect(theme.theme).toBe('dark');
    });

    it('ignores a remembered value it does not know', () => {
        prefersLight(false);
        localStorage.setItem('sidedrop_theme', 'sepia');
        const theme = useThemeStore();
        theme.init();
        expect(theme.theme).toBe('dark');
    });

    it('falls back to dark where there is no matchMedia, or storage is blocked', () => {
        vi.stubGlobal('matchMedia', undefined);
        const theme = useThemeStore();
        theme.init();
        expect(theme.theme).toBe('dark');

        blockStorage('SecurityError');
        prefersLight(true);
        theme.init();
        expect(theme.theme).toBe('dark');
    });
});

describe('theme store — toggle', () => {
    it('switches between dark and light and remembers the choice', () => {
        prefersLight(false);
        const theme = useThemeStore();
        theme.init();

        theme.toggle();
        expect(theme.theme).toBe('light');
        expect(document.documentElement.dataset.theme).toBe('light');
        expect(localStorage.getItem('sidedrop_theme')).toBe('light');

        theme.toggle();
        expect(theme.theme).toBe('dark');
        expect(localStorage.getItem('sidedrop_theme')).toBe('dark');
    });

    it('still switches when the choice cannot be stored', () => {
        blockStorage('QuotaExceededError');
        const theme = useThemeStore();
        theme.toggle();
        expect(theme.theme).toBe('light');
    });

    it('works without a document', () => {
        const theme = useThemeStore();
        vi.stubGlobal('document', undefined);
        theme.toggle();
        vi.unstubAllGlobals();
        expect(theme.theme).toBe('light');
        expect(document.documentElement.dataset.theme).toBeUndefined();
    });
});
