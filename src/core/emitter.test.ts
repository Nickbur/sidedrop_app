import { describe, expect, it, vi } from 'vitest';
import { Emitter } from './emitter';

/**
 * The emitter is the only wire between the transfer engine, the session and the
 * store. A handler that silently stops firing (or fires after it was removed)
 * shows up as a frozen or ghost transfer list, so these pin its contract.
 */

type Events = { ping: number; other: string };

describe('Emitter', () => {
    it('delivers a payload to every handler of that event and to no other event', () => {
        const emitter = new Emitter<Events>();
        const a = vi.fn();
        const b = vi.fn();
        const other = vi.fn();
        emitter.on('ping', a);
        emitter.on('ping', b);
        emitter.on('other', other);

        emitter.emit('ping', 7);

        expect(a).toHaveBeenCalledWith(7);
        expect(b).toHaveBeenCalledWith(7);
        expect(other).not.toHaveBeenCalled();
    });

    it('stops delivering once a handler is unsubscribed or switched off', () => {
        const emitter = new Emitter<Events>();
        const viaReturn = vi.fn();
        const viaOff = vi.fn();
        const unsubscribe = emitter.on('ping', viaReturn);
        emitter.on('ping', viaOff);

        unsubscribe();
        emitter.off('ping', viaOff);
        emitter.emit('ping', 1);

        expect(viaReturn).not.toHaveBeenCalled();
        expect(viaOff).not.toHaveBeenCalled();
    });

    it('lets a handler remove itself mid-emit without skipping the next one', () => {
        const emitter = new Emitter<Events>();
        const seen: string[] = [];
        const first = (): void => {
            seen.push('first');
            emitter.off('ping', first);
        };
        emitter.on('ping', first);
        emitter.on('ping', () => seen.push('second'));

        emitter.emit('ping', 1);
        emitter.emit('ping', 2);

        expect(seen).toEqual(['first', 'second', 'second']);
    });

    it('ignores emits nobody listens to, and forgets every handler on clear()', () => {
        const emitter = new Emitter<Events>();
        expect(() => emitter.emit('other', 'nobody')).not.toThrow();
        emitter.off('other', () => undefined);

        const handler = vi.fn();
        emitter.on('ping', handler);
        emitter.clear();
        emitter.emit('ping', 3);

        expect(handler).not.toHaveBeenCalled();
    });
});
