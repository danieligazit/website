// Shared by the prerender plugins: the <head> tags a link-preview crawler reads, and the
// swap of index.html's default block (between the page-meta comments) for a page's own.

export const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

const META_BLOCK = /<!-- page-meta[\s\S]*?<!-- \/page-meta -->/;

export function withPageMeta(indexHtml, tags) {
    if (!META_BLOCK.test(indexHtml)) {
        throw new Error('index.html has no page-meta block to replace');
    }
    return indexHtml.replace(META_BLOCK, () => tags);
}

// Open Graph + Twitter tags for a page. `video` adds the player tags fragments use.
export function pageMetaTags({ url, title, description, image, imageWidth, imageHeight, type = 'website', video }) {
    const e = escapeHtml;
    const lines = [
        `<title>${e(title)}</title>`,
        `<meta name="description" content="${e(description)}">`,
        `<link rel="canonical" href="${e(url)}">`,
        `<meta property="og:site_name" content="Daniel Gazit">`,
        `<meta property="og:type" content="${e(type)}">`,
        `<meta property="og:url" content="${e(url)}">`,
        `<meta property="og:title" content="${e(title)}">`,
        `<meta property="og:description" content="${e(description)}">`,
        `<meta property="og:image" content="${e(image)}">`,
    ];
    if (imageWidth && imageHeight) {
        lines.push(
            `<meta property="og:image:width" content="${imageWidth}">`,
            `<meta property="og:image:height" content="${imageHeight}">`,
        );
    }
    if (video) {
        lines.push(
            `<meta property="og:video" content="${e(video.src)}">`,
            `<meta property="og:video:type" content="video/mp4">`,
            `<meta property="og:video:width" content="${video.width}">`,
            `<meta property="og:video:height" content="${video.height}">`,
        );
    }
    lines.push(
        `<meta name="twitter:card" content="${video ? 'player' : 'summary_large_image'}">`,
        `<meta name="twitter:title" content="${e(title)}">`,
        `<meta name="twitter:description" content="${e(description)}">`,
        `<meta name="twitter:image" content="${e(image)}">`,
    );
    return lines.join('\n    ');
}
