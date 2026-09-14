import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles.css';
import App from './App.vue';
import router from './router';
import { i18n } from './i18n';
import { useThemeStore } from './stores/theme';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(i18n);
app.use(router);

// Apply the persisted / system theme before mount to avoid a flash.
useThemeStore(pinia).init();

app.mount('#app');
