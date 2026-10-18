import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSessionStore } from './session';
import { FakeSession } from '../test/session-fake';
import { item, sessionState, textFile } from '../test/fixtures';

/**
 * The store is what every screen reads: the connection state, the transfer
 * list, and the live speed / ETA it estimates every 300 ms. Starting a new room
 * must throw the old one away completely, so these tests swap the real session
 * for a fake one and drive it from the outside.
 */

vi.mock('../core/session', () => import('../test/session-fake'));

beforeEach(() => {
    FakeSession.instances = [];
    setActivePinia(createPinia());
});

describe('session store — starting', () => {
    it('starts idle with nothing to show, and ignores actions before a room exists', async () => {
        const store = useSessionStore();
        expect(store.state).toEqual(sessionState());
        expect(store.items).toEqual([]);
        expect(store.canSend).toBe(false);

        store.sendFiles([]);
        store.sendText('x');
        store.cancel('x');
        store.clearFinished();
        await expect(store.save('x')).resolves.toBeUndefined();
        await expect(store.saveAllReady()).resolves.toBeUndefined();
        expect(FakeSession.instances).toEqual([]);
    });

    it('hosts a new room, joins by link, or joins by code', () => {
        const store = useSessionStore();
        store.hostNew();
        store.joinRoom('r-1');
        store.joinCode('K7Q2XM');

        expect(FakeSession.instances.map((s) => s.start.mock.calls[0]?.[0])).toEqual([
            { mode: 'create' },
            { mode: 'join', room: 'r-1' },
            { mode: 'join', code: 'K7Q2XM' },
        ]);
    });

    it('throws the previous room away completely when starting another', () => {
        const store = useSessionStore();
        store.hostNew();
        const first = FakeSession.last();
        first.setState({ status: 'connected', roomId: 'r-1', peerConnected: true, sinkMode: 'memory' });
        first.setItems([item({ id: 'old' })]);

        store.joinCode('K7Q2XM');

        expect(first.dispose).toHaveBeenCalledTimes(1);
        expect(store.state).toEqual(sessionState());
        expect(store.items).toEqual([]);
    });

    it('takes the sink mode the new session reports before it connects', () => {
        const store = useSessionStore();
        vi.spyOn(FakeSession.prototype, 'snapshot').mockReturnValue(sessionState({ sinkMode: 'memory' }));
        store.hostNew();
        expect(store.state.sinkMode).toBe('memory');
    });
});

describe('session store — following the session', () => {
    it('mirrors connection state and the transfer list as the session reports them', () => {
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();

        session.setState({ status: 'connected', roomId: 'r-1', code: 'K7Q2XM', peerConnected: true });
        session.setItems([item({ id: 'a' })]);

        expect(store.state).toMatchObject({ status: 'connected', roomId: 'r-1', code: 'K7Q2XM' });
        expect(store.canSend).toBe(true);
        expect(store.items.map((it) => it.id)).toEqual(['a']);
    });

    it('lists only received, ready files as ready to save', () => {
        const store = useSessionStore();
        store.hostNew();
        FakeSession.last().setItems([
            item({ id: 'ready', status: 'ready' }),
            item({ id: 'sending', dir: 'send', status: 'ready' }),
            item({ id: 'text', kind: 'text', status: 'ready' }),
            item({ id: 'busy', status: 'active' }),
        ]);
        expect(store.readyToSave.map((it) => it.id)).toEqual(['ready']);
    });

    it.each(['done', 'completed', 'canceled', 'failed'] as const)('counts a %s item as finished', (status) => {
        const store = useSessionStore();
        store.hostNew();
        FakeSession.last().setItems([item({ status: 'active' })]);
        expect(store.hasFinished).toBe(false);
        FakeSession.last().setItems([item({ status: 'active' }), item({ id: 'b', status })]);
        expect(store.hasFinished).toBe(true);
    });
});

