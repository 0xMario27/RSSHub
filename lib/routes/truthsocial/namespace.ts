import type { Namespace } from '@/types';

export const namespace: Namespace = {
    name: 'Truth Social',
    url: 'truthsocial.com',
    description: `Truth Social is a Mastodon-compatible social media platform.

::: tip
This route uses Puppeteer with a stealth plugin to bypass Cloudflare's anti-bot protection. No authentication is required.
:::`,
    lang: 'en',
};
