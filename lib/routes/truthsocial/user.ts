import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import { parseDate } from '@/utils/parse-date';
import { addExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
// These are dynamically required by stealth/evasions/user-agent-override.
// Import them statically so @vercel/nft traces them in Docker builds.
import 'puppeteer-extra-plugin-user-preferences';
import 'puppeteer-extra-plugin-user-data-dir';
import { chromium } from 'patchright';
import logger from '@/utils/logger';

const stealthChromium = addExtra(chromium);
stealthChromium.use(StealthPlugin());

export const route: Route = {
    path: '/user/:id',
    categories: ['social-media'],
    view: ViewType.SocialMedia,
    example: '/truthsocial/user/realDonaldTrump',
    parameters: {
        id: 'username, with or without @ prefix, e.g. `realDonaldTrump` or `@realDonaldTrump`',
    },
    features: {
        requireConfig: false,
        requirePuppeteer: true,
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
    const pageUrl = `${baseUrl}/@${id}`;

    let browser;
    try {
        browser = await stealthChromium.launchPersistentContext('/tmp/rsshub-chrome-profile', {
            headless: false,
            executablePath: config.chromiumExecutablePath || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                ...(process.env.TRUTHSOCIAL_PROXY ? [`--proxy-server=${process.env.TRUTHSOCIAL_PROXY}`] : []),
            ],
        });
        const page = browser.pages()[0] || await browser.newPage();

        // Intercept API responses from the SPA
        let accountData: any = null;
        let statusesData: any[] = [];

        page.on('response', async (resp) => {
            const url = resp.url();
            if (resp.status() !== 200) {
                return;
            }
            try {
                if (url.includes('/api/v1/accounts/lookup')) {
                    accountData = await resp.json();
                }
                // Capture the latest main statuses response (overwrite previous)
                if (url.includes('/api/v1/accounts/') && url.includes('/statuses') && !url.includes('pinned') && !url.includes('only_media')) {
                    const data = await resp.json();
                    if (Array.isArray(data) && data.length > 0) {
                        statusesData = data;
                    }
                }
            } catch {
                // ignore parse errors
            }
        });

        logger.http(`Requesting ${pageUrl}`);
        await page.goto(pageUrl, { waitUntil: 'commit', timeout: 30000 });

        // Wait for the SPA to make API calls (up to 30 seconds, need both account + statuses)
        for (let i = 0; i < 30 && (!accountData || statusesData.length === 0); i++) {
            await page.waitForTimeout(1000);
        }

        if (!accountData) {
            throw new Error(`User "${id}" not found or API blocked`);
        }

        const items = statusesData.map((item) => {
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
            link: accountData.url ?? pageUrl,
            description: accountData.note,
            item: items,
            allowEmpty: true,
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => {});
        }
    }
}