describe('session store — actions', () => {
    it('passes every transfer action on to the current session', async () => {
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();
        const dropped = [{ file: textFile('a.txt'), relPath: 'a.txt' }];

        store.sendFiles(dropped);
        store.sendText('hello');
        store.cancel('a');
        await store.save('b');
        await store.saveAllReady();

        expect(session.sendFiles).toHaveBeenCalledWith(dropped);
        expect(session.sendText).toHaveBeenCalledWith('hello');
        expect(session.cancel).toHaveBeenCalledWith('a');
        expect(session.save).toHaveBeenCalledWith('b');
        expect(session.saveAllReady).toHaveBeenCalledTimes(1);
    });

    it('re-reads the list right after clearing finished items', () => {
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();
        session.setItems([item({ id: 'a', status: 'done' }), item({ id: 'b' })]);
        session.clearFinished.mockImplementation(() => session.replaceItems([item({ id: 'b' })]));

        store.clearFinished();

        expect(store.items.map((it) => it.id)).toEqual(['b']);
    });
});

describe('session store — speed and ETA', () => {
    /** Fake interval timers and a clock the test sets by hand, in milliseconds. */
    function clock(): { at: (ms: number) => void } {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
        let now = 0;
        vi.spyOn(performance, 'now').mockImplementation(() => now);
        return { at: (ms) => (now = ms) };
    }

    it('estimates speed from progress between ticks and smooths it', () => {
        const time = clock();
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();
        const at = (transferred: number): void =>
            session.replaceItems([item({ id: 'a', size: 10_000, transferred, status: 'active' })]);

        at(0);
        time.at(0);
        vi.advanceTimersByTime(300);
        expect(store.items[0]).toMatchObject({ speed: 0, eta: Infinity });

        at(1000);
        time.at(500);
        vi.advanceTimersByTime(300);
        expect(store.items[0]?.speed).toBe(2000);
        expect(store.items[0]?.eta).toBe(4.5);

        at(3000);
        time.at(1000);
        vi.advanceTimersByTime(300);
        expect(store.items[0]?.speed).toBe(2000 * 0.6 + 4000 * 0.4);
        expect(store.items[0]?.eta).toBeCloseTo(7000 / 2800);
    });

    it('keeps the last estimate when ticks come too close together', () => {
        const time = clock();
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();
        const at = (transferred: number): void =>
            session.replaceItems([item({ id: 'a', size: 10_000, transferred, status: 'active' })]);

        at(0);
        vi.advanceTimersByTime(300);
        at(1000);
        time.at(1000);
        vi.advanceTimersByTime(300);
        at(5000);
        time.at(1100);
        vi.advanceTimersByTime(300);

        expect(store.items[0]?.speed).toBe(1000);
        expect(store.items[0]?.eta).toBe(5);
    });

    it('shows no ETA while nothing moves, and forgets items that stopped', () => {
        const time = clock();
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();
        session.replaceItems([item({ id: 'a', size: 10, transferred: 2, status: 'active' })]);
        vi.advanceTimersByTime(300);
        time.at(100);
        vi.advanceTimersByTime(300);
        expect(store.items[0]).toMatchObject({ speed: 0, eta: Infinity });
        time.at(400);
        vi.advanceTimersByTime(300);
        expect(store.items[0]).toMatchObject({ speed: 0, eta: Infinity });

        session.replaceItems([item({ id: 'a', size: 10, transferred: 2, status: 'paused' })]);
        vi.advanceTimersByTime(300);
        session.replaceItems([item({ id: 'a', size: 10, transferred: 6, status: 'active' })]);
        time.at(1000);
        vi.advanceTimersByTime(300);
        expect(store.items[0]?.speed).toBe(0);
    });

    it('uses the wall clock where performance.now is unavailable', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        vi.stubGlobal('performance', undefined);
        const store = useSessionStore();
        store.hostNew();
        const session = FakeSession.last();

        session.replaceItems([item({ id: 'a', size: 10_000, transferred: 0, status: 'active' })]);
        vi.advanceTimersByTime(300);
        session.replaceItems([item({ id: 'a', size: 10_000, transferred: 600, status: 'active' })]);
        vi.advanceTimersByTime(300);

        expect(store.items[0]?.speed).toBe(2000);
    });
});
