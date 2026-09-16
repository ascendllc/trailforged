// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://trailforged.org',
  integrations: [
    sitemap({
      serialize(item) {
        return { ...item, lastmod: new Date() };
      },
    }),
  ],
});
