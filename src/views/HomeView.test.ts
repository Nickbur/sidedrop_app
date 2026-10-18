import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import HomeView from './HomeView.vue';
import DropZone from '../components/DropZone.vue';
import PairingPanel from '../components/PairingPanel.vue';
import TransferTable from '../components/TransferTable.vue';
import LandingStrip from '../components/LandingStrip.vue';
import { i18n } from '../i18n';
import { FakeSession } from '../test/session-fake';
import { item } from '../test/fixtures';
import { button, hasButton, render } from '../test/render';
import type { SessionState } from '../core/session';

/**
 * The one screen: opening `/` hosts a new room, opening a shared `/r/<room>`
 * link joins it. The status line says where the pairing stands, the main card
 * swaps between pairing, dropping and an error, and a memory-only browser gets a
 * warning about very large files.
 */

vi.mock('../core/session', () => import('../test/session-fake'));
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));

const t = i18n.global.t;

beforeEach(() => {
    FakeSession.instances = [];
});

async function home(path = '/') {
    const rendered = await render(HomeView, path);
    const session = FakeSession.last();
    const report = async (patch: Partial<SessionState>): Promise<void> => {
        session.setState(patch);
        await nextTick();
    };
    return { ...rendered, session, report };
}

describe('HomeView — opening the page', () => {
    it('hosts a new room at the root', async () => {
        const { session, wrapper } = await home('/');
        expect(session.start).toHaveBeenCalledWith({ mode: 'create' });
        expect(wrapper.find('.tagline').text()).toBe(t('tagline'));
        expect(wrapper.findComponent(TransferTable).exists()).toBe(true);
        expect(wrapper.findComponent(LandingStrip).exists()).toBe(true);
    });

    it('joins the room of a shared link', async () => {
        const { session } = await home('/r/r-42');
        expect(session.start).toHaveBeenCalledWith({ mode: 'join', room: 'r-42' });
    });
});

describe('HomeView — status line', () => {
    it.each<[SessionState['status'], string, string]>([
        ['idle', 'conn.connecting', 'pulse'],
        ['connecting', 'conn.connecting', 'pulse'],
        ['waiting', 'conn.waiting', 'muted'],
        ['connected', 'conn.connected', 'ok'],
        ['reconnecting', 'conn.reconnecting', 'warn'],
        ['closed', 'conn.closed', 'pulse'],
    ])('reads "%s" as the matching message', async (status, key, dot) => {
        const { wrapper, report } = await home();
        await report({ status });
        expect(wrapper.find('.status').text()).toBe(t(key));
        expect(wrapper.find('.status .dot').classes()).toContain(dot);
    });

    it('shows the encrypted badge only while connected', async () => {
        const { wrapper, report } = await home();
        await report({ status: 'waiting' });
        expect(wrapper.find('.status-bar .badge').exists()).toBe(false);
        await report({ status: 'connected', peerConnected: true });
        expect(wrapper.find('.status-bar .badge').text()).toContain(t('conn.secure'));
    });
});

describe('HomeView — main card', () => {
    it('shows the pairing panel until the other device connects, then the drop zone', async () => {
        const { wrapper, report } = await home();
        await report({ status: 'waiting' });
        expect(wrapper.findComponent(PairingPanel).exists()).toBe(true);
        expect(wrapper.findComponent(DropZone).exists()).toBe(false);

        await report({ status: 'connected', peerConnected: true });
        expect(wrapper.findComponent(DropZone).exists()).toBe(true);
        expect(wrapper.findComponent(PairingPanel).exists()).toBe(false);
    });

    it.each([
        ['room-full', 'conn.roomFull'],
        ['room-not-found', 'conn.notFound'],
        ['server-error', 'conn.error'],
    ])('explains a %s error and offers a new room', async (errorCode, key) => {
        const { wrapper, report } = await home('/r/r-42');
        await report({ status: 'error', errorCode });

        expect(wrapper.find('.status').text()).toBe(t(key));
        expect(wrapper.find('.status .dot').classes()).toContain('danger');
        expect(wrapper.find('.error-box').text()).toBe(t(key));
        expect(wrapper.findComponent(PairingPanel).exists()).toBe(false);

        await button(wrapper, t('pair.newRoom')).trigger('click');
        expect(FakeSession.last().start).toHaveBeenCalledWith({ mode: 'create' });
        await nextTick();
        expect(hasButton(wrapper, t('pair.newRoom'))).toBe(false);
    });

    it('warns about large files only when the browser keeps them in memory', async () => {
        const { wrapper, report } = await home();
        expect(wrapper.find('.warn-note').exists()).toBe(false);
        await report({ sinkMode: 'memory' });
        expect(wrapper.find('.warn-note').text()).toContain(t('save.memoryWarn'));
    });

    it('lists transfers under the card', async () => {
        const { wrapper, session } = await home();
        session.setItems([item({ name: 'holiday.mov' })]);
        await nextTick();
        expect(wrapper.find('.transfers').text()).toContain('holiday.mov');
    });
});
