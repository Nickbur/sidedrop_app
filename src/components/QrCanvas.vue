<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';

const props = defineProps<{ value: string; size?: number }>();
const canvas = ref<HTMLCanvasElement | null>(null);

async function render(): Promise<void> {
    if (!canvas.value || !props.value) return;
    try {
        await QRCode.toCanvas(canvas.value, props.value, {
            width: props.size ?? 208,
            margin: 1,
            color: { dark: '#1c1917', light: '#ffffff' },
        });
    } catch {
        /* nothing to render */
    }
}

onMounted(render);
watch(() => props.value, render);
</script>

<template>
    <canvas ref="canvas" class="qr" :width="size ?? 208" :height="size ?? 208" />
</template>

<style scoped>
.qr {
    display: block;
    border-radius: var(--radius);
    background: #fff;
    padding: 8px;
    box-shadow: var(--shadow-sm);
}
</style>
