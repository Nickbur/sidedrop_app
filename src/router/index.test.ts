import { describe, expect, it, vi } from 'vitest';
import router from './index';

/**
 * Sidedrop has two real addresses: `/` hosts a new room and `/r/<room>` joins
 * one (the link the other device opens). Anything else must land on the home
 * page rather than a blank screen.
 */

vi.mock('../views/HomeView.vue', () => ({ default: { name: 'HomeView', render: () => null } }));

describe('router', () => {
    it('hosts a new room at the root', async () => {
        await router.push('/');
        expect(router.currentRoute.value.name).toBe('home');
        expect(router.currentRoute.value.matched[0]?.components?.default).toMatchObject({ name: 'HomeView' });
    });

    it('joins the room named in a shared link', async () => {
        await router.push('/r/r-42');
        expect(router.currentRoute.value.name).toBe('room');
        expect(router.currentRoute.value.params.room).toBe('r-42');
        expect(router.currentRoute.value.matched[0]?.components?.default).toMatchObject({ name: 'HomeView' });
    });

    it('sends unknown addresses home', async () => {
        await router.push('/r/r-42/extra/bits');
        expect(router.currentRoute.value.name).toBe('home');
        await router.push('/nope');
        expect(router.currentRoute.value.fullPath).toBe('/');
    });
});
