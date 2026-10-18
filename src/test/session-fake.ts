import { vi } from 'vitest';
import { Emitter } from '../core/emitter';
import type { Dropped } from '../core/fileTree';
import type { Intent, SessionEvents, SessionState } from '../core/session';
import type { TransferItem } from '../core/types';
import { sessionState } from './fixtures';

/**
 * A stand-in for `core/session`'s `Session`, for tests of the store and the
 * screens. It speaks the same events the real one does (`state`, `items`) and
 * records every call, so a screen test can say "the other device connected" or
 * "a file is ready" without any signaling or WebRTC underneath.
 *
 * Use with: `vi.mock('../core/session', () => import('../test/session-fake'));`
 */
export class FakeSession {
    static instances: FakeSession[] = [];

    /** The most recently created session — the one the store is currently driving. */
    static last(): FakeSession {
        const session = FakeSession.instances.at(-1);
        if (!session) throw new Error('no Session was created');
        return session;
    }

    readonly emitter = new Emitter<SessionEvents>();
    readonly start = vi.fn<(intent: Intent) => void>();
    readonly sendFiles = vi.fn<(dropped: Dropped[]) => void>();
    readonly sendText = vi.fn<(content: string) => void>();
    readonly save = vi.fn<(id: string) => Promise<void>>(async () => undefined);
    readonly saveAllReady = vi.fn<() => Promise<void>>(async () => undefined);
    readonly cancel = vi.fn<(id: string) => void>();
    readonly clearFinished = vi.fn<() => void>();
    /** Like the real one, a disposed session never speaks again. */
    readonly dispose = vi.fn<() => void>(() => this.emitter.clear());

    private state: SessionState = sessionState();
    private items: TransferItem[] = [];

    constructor() {
        FakeSession.instances.push(this);
    }

    getItems(): TransferItem[] {
        return this.items.map((it) => ({ ...it }));
    }

    snapshot(): SessionState {
        return { ...this.state };
    }

    // drivers

    /** The session reports a new connection state (what `Session.emitState` does). */
    setState(patch: Partial<SessionState>): void {
        this.state = { ...this.state, ...patch };
        this.emitter.emit('state', this.snapshot());
    }

    /** The transfer list changed (what the engine's change/added/done events do). */
    setItems(items: TransferItem[]): void {
        this.items = items;
        this.emitter.emit('items', undefined as void);
    }

    /** Replace the list silently, as the engine does between change notifications. */
    replaceItems(items: TransferItem[]): void {
        this.items = items;
    }
}

export { FakeSession as Session };
