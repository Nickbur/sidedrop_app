# sidedrop_app

Sidedrop — real-time, peer-to-peer, browser-to-browser file transfer. No cloud, no storage, no account.

Web-only SPA (Vue 3 + Vite). Part of the burakov ecosystem; backed only by an anonymous signaling module in `burakov_api`.

- Concept & spec: `burakov_docs/sidedrop/tz-sidedrop.md`
- Ops context: `burakov_docs/sidedrop/project-context-sidedrop.md`

## Dev

```
npm install
npm run serve   # http://localhost:8103
```

Needs `burakov_api` running (signaling WebSocket + ICE credentials) at `VITE_API_URL`.
