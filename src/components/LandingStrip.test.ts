import { describe, expect, it } from 'vitest';
import LandingStrip from './LandingStrip.vue';
import { i18n } from '../i18n';
import { render } from '../test/render';

/** The three "how / private / open source" tiles under the main card, in the reader's language. */

const t = i18n.global.t;

describe('LandingStrip', () => {
    it('explains how it works, the privacy model and the licence', async () => {
        const { wrapper } = await render(LandingStrip);
        expect(wrapper.findAll('h3').map((h) => h.text())).toEqual([
            t('landing.how.title'),
            t('landing.priv.title'),
            t('landing.oss.title'),
        ]);
        expect(wrapper.findAll('p').map((p) => p.text())).toEqual([
            t('landing.how.body'),
            t('landing.priv.body'),
            t('landing.oss.body'),
        ]);
    });

    it('speaks Russian when the reader does', async () => {
        i18n.global.locale.value = 'ru';
        const { wrapper } = await render(LandingStrip);
        expect(wrapper.find('h3').text()).toBe('Как это работает');
    });
});
