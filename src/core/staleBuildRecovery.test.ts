import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStaleBuildRecovery, isChunkLoadError } from './staleBuildRecovery';

/**
 * A tab still running the previous build reloads for fresh chunks — whether Vite reports the
 * missing chunk or it surfaces as an unhandled rejection — at most once a minute, so a deploy that
 * really lacks a chunk never loops while a tab left open across deploys recovers from each one.
 * Every other failure is left alone.
 */

const NOW = 1_800_000_000_000;
const KEY = 'stale_build_reload_at';

const missingChunk = (): TypeError =>
    new TypeError('Failed to fetch dynamically imported module: https://app.example.com/assets/Home.js');

/** What Vite's preload helper dispatches when a lazy import fails. */
function preloadError(payload: unknown): void {
    window.dispatchEvent(Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload }));
}

function unhandledRejection(reason: unknown): void {
    window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason }));
}

const report = vi.fn();
let uninstall: () => void = () => {};

beforeEach(() => {
    sessionStorage.clear();
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(() => {
    uninstall();
});

describe('chunk load errors', () => {
    it.each([
        { name: 'ChunkLoadError', message: 'Loading chunk 7 failed' },
        missingChunk(),
        new TypeError('error loading dynamically imported module: https://app.example.com/assets/Home.js'),
        new TypeError('Importing a module script failed.'),
        new Error('Unable to preload CSS for /assets/Notes.css'),
    ])('recognises a chunk that could not be fetched (%s)', (reason) => {
        expect(isChunkLoadError(reason)).toBe(true);
    });

    it.each([new Error('boom in the module body'), { message: 404 }, 'Failed to fetch', null, undefined])(
        'tells any other failure apart (%s)',
        (reason) => {
            expect(isChunkLoadError(reason)).toBe(false);
        },
    );
});

describe('stale build recovery', () => {
    it('reloads for fresh assets when Vite cannot load a chunk', () => {
        uninstall = installStaleBuildRecovery(report);
        const error = missingChunk();
        preloadError(error);

        expect(window.location.reload).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledWith(error, 'ChunkLoadError — reloading for fresh assets');
        expect(sessionStorage.getItem(KEY)).toBe(String(NOW));
    });

    it('reloads when a missing chunk surfaces as an unhandled rejection', () => {
        uninstall = installStaleBuildRecovery(report);
        unhandledRejection(missingChunk());

        expect(window.location.reload).toHaveBeenCalledOnce();
    });

    it('reloads once when the same failure arrives through both signals', () => {
        uninstall = installStaleBuildRecovery(report);
        const error = missingChunk();
        preloadError(error);
        unhandledRejection(error);

        expect(window.location.reload).toHaveBeenCalledOnce();
        expect(report).toHaveBeenCalledOnce();
    });

    it('does not reload again within a minute: a chunk still missing after a fresh load is a broken deploy', () => {
        sessionStorage.setItem(KEY, String(NOW - 59_999));
        uninstall = installStaleBuildRecovery(report);
        const error = missingChunk();
        preloadError(error);

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(report).toHaveBeenCalledWith(error, 'ChunkLoadError — reload already attempted');
        expect(sessionStorage.getItem(KEY)).toBe(String(NOW - 59_999));
    });

    it('recovers again once the minute has passed, for a tab left open across deploys', () => {
        sessionStorage.setItem(KEY, String(NOW - 60_000));
        uninstall = installStaleBuildRecovery(report);
        preloadError(missingChunk());

        expect(window.location.reload).toHaveBeenCalledOnce();
        expect(sessionStorage.getItem(KEY)).toBe(String(NOW));
    });

    it('never reloads without session storage, where the attempts could not be counted', () => {
        vi.spyOn(sessionStorage, 'getItem').mockImplementation(() => {
            throw new DOMException('The operation is insecure.', 'SecurityError');
        });
        uninstall = installStaleBuildRecovery(report);
        const error = missingChunk();
        preloadError(error);

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(report).toHaveBeenCalledWith(error, 'ChunkLoadError — reload already attempted');
    });

    it('leaves every other failure alone', () => {
        uninstall = installStaleBuildRecovery(report);
        preloadError(new Error('boom in the module body'));
        unhandledRejection(new Error('something else'));
        unhandledRejection(undefined);

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
    });

    it('stops listening once uninstalled', () => {
        installStaleBuildRecovery(report)();
        preloadError(missingChunk());
        unhandledRejection(missingChunk());

        expect(window.location.reload).not.toHaveBeenCalled();
        expect(report).not.toHaveBeenCalled();
    });

    it('reports to the console unless given a reporter', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        uninstall = installStaleBuildRecovery();
        const error = missingChunk();
        preloadError(error);

        expect(consoleError).toHaveBeenCalledWith('ChunkLoadError — reloading for fresh assets', error);
    });
});
