import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';

/**
 * Sidedrop front-end dev server on :8103 — an origin burakov_api's CORS allows.
 * http://localhost is a secure context, so WebRTC / OPFS / clipboard all work in
 * dev without HTTPS; production is served over https at sidedrop.burakov.net.
 */
export default defineConfig({
    plugins: [vue()],
    server: {
        port: 8103,
        strictPort: true,
    },
    test: {
        environment: 'happy-dom',
        // Pin the zone so local-time date math gives the same results on every host, and the
        // app's settings so a run never depends on which `.env` is switched in.
        env: {
            TZ: 'UTC',
            VITE_API_URL: 'http://api.test',
            VITE_CLIENT_ID: 'sidedrop',
        },
        include: ['src/**/*.test.ts'],
        setupFiles: ['src/test/setup.ts'],
        // Every mock starts each test empty: a test states the answers it relies on.
        mockReset: true,
        unstubEnvs: true,
        unstubGlobals: true,
        coverage: {
            enabled: true,
            provider: 'v8',
            include: ['src/**/*.{ts,vue}'],
            exclude: ['src/**/*.test.ts', 'src/test/**', 'src/vite-env.d.ts'],
            reporter: ['text-summary'],
            // `build` fails below these. Logic (signaling, peer link, transfer protocol, file storage,
            // i18n, stores, routing) is held higher than the screens that render it.
            thresholds: {
                // Each file on its own as well: a new module without tests fails `build` instead of hiding in the total.
                perFile: { lines: 80, statements: 80, functions: 80, branches: 80 },
                lines: 80,
                statements: 80,
                functions: 80,
                branches: 80,
                'src/{api.ts,{core,i18n,router,stores}/**}': {
                    lines: 90,
                    statements: 90,
                    functions: 90,
                    branches: 90,
                },
            },
        },
    },
});
