// Vite plugin: emit a static HTML shell per fragment at /fragments/<slug>/index.html.
//
// The site is a single-page app, so a link to /fragments/<slug> is resolved by JavaScript
// after the page loads. Crawlers that build link previews (WhatsApp, Slack, iMessage,
// Twitter, Facebook) do not run that JavaScript — they read the first response's <head>
// and stop. Without these shells a shared fragment link previews as the generic site
// title, or as nothing.
//
// Each shell carries the per-clip Open Graph tags and then hands over to the SPA, which
// reads the same URL and opens the right clip.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

export function prerenderFragments({ siteUrl, manifestPath }) {
    let outDir;

    return {
        name: 'prerender-fragments',
        apply: 'build',

        configResolved(config) {
            // build.outDir is relative to config.root (here 'src'), not to the cwd.
            outDir = resolve(config.root, config.build.outDir);
        },

        // closeBundle rather than generateBundle: Vite's own HTML plugin emits index.html
        // late, so at generateBundle time it is not yet in the bundle to copy from.
        async closeBundle() {
            const { videosData } = await import(
                `${pathToFileURL(manifestPath).href}?t=${Date.now()}`
            );
            if (!videosData?.length) return;

            const indexPath = join(outDir, 'index.html');
            let indexHtml;
            try {
                indexHtml = await readFile(indexPath, 'utf8');
            } catch {
                this.warn(`could not read ${indexPath}; skipping fragment prerender`);
                return;
            }

            for (const video of videosData) {
                const url = `${siteUrl}/fragments/${video.id}`;
                const title = `${video.title} — Daniel Gazit`;
                const description = video.description || 'A short piece by Daniel Gazit.';

                const tags = `<title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${escapeHtml(url)}">
    <meta property="og:site_name" content="Daniel Gazit">
    <meta property="og:type" content="video.other">
    <meta property="og:url" content="${escapeHtml(url)}">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:image" content="${escapeHtml(siteUrl + video.poster)}">
    <meta property="og:video" content="${escapeHtml(siteUrl + video.src)}">
    <meta property="og:video:type" content="video/mp4">
    <meta property="og:video:width" content="${video.width}">
    <meta property="og:video:height" content="${video.height}">
    <meta name="twitter:card" content="player">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${escapeHtml(siteUrl + video.poster)}">`;

                // Replace the SPA's own <title> so crawlers don't read the generic one first.
                const html = indexHtml.replace(/<title>[\s\S]*?<\/title>/, tags);

                const dest = join(outDir, 'fragments', video.id, 'index.html');
                await mkdir(dirname(dest), { recursive: true });
                await writeFile(dest, html, 'utf8');
            }

            console.log(`\nprerendered ${videosData.length} fragment shells`);
        },
    };
}
