import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Session, type SessionState } from './session';
import { encodeChunk, encodeControl, decodeChunk } from './protocol';
import { saveAll, saveReceived, saveText } from './save';
import type { ReceivedFile } from './opfs';
import { FakeDataChannel, FakeRTCPeerConnection, FakeWebSocket, installWebRtc, installWebSocket } from '../test/fakes';
import { textFile } from '../test/fixtures';

/**
 * The session ties one room together: signaling (fake WebSocket), the WebRTC
 * link (fake RTCPeerConnection) and the transfer engine. These tests play the
 * server and the other browser to walk the real flows — host and guest pairing,
 * a link failing and being rebuilt, the other device leaving — and check what
 * the screens get to see through `state`, `items` and `snapshot()`.
 */

vi.mock('./save');

const ICE = [{ urls: 'stun:stun.example:3478' }];
const ROOM = { roomId: 'r-1', code: 'K7Q2XM', token: 'tk', iceServers: ICE };

/** Lets promise chains (offers, answers, engine processing) run to the end. */
async function flush(): Promise<void> {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
}

interface Harness {
    session: Session;
    ws: FakeWebSocket;
    states: SessionState[];
    last: () => SessionState;
    signals: () => Array<Record<string, unknown>>;
}

function begin(intent: Parameters<Session['start']>[0]): Harness {
    const session = new Session();
    const states: SessionState[] = [];
    session.emitter.on('state', (s) => states.push(s));
    session.start(intent);
    const ws = FakeWebSocket.last();
    ws.open();
    return {
        session,
        ws,
        states,
        last: () => states.at(-1)!,
        signals: () =>
            FakeWebSocket.instances
                .flatMap((socket) => socket.messages())
                .filter((m) => m.t === 'signal')
                .map((m) => m.data as Record<string, unknown>),
    };
}

/** A host whose guest has joined and whose data channel is open. */
async function connectedHost(): Promise<Harness & { pc: FakeRTCPeerConnection; dc: FakeDataChannel }> {
    const h = begin({ mode: 'create' });
    h.ws.receive({ t: 'created', ...ROOM });
    h.ws.receive({ t: 'peer-joined' });
    await flush();
    const pc = FakeRTCPeerConnection.last();
    h.ws.receive({ t: 'signal', data: { kind: 'answer', epoch: 1, sdp: { type: 'answer', sdp: 'a' } } });
    const dc = pc.channels[0]!;
    dc.open();
    await flush();
    return { ...h, pc, dc };
}

/** A guest joined by link whose host has offered and whose data channel is open. */
async function connectedGuest(): Promise<Harness & { pc: FakeRTCPeerConnection; dc: FakeDataChannel }> {
    const h = begin({ mode: 'join', room: 'r-1' });
    h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: true });
    h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'o' } } });
    await flush();
    const pc = FakeRTCPeerConnection.last();
    const dc = pc.emitDataChannel();
    dc.open();
    await flush();
    return { ...h, pc, dc };
}

beforeEach(() => {
    installWebSocket();
    installWebRtc();
});

