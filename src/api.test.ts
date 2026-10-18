import { describe, expect, it, vi } from 'vitest';

/**
 * Where the app finds its signaling server and how it builds the link the other
 * device opens. A wrong scheme (ws on an https site) or a wrong path means two
 * devices can never pair.
 */

async function freshApi(): Promise<typeof import('./api')> {
    vi.resetModules();
    return import('./api');
}

describe('signalingWsUrl', () => {
    it('turns the configured http API origin into a ws URL on the signaling path', async () => {
        const api = await freshApi();
        expect(api.signalingWsUrl()).toBe('ws://api.test/v1/signaling/ws');
    });

    it('uses wss when the API is served over https', async () => {
        vi.stubEnv('VITE_API_URL', 'https://api.burakov.net');
        const api = await freshApi();
        expect(api.signalingWsUrl()).toBe('wss://api.burakov.net/v1/signaling/ws');
    });

    it('falls back to the local API and the sidedrop client when nothing is configured', async () => {
        vi.stubEnv('VITE_API_URL', undefined);
        vi.stubEnv('VITE_CLIENT_ID', undefined);
        const api = await freshApi();
        expect(api.signalingWsUrl()).toBe('ws://localhost:3000/v1/signaling/ws');
        expect(api.CLIENT_ID).toBe('sidedrop');
    });

    it('identifies as the configured client', async () => {
        vi.stubEnv('VITE_CLIENT_ID', 'sidedrop-staging');
        const api = await freshApi();
        expect(api.CLIENT_ID).toBe('sidedrop-staging');
    });
});

describe('roomLink', () => {
    it('links to the room on the origin the app is served from', async () => {
        const api = await freshApi();
        expect(api.roomLink('r-42')).toBe(`${window.location.origin}/r/r-42`);
    });

    it('links to the public site when there is no window', async () => {
        const api = await freshApi();
        vi.stubGlobal('window', undefined);
        expect(api.roomLink('r-42')).toBe('https://sidedrop.burakov.net/r/r-42');
    });
});
