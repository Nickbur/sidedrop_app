<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import { formatBytes, formatEta, formatSpeed, percent } from '../core/format';
import type { TransferItem, TransferStatus } from '../core/types';

const { t } = useI18n();
const store = useSessionStore();

const STATUS_BADGE: Record<TransferStatus, string> = {
    queued: 'badge--muted',
    active: 'badge',
    paused: 'badge--warn',
    ready: 'badge--ok',
    done: 'badge--ok',
    completed: 'badge--ok',
    failed: 'badge--warn',
    canceled: 'badge--muted',
};

function statusLabel(item: TransferItem): string {
    return t(`status.${item.status}`);
}

async function copyText(item: TransferItem): Promise<void> {
    if (item.text === undefined) return;
    try {
        await navigator.clipboard.writeText(item.text);
    } catch {
        /* clipboard blocked */
    }
}
</script>

<template>
    <section v-if="store.items.length > 0" class="transfers">
        <div class="head">
            <h2>{{ t('table.title') }}</h2>
            <div class="head-actions">
                <button
                    v-if="store.readyToSave.length > 1"
                    class="btn btn--sm"
                    type="button"
                    @click="store.saveAllReady()"
                >
                    {{ t('table.saveAll') }}
                </button>
                <button
                    v-if="store.hasFinished"
                    class="btn btn--ghost btn--sm"
                    type="button"
                    @click="store.clearFinished()"
                >
                    {{ t('table.clearDone') }}
                </button>
            </div>
        </div>

        <div class="table-wrap">
            <table class="table">
                <thead>
                    <tr>
                        <th class="dir"></th>
                        <th class="name">{{ t('table.name') }}</th>
                        <th class="size">{{ t('table.size') }}</th>
                        <th class="prog">{{ t('table.progress') }}</th>
                        <th class="speed">{{ t('table.speed') }}</th>
                        <th class="eta">{{ t('table.eta') }}</th>
                        <th class="status">{{ t('table.status') }}</th>
                        <th class="act"></th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="item in store.items" :key="item.id">
                        <td class="dir">
                            <span :title="item.dir === 'send' ? t('table.sending') : t('table.receiving')">
                                {{ item.dir === 'send' ? '↑' : '↓' }}
                            </span>
                        </td>
                        <td class="name">
                            <span class="fname" :title="item.relPath || item.name">{{ item.name }}</span>
                            <span v-if="item.kind === 'text' && item.text" class="preview muted">{{ item.text }}</span>
                            <span v-else-if="item.relPath && item.relPath !== item.name" class="preview muted">{{ item.relPath }}</span>
                        </td>
                        <td class="size mono">{{ formatBytes(item.size) }}</td>
                        <td class="prog">
                            <div class="bar">
                                <div class="bar-fill" :style="{ width: percent(item.transferred, item.size) + '%' }"></div>
                            </div>
                            <span class="pct mono">{{ percent(item.transferred, item.size) }}%</span>
                        </td>
                        <td class="speed mono">{{ item.status === 'active' ? formatSpeed(item.speed) : '—' }}</td>
                        <td class="eta mono">{{ item.status === 'active' ? formatEta(item.eta) : '—' }}</td>
                        <td class="status">
                            <span class="badge" :class="STATUS_BADGE[item.status]">{{ statusLabel(item) }}</span>
                        </td>
                        <td class="act">
                            <button
                                v-if="item.dir === 'recv' && item.status === 'ready'"
                                class="btn btn--sm"
                                type="button"
                                @click="store.save(item.id)"
                            >
                                {{ t('table.save') }}
                            </button>
                            <button
                                v-else-if="item.kind === 'text' && item.dir === 'recv'"
                                class="btn btn--ghost btn--sm"
                                type="button"
                                @click="copyText(item)"
                            >
                                {{ t('text.copy') }}
                            </button>
                            <button
                                v-else-if="item.status === 'active' || item.status === 'queued' || item.status === 'paused'"
                                class="btn btn--danger btn--sm"
                                type="button"
                                @click="store.cancel(item.id)"
                            >
                                {{ t('table.cancel') }}
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    </section>
</template>

<style scoped>
.transfers {
    margin-top: 28px;
}
.head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
}
.head h2 {
    font-size: 18px;
    margin: 0;
}
.head-actions {
    display: flex;
    gap: 8px;
}
.table-wrap {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
}
.table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
    min-width: 640px;
}
.table th {
    text-align: left;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    font-weight: 600;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-secondary);
}
.table td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-light);
    vertical-align: middle;
}
.table tr:last-child td {
    border-bottom: none;
}
.dir {
    width: 28px;
    text-align: center;
    color: var(--accent);
    font-weight: 700;
}
.name {
    max-width: 240px;
}
.fname {
    display: block;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}
.preview {
    display: block;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 240px;
}
.size,
.speed,
.eta {
    white-space: nowrap;
    color: var(--text-secondary);
}
.prog {
    min-width: 140px;
}
.bar {
    height: 6px;
    background: var(--bg-secondary);
    border-radius: var(--radius-pill);
    overflow: hidden;
    display: inline-block;
    width: 90px;
    vertical-align: middle;
}
.bar-fill {
    height: 100%;
    background: var(--accent);
    transition: width var(--dur-base) var(--ease-out);
}
.pct {
    font-size: 12px;
    color: var(--text-muted);
    margin-left: 8px;
}
.act {
    text-align: right;
    white-space: nowrap;
}
</style>