describe('Session — hosting a room', () => {
    it('connects to the signaling server and waits for the other device once the room exists', () => {
        const h = begin({ mode: 'create' });
        expect(h.ws.url).toBe('ws://api.test/v1/signaling/ws');
        expect(h.ws.messages()).toEqual([{ t: 'create' }]);
        expect(h.session.snapshot().status).toBe('connecting');

        h.ws.receive({ t: 'created', ...ROOM });

        expect(h.last()).toEqual({
            status: 'waiting',
            roomId: 'r-1',
            code: 'K7Q2XM',
            link: `${window.location.origin}/r/r-1`,
            role: 'host',
            peerConnected: false,
            sinkMode: 'memory',
            errorCode: null,
        });
        expect(h.session.canSend).toBe(false);
    });

    it('offers a connection over the room ICE servers when the other device joins', async () => {
        const h = begin({ mode: 'create' });
        h.ws.receive({ t: 'created', ...ROOM });
        h.ws.receive({ t: 'peer-joined' });
        await flush();

        expect(h.last().status).toBe('connecting');
        expect(FakeRTCPeerConnection.last().config).toEqual({ iceServers: ICE });
        expect(h.signals()).toEqual([{ kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'offer-0' } }]);
    });

    it('is connected once the data channel opens, and greets the other side over it', async () => {
        const h = await connectedHost();
        h.pc.setState('connecting');

        expect(h.pc.remoteDescription).toEqual({ type: 'answer', sdp: 'a' });
        expect(h.last()).toMatchObject({ status: 'connected', peerConnected: true });
        expect(h.session.canSend).toBe(true);
        expect(h.dc.controls()).toEqual([{ t: 'hello', v: 1 }]);
    });

    it('relays ICE candidates both ways and drops those of another attempt', async () => {
        const h = await connectedHost();

        h.pc.emitCandidate({ candidate: 'local-1' });
        h.ws.receive({ t: 'signal', data: { kind: 'ice', epoch: 1, candidate: { candidate: 'remote-1' } } });
        h.ws.receive({ t: 'signal', data: { kind: 'ice', epoch: 0, candidate: { candidate: 'stale' } } });
        await flush();

        expect(h.signals().at(-1)).toEqual({ kind: 'ice', epoch: 1, candidate: { candidate: 'local-1' } });
        expect(h.pc.candidates).toEqual([{ candidate: 'remote-1' }]);
    });

    it('offers straight away when it is handed back a room the other device is already in', async () => {
        const h = begin({ mode: 'join', room: 'r-1' });
        h.ws.receive({ t: 'joined', ...ROOM, role: 'host', peerPresent: true });
        await flush();

        expect(h.last()).toMatchObject({ status: 'connecting', role: 'host' });
        expect(h.signals()).toEqual([{ kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'offer-0' } }]);
    });

    it('rebuilds the link with a new epoch when the guest asks, staying connected meanwhile', async () => {
        const h = await connectedHost();

        h.ws.receive({ t: 'signal', data: { kind: 'rebuild' } });
        await flush();

        expect(h.pc.closeCalls).toBe(1);
        expect(FakeRTCPeerConnection.instances).toHaveLength(2);
        expect(h.signals().at(-1)).toMatchObject({ kind: 'offer', epoch: 2 });
        expect(h.session.snapshot().status).toBe('connected');
    });

    it('ignores offers and signals it does not understand', async () => {
        const h = await connectedHost();

        for (const data of [
            { kind: 'offer', epoch: 9, sdp: { type: 'offer', sdp: 'o' } },
            null,
            'offer',
            { kind: 'party' },
        ]) {
            h.ws.receive({ t: 'signal', data });
        }
        await flush();

        expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    });
});

describe('Session — joining a room', () => {
    it('asks the host to (re)build the link and answers its offer', async () => {
        const h = begin({ mode: 'join', code: 'K7Q2XM' });
        expect(h.ws.messages()).toEqual([{ t: 'join', code: 'K7Q2XM' }]);

        h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: true });
        expect(h.last()).toMatchObject({ status: 'connecting', role: 'guest', roomId: 'r-1' });
        expect(h.signals()).toEqual([{ kind: 'rebuild' }]);

        h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 3, sdp: { type: 'offer', sdp: 'o' } } });
        await flush();
        expect(h.signals().at(-1)).toEqual({ kind: 'answer', epoch: 3, sdp: { type: 'answer', sdp: 'answer-0' } });

        FakeRTCPeerConnection.last().emitDataChannel().open();
        expect(h.last()).toMatchObject({ status: 'connected', peerConnected: true });
    });

    it('waits when the host is not in the room yet', () => {
        const h = begin({ mode: 'join', room: 'r-1' });
        h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: false });
        h.ws.receive({ t: 'peer-joined' });
        h.ws.receive({ t: 'peer-joined' });

        expect(h.last().status).toBe('connecting');
        expect(h.states.map((s) => s.status)).toEqual(['waiting', 'connecting', 'connecting']);
        expect(h.signals()).toEqual([]);
    });

    it('ignores a stale offer, a rebuild request, and ICE before any link exists', async () => {
        const h = begin({ mode: 'join', room: 'r-1' });
        h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: true });
        h.ws.receive({ t: 'signal', data: { kind: 'ice', epoch: 0, candidate: { candidate: 'early' } } });
        h.ws.receive({ t: 'signal', data: { kind: 'rebuild' } });
        h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 3, sdp: { type: 'offer', sdp: 'o3' } } });
        await flush();
        h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 2, sdp: { type: 'offer', sdp: 'o2' } } });
        await flush();

        expect(FakeRTCPeerConnection.instances).toHaveLength(1);
        expect(FakeRTCPeerConnection.last().remoteDescription).toEqual({ type: 'offer', sdp: 'o3' });
    });

    it('takes a newer offer as a fresh link, keeping its connected status', async () => {
        const h = await connectedGuest();

        h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 2, sdp: { type: 'offer', sdp: 'o2' } } });
        await flush();

        expect(h.pc.closeCalls).toBe(1);
        expect(FakeRTCPeerConnection.instances).toHaveLength(2);
        expect(h.session.snapshot().status).toBe('connected');
    });
});

