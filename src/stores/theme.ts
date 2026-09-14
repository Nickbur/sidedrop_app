import { defineStore } from 'pinia';
import { ref } from 'vue';

export type Theme = 'light' | 'dark';
const KEY = 'sidedrop_theme';

export const useThemeStore = defineStore('theme', () => {
    const theme = ref<Theme>('dark');

    function apply(next: Theme): void {
        theme.value = next;
        if (typeof document !== 'undefined') document.documentElement.dataset.theme = next;
    }

    function init(): void {
        let initial: Theme = 'dark';
        try {
            const saved = localStorage.getItem(KEY);
            if (saved === 'light' || saved === 'dark') initial = saved;
            else if (window.matchMedia?.('(prefers-color-scheme: light)').matches) initial = 'light';
        } catch {
            /* storage/matchMedia may be unavailable */
        }
        apply(initial);
    }

    function toggle(): void {
        const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
        apply(next);
        try {
            localStorage.setItem(KEY, next);
        } catch {
            /* storage may be unavailable */
        }
    }

    return { theme, init, toggle };
});
