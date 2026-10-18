import { afterEach, beforeEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { i18n } from '../i18n';

/**
 * Runs around every test. Each one starts from the same browser: English, no
 * remembered language or theme, nothing stamped on the document, real timers,
 * and no screen left mounted from the test before. Mock call history and
 * implementations are reset by `mockReset` in the Vitest config, so a test sets
 * up exactly the answers it relies on.
 */

enableAutoUnmount(afterEach);

beforeEach(() => {
    i18n.global.locale.value = 'en';
});

afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('data-theme');
    root.removeAttribute('lang');
    document.body.innerHTML = '';
});