describe('Session — losing and regaining the link', () => {
    it('pauses and rebuilds after the link fails (host)', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();
        h.session.sendFiles([{ file: textFile('a.txt', 'abc'), relPath: 'a.txt' }]);
        h.dc.bufferedAmount = 9 * 1024 * 1024;

        h.pc.setState('failed');
        expect(h.last()).toMatchObject({ status: 'reconnecting', peerConnected: false });
        await flush();
        expect(h.session.getItems()[0]?.status).toBe('paused');

        await vi.advanceTimersByTimeAsync(1200);
        const next = FakeRTCPeerConnection.last();
        expect(next).not.toBe(h.pc);
        expect(h.signals().at(-1)).toMatchObject({ kind: 'offer', epoch: 2 });

        h.ws.receive({ t: 'signal', data: { kind: 'answer', epoch: 2, sdp: { type: 'answer', sdp: 'a2' } } });
        next.channels[0]!.open();
        await flush();
        expect(h.last().status).toBe('connected');
        expect(next.channels[0]!.controls().map((c) => c.t)).toEqual(['hello', 'batch', 'eof']);
    });

    it('asks the host to rebuild after the link closes (guest)', async () => {
        vi.useFakeTimers();
        const h = await connectedGuest();

        h.pc.setState('closed');
        await vi.advanceTimersByTimeAsync(1200);

        expect(h.signals().filter((s) => s.kind === 'rebuild')).toHaveLength(2);
    });

    it('gives a briefly disconnected link time to come back by itself', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();

        h.pc.setState('disconnected');
        h.pc.setState('disconnected');
        await vi.advanceTimersByTimeAsync(600);
        h.pc.setState('connected');
        await vi.advanceTimersByTimeAsync(1200);

        expect(FakeRTCPeerConnection.instances).toHaveLength(1);
        expect(h.last()).toMatchObject({ status: 'connected', peerConnected: true });
    });

    it('rebuilds a link that went from disconnected to failed', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();

        h.pc.setState('disconnected');
        await vi.advanceTimersByTimeAsync(600);
        h.pc.setState('failed');
        await vi.advanceTimersByTimeAsync(600);

        expect(FakeRTCPeerConnection.instances).toHaveLength(2);
    });

    it('goes back to waiting when the other device leaves, and stops recovering', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();
        h.pc.setState('disconnected');

        h.ws.receive({ t: 'peer-left' });
        await vi.advanceTimersByTimeAsync(1200);

        expect(h.last()).toMatchObject({ status: 'waiting', peerConnected: false });
        expect(h.pc.closeCalls).toBe(1);
        expect(FakeRTCPeerConnection.instances).toHaveLength(1);
        expect(h.session.canSend).toBe(false);
    });

    it('does not chase a link whose device is no longer in the room', async () => {
        vi.useFakeTimers();
        const h = begin({ mode: 'join', room: 'r-1' });
        h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: true });
        h.ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'o' } } });
        await flush();
        const pc = FakeRTCPeerConnection.last();
        h.ws.receive({ t: 'peer-left' });
        const before = h.states.length;

        pc.setState('failed');
        await vi.advanceTimersByTimeAsync(1200);

        expect(h.states.length).toBe(before);
        expect(h.signals()).toEqual([{ kind: 'rebuild' }, { kind: 'answer', epoch: 1, sdp: expect.anything() }]);
    });

    it('drops a pending recovery once the link is back', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();
        h.pc.setState('failed');

        h.ws.receive({ t: 'signal', data: { kind: 'rebuild' } });
        await flush();
        FakeRTCPeerConnection.last().channels[0]!.open();
        await vi.advanceTimersByTimeAsync(1200);

        expect(FakeRTCPeerConnection.instances).toHaveLength(2);
        expect(h.last().status).toBe('connected');
    });

    it('rebuilds a link that never came up once the signaling socket is back (host)', async () => {
        vi.useFakeTimers();
        const h = begin({ mode: 'create' });
        h.ws.receive({ t: 'created', ...ROOM });
        h.ws.receive({ t: 'peer-joined' });
        await flush();

        h.ws.drop();
        expect(h.session.snapshot().status).toBe('reconnecting');
        await vi.advanceTimersByTimeAsync(500);
        const again = FakeWebSocket.last();
        again.open();
        await flush();

        expect(again.messages()[0]).toEqual({ t: 'join', room: 'r-1', token: 'tk' });
        expect(FakeRTCPeerConnection.instances).toHaveLength(2);
        expect(h.signals().at(-1)).toMatchObject({ kind: 'offer', epoch: 2 });

        again.receive({ t: 'joined', ...ROOM, role: 'host', peerPresent: true });
        await flush();
        expect(h.signals().at(-1)).toMatchObject({ kind: 'offer', epoch: 3 });
        expect(h.last()).toMatchObject({ status: 'connecting', roomId: 'r-1' });
    });

    it('asks for a rebuild once the signaling socket is back (guest)', async () => {
        vi.useFakeTimers();
        const h = begin({ mode: 'join', room: 'r-1' });
        h.ws.receive({ t: 'joined', ...ROOM, role: 'guest', peerPresent: true });

        h.ws.drop();
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.last().open();

        expect(FakeWebSocket.last().messages()).toEqual([
            { t: 'join', room: 'r-1', token: 'tk' },
            { t: 'signal', data: { kind: 'rebuild' } },
        ]);
    });

    it('does not rebuild a working link merely because the signaling socket reconnected', async () => {
        vi.useFakeTimers();
        const h = await connectedHost();

        h.ws.drop();
        await vi.advanceTimersByTimeAsync(500);
        FakeWebSocket.last().open();
        await flush();

        expect(FakeRTCPeerConnection.instances).toHaveLength(1);
    });
});

