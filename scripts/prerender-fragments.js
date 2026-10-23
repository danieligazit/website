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
import { pageMetaTags, withPageMeta } from './page-meta.js';

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

                const tags = pageMetaTags({
                    url,
                    title,
                    description,
                    image: siteUrl + video.poster,
                    type: 'video.other',
                    video: { src: siteUrl + video.src, width: video.width, height: video.height },
                });

                // Swap the SPA's default head tags so crawlers don't read the generic ones.
                const html = withPageMeta(indexHtml, tags);

                const dest = join(outDir, 'fragments', video.id, 'index.html');
                await mkdir(dirname(dest), { recursive: true });
                await writeFile(dest, html, 'utf8');
            }

            console.log(`\nprerendered ${videosData.length} fragment shells`);
        },
    };
}
