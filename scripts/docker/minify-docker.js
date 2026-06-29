/* eslint-disable no-console */
import path from 'node:path';

import { nodeFileTrace } from '@vercel/nft';
import fs from 'fs-extra';

const __dirname = import.meta.dirname;
// !!! if any new dependencies are added, update the Dockerfile !!!

const projectRoot = path.resolve(process.env.PROJECT_ROOT || path.join(__dirname, '../..'));
const resultFolder = path.join(projectRoot, 'app-minimal');
const files = ['dist/index.mjs', 'node_modules/cross-env/dist/bin/cross-env.js', 'node_modules/.bin/cross-env'].map((file) => path.join(projectRoot, file));

console.log('Start analyzing, project root:', projectRoot);

// First pass: trace main entry
const { fileList: fileSet } = await nodeFileTrace(files, {
    base: projectRoot,
});
let fileList = [...fileSet];
console.log('Total touchable files:', fileList.length);
fileList = fileList.filter((file) => file.startsWith('node_modules/'));

// playwright-core browsers.json workaround
const patchrightCoreFile = fileList.find((file) => file.includes('/patchright-core/'));
if (patchrightCoreFile) {
    const packageRoot = patchrightCoreFile.slice(0, patchrightCoreFile.indexOf('/patchright-core/') + '/patchright-core'.length);
    const browsersJson = `${packageRoot}/browsers.json`;
    if (!fileList.includes(browsersJson) && (await fs.pathExists(path.join(projectRoot, browsersJson)))) {
        fileList.push(browsersJson);
        console.log('Manually included patchright-core asset:', browsersJson);
    }
}

// Find puppeteer-extra-plugin-stealth index to add as trace entry point
// (its evasions/dependencies are dynamically required and not traced by nft)
const stealthIndex = fileList.find((f) => f.includes('puppeteer-extra-plugin-stealth') && f.endsWith('index.js'));
const extraEntryPoints = [];
if (stealthIndex) {
    // Also trace the stealth plugin's evasions and dependencies
    const stealthDir = path.dirname(path.join(projectRoot, stealthIndex));
    const evasionsDir = path.join(stealthDir, 'evasions');
    if (await fs.pathExists(evasionsDir)) {
        // Collect all evasion entry points
        for (const evasion of await fs.readdir(evasionsDir)) {
            const evasionIndex = path.join(evasionsDir, evasion, 'index.js');
            if (await fs.pathExists(evasionIndex)) {
                extraEntryPoints.push(path.relative(projectRoot, evasionIndex));
            }
        }
    }
    // Also add dependency package entry points
    const pnpmDir = path.join(projectRoot, 'node_modules', '.pnpm');
    if (await fs.pathExists(pnpmDir)) {
        for (const entry of await fs.readdir(pnpmDir)) {
            if (entry.startsWith('puppeteer-extra-plugin-user-')) {
                const pkgName = entry.replace(/@[\d.]+.*/, '');
                const indexPath = path.join('.pnpm', entry, 'node_modules', pkgName, 'index.js');
                const fullPath = path.join(projectRoot, 'node_modules', indexPath);
                if (await fs.pathExists(fullPath) && !fileList.includes(indexPath)) {
                    extraEntryPoints.push('node_modules/' + indexPath);
                }
            }
        }
    }
}

if (extraEntryPoints.length > 0) {
    console.log('Second pass: tracing', extraEntryPoints.length, 'extra entry points');
    const extraFiles = extraEntryPoints.map((f) => path.join(projectRoot, f));
    const { fileList: extraSet } = await nodeFileTrace(extraFiles, {
        base: projectRoot,
    });
    for (const f of extraSet) {
        if (f.startsWith('node_modules/') && !fileList.includes(f)) {
            fileList.push(f);
        }
    }
    console.log('Added', extraSet.size, 'extra files from second pass');
}

console.log('Total files need to be copied:', fileList.length);
console.log('Start copying files, destination:', resultFolder);
try {
    await Promise.all(fileList.map((e) => fs.copy(path.join(projectRoot, e), path.join(resultFolder, e))));
} catch (error) {
    console.error(error, error.stack);
    process.exit(1);
}

// Create missing node_modules symlinks for packages under .pnpm/
// nft copies the resolved files into .pnpm/ but doesn't create the node_modules/pkg→.pnpm/... symlinks
console.log('Creating missing node_modules symlinks...');
const resultPnpm = path.join(resultFolder, 'node_modules', '.pnpm');
if (await fs.pathExists(resultPnpm)) {
    for (const entry of await fs.readdir(resultPnpm)) {
        // entry looks like: deepmerge@4.3.1 or puppeteer-extra-plugin-stealth@2.11.2_playwright-extra@4.3.6
        const atIndex = entry.indexOf('@');
        if (atIndex <= 0) continue;
        const pkgName = entry.substring(0, atIndex);
        const srcDir = path.join(resultPnpm, entry, 'node_modules', pkgName);
        const symlinkPath = path.join(resultFolder, 'node_modules', pkgName);
        if (await fs.pathExists(srcDir) && !(await fs.pathExists(symlinkPath))) {
            await fs.symlink(path.relative(path.join(resultFolder, 'node_modules'), srcDir), symlinkPath);
        }
    }
}
