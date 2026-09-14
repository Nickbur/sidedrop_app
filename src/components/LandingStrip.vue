<script setup lang="ts">
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const tiles = [
    { icon: '⚡', key: 'how' },
    { icon: '🔒', key: 'priv' },
    { icon: '⌗', key: 'oss' },
] as const;
</script>

<template>
    <section class="landing">
        <div v-for="tile in tiles" :key="tile.key" class="tile">
            <span class="tile-icon" aria-hidden="true">{{ tile.icon }}</span>
            <h3>{{ t(`landing.${tile.key}.title`) }}</h3>
            <p class="muted">{{ t(`landing.${tile.key}.body`) }}</p>
        </div>
    </section>
</template>

<style scoped>
.landing {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin-top: 56px;
}
.tile {
    padding: 4px 8px;
}
.tile-icon {
    font-size: 22px;
}
.tile h3 {
    font-size: 16px;
    margin: 10px 0 6px;
}
.tile p {
    font-size: 14px;
    margin: 0;
    line-height: 1.5;
}
@media (max-width: 720px) {
    .landing {
        grid-template-columns: 1fr;
        gap: 24px;
    }
}
</style>
