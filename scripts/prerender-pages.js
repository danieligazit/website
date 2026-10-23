// Vite plugin: emit a static HTML shell for each top-level section (/music, /live, /works)
// with its own title and link-preview tags. Same reason as the fragment shells: crawlers
// building link previews read the first response's <head> and never run the SPA.
//
// Shells are written as <section>.html, which GitHub Pages serves at /<section> without
// a redirect to a trailing slash.

import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pageMetaTags, withPageMeta } from './page-meta.js';

export function prerenderPages({ siteUrl, pages }) {
    let outDir;

    return {
        name: 'prerender-pages',
        apply: 'build',

        configResolved(config) {
            outDir = resolve(config.root, config.build.outDir);
        },

        async closeBundle() {
            const indexHtml = await readFile(join(outDir, 'index.html'), 'utf8');

            for (const page of pages) {
                const tags = pageMetaTags({
                    ...page,
                    url: `${siteUrl}${page.path}`,
                    image: `${siteUrl}${page.image}`,
                });
                await writeFile(join(outDir, `${page.path.slice(1)}.html`), withPageMeta(indexHtml, tags), 'utf8');
            }

            console.log(`prerendered ${pages.length} page shells`);
        },
    };
}
