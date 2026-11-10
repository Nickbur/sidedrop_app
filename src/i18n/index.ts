import { createI18n } from 'vue-i18n';
import { en } from './en';
import { ru } from './ru';

export type Locale = 'en' | 'ru';
const KEY = 'sidedrop_lang';

function initialLocale(): Locale {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === 'en' || saved === 'ru') return saved;
    } catch {
        /* storage may be unavailable */
    }
    if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('ru')) {
        return 'ru';
    }
    return 'en';
}

/** Stamp the language on `<html lang>` (screen readers, hyphenation, translation prompts). */
function markDocument(locale: Locale): void {
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', locale);
}

const startLocale = initialLocale();

export const i18n = createI18n({
    legacy: false,
    locale: startLocale,
    fallbackLocale: 'en',
    messages: { en, ru },
});

// index.html says `lang="en"`; a Russian start must say so from the first paint, not only after a switch.
markDocument(startLocale);

export function setLocale(locale: Locale): void {
    i18n.global.locale.value = locale;
    try {
        localStorage.setItem(KEY, locale);
    } catch {
        /* storage may be unavailable */
    }
    markDocument(locale);
}
