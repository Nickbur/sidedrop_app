const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(n: number, digits = 1): string {
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return `${Math.round(n)} B`;
    let value = n / 1024;
    let i = 0;
    while (value >= 1024 && i < UNITS.length - 1) {
        value /= 1024;
        i += 1;
    }
    return `${value.toFixed(digits)} ${UNITS[i] ?? 'PB'}`;
}

export function formatSpeed(bytesPerSecond: number): string {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—';
    return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatEta(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const s = Math.round(seconds);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `${m}m ${rs}s`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h ${rm}m`;
}

export function percent(transferred: number, size: number): number {
    if (size <= 0) return transferred > 0 ? 100 : 0;
    return Math.min(100, Math.floor((transferred / size) * 100));
}
