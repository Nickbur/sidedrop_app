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

export const i18n = createI18n({
    legacy: false,
    locale: initialLocale(),
    fallbackLocale: 'en',
    messages: { en, ru },
});

export function setLocale(locale: Locale): void {
    i18n.global.locale.value = locale;
    try {
        localStorage.setItem(KEY, locale);
    } catch {
        /* storage may be unavailable */
    }
    if (typeof document !== 'undefined') document.documentElement.setAttribute('lang', locale);
}
