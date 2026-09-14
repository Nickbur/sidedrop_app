<script setup lang="ts">
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useSessionStore } from '../stores/session';
import { fromDataTransfer, fromFileList } from '../core/fileTree';

const { t } = useI18n();
const store = useSessionStore();

const dragOver = ref(false);
const showText = ref(false);
const textValue = ref('');
const filesInput = ref<HTMLInputElement | null>(null);
const folderInput = ref<HTMLInputElement | null>(null);

async function onDrop(e: DragEvent): Promise<void> {
    e.preventDefault();
    dragOver.value = false;
    if (!store.canSend || !e.dataTransfer) return;
    const dropped = await fromDataTransfer(e.dataTransfer);
    if (dropped.length > 0) store.sendFiles(dropped);
}

function onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (store.canSend) dragOver.value = true;
}

function onDragLeave(): void {
    dragOver.value = false;
}

function pickFiles(): void {
    filesInput.value?.click();
}
function pickFolder(): void {
    folderInput.value?.click();
}

function onFilesChosen(e: Event): void {
    const input = e.target as HTMLInputElement;
    const dropped = fromFileList(input.files);
    if (dropped.length > 0) store.sendFiles(dropped);
    input.value = '';
}

function sendText(): void {
    const value = textValue.value.trim();
    if (!value) return;
    store.sendText(value);
    textValue.value = '';
    showText.value = false;
}
</script>

<template>
    <div>
        <div
            class="drop"
            :class="{ over: dragOver, disabled: !store.canSend }"
            @drop="onDrop"
            @dragover="onDragOver"
            @dragleave="onDragLeave"
            @click="store.canSend && pickFiles()"
        >
            <div class="drop-icon" aria-hidden="true">⤓</div>
            <p class="drop-title">{{ store.canSend ? t('drop.title') : t('drop.disabledTitle') }}</p>
            <p class="muted drop-hint">{{ store.canSend ? t('drop.hint') : t('drop.disabledHint') }}</p>

            <div v-if="store.canSend" class="drop-actions" @click.stop>
                <button class="btn btn--sm" type="button" @click="pickFiles">{{ t('drop.files') }}</button>
                <button class="btn btn--ghost btn--sm" type="button" @click="pickFolder">{{ t('drop.folder') }}</button>
                <button class="btn btn--ghost btn--sm" type="button" @click="showText = !showText">
                    {{ t('drop.text') }}
                </button>
            </div>
        </div>

        <div v-if="showText && store.canSend" class="text-send card">
            <textarea
                v-model="textValue"
                class="field"
                rows="3"
                :placeholder="t('text.placeholder')"
                @keydown.ctrl.enter="sendText"
                @keydown.meta.enter="sendText"
            ></textarea>
            <div class="text-actions">
                <button class="btn btn--ghost btn--sm" type="button" @click="showText = false">{{ t('text.cancel') }}</button>
                <button class="btn btn--sm" type="button" :disabled="!textValue.trim()" @click="sendText">
                    {{ t('text.send') }}
                </button>
            </div>
        </div>

        <input ref="filesInput" type="file" multiple hidden @change="onFilesChosen" />
        <input ref="folderInput" type="file" webkitdirectory multiple hidden @change="onFilesChosen" />
    </div>
</template>

<style scoped>
.drop {
    border: 2px dashed var(--border-hover);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    padding: 44px 24px;
    text-align: center;
    cursor: pointer;
    transition: all var(--transition);
}
.drop.over {
    border-color: var(--accent);
    background: var(--accent-bg);
    transform: translateY(-1px);
}
.drop.disabled {
    cursor: default;
    opacity: 0.85;
    border-style: solid;
    border-color: var(--border);
}
.drop-icon {
    font-size: 34px;
    color: var(--accent);
    line-height: 1;
}
.drop-title {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 18px;
    margin: 12px 0 4px;
}
.drop-hint {
    margin: 0;
    font-size: 14px;
}
.drop-actions {
    display: flex;
    gap: 8px;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 18px;
}
.text-send {
    margin-top: 12px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
}
.text-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}
</style>
