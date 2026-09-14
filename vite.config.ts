/// <reference types="vitest/config" />
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
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
