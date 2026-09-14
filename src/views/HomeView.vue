<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import PairingPanel from '../components/PairingPanel.vue';
import DropZone from '../components/DropZone.vue';
import TransferTable from '../components/TransferTable.vue';
import LandingStrip from '../components/LandingStrip.vue';

const { t } = useI18n();
const route = useRoute();
const store = useSessionStore();

onMounted(() => {
    const room = route.params.room;
    if (typeof room === 'string' && room.length > 0) store.joinRoom(room);
    else store.hostNew();
});

const errorMessage = computed(() => {
    switch (store.state.errorCode) {
        case 'room-full':
            return t('conn.roomFull');
        case 'room-not-found':
            return t('conn.notFound');
        default:
            return t('conn.error');
    }
});

const statusText = computed(() => {
    switch (store.state.status) {
        case 'waiting':
            return t('conn.waiting');
        case 'connected':
            return t('conn.connected');
        case 'reconnecting':
            return t('conn.reconnecting');
        case 'closed':
            return t('conn.closed');
        case 'error':
            return errorMessage.value;
        default:
            return t('conn.connecting');
    }
});

const dotClass = computed(() => {
    switch (store.state.status) {
        case 'connected':
            return 'ok';
        case 'reconnecting':
            return 'warn';
        case 'error':
            return 'danger';
        case 'waiting':
            return 'muted';
        default:
            return 'pulse';
    }
});

const showMemoryWarn = computed(() => store.state.sinkMode === 'memory');
</script>

<template>
    <section class="page container">
        <p class="tagline muted">{{ t('tagline') }}</p>

        <div class="status-bar">
            <span class="status">
                <span class="dot" :class="dotClass"></span>
                {{ statusText }}
            </span>
            <span v-if="store.state.status === 'connected'" class="badge badge--ok">🔒 {{ t('conn.secure') }}</span>
            <button
                v-if="store.state.status === 'error'"
                class="btn btn--sm"
                type="button"
                @click="store.hostNew()"
            >
                {{ t('pair.newRoom') }}
            </button>
        </div>

        <div class="card main-card">
            <DropZone v-if="store.canSend" />
            <div v-else-if="store.state.status === 'error'" class="error-box">
                <p class="err">{{ errorMessage }}</p>
            </div>
            <PairingPanel v-else />
        </div>

        <p v-if="showMemoryWarn" class="warn-note muted">⚠ {{ t('save.memoryWarn') }}</p>

        <TransferTable />
        <LandingStrip />
    </section>
</template>

<style scoped>
.page {
    padding: 32px 20px 64px;
}
.tagline {
    text-align: center;
    font-size: 15px;
    margin: 8px 0 24px;
}
.status-bar {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 16px;
    flex-wrap: wrap;
}
.status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
}
.dot {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-muted);
}
.dot.ok {
    background: var(--ok);
}
.dot.warn {
    background: var(--warn);
}
.dot.danger {
    background: var(--danger);
}
.dot.muted {
    background: var(--text-muted);
}
.dot.pulse {
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.35;
    }
}
.main-card {
    padding: 28px;
    max-width: 760px;
    margin: 0 auto;
}
.error-box {
    text-align: center;
    padding: 24px;
}
.err {
    color: var(--danger);
    font-weight: 600;
    margin: 0;
}
.warn-note {
    max-width: 760px;
    margin: 12px auto 0;
    text-align: center;
    font-size: 13px;
}
@media (max-width: 560px) {
    .main-card {
        padding: 20px 16px;
    }
}
</style>