describe('Session — server errors', () => {
    it('shows the error and keeps showing it while the socket reconnects', async () => {
        vi.useFakeTimers();
        const h = begin({ mode: 'join', code: 'NOPE00' });

        h.ws.receive({ t: 'error', code: 'room-not-found' });
        expect(h.last()).toMatchObject({ status: 'error', errorCode: 'room-not-found' });

        h.ws.drop();
        await vi.advanceTimersByTimeAsync(500);
        expect(h.session.snapshot().status).toBe('error');
    });

    it('clears the error code once a room is granted', () => {
        const h = begin({ mode: 'create' });
        h.ws.receive({ t: 'error', code: 'server-error' });
        h.ws.receive({ t: 'created', ...ROOM });
        expect(h.last().errorCode).toBeNull();
    });
});

describe('Session — transfers', () => {
    it('lists dropped files at once and streams their bytes once connected', async () => {
        const h = await connectedHost();
        const changes = vi.fn();
        h.session.emitter.on('items', changes);

        h.session.sendFiles([
            { file: textFile('a.txt', 'hello'), relPath: 'docs/a.txt' },
            { file: new File(['?'], 'raw'), relPath: 'raw' },
        ]);
        await flush();

        const [a, raw] = h.session.getItems();
        expect(a).toMatchObject({ name: 'a.txt', relPath: 'docs/a.txt', mime: 'text/plain', size: 5, dir: 'send' });
        expect(raw?.mime).toBe('application/octet-stream');
        expect(a?.id).not.toBe(raw?.id);
        expect(changes).toHaveBeenCalled();

        const dc = h.dc;
        const frame = decodeChunk(dc.sent.find((d) => typeof d !== 'string') as ArrayBuffer)!;
        expect(new TextDecoder().decode(frame.payload)).toBe('hello');
    });

    it('gives files a random id where crypto.randomUUID is missing', () => {
        vi.stubGlobal('crypto', {});
        const session = new Session();
        session.sendFiles([
            { file: textFile('a.txt'), relPath: 'a.txt' },
            { file: textFile('b.txt'), relPath: 'b.txt' },
        ]);
        const [a, b] = session.getItems();
        expect(a?.id).toMatch(/^[a-z0-9]+$/);
        expect(a?.id).not.toBe(b?.id);
    });

    it('sends text as text.txt', async () => {
        const h = await connectedHost();
        h.session.sendText('hi there');
        expect(h.session.getItems()[0]).toMatchObject({ name: 'text.txt', kind: 'text', text: 'hi there' });
        expect(h.dc.controls().at(-1)).toMatchObject({ t: 'text', content: 'hi there' });
    });

    it('saves a received file and marks it saved', async () => {
        const h = await connectedGuest();
        h.dc.receive(
            encodeControl({
                t: 'batch',
                items: [{ i: 0, id: 'in-1', name: 'a.txt', size: 5, mime: 'text/plain', kind: 'file' }],
            }),
        );
        h.dc.receive(encodeChunk(0, 0, new TextEncoder().encode('hello')));
        await flush();
        expect(h.session.getItems()[0]?.status).toBe('ready');

        await h.session.save('in-1');

        const file = vi.mocked(saveReceived).mock.calls[0]?.[0] as ReceivedFile;
        expect(file).toMatchObject({ id: 'in-1', name: 'a.txt' });
        expect(new TextDecoder().decode(await (await file.getBlob()).arrayBuffer())).toBe('hello');
        expect(h.session.getItems()[0]?.status).toBe('done');
    });

    it('saves received text as a text file and marks it saved', async () => {
        const h = await connectedGuest();
        h.dc.receive(encodeControl({ t: 'text', id: 't-1', name: 'text.txt', content: 'note' }));
        await flush();

        await h.session.save('t-1');

        expect(saveText).toHaveBeenCalledWith('text.txt', 'note');
        expect(h.session.getItems()[0]?.status).toBe('done');
    });

    it('does nothing when asked to save something it does not hold', async () => {
        const h = await connectedGuest();
        await h.session.save('nope');
        expect(saveReceived).not.toHaveBeenCalled();
        expect(saveText).not.toHaveBeenCalled();
    });

    it('saves every received file that is ready, in one go', async () => {
        const h = await connectedGuest();
        const channel = h.dc;
        channel.receive(
            encodeControl({
                t: 'batch',
                items: [
                    { i: 0, id: 'a', name: 'a.txt', size: 1, mime: 'text/plain', kind: 'file' },
                    { i: 1, id: 'b', name: 'b.txt', size: 1, mime: 'text/plain', kind: 'file' },
                    { i: 2, id: 'empty', name: 'empty', size: 0, mime: '', kind: 'file' },
                    { i: 3, id: 'later', name: 'later.txt', size: 9, mime: 'text/plain', kind: 'file' },
                ],
            }),
        );
        channel.receive(encodeChunk(0, 0, new Uint8Array([65])));
        channel.receive(encodeChunk(1, 0, new Uint8Array([66])));
        channel.receive(encodeControl({ t: 'text', id: 't', name: 'text.txt', content: 'x' }));
        await flush();

        await h.session.saveAllReady();

        expect(vi.mocked(saveAll).mock.calls[0]?.[0].map((f) => f.id)).toEqual(['a', 'b']);
        expect(h.session.getItems().map((it) => [it.id, it.status])).toEqual([
            ['a', 'done'],
            ['b', 'done'],
            ['empty', 'done'],
            ['later', 'active'],
            ['t', 'completed'],
        ]);
    });

    it('does not open a save dialog when nothing is ready', async () => {
        const h = await connectedGuest();
        await h.session.saveAllReady();
        expect(saveAll).not.toHaveBeenCalled();
    });

    it('cancels a transfer and clears finished ones', async () => {
        const h = await connectedHost();
        h.dc.bufferedAmount = 9 * 1024 * 1024;
        h.session.sendFiles([{ file: textFile('a.txt'), relPath: 'a.txt' }]);
        const id = h.session.getItems()[0]!.id;

        h.session.cancel(id);
        expect(h.session.getItems()[0]?.status).toBe('canceled');
        expect(h.dc.controls().at(-1)).toEqual({ t: 'cancel-send', i: 0 });

        h.session.clearFinished();
        expect(h.session.getItems()).toEqual([]);
    });
});

describe('Session — dispose', () => {
    it('leaves the room, closes the link and goes silent', async () => {
        const h = await connectedHost();
        const before = h.states.length;

        h.session.dispose();
        h.ws.receive({ t: 'peer-left' });

        expect(h.ws.messages().at(-1)).toEqual({ t: 'bye' });
        expect(h.ws.closeCalls).toBe(1);
        expect(h.pc.closeCalls).toBe(1);
        expect(h.states.length).toBe(before);
    });

    it('can be disposed before it ever started', () => {
        expect(() => new Session().dispose()).not.toThrow();
    });
});
