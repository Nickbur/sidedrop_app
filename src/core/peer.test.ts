import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Peer, type PeerCallbacks, type PeerSignal } from './peer';
import type { Channel } from './transfer';
import { FakeDataChannel, FakeRTCPeerConnection, installWebRtc } from '../test/fakes';

/**
 * One WebRTC negotiation between the two browsers. The host makes the data
 * channel and offers, the guest answers; every signal carries the epoch so a
 * stale one from a previous attempt can be told apart. A broken step here means
 * two paired devices that never connect, so the fake RTCPeerConnection lets each
 * test play the network and the other browser.
 */

const ICE = [{ urls: 'stun:stun.example:3478' }, { urls: ['turn:turn.example'], username: 'u', credential: 'p' }];

function callbacks(): PeerCallbacks & { signals: PeerSignal[]; channels: Channel[]; states: string[] } {
    const signals: PeerSignal[] = [];
    const channels: Channel[] = [];
    const states: string[] = [];
    return {
        signals,
        channels,
        states,
        onSignal: (s) => signals.push(s),
        onChannel: (c) => channels.push(c),
        onState: (s) => states.push(s),
    };
}

beforeEach(() => {
    installWebRtc();
});

describe('Peer — host', () => {
    it('configures ICE, opens an ordered data channel and offers with its epoch', async () => {
        const cb = callbacks();
        const peer = new Peer('host', 3, ICE, cb);
        const pc = FakeRTCPeerConnection.last();

        await peer.start();

        expect(pc.config).toEqual({ iceServers: ICE });
        expect(pc.channels.map((c) => [c.label, c.options])).toEqual([['sidedrop', { ordered: true }]]);
        expect(pc.channels[0]?.binaryType).toBe('arraybuffer');
        expect(cb.signals).toEqual([{ kind: 'offer', epoch: 3, sdp: { type: 'offer', sdp: 'offer-0' } }]);
        expect(pc.localDescription).toEqual({ type: 'offer', sdp: 'offer-0' });
    });

    it('applies the answer and ignores an offer meant for a guest', async () => {
        const peer = new Peer('host', 1, [], callbacks());
        const pc = FakeRTCPeerConnection.last();

        await peer.handleSignal({ kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'x' } });
        expect(pc.remoteDescription).toBeNull();

        await peer.handleSignal({ kind: 'answer', epoch: 1, sdp: { type: 'answer', sdp: 'a' } });
        expect(pc.remoteDescription).toEqual({ type: 'answer', sdp: 'a' });
    });

    it('reports the channel once it opens, and not after the peer was closed', () => {
        const cb = callbacks();
        new Peer('host', 1, [], cb);
        FakeRTCPeerConnection.last().channels[0]?.open();
        expect(cb.channels).toHaveLength(1);

        const late = callbacks();
        const closed = new Peer('host', 2, [], late);
        closed.close();
        FakeRTCPeerConnection.last().channels[0]?.open();
        expect(late.channels).toEqual([]);
    });
});

describe('Peer — guest', () => {
    it('answers an offer with the same epoch and makes no channel of its own', async () => {
        const cb = callbacks();
        const peer = new Peer('guest', 5, [], cb);
        const pc = FakeRTCPeerConnection.last();

        await peer.start();
        expect(cb.signals).toEqual([]);

        await peer.handleSignal({ kind: 'offer', epoch: 5, sdp: { type: 'offer', sdp: 'o' } });
        expect(pc.remoteDescription).toEqual({ type: 'offer', sdp: 'o' });
        expect(cb.signals).toEqual([{ kind: 'answer', epoch: 5, sdp: { type: 'answer', sdp: 'answer-0' } }]);
        expect(pc.channels).toEqual([]);
    });

    it('ignores an answer, since only the host offers', async () => {
        const peer = new Peer('guest', 1, [], callbacks());
        await peer.handleSignal({ kind: 'answer', epoch: 1, sdp: { type: 'answer', sdp: 'a' } });
        expect(FakeRTCPeerConnection.last().remoteDescription).toBeNull();
    });

    it("reports the host's channel when it arrives open or when it opens later", () => {
        const cb = callbacks();
        new Peer('guest', 1, [], cb);
        const pc = FakeRTCPeerConnection.last();

        const alreadyOpen = new FakeDataChannel();
        alreadyOpen.readyState = 'open';
        pc.emitDataChannel(alreadyOpen);
        expect(cb.channels).toHaveLength(1);

        const later = pc.emitDataChannel();
        expect(cb.channels).toHaveLength(1);
        later.open();
        expect(cb.channels).toHaveLength(2);
    });
});

