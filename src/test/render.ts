import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createMemoryHistory, createRouter, type Router } from 'vue-router';
import { defineComponent, h, type Component } from 'vue';
import { i18n } from '../i18n';

/**
 * Mounts a screen the way the app does — real i18n, real Pinia, a router with
 * the app's paths — so a test exercises the screen's own wiring (route params,
 * `RouterView`) instead of a hand-made imitation of it. Only the session is
 * fake: screen tests mock `core/session` with `test/session-fake`.
 */

const Blank = defineComponent({ name: 'Blank', render: () => h('div', { class: 'blank-route' }) });

export function testRouter(): Router {
    return createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: '/', name: 'home', component: Blank },
            { path: '/r/:room', name: 'room', component: Blank },
        ],
    });
}

export interface Rendered {
    wrapper: VueWrapper;
    router: Router;
    pinia: Pinia;
}

/** The button whose visible label is exactly `label` — screens are driven the way a reader sees them. */
export function button(wrapper: VueWrapper, label: string): DOMWrapper<HTMLButtonElement> {
    const found = wrapper.findAll('button').find((b) => b.text().trim() === label);
    if (!found) {
        const labels = wrapper.findAll('button').map((b) => b.text().trim());
        throw new Error(`no button "${label}" among: ${labels.join(' | ')}`);
    }
    return found;
}

/** Whether a button with exactly this label is on screen. */
export function hasButton(wrapper: VueWrapper, label: string): boolean {
    return wrapper.findAll('button').some((b) => b.text().trim() === label);
}

/**
 * Navigates to `path`, mounts `component` on it and lets its `onMounted` work
 * settle. The returned Pinia is active, so `useSessionStore()` in the test reads
 * the same store the screen uses.
 */
export async function render(component: Component, path = '/', props: Record<string, unknown> = {}): Promise<Rendered> {
    const pinia = createPinia();
    setActivePinia(pinia);
    const router = testRouter();
    await router.push(path);
    await router.isReady();
    const wrapper = mount(component, {
        props,
        attachTo: document.body,
        global: { plugins: [pinia, i18n, router] },
    });
    await flushPromises();
    return { wrapper, router, pinia };
}
