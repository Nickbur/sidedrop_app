const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
export const CLIENT_ID = import.meta.env.VITE_CLIENT_ID ?? 'sidedrop';

/** WebSocket URL for the signaling relay (http→ws, https→wss off the API origin). */
export function signalingWsUrl(): string {
    return `${API_URL.replace(/^http/, 'ws')}/v1/signaling/ws`;
}

/** Shareable link that joins a specific room. */
export function roomLink(roomId: string): string {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://sidedrop.burakov.net';
    return `${origin}/r/${roomId}`;
}
