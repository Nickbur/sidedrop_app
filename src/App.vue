<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { setLocale, type Locale } from './i18n';
import { useThemeStore } from './stores/theme';

const { t, locale } = useI18n();
const theme = useThemeStore();

const GITHUB = 'https://github.com/Nickbur/sidedrop_app';
const SPONSOR = 'https://github.com/sponsors/Nickbur';
const SITE = 'https://burakov.net';

function switchLang(): void {
    setLocale(locale.value === 'ru' ? 'en' : ('ru' as Locale));
}
</script>

<template>
    <div class="app">
        <header class="topbar">
            <a class="brand" href="/">
                <span class="mark" aria-hidden="true">◈</span>
                <span class="brand-name">{{ t('brand') }}</span>
                <span class="brand-sub muted">{{ t('by') }}</span>
            </a>
            <div class="topbar-right">
                <button class="icon-btn" type="button" :title="t('lang.switch')" @click="switchLang">
                    {{ locale === 'ru' ? 'EN' : 'RU' }}
                </button>
                <button class="icon-btn" type="button" :title="t('theme.toggle')" @click="theme.toggle()">
                    <span aria-hidden="true">{{ theme.theme === 'dark' ? '☾' : '☀' }}</span>
                </button>
            </div>
        </header>

        <main class="main">
            <RouterView />
        </main>

        <footer class="foot">
            <div class="foot-inner">
                <span class="badge badge--ok">🔒 {{ t('conn.secure') }}</span>
                <span class="foot-links">
                    <a :href="SITE" target="_blank" rel="noopener">{{ t('footer.site') }}</a>
                    <span class="dot">·</span>
                    <a :href="GITHUB" target="_blank" rel="noopener">{{ t('footer.source') }}</a>
                    <span class="dot">·</span>
                    <a :href="SPONSOR" target="_blank" rel="noopener">{{ t('footer.sponsor') }}</a>
                </span>
                <span class="muted foot-tag">{{ t('footer.tagline') }}</span>
            </div>
        </footer>
    </div>
</template>

<style scoped>
.app {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    background: var(--bg);
}

.topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--border);
    background: color-mix(in srgb, var(--bg) 82%, transparent);
    position: sticky;
    top: 0;
    z-index: 20;
    backdrop-filter: blur(10px);
}
.brand {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    color: var(--text);
}
.brand:hover {
    color: var(--text);
}
.mark {
    color: var(--accent);
    font-size: 18px;
    transform: translateY(1px);
}
.brand-name {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.01em;
}
.brand-sub {
    font-size: 12px;
}
.topbar-right {
    display: inline-flex;
    gap: 8px;
}
.icon-btn {
    min-width: 38px;
    height: 34px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-secondary);
    color: var(--text-secondary);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--transition);
}
.icon-btn:hover {
    color: var(--text);
    border-color: var(--border-hover);
}

.main {
    flex: 1;
    width: 100%;
}

.foot {
    border-top: 1px solid var(--border);
    padding: 18px 20px;
}
.foot-inner {
    max-width: var(--container);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 16px;
    flex-wrap: wrap;
    justify-content: center;
    font-size: 13px;
}
.foot-links {
    color: var(--text-secondary);
}
.foot-links .dot {
    margin: 0 8px;
    color: var(--text-muted);
}
.foot-tag {
    font-size: 12px;
}
@media (max-width: 560px) {
    .brand-sub {
        display: none;
    }
}
</style>
