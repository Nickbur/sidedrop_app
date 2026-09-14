<script setup lang="ts">
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import QrCanvas from './QrCanvas.vue';

const { t } = useI18n();
const store = useSessionStore();

const codeInput = ref('');
const copied = ref<'link' | 'code' | null>(null);

const formattedCode = computed(() => {
    const c = store.state.code;
    if (!c) return '';
    return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
});

async function copy(kind: 'link' | 'code'): Promise<void> {
    const value = kind === 'link' ? store.state.link : store.state.code;
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        copied.value = kind;
        setTimeout(() => {
            if (copied.value === kind) copied.value = null;
        }, 1600);
    } catch {
        /* clipboard blocked */
    }
}

function join(): void {
    const code = codeInput.value.trim();
    if (code) store.joinCode(code);
}
</script>

<template>
    <div class="pairing">
        <h2>{{ t('pair.title') }}</h2>
        <p class="muted sub">{{ t('pair.subtitle') }}</p>

        <div class="pair-grid">
            <div class="qr-wrap">
                <QrCanvas v-if="store.state.link" :value="store.state.link" />
                <span class="qr-label muted">{{ t('pair.scan') }}</span>
            </div>

            <div class="pair-fields">
                <div class="field-block">
                    <span class="label">{{ t('pair.link') }}</span>
                    <div class="copy-row">
                        <input class="field mono" :value="store.state.link ?? ''" readonly />
                        <button class="btn btn--ghost btn--sm" type="button" @click="copy('link')">
                            {{ copied === 'link' ? t('pair.copied') : t('pair.copy') }}
                        </button>
                    </div>
                </div>

                <div class="field-block">
                    <span class="label">{{ t('pair.codeLabel') }}</span>
                    <div class="copy-row">
                        <span class="code mono">{{ formattedCode }}</span>
                        <button class="btn btn--ghost btn--sm" type="button" @click="copy('code')">
                            {{ copied === 'code' ? t('pair.copied') : t('pair.copy') }}
                        </button>
                    </div>
                </div>

                <div class="divider"><span>{{ t('pair.enterPrompt') }}</span></div>

                <form class="copy-row" @submit.prevent="join">
                    <input
                        v-model="codeInput"
                        class="field"
                        :placeholder="t('pair.enterPlaceholder')"
                        autocomplete="off"
                        autocapitalize="characters"
                    />
                    <button class="btn btn--sm" type="submit" :disabled="!codeInput.trim()">{{ t('pair.join') }}</button>
                </form>
            </div>
        </div>
    </div>
</template>

<style scoped>
.pairing {
    text-align: center;
}
.pairing h2 {
    font-size: 22px;
}
.sub {
    max-width: 44ch;
    margin: 0 auto 24px;
}
.pair-grid {
    display: flex;
    gap: 32px;
    align-items: center;
    justify-content: center;
    flex-wrap: wrap;
    text-align: left;
}
.qr-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}
.qr-label {
    font-size: 12px;
}
.pair-fields {
    min-width: 280px;
    max-width: 360px;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.field-block {
    display: flex;
    flex-direction: column;
    gap: 6px;
}
.label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
}
.copy-row {
    display: flex;
    gap: 8px;
    align-items: center;
}
.copy-row .field {
    flex: 1;
    font-size: 13px;
}
.code {
    flex: 1;
    font-size: 22px;
    font-weight: 700;
    letter-spacing: 0.12em;
    color: var(--accent);
    padding: 6px 4px;
}
.divider {
    display: flex;
    align-items: center;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
    margin: 4px 0 0;
}
.divider::before,
.divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
}
.divider span {
    padding: 0 10px;
}
@media (max-width: 560px) {
    .pair-grid {
        gap: 24px;
        flex-direction: column;
    }
    .qr-wrap,
    .pair-fields {
        min-width: 0;
        width: 100%;
    }
}
</style>
