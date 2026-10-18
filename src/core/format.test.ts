import { describe, expect, it } from 'vitest';
import { formatBytes, formatEta, formatSpeed, percent } from './format';

describe('formatBytes', () => {
    it('formats across units', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1024)).toBe('1.0 KB');
        expect(formatBytes(1536)).toBe('1.5 KB');
        expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
        expect(formatBytes(3.5 * 1024 * 1024 * 1024)).toBe('3.5 GB');
    });
    it('stops at petabytes and honours the requested precision', () => {
        expect(formatBytes(2 * 1024 ** 5)).toBe('2.0 PB');
        expect(formatBytes(3 * 1024 ** 6)).toBe('3072.0 PB');
        expect(formatBytes(1536, 2)).toBe('1.50 KB');
    });
    it('guards bad input', () => {
        expect(formatBytes(-1)).toBe('—');
        expect(formatBytes(NaN)).toBe('—');
    });
});

describe('formatSpeed / formatEta', () => {
    it('formats speed', () => {
        expect(formatSpeed(0)).toBe('—');
        expect(formatSpeed(2048)).toBe('2.0 KB/s');
    });
    it('formats eta', () => {
        expect(formatEta(45)).toBe('45s');
        expect(formatEta(90)).toBe('1m 30s');
        expect(formatEta(3700)).toBe('1h 1m');
        expect(formatEta(Infinity)).toBe('—');
        expect(formatEta(-1)).toBe('—');
        expect(formatEta(59.6)).toBe('1m 0s');
    });
});

describe('percent', () => {
    it('clamps and floors', () => {
        expect(percent(0, 100)).toBe(0);
        expect(percent(50, 100)).toBe(50);
        expect(percent(100, 100)).toBe(100);
        expect(percent(999, 100)).toBe(100);
        expect(percent(5, 0)).toBe(100);
        expect(percent(0, 0)).toBe(0);
        expect(percent(999, 1000)).toBe(99);
    });
});
