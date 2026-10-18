import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignalingClient, type SignalingEvents } from './signaling';
import { FakeWebSocket, installWebSocket } from '../test/fakes';

/**
 * The signaling client is the only part of Sidedrop that talks to the server:
 * it creates or joins a room, relays WebRTC signals, and — when the socket drops
 * — reconnects with growing back-off and reclaims the same room with its token.
 * A fake WebSocket plays the server, so no test ever opens a connection.
 */

const URL = 'ws://api.test/v1/signaling/ws';

function record(client: SignalingClient): Array<[keyof SignalingEvents, unknown]> {
    const log: Array<[keyof SignalingEvents, unknown]> = [];
    const names: Array<keyof SignalingEvents> = [
        'created',
        'joined',
        'peer-joined',
        'peer-left',
        'signal',
        'reconnected',
        'status',
        'error',
    ];
    for (const name of names) client.emitter.on(name, (payload) => log.push([name, payload]));
    return log;
}

const events = (log: Array<[keyof SignalingEvents, unknown]>, name: keyof SignalingEvents): unknown[] =>
    log.filter(([n]) => n === name).map(([, p]) => p);

beforeEach(() => {
    installWebSocket();
});

describe('SignalingClient — opening a room', () => {
    it('connects to the signaling URL and asks for a new room once the socket opens', () => {
        const client = new SignalingClient(URL);
        const log = record(client);

        client.create();
        const ws = FakeWebSocket.last();
        expect(ws.url).toBe(URL);
        expect(events(log, 'status')).toEqual(['connecting']);
        expect(ws.sent).toEqual([]);

        ws.open();
        expect(events(log, 'status')).toEqual(['connecting', 'open']);
        expect(ws.messages()).toEqual([{ t: 'create' }]);
        expect(events(log, 'reconnected')).toEqual([]);
    });

    it('joins by room id or by code', () => {
        const byRoom = new SignalingClient(URL);
        byRoom.join({ room: 'r-1' });
        FakeWebSocket.last().open();
        expect(FakeWebSocket.last().messages()).toEqual([{ t: 'join', room: 'r-1' }]);

        const byCode = new SignalingClient(URL);
        byCode.join({ code: 'K7Q2XM' });
        FakeWebSocket.last().open();
        expect(FakeWebSocket.last().messages()).toEqual([{ t: 'join', code: 'K7Q2XM' }]);
    });

    it('announces the created room with its ICE servers', () => {
        const client = new SignalingClient(URL);
        const log = record(client);
        client.create();
        const ws = FakeWebSocket.last();
        ws.open();

        ws.receive({ t: 'created', roomId: 'r-1', code: 'K7Q2XM', token: 'tk', iceServers: [{ urls: 'stun:s' }] });
        ws.receive({ t: 'created', roomId: 'r-2', code: 'ABCDEF', token: 'tk2' });

        expect(events(log, 'created')).toEqual([
            { roomId: 'r-1', code: 'K7Q2XM', token: 'tk', iceServers: [{ urls: 'stun:s' }] },
            { roomId: 'r-2', code: 'ABCDEF', token: 'tk2', iceServers: [] },
        ]);
    });

    it('announces a joined room, defaulting to a guest with no peer and no ICE servers', () => {
        const client = new SignalingClient(URL);
        const log = record(client);
        client.join({ room: 'r-1' });
        const ws = FakeWebSocket.last();
        ws.open();

        ws.receive({ t: 'joined', roomId: 'r-1', code: 'K7Q2XM', token: 'tk' });
        ws.receive({ t: 'joined', roomId: 'r-1', code: 'K7Q2XM', token: 'tk', role: 'host', peerPresent: 1 });

        expect(events(log, 'joined')).toEqual([
            { roomId: 'r-1', code: 'K7Q2XM', token: 'tk', role: 'guest', peerPresent: false, iceServers: [] },
            { roomId: 'r-1', code: 'K7Q2XM', token: 'tk', role: 'host', peerPresent: true, iceServers: [] },
        ]);
        expect(events(log, 'created')).toEqual([]);
    });
});

describe('SignalingClient — messages', () => {
    function opened(): { client: SignalingClient; ws: FakeWebSocket; log: Array<[keyof SignalingEvents, unknown]> } {
        const client = new SignalingClient(URL);
        const log = record(client);
        client.create();
        const ws = FakeWebSocket.last();
        ws.open();
        return { client, ws, log };
    }

    it('passes on peer presence, relayed signals and server errors', () => {
        const { ws, log } = opened();

        ws.receive({ t: 'peer-joined' });
        ws.receive({ t: 'signal', data: { kind: 'offer', epoch: 1 } });
        ws.receive({ t: 'peer-left' });
        ws.receive({ t: 'error', code: 'room-full' });

        expect(log.filter(([n]) => n !== 'status')).toEqual([
            ['peer-joined', undefined],
            ['signal', { kind: 'offer', epoch: 1 }],
            ['peer-left', undefined],
            ['error', { code: 'room-full' }],
        ]);
    });

    it('ignores binary frames, broken JSON and unknown message types', () => {
        const { ws, log } = opened();
        const before = log.length;

        ws.receiveRaw(new ArrayBuffer(4));
        ws.receive('{not json');
        ws.receive({ t: 'party' });

        expect(log.length).toBe(before);
    });

    it('relays a signal only while the socket is open', () => {
        const client = new SignalingClient(URL);
        client.sendSignal({ kind: 'ice' });
        client.create();
        const ws = FakeWebSocket.last();
        client.sendSignal({ kind: 'ice' });
        ws.open();
        client.sendSignal({ kind: 'answer', epoch: 2 });

        expect(ws.messages()).toEqual([{ t: 'create' }, { t: 'signal', data: { kind: 'answer', epoch: 2 } }]);
    });
});

