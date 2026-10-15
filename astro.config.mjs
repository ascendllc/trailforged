// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  site: 'https://trailforged.org',
  adapter: vercel(),
  redirects: {
    // Temporary (302) on purpose: points at a single event's registration page.
    '/join': { status: 302, destination: 'https://nwc.churchcenter.com/registrations/events/3606965' },
  },
  integrations: [
    sitemap({
      filter: (page) => !/\/(upload|photos)(\/|$)/.test(new URL(page).pathname),
      serialize(item) {
        return { ...item, lastmod: new Date() };
      },
    }),
  ],
});
