import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import TransferTable from './TransferTable.vue';
import { i18n } from '../i18n';
import { useSessionStore } from '../stores/session';
import { FakeSession } from '../test/session-fake';
import { stubClipboard } from '../test/fakes';
import { item } from '../test/fixtures';
import { button, hasButton, render } from '../test/render';
import type { TransferItem, TransferStatus } from '../core/types';

/**
 * The transfer list: every file and text going either way, with progress, live
 * speed and ETA, its status, and the one action that makes sense for it (save,
 * copy or cancel). The header offers "Save all" and "Clear finished" only when
 * they would do something.
 */

vi.mock('../core/session', () => import('../test/session-fake'));

const t = i18n.global.t;

beforeEach(() => {
    FakeSession.instances = [];
});

async function table(items: TransferItem[]) {
    const rendered = await render(TransferTable);
    useSessionStore().hostNew();
    const session = FakeSession.last();
    session.setItems(items);
    await nextTick();
    return { ...rendered, session };
}

const cells = (row: { findAll: (s: string) => Array<{ text: () => string }> }): string[] =>
    row.findAll('td').map((td) => td.text());

describe('TransferTable — rows', () => {
    it('shows nothing until there is a transfer', async () => {
        const { wrapper } = await table([]);
        expect(wrapper.find('.transfers').exists()).toBe(false);
    });

    it('shows direction, name, size, progress, speed, ETA and status for an active transfer', async () => {
        const { wrapper } = await table([
            item({
                dir: 'send',
                name: 'video.mp4',
                size: 2 * 1024 * 1024,
                transferred: 1024 * 1024,
                speed: 512 * 1024,
                eta: 2,
                status: 'active',
            }),
        ]);

        expect(wrapper.find('h2').text()).toBe(t('table.title'));
        const row = wrapper.find('tbody tr');
        expect(cells(row)).toEqual([
            '↑',
            'video.mp4',
            '2.0 MB',
            '50%',
            '512.0 KB/s',
            '2s',
            t('status.active'),
            t('table.cancel'),
        ]);
        expect(row.find('.dir span').attributes('title')).toBe(t('table.sending'));
        expect(row.find('.bar-fill').attributes('style')).toContain('width: 50%');
    });

    it('shows dashes instead of speed and ETA once a transfer is not moving', async () => {
        const { wrapper } = await table([item({ status: 'ready', transferred: 1024, speed: 999, eta: 1 })]);
        const row = wrapper.find('tbody tr');
        expect(cells(row).slice(0, 6)).toEqual(['↓', 'photo.jpg', '1.0 KB', '100%', '—', '—']);
        expect(row.find('.dir span').attributes('title')).toBe(t('table.receiving'));
    });

    it('shows the folder path under the name, and the content of a text', async () => {
        const { wrapper } = await table([
            item({ id: 'a', name: 'a.jpg', relPath: 'album/a.jpg' }),
            item({ id: 'b', name: 'b.jpg', relPath: 'b.jpg' }),
            item({ id: 't', kind: 'text', name: 'text.txt', text: 'see you at 5', status: 'completed' }),
        ]);
        const [a, b, text] = wrapper.findAll('tbody tr');
        expect(a!.find('.fname').attributes('title')).toBe('album/a.jpg');
        expect(a!.find('.preview').text()).toBe('album/a.jpg');
        expect(b!.find('.fname').attributes('title')).toBe('b.jpg');
        expect(b!.find('.preview').exists()).toBe(false);
        expect(text!.find('.preview').text()).toBe('see you at 5');
    });

    it.each<[TransferStatus, string]>([
        ['queued', 'badge--muted'],
        ['active', 'badge'],
        ['paused', 'badge--warn'],
        ['ready', 'badge--ok'],
        ['done', 'badge--ok'],
        ['completed', 'badge--ok'],
        ['failed', 'badge--warn'],
        ['canceled', 'badge--muted'],
    ])('labels a %s transfer', async (status, badge) => {
        const { wrapper } = await table([item({ status })]);
        const label = wrapper.find('td.status .badge');
        expect(label.text()).toBe(t(`status.${status}`));
        expect(label.classes()).toContain(badge);
    });
});

describe('TransferTable — row actions', () => {
    it('saves a received file that is ready', async () => {
        const { wrapper, session } = await table([item({ id: 'in-1', status: 'ready' })]);
        await button(wrapper, t('table.save')).trigger('click');
        expect(session.save).toHaveBeenCalledWith('in-1');
    });

    it('copies received text to the clipboard, quietly when the clipboard is blocked', async () => {
        const writeText = stubClipboard();
        const { wrapper } = await table([item({ kind: 'text', text: 'hello', status: 'completed' })]);
        await button(wrapper, t('text.copy')).trigger('click');
        expect(writeText).toHaveBeenCalledWith('hello');

        const blocked = stubClipboard('blocked');
        await button(wrapper, t('text.copy')).trigger('click');
        expect(blocked).toHaveBeenCalledTimes(1);
    });

    it('copies nothing for a text without content', async () => {
        const writeText = stubClipboard();
        const { wrapper } = await table([item({ kind: 'text', text: undefined, status: 'completed' })]);
        await button(wrapper, t('text.copy')).trigger('click');
        expect(writeText).not.toHaveBeenCalled();
    });

    it.each<TransferStatus>(['active', 'queued', 'paused'])('cancels a %s transfer', async (status) => {
        const { wrapper, session } = await table([item({ id: 'x', dir: 'send', status })]);
        await button(wrapper, t('table.cancel')).trigger('click');
        expect(session.cancel).toHaveBeenCalledWith('x');
    });

    it.each<TransferStatus>(['done', 'completed', 'failed', 'canceled'])(
        'offers nothing for a %s file',
        async (status) => {
            const { wrapper } = await table([item({ dir: 'send', status })]);
            expect(wrapper.findAll('td.act button')).toHaveLength(0);
        },
    );
});

describe('TransferTable — header actions', () => {
    it('offers "Save all" only for two or more ready files', async () => {
        const one = await table([item({ id: 'a', status: 'ready' })]);
        expect(hasButton(one.wrapper, t('table.saveAll'))).toBe(false);

        const two = await table([item({ id: 'a', status: 'ready' }), item({ id: 'b', status: 'ready' })]);
        await button(two.wrapper, t('table.saveAll')).trigger('click');
        expect(two.session.saveAllReady).toHaveBeenCalledTimes(1);
    });

    it('offers "Clear finished" only once something has finished', async () => {
        const busy = await table([item({ status: 'active' })]);
        expect(hasButton(busy.wrapper, t('table.clearDone'))).toBe(false);

        const done = await table([item({ status: 'active' }), item({ id: 'b', status: 'done' })]);
        await button(done.wrapper, t('table.clearDone')).trigger('click');
        expect(done.session.clearFinished).toHaveBeenCalledTimes(1);
    });
});
