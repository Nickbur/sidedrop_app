import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import PairingPanel from './PairingPanel.vue';
import QrCanvas from './QrCanvas.vue';
import { i18n } from '../i18n';
import { useSessionStore } from '../stores/session';
import { FakeSession } from '../test/session-fake';
import { stubClipboard } from '../test/fakes';
import { button, render } from '../test/render';

/**
 * The pairing card a host shows while waiting: a QR code, the room link and the
 * short code to copy, and a field to join someone else's code instead. Copy
 * feedback must not lie, and a typed code must reach the store trimmed.
 */

vi.mock('../core/session', () => import('../test/session-fake'));
vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));

const t = i18n.global.t;
const LINK = 'http://localhost:3000/r/r-1';

beforeEach(() => {
    FakeSession.instances = [];
});

async function hosting(state: { link?: string | null; code?: string | null } = {}) {
    const rendered = await render(PairingPanel);
    useSessionStore().hostNew();
    FakeSession.last().setState({ status: 'waiting', link: LINK, code: 'K7Q2XM', ...state });
    await nextTick();
    return rendered;
}

const copyButtons = (wrapper: Awaited<ReturnType<typeof hosting>>['wrapper']) =>
    wrapper.findAll('.copy-row button[type="button"]');

describe('PairingPanel — what it shows', () => {
    it('shows the room link, its QR code and the code split for reading aloud', async () => {
        const { wrapper } = await hosting();

        expect(wrapper.find('h2').text()).toBe(t('pair.title'));
        expect(wrapper.find('input[readonly]').element).toHaveProperty('value', LINK);
        expect(wrapper.findComponent(QrCanvas).props('value')).toBe(LINK);
        expect(wrapper.find('.code').text()).toBe('K7Q-2XM');
    });

    it('shows a short code as it is, and no QR or code before the room exists', async () => {
        const short = await hosting({ code: 'AB' });
        expect(short.wrapper.find('.code').text()).toBe('AB');

        const empty = await hosting({ link: null, code: null });
        expect(empty.wrapper.findComponent(QrCanvas).exists()).toBe(false);
        expect(empty.wrapper.find('input[readonly]').element).toHaveProperty('value', '');
        expect(empty.wrapper.find('.code').text()).toBe('');
    });
});

describe('PairingPanel — copying', () => {
    it('copies the link, says so, and goes back to "Copy" after a moment', async () => {
        vi.useFakeTimers();
        const writeText = stubClipboard();
        const { wrapper } = await hosting();

        await copyButtons(wrapper)[0]!.trigger('click');
        await vi.advanceTimersByTimeAsync(0);
        expect(writeText).toHaveBeenCalledWith(LINK);
        expect(copyButtons(wrapper).map((b) => b.text())).toEqual([t('pair.copied'), t('pair.copy')]);

        await vi.advanceTimersByTimeAsync(1600);
        expect(copyButtons(wrapper).map((b) => b.text())).toEqual([t('pair.copy'), t('pair.copy')]);
    });

    it('copies the raw code, and a quick second copy keeps its own "Copied"', async () => {
        vi.useFakeTimers();
        const writeText = stubClipboard();
        const { wrapper } = await hosting();

        await copyButtons(wrapper)[0]!.trigger('click');
        await vi.advanceTimersByTimeAsync(1000);
        await copyButtons(wrapper)[1]!.trigger('click');
        await vi.advanceTimersByTimeAsync(600);

        expect(writeText).toHaveBeenLastCalledWith('K7Q2XM');
        expect(copyButtons(wrapper).map((b) => b.text())).toEqual([t('pair.copy'), t('pair.copied')]);
    });

    it('does not claim success when the clipboard is blocked', async () => {
        stubClipboard('blocked');
        const { wrapper } = await hosting();
        await copyButtons(wrapper)[0]!.trigger('click');
        await nextTick();
        expect(copyButtons(wrapper)[0]!.text()).toBe(t('pair.copy'));
    });

    it('copies nothing before there is a link or code', async () => {
        const writeText = stubClipboard();
        const { wrapper } = await hosting({ link: null, code: null });
        for (const b of copyButtons(wrapper)) await b.trigger('click');
        expect(writeText).not.toHaveBeenCalled();
    });
});

describe('PairingPanel — joining by code', () => {
    it('joins the typed code, trimmed', async () => {
        const { wrapper } = await hosting();
        await wrapper.find('form input').setValue('  ab12cd ');
        await wrapper.find('form').trigger('submit');

        expect(FakeSession.instances).toHaveLength(2);
        expect(FakeSession.last().start).toHaveBeenCalledWith({ mode: 'join', code: 'ab12cd' });
        expect(FakeSession.instances[0]?.dispose).toHaveBeenCalled();
    });

    it('cannot join with an empty code', async () => {
        const { wrapper } = await hosting();
        expect(button(wrapper, t('pair.join')).attributes('disabled')).toBeDefined();

        await wrapper.find('form input').setValue('   ');
        await wrapper.find('form').trigger('submit');

        expect(button(wrapper, t('pair.join')).attributes('disabled')).toBeDefined();
        expect(FakeSession.instances).toHaveLength(1);
    });
});
