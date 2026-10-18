import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';
import DropZone from './DropZone.vue';
import { i18n } from '../i18n';
import { useSessionStore } from '../stores/session';
import { FakeSession } from '../test/session-fake';
import { textFile } from '../test/fixtures';
import { button, hasButton, render } from '../test/render';

/**
 * Where files leave this device: drop them, pick files or a folder, or type
 * text. Everything starts sending at once — so nothing may be sent before the
 * other device is connected, and a picked folder must keep its paths.
 */

vi.mock('../core/session', () => import('../test/session-fake'));

const t = i18n.global.t;

let clicked: HTMLInputElement[];

beforeEach(() => {
    FakeSession.instances = [];
    clicked = [];
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
        clicked.push(this);
    });
});

async function dropZone(connected: boolean) {
    const rendered = await render(DropZone);
    useSessionStore().hostNew();
    FakeSession.last().setState({ status: connected ? 'connected' : 'waiting', peerConnected: connected });
    await nextTick();
    return { ...rendered, session: FakeSession.last() };
}

/** Fires a drop carrying `files` (a DataTransfer without the entries API, like Safari's). */
async function dropFiles(el: Element, files: File[] | null): Promise<void> {
    const event = new Event('drop', { bubbles: true, cancelable: true });
    if (files) Object.defineProperty(event, 'dataTransfer', { value: { items: [], files } });
    el.dispatchEvent(event);
    await flushPromises();
}

/** Picks `files` in the hidden input, as the browser does after its file dialog. */
async function choose(input: HTMLInputElement, files: File[]): Promise<void> {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
    await flushPromises();
}

describe('DropZone — before the other device connects', () => {
    it('says to connect first and offers no way to send', async () => {
        const { wrapper, session } = await dropZone(false);

        expect(wrapper.find('.drop-title').text()).toBe(t('drop.disabledTitle'));
        expect(wrapper.find('.drop-hint').text()).toBe(t('drop.disabledHint'));
        expect(wrapper.find('.drop').classes()).toContain('disabled');
        expect(wrapper.findAll('button')).toHaveLength(0);

        await wrapper.find('.drop').trigger('click');
        await wrapper.find('.drop').trigger('dragover');
        await dropFiles(wrapper.find('.drop').element, [textFile('a.txt')]);

        expect(clicked).toEqual([]);
        expect(wrapper.find('.drop').classes()).not.toContain('over');
        expect(session.sendFiles).not.toHaveBeenCalled();
    });
});

describe('DropZone — dropping', () => {
    it('highlights while something is dragged over, and sends what is dropped', async () => {
        const { wrapper, session } = await dropZone(true);
        const zone = wrapper.find('.drop');
        expect(wrapper.find('.drop-title').text()).toBe(t('drop.title'));

        await zone.trigger('dragover');
        expect(zone.classes()).toContain('over');
        await zone.trigger('dragleave');
        expect(zone.classes()).not.toContain('over');

        await zone.trigger('dragover');
        const files = [textFile('a.txt'), textFile('b.txt')];
        await dropFiles(zone.element, files);

        expect(zone.classes()).not.toContain('over');
        expect(session.sendFiles).toHaveBeenCalledWith([
            { file: files[0], relPath: 'a.txt' },
            { file: files[1], relPath: 'b.txt' },
        ]);
    });

    it('sends nothing for a drop without files', async () => {
        const { wrapper, session } = await dropZone(true);
        await dropFiles(wrapper.find('.drop').element, []);
        await dropFiles(wrapper.find('.drop').element, null);
        expect(session.sendFiles).not.toHaveBeenCalled();
    });
});

describe('DropZone — picking', () => {
    it('opens the file dialog from the zone or the button, and the folder dialog from its button', async () => {
        const { wrapper } = await dropZone(true);
        const [filesInput, folderInput] = wrapper.findAll('input[type="file"]').map((w) => w.element);

        await wrapper.find('.drop').trigger('click');
        await button(wrapper, t('drop.files')).trigger('click');
        await button(wrapper, t('drop.folder')).trigger('click');

        expect(clicked).toEqual([filesInput, filesInput, folderInput]);
        expect(folderInput?.hasAttribute('webkitdirectory')).toBe(true);
    });

    it('sends the picked files with their folder paths and resets the picker', async () => {
        const { wrapper, session } = await dropZone(true);
        const folderInput = wrapper.findAll('input[type="file"]')[1]!.element as HTMLInputElement;
        const file = textFile('a.txt');
        Object.defineProperty(file, 'webkitRelativePath', { value: 'docs/a.txt' });

        await choose(folderInput, [file]);

        expect(session.sendFiles).toHaveBeenCalledWith([{ file, relPath: 'docs/a.txt' }]);
        expect(folderInput.value).toBe('');
    });

    it('sends nothing when the dialog is closed without a choice', async () => {
        const { wrapper, session } = await dropZone(true);
        await choose(wrapper.find('input[type="file"]').element as HTMLInputElement, []);
        expect(session.sendFiles).not.toHaveBeenCalled();
    });
});

describe('DropZone — sending text', () => {
    it('sends the typed text trimmed and closes the box', async () => {
        const { wrapper, session } = await dropZone(true);
        await button(wrapper, t('drop.text')).trigger('click');
        expect(wrapper.find('textarea').attributes('placeholder')).toBe(t('text.placeholder'));
        expect(button(wrapper, t('text.send')).attributes('disabled')).toBeDefined();

        await wrapper.find('textarea').setValue('  hello  ');
        await button(wrapper, t('text.send')).trigger('click');

        expect(session.sendText).toHaveBeenCalledWith('hello');
        expect(wrapper.find('textarea').exists()).toBe(false);
    });

    it('sends with Ctrl+Enter or Cmd+Enter', async () => {
        const { wrapper, session } = await dropZone(true);
        await button(wrapper, t('drop.text')).trigger('click');
        await wrapper.find('textarea').setValue('one');
        await wrapper.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
        await button(wrapper, t('drop.text')).trigger('click');
        await wrapper.find('textarea').setValue('two');
        await wrapper.find('textarea').trigger('keydown', { key: 'Enter', metaKey: true });

        expect(session.sendText.mock.calls).toEqual([['one'], ['two']]);
    });

    it('sends nothing for blank text, and closes on Cancel or a second click', async () => {
        const { wrapper, session } = await dropZone(true);
        await button(wrapper, t('drop.text')).trigger('click');
        await wrapper.find('textarea').setValue('   ');
        await wrapper.find('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
        expect(session.sendText).not.toHaveBeenCalled();

        await button(wrapper, t('text.cancel')).trigger('click');
        expect(hasButton(wrapper, t('text.send'))).toBe(false);
        await button(wrapper, t('drop.text')).trigger('click');
        await button(wrapper, t('drop.text')).trigger('click');
        expect(wrapper.find('textarea').exists()).toBe(false);
    });
});
