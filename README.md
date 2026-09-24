# sidedrop_app

Sidedrop — real-time, peer-to-peer, browser-to-browser file transfer. No cloud, no storage, no account.

Web-only SPA (Vue 3 + Vite). Part of the burakov ecosystem; backed only by an anonymous signaling module in `burakov_api`.

- Docs: `burakov_docs/sidedrop/project-context-sidedrop.md` (current state + non-obvious notes + remaining-work)

## Dev

```
npm install
npm run switch_to_dev   # env/env.dev -> .env (VITE_API_URL=http://localhost:3000)
npm run serve           # http://localhost:8103
```

Needs `burakov_api` running (signaling WebSocket + ICE credentials) at `VITE_API_URL`.
