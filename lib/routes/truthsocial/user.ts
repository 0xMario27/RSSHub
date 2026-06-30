import { config } from '@/config';
import type { Route } from '@/types';
import { ViewType } from '@/types';
import { parseDate } from '@/utils/parse-date';
import { chromium } from 'patchright';
import logger from '@/utils/logger';
import os from 'node:os';
import path from 'node:path';

// Cloudflare blocks every headless Chromium mode on truthsocial.com (including the "new"
// headless mode). The only reliable way through its JavaScript challenge is a *headful*
// browser, which on a server must run under a virtual display such as Xvfb.
// A persistent context lets the cf_clearance cookie survive across requests, so the
// challenge usually only has to be solved once. The same profile directory cannot be
// opened by two browser instances at once, so requests are serialized via an in-process lock.
const userDataDir = path.join(os.tmpdir(), 'rsshub-truthsocial-profile');
let browserLock: Promise<unknown> = Promise.resolve();

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

async function fetchUser(id: string) {
    const baseUrl = 'https://truthsocial.com';
    const pageUrl = `${baseUrl}/@${id}`;

    // config.chromiumExecutablePath may point at a headless_shell binary (the amd64 Docker
    // image sets it that way), which cannot run headful. In that case, fall back to
    // Patchright's bundled full Chromium by leaving executablePath unset.
    const executablePath = config.chromiumExecutablePath;
    const useExecutablePath = executablePath && !executablePath.includes('headless_shell');

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless: false,
        viewport: null,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
        ...(useExecutablePath ? { executablePath } : {}),
    });

    try {
        const page = context.pages()[0] ?? (await context.newPage());

        // Intercept API responses from the SPA
        let accountData: any = null;
        let statusesData: any[] = [];

        page.on('response', async (resp) => {
            if (resp.status() !== 200) {
                return;
            }
            const url = resp.url();
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

        // Wait for the SPA to solve the Cloudflare challenge and call its APIs
        // (up to 30 seconds, need both account + statuses).
        for (let i = 0; i < 30 && (!accountData || statusesData.length === 0); i++) {
            await page.waitForTimeout(1000);
        }

        if (!accountData) {
            throw new Error(`User "${id}" not found or blocked by Cloudflare`);
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
        await context.close().catch(() => {});
    }
}

async function handler(ctx) {
    const id = ctx.req.param('id').replace(/^@/, '');
    // Serialize browser access: the persistent profile can only be opened by one instance at a time.
    const result = browserLock.then(() => fetchUser(id));
    browserLock = result.catch(() => {});
    return result;
}
