import { describe, expect, it, vi } from 'vitest';

/**
 * The first language a visitor sees: a remembered choice, else Russian for a
 * Russian browser, else English. Switching is remembered and stamped on `<html
 * lang>`. Each test loads the module afresh, because the start language is
 * decided once at import.
 */

/** Storage that refuses every read and write, as in a locked-down private window. */
function blockStorage(reason: string): void {
    const refuse = (): never => {
        throw new Error(reason);
    };
    vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, clear: () => undefined });
}

async function freshI18n(): Promise<typeof import('./index')> {
    vi.resetModules();
    return import('./index');
}

function browserLanguage(language: string): void {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue(language);
}

describe('start language', () => {
    it('is English for an English browser', async () => {
        browserLanguage('en-US');
        const { i18n } = await freshI18n();
        expect(i18n.global.locale.value).toBe('en');
    });

    it('is Russian for a Russian browser', async () => {
        browserLanguage('RU-ru');
        const { i18n } = await freshI18n();
        expect(i18n.global.locale.value).toBe('ru');
    });

    it('is the remembered choice whatever the browser says', async () => {
        browserLanguage('ru');
        localStorage.setItem('sidedrop_lang', 'en');
        expect((await freshI18n()).i18n.global.locale.value).toBe('en');

        browserLanguage('en');
        localStorage.setItem('sidedrop_lang', 'ru');
        expect((await freshI18n()).i18n.global.locale.value).toBe('ru');
    });

    it('ignores a remembered language it does not ship', async () => {
        browserLanguage('en');
        localStorage.setItem('sidedrop_lang', 'de');
        expect((await freshI18n()).i18n.global.locale.value).toBe('en');
    });

    it('falls back to English when storage is blocked and there is no navigator', async () => {
        blockStorage('SecurityError');
        vi.stubGlobal('navigator', undefined);
        const { i18n } = await freshI18n();
        expect(i18n.global.locale.value).toBe('en');
    });
});

describe('setLocale', () => {
    it('switches the language, remembers it and marks the document', async () => {
        const { i18n, setLocale } = await freshI18n();
        setLocale('ru');
        expect(i18n.global.locale.value).toBe('ru');
        expect(i18n.global.t('conn.connected')).toBe('Соединено');
        expect(localStorage.getItem('sidedrop_lang')).toBe('ru');
        expect(document.documentElement.getAttribute('lang')).toBe('ru');
    });

    it('still switches when the choice cannot be stored, or there is no document', async () => {
        const { i18n, setLocale } = await freshI18n();
        blockStorage('QuotaExceededError');
        setLocale('ru');
        expect(i18n.global.locale.value).toBe('ru');

        vi.stubGlobal('document', undefined);
        setLocale('en');
        vi.unstubAllGlobals();
        expect(i18n.global.locale.value).toBe('en');
        expect(document.documentElement.getAttribute('lang')).toBe('ru');
    });
});
