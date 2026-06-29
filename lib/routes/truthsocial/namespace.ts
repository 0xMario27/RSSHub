import type { Namespace } from '@/types';

export const namespace: Namespace = {
    name: 'Truth Social',
    url: 'truthsocial.com',
    description: `Truth Social is a Mastodon-compatible social media platform.

::: tip
Truth Social's API is Mastodon-compatible. If this route doesn't work due to Cloudflare protection, you can use the [Mastodon route](/routes/social-media#mastodon) with \`site\` set to \`truthsocial.com\`.

To get a numeric account ID for the Mastodon route, visit \`https://truthsocial.com/api/v1/accounts/lookup?acct=USERNAME\` in your browser.
:::`,
    lang: 'en',
};
