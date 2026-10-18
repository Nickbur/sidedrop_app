import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import QRCode from 'qrcode';
import QrCanvas from './QrCanvas.vue';

/**
 * The QR code the other device scans to join. It must encode exactly the room
 * link, redraw when the link changes, and never break the page if drawing fails.
 */

vi.mock('qrcode', () => ({ default: { toCanvas: vi.fn() } }));

// `toCanvas` is overloaded; the component only uses the (canvas, text, options) → Promise form.
type ToCanvas = (canvas: HTMLCanvasElement, text: string, options: object) => Promise<void>;
const toCanvas = vi.mocked(QRCode.toCanvas as unknown as ToCanvas);

beforeEach(() => {
    toCanvas.mockResolvedValue(undefined);
});

describe('QrCanvas', () => {
    it('draws the link onto a 208 px canvas with dark-on-white colours', async () => {
        const wrapper = mount(QrCanvas, { props: { value: 'https://sidedrop.test/r/r-1' } });
        await flushPromises();

        const canvas = wrapper.find('canvas');
        expect(canvas.attributes()).toMatchObject({ width: '208', height: '208' });
        expect(toCanvas).toHaveBeenCalledWith(canvas.element, 'https://sidedrop.test/r/r-1', {
            width: 208,
            margin: 1,
            color: { dark: '#1c1917', light: '#ffffff' },
        });
    });

    it('honours a custom size', async () => {
        const wrapper = mount(QrCanvas, { props: { value: 'x', size: 120 } });
        await flushPromises();
        expect(wrapper.find('canvas').attributes()).toMatchObject({ width: '120', height: '120' });
        expect(toCanvas.mock.calls[0]?.[2]).toMatchObject({ width: 120 });
    });

    it('redraws when the link changes', async () => {
        const wrapper = mount(QrCanvas, { props: { value: 'first' } });
        await wrapper.setProps({ value: 'second' });
        await flushPromises();
        expect(toCanvas.mock.calls.map((c) => c[1])).toEqual(['first', 'second']);
    });

    it('draws nothing for an empty link', async () => {
        mount(QrCanvas, { props: { value: '' } });
        await flushPromises();
        expect(toCanvas).not.toHaveBeenCalled();
    });

    it('keeps the page intact when drawing fails', async () => {
        toCanvas.mockRejectedValue(new Error('data too long'));
        const wrapper = mount(QrCanvas, { props: { value: 'x'.repeat(5000) } });
        await flushPromises();
        expect(wrapper.find('canvas').exists()).toBe(true);
    });
});