describe('Peer — ICE and connection state', () => {
    it('forwards local candidates, and the end-of-candidates marker as null', () => {
        const cb = callbacks();
        new Peer('host', 4, [], cb);
        const pc = FakeRTCPeerConnection.last();

        pc.emitCandidate({ candidate: 'candidate:1', sdpMid: '0' });
        pc.emitCandidate(null);

        expect(cb.signals).toEqual([
            { kind: 'ice', epoch: 4, candidate: { candidate: 'candidate:1', sdpMid: '0' } },
            { kind: 'ice', epoch: 4, candidate: null },
        ]);
    });

    it('adds remote candidates and skips the end-of-candidates marker', async () => {
        const peer = new Peer('guest', 1, [], callbacks());
        const pc = FakeRTCPeerConnection.last();

        await peer.handleSignal({ kind: 'ice', epoch: 1, candidate: { candidate: 'c1' } });
        await peer.handleSignal({ kind: 'ice', epoch: 1, candidate: null });

        expect(pc.candidates).toEqual([{ candidate: 'c1' }]);
    });

    it('survives a candidate or description the connection refuses', async () => {
        const peer = new Peer('guest', 1, [], callbacks());
        const pc = FakeRTCPeerConnection.last();
        pc.rejectIce = true;
        pc.rejectRemote = true;

        await expect(peer.handleSignal({ kind: 'ice', epoch: 1, candidate: { candidate: 'c1' } })).resolves.toBe(
            undefined,
        );
        await expect(
            peer.handleSignal({ kind: 'offer', epoch: 1, sdp: { type: 'offer', sdp: 'o' } }),
        ).resolves.toBeUndefined();
    });

    it('reports connection state changes until it is closed', () => {
        const cb = callbacks();
        const peer = new Peer('host', 1, [], cb);
        const pc = FakeRTCPeerConnection.last();

        pc.setState('connecting');
        pc.setState('connected');
        expect(peer.connectionState).toBe('connected');
        peer.close();
        pc.setState('failed');

        expect(cb.states).toEqual(['connecting', 'connected']);
    });
});

describe('Peer — data channel adapter', () => {
    function hostChannel(): { channel: Channel; dc: FakeDataChannel; pc: FakeRTCPeerConnection } {
        const cb = callbacks();
        new Peer('host', 1, [], cb);
        const pc = FakeRTCPeerConnection.last();
        const dc = pc.channels[0]!;
        dc.open();
        return { channel: cb.channels[0]!, dc, pc };
    }

    it('sends text and binary frames as they are', () => {
        const { channel, dc } = hostChannel();
        const frame = new ArrayBuffer(4);
        channel.send('{"t":"hello"}');
        channel.send(frame);
        expect(dc.sent).toEqual(['{"t":"hello"}', frame]);
    });

    it('passes on text and binary messages and drops any other kind', () => {
        const { channel, dc } = hostChannel();
        dc.receive('before anyone listens');
        const got: Array<string | ArrayBuffer> = [];
        channel.onMessage((d) => got.push(d));

        const frame = new ArrayBuffer(2);
        dc.receive('{"t":"eof","i":0}');
        dc.receive(frame);
        dc.receive(new Blob(['x']));

        expect(got).toEqual(['{"t":"eof","i":0}', frame]);
    });

    it('reports drain events and exposes the buffer level and low-water threshold', () => {
        const { channel, dc } = hostChannel();
        dc.drain();
        const drained = vi.fn();
        channel.onDrain(drained);
        dc.drain();
        expect(drained).toHaveBeenCalledTimes(1);

        dc.bufferedAmount = 1234;
        expect(channel.bufferedAmount()).toBe(1234);
        channel.setLowThreshold(4096);
        expect(dc.bufferedAmountLowThreshold).toBe(4096);
    });

    it('uses the negotiated message size, and 256 KiB when it is unknown or unbounded', () => {
        const { channel, pc } = hostChannel();
        pc.sctp = { maxMessageSize: 65536 };
        expect(channel.maxMessageSize()).toBe(65536);
        pc.sctp = { maxMessageSize: 0 };
        expect(channel.maxMessageSize()).toBe(256 * 1024);
        pc.sctp = { maxMessageSize: Number.POSITIVE_INFINITY };
        expect(channel.maxMessageSize()).toBe(256 * 1024);
        pc.sctp = null;
        expect(channel.maxMessageSize()).toBe(256 * 1024);
    });
});

describe('Peer — close', () => {
    it('closes the channel and the connection, and ignores later signals', async () => {
        const peer = new Peer('host', 1, [], callbacks());
        const pc = FakeRTCPeerConnection.last();
        peer.close();

        expect(pc.channels[0]?.closeCalls).toBe(1);
        expect(pc.closeCalls).toBe(1);
        await peer.handleSignal({ kind: 'answer', epoch: 1, sdp: { type: 'answer', sdp: 'a' } });
        expect(pc.remoteDescription).toBeNull();
    });

    it('does not offer once closed', async () => {
        const cb = callbacks();
        const peer = new Peer('host', 1, [], cb);
        peer.close();
        await peer.start();
        expect(cb.signals).toEqual([]);
    });

    it('closes cleanly even if the channel or connection throws while closing', () => {
        const peer = new Peer('host', 1, [], callbacks());
        const pc = FakeRTCPeerConnection.last();
        pc.channels[0]!.throwOnClose = true;
        pc.throwOnClose = true;
        expect(() => peer.close()).not.toThrow();
    });

    it('closes a guest that never received a channel', () => {
        const peer = new Peer('guest', 1, [], callbacks());
        peer.close();
        expect(FakeRTCPeerConnection.last().closeCalls).toBe(1);
    });
});
