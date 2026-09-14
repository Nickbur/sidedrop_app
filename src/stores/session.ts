import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { Session, type Intent, type SessionState } from '../core/session';
import type { Dropped } from '../core/fileTree';
import type { TransferItem } from '../core/types';

const EMPTY: SessionState = {
    status: 'idle',
    roomId: null,
    code: null,
    link: null,
    role: null,
    peerConnected: false,
    sinkMode: 'opfs',
    errorCode: null,
};

export const useSessionStore = defineStore('session', () => {
    const state = reactive<SessionState>({ ...EMPTY });
    const items = ref<TransferItem[]>([]);

    let session: Session | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const rates = new Map<string, { bytes: number; t: number; speed: number }>();

    function refresh(): void {
        if (session) items.value = session.getItems();
    }

    function tick(): void {
        if (!session) return;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        const list = session.getItems();
        for (const it of list) {
            if (it.status === 'active') {
                const prev = rates.get(it.id);
                if (prev) {
                    const dt = (now - prev.t) / 1000;
                    if (dt >= 0.2) {
                        const inst = Math.max(0, (it.transferred - prev.bytes) / dt);
                        const speed = prev.speed > 0 ? prev.speed * 0.6 + inst * 0.4 : inst;
                        it.speed = speed;
                        it.eta = speed > 0 ? Math.max(0, (it.size - it.transferred) / speed) : Infinity;
                        rates.set(it.id, { bytes: it.transferred, t: now, speed });
                    } else {
                        it.speed = prev.speed;
                        it.eta = prev.speed > 0 ? Math.max(0, (it.size - it.transferred) / prev.speed) : Infinity;
                    }
                } else {
                    rates.set(it.id, { bytes: it.transferred, t: now, speed: 0 });
                }
            } else {
                rates.delete(it.id);
            }
        }
        items.value = list;
    }

    function wire(s: Session): void {
        s.emitter.on('state', (st) => Object.assign(state, st));
        s.emitter.on('items', refresh);
        if (!timer) timer = setInterval(tick, 300);
    }

    function fresh(): Session {
        session?.dispose();
        rates.clear();
        Object.assign(state, EMPTY);
        items.value = [];
        session = new Session();
        wire(session);
        Object.assign(state, session.snapshot());
        return session;
    }

    function begin(intent: Intent): void {
        fresh().start(intent);
    }

    function hostNew(): void {
        begin({ mode: 'create' });
    }
    function joinRoom(room: string): void {
        begin({ mode: 'join', room });
    }
    function joinCode(code: string): void {
        begin({ mode: 'join', code });
    }

    function sendFiles(dropped: Dropped[]): void {
        session?.sendFiles(dropped);
    }
    function sendText(content: string): void {
        session?.sendText(content);
    }
    function save(id: string): Promise<void> {
        return session ? session.save(id) : Promise.resolve();
    }
    function saveAllReady(): Promise<void> {
        return session ? session.saveAllReady() : Promise.resolve();
    }
    function cancel(id: string): void {
        session?.cancel(id);
    }
    function clearFinished(): void {
        session?.clearFinished();
        refresh();
    }

    const canSend = computed(() => state.peerConnected);
    const readyToSave = computed(() =>
        items.value.filter((it) => it.dir === 'recv' && it.status === 'ready' && it.kind === 'file'),
    );
    const hasFinished = computed(() =>
        items.value.some((it) => ['done', 'completed', 'canceled', 'failed'].includes(it.status)),
    );

    return {
        state,
        items,
        canSend,
        readyToSave,
        hasFinished,
        hostNew,
        joinRoom,
        joinCode,
        sendFiles,
        sendText,
        save,
        saveAllReady,
        cancel,
        clearFinished,
    };
});
