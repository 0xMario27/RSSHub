import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import cache from '@/utils/cache';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';
import * as cheerio from 'cheerio';

export const route: Route = {
    path: '/user/:id',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/truthsocial/user/realDonaldTrump',
    parameters: {
        id: 'username, with or without @ prefix, e.g. `realDonaldTrump` or `@realDonaldTrump`',
    },
    features: {
        requireConfig: [
            {
                name: 'TRUTHSOCIAL_ACCESS_TOKEN',
                description: 'Truth Social API access token. Required because Truth Social locks down all API endpoints behind authentication. See namespace docs for how to get one.',
                optional: true,
            },
        ],
        requirePuppeteer: false,
        antiCrawler: true,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    name: 'User timeline',
    maintainers: [],
    handler,
    radar: [
        {
            source: ['truthsocial.com/@:id'],
            target: '/user/:id',
        },
    ],
};

async function handler(ctx) {
    const id = ctx.req.param('id').replace(/^@/, '');
    const baseUrl = 'https://truthsocial.com';
    const accessToken = config.truthsocial?.accessToken ?? '';

    // Resolve account ID from the profile page HTML (og:image URL contains the ID)
    const accountId = await cache.tryGet(`truthsocial:account_id:${id}`, async () => {
        const html = await ofetch(`${baseUrl}/@${id}`);
        const $ = cheerio.load(html);
        const ogImage = $('meta[property="og:image"]').attr('content');
        if (!ogImage) {
            throw new Error(`User "${id}" not found on Truth Social`);
        }
        const match = ogImage.match(/accounts\/avatars\/(\d{3})\/(\d{3})\/(\d{3})\/(\d{3})\/(\d{3})\/(\d{3})/);
        if (!match) {
            throw new Error(`Cannot resolve account ID for "${id}" from og:image`);
        }
        return match.slice(1).join('');
    });

    const headers: Record<string, string> = {};
    if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
    }

    const resp = await ofetch(`${baseUrl}/api/v1/accounts/${accountId}/statuses`, {
        query: { limit: 40 },
        headers,
    });

    const accountData = resp.length > 0 && resp[0].account ? resp[0].account : await ofetch(`${baseUrl}/api/v1/accounts/${accountId}`, { headers });

    const items = resp.map((item) => {
        const isReblog = Boolean(item.reblog);
        const status = item.reblog ?? item;
        const content = status.content ? status.content.replaceAll(/<span.*?>|<\/span.*?>/g, '') : '';
        const contentText = content.replaceAll(/<(?:.|\n)*?>/g, '\n');

        const media = (status.media_attachments ?? [])
            .map((m) => {
                const url = m.remote_url ?? m.url;
                const desc = m.description ?? '';
                switch (m.type) {
                    case 'gifv':
                        return `<br><video src="${url}" autoplay loop>${desc}</video>`;
                    case 'video':
                        return `<br><video src="${url}" controls loop>${desc}</video>`;
                    case 'image':
                        return `<br><img src="${url}" alt="${desc}">`;
                    case 'audio':
                        return `<br><audio controls src="${url}">${desc}</audio>`;
                    default:
                        return `<br><a href="${url}">${desc}</a>`;
                }
            })
            .join('');

        const author = `${status.account.display_name} (@${status.account.acct})`;
        const titlePrefix = isReblog ? `RT @${item.account.username}` : `@${status.account.username}`;
        const titleText = status.sensitive === true ? `(CW) ${status.spoiler_text}` : contentText;
        const title = `${titlePrefix}: "${titleText}"`;

        return {
            title,
            author,
            description: (status.spoiler_text ? status.spoiler_text + '<hr />' : '') + content + media,
            pubDate: parseDate(status.created_at),
            link: status.url ?? `${baseUrl}/@${status.account.username}/${status.id}`,
            guid: status.uri,
        };
    });

    return {
        title: `${accountData.display_name} (@${accountData.acct})`,
        link: accountData.url ?? `${baseUrl}/@${id}`,
        description: accountData.note,
        item: items,
        allowEmpty: true,
    };
}
