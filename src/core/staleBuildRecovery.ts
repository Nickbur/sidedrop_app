/**
 * Stale build recovery. After a deploy, a tab still running the previous build asks for chunks
 * whose hashed names no longer exist; a reload fetches the fresh index.html and its chunks.
 *
 * Two signals, because neither covers every path alone:
 * - `vite:preloadError` — Vite's preload helper fires it for every failed lazy import before the
 *   caller sees the error, so it also covers failures the caller swallows (RouterLink and
 *   back/forward navigation `.catch()` theirs);
 * - `unhandledrejection` — a failed import that did not go through Vite's helper.
 *
 * At most one reload a minute per tab: a chunk still missing right after a fresh load is a broken
 * deploy, not a stale tab, and must not loop — while a tab left open across several deploys still
 * recovers from each one.
 */

type Report = (error: unknown, context: string) => void;

const RELOAD_KEY = 'stale_build_reload_at';
const RELOAD_COOLDOWN_MS = 60_000;

/** Whether a failure is a module or stylesheet that could not be fetched — what a stale build looks like. */
export function isChunkLoadError(reason: unknown): boolean {
    const error = reason as { name?: unknown; message?: unknown } | null | undefined;
    const message = typeof error?.message === 'string' ? error.message : '';
    return (
        error?.name === 'ChunkLoadError' ||
        message.includes('Failed to fetch dynamically imported module') || // Chromium
        message.includes('error loading dynamically imported module') || // Firefox
        message.includes('Importing a module script failed') || // Safari
        message.includes('Unable to preload CSS') // Vite's stylesheet preload
    );
}

/** Reloads the page for fresh assets when a chunk fails to load. Returns a function that stops listening. */
export function installStaleBuildRecovery(
    report: Report = (error, context) => console.error(context, error),
): () => void {
    // The same failure can arrive through both signals; the page is already on its way out.
    let reloading = false;

    const recover = (reason: unknown): void => {
        if (reloading || !isChunkLoadError(reason)) return;
        if (!claimReload()) {
            report(reason, 'ChunkLoadError — reload already attempted');
            return;
        }
        reloading = true;
        report(reason, 'ChunkLoadError — reloading for fresh assets');
        window.location.reload();
    };
    const onPreloadError = (event: WindowEventMap['vite:preloadError']): void => recover(event.payload);
    const onRejection = (event: PromiseRejectionEvent): void => recover(event.reason);

    window.addEventListener('vite:preloadError', onPreloadError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
        window.removeEventListener('vite:preloadError', onPreloadError);
        window.removeEventListener('unhandledrejection', onRejection);
    };
}

/**
 * Records a reload unless one already ran within the cooldown. Without session storage the attempts
 * can't be counted across reloads, so it never reloads — that could loop.
 */
function claimReload(): boolean {
    try {
        const now = Date.now();
        if (now - Number(sessionStorage.getItem(RELOAD_KEY)) < RELOAD_COOLDOWN_MS) return false;
        sessionStorage.setItem(RELOAD_KEY, String(now));
        return true;
    } catch {
        return false;
    }
}
