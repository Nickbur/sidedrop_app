import { describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { FakeSession } from './test/session-fake';
import { installStaleBuildRecovery } from './core/staleBuildRecovery';

/**
 * Booting the app: a stale build's missing chunks reload the page, the remembered
 * theme is applied before the first paint, and the app mounts on `#app` with the
 * router, i18n and Pinia wired — landing on the home page, which hosts a room.
 * The session is faked, so nothing connects.
 */

vi.mock('./core/session', () => import('./test/session-fake'));
vi.mock('./core/staleBuildRecovery');

describe('main', () => {
    it('applies the theme, mounts the app and opens the home page', async () => {
        FakeSession.instances = [];
        localStorage.setItem('sidedrop_theme', 'light');
        document.body.innerHTML = '<div id="app"></div>';

        await import('./main');
        expect(installStaleBuildRecovery).toHaveBeenCalledTimes(1);
        expect(document.documentElement.dataset.theme).toBe('light');
        // The home page is a lazy route: wait until its code has loaded and it has mounted.
        await (await import('./router')).default.isReady();
        await flushPromises();

        expect(document.querySelector('#app .brand-name')?.textContent).toBe('Sidedrop');
        expect(document.querySelector('#app .tagline')).not.toBeNull();
        expect(FakeSession.last().start).toHaveBeenCalledWith({ mode: 'create' });
    });
});
