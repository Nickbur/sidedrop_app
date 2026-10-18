import { describe, expect, it } from 'vitest';
import App from './App.vue';
import { i18n } from './i18n';
import { useThemeStore } from './stores/theme';
import { render } from './test/render';

/**
 * The app frame around every page: brand, language and theme switches, the
 * routed page, and the footer links. A wrong footer link sends readers to the
 * wrong legal page or nowhere.
 */

const t = i18n.global.t;

const switches = async () => {
    const rendered = await render(App, '/');
    const [lang, theme] = rendered.wrapper.findAll('.topbar-right button');
    return { ...rendered, lang: lang!, theme: theme! };
};

describe('App — frame', () => {
    it('shows the brand, the routed page and the footer', async () => {
        const { wrapper } = await switches();
        expect(wrapper.find('.brand-name').text()).toBe(t('brand'));
        expect(wrapper.find('.brand').attributes('href')).toBe('/');
        expect(wrapper.find('.blank-route').exists()).toBe(true);
        expect(wrapper.find('.foot-tag').text()).toBe(t('footer.tagline'));
    });

    it('links to the site, source, docs, legal pages and sponsorship in new tabs', async () => {
        const { wrapper } = await switches();
        const links = wrapper.findAll('.foot-links a');
        expect(links.map((a) => [a.text(), a.attributes('href')])).toEqual([
            [t('footer.site'), 'https://burakov.net'],
            [t('footer.source'), 'https://github.com/Nickbur/sidedrop_app'],
            [t('footer.docs'), 'https://docs.burakov.net/sidedrop'],
            [t('footer.privacy'), 'https://burakov.net/projects/sidedrop/privacy'],
            [t('footer.terms'), 'https://burakov.net/projects/sidedrop/terms'],
            [t('footer.sponsor'), 'https://github.com/sponsors/Nickbur'],
        ]);
        expect(links.every((a) => a.attributes('target') === '_blank' && a.attributes('rel') === 'noopener')).toBe(
            true,
        );
    });
});

describe('App — switches', () => {
    it('switches between English and Russian and remembers the choice', async () => {
        const { wrapper, lang } = await switches();
        expect(lang.text()).toBe('RU');
        expect(lang.attributes('title')).toBe(t('lang.switch'));

        await lang.trigger('click');
        expect(i18n.global.locale.value).toBe('ru');
        expect(lang.text()).toBe('EN');
        expect(wrapper.find('.foot-tag').text()).toBe(i18n.global.t('footer.tagline'));
        expect(localStorage.getItem('sidedrop_lang')).toBe('ru');
        expect(document.documentElement.getAttribute('lang')).toBe('ru');

        await lang.trigger('click');
        expect(i18n.global.locale.value).toBe('en');
        expect(lang.text()).toBe('RU');
    });

    it('toggles the theme', async () => {
        const { theme } = await switches();
        expect(theme.text()).toBe('☾');
        expect(theme.attributes('title')).toBe(t('theme.toggle'));

        await theme.trigger('click');
        expect(useThemeStore().theme).toBe('light');
        expect(theme.text()).toBe('☀');
        expect(document.documentElement.dataset.theme).toBe('light');
    });
});