describe('SignalingClient — reconnecting', () => {
    it('reconnects with doubling back-off up to 8 s, and resets it once connected', async () => {
        vi.useFakeTimers();
        const client = new SignalingClient(URL);
        const log = record(client);
        client.create();
        FakeWebSocket.last().open();

        const delays: number[] = [];
        for (let attempt = 0; attempt < 6; attempt += 1) {
            const count = FakeWebSocket.instances.length;
            FakeWebSocket.last().drop();
            let waited = 0;
            while (FakeWebSocket.instances.length === count) {
                await vi.advanceTimersByTimeAsync(100);
                waited += 100;
            }
            delays.push(waited);
        }
        expect(delays).toEqual([500, 1000, 2000, 4000, 8000, 8000]);
        expect(events(log, 'status').slice(0, 4)).toEqual(['connecting', 'open', 'reconnecting', 'reconnecting']);

        FakeWebSocket.last().open();
        const count = FakeWebSocket.instances.length;
        FakeWebSocket.last().drop();
        await vi.advanceTimersByTimeAsync(500);
        expect(FakeWebSocket.instances.length).toBe(count + 1);
    });

    it('reclaims its room with the token after a reconnect and says it reconnected', async () => {
        vi.useFakeTimers();
        const client = new SignalingClient(URL);
        const log = record(client);
        client.join({ code: 'K7Q2XM' });
        const first = FakeWebSocket.last();
        first.open();
        first.receive({ t: 'joined', roomId: 'r-9', code: 'K7Q2XM', token: 'secret', role: 'guest' });

        first.drop();
        await vi.advanceTimersByTimeAsync(500);
        const second = FakeWebSocket.last();
        expect(second).not.toBe(first);
        second.open();

        expect(second.messages()).toEqual([{ t: 'join', room: 'r-9', token: 'secret' }]);
        expect(events(log, 'reconnected')).toEqual([undefined]);
        expect(events(log, 'status')).toEqual(['connecting', 'open', 'reconnecting', 'reconnecting', 'open']);
    });

    it('treats a socket error as a drop and reconnects', async () => {
        vi.useFakeTimers();
        const client = new SignalingClient(URL);
        client.create();
        const ws = FakeWebSocket.last();
        ws.open();

        ws.fail();
        expect(ws.closeCalls).toBe(1);
        await vi.advanceTimersByTimeAsync(500);
        expect(FakeWebSocket.instances).toHaveLength(2);
    });

    it('tolerates a socket that throws while being closed after an error', () => {
        const client = new SignalingClient(URL);
        client.create();
        const ws = FakeWebSocket.last();
        ws.throwOnClose = true;
        expect(() => ws.fail()).not.toThrow();
    });
});

describe('SignalingClient — close', () => {
    it('says goodbye, closes the socket and reports closed without reconnecting', async () => {
        vi.useFakeTimers();
        const client = new SignalingClient(URL);
        const log = record(client);
        client.create();
        const ws = FakeWebSocket.last();
        ws.open();

        client.close();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(ws.messages()).toEqual([{ t: 'create' }, { t: 'bye' }]);
        expect(ws.closeCalls).toBe(1);
        expect(events(log, 'status').at(-1)).toBe('closed');
        expect(FakeWebSocket.instances).toHaveLength(1);
        client.sendSignal({ kind: 'ice' });
        expect(ws.messages()).toHaveLength(2);
    });

    it('closes quietly before connecting, or when the socket refuses the goodbye or the close', () => {
        expect(() => new SignalingClient(URL).close()).not.toThrow();

        const connecting = new SignalingClient(URL);
        connecting.create();
        const ws = FakeWebSocket.last();
        ws.throwOnClose = true;
        expect(() => connecting.close()).not.toThrow();
        expect(ws.sent).toEqual([]);
    });

    it('does not come back when closed while waiting to reconnect', async () => {
        vi.useFakeTimers();
        const client = new SignalingClient(URL);
        client.create();
        FakeWebSocket.last().open();
        FakeWebSocket.last().drop();

        client.close();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(FakeWebSocket.instances).toHaveLength(1);
    });
});
