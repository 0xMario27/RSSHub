import type { Namespace } from '@/types';

export const namespace: Namespace = {
    name: 'Truth Social',
    url: 'truthsocial.com',
    description: `Truth Social is a Mastodon-compatible social media platform.

::: warning
Truth Social locks down all Mastodon API endpoints behind authentication. To use this route, you must configure a Truth Social access token.

### Getting an access token

1. Register an account on [Truth Social](https://truthsocial.com)
2. Go to **Settings → Development** and create a new application  
   - Name: RSSHub (or anything)
   - Scopes: \`read\`
   - Redirect URI: \`urn:ietf:wg:oauth:2.0:oob\`
3. Copy your access token
4. Set the environment variable \`TRUTHSOCIAL_ACCESS_TOKEN\` to the token

Alternatively, if your RSSHub instance's IP is not blocked by Cloudflare and can access the API, you can set \`TRUTHSOCIAL_ACCESS_TOKEN\` to an empty string to attempt unauthenticated access (rarely works).
:::`,
    lang: 'en',
};
