#!/usr/bin/env node
//
// Encodes video masters from media/raw/ into web-ready renditions in public/videos/,
// then regenerates src/js/videos-data.js.
//
//   npm run videos                     encode anything new or changed
//   npm run videos -- --force          re-encode everything
//   npm run videos -- --only backlight limit to one slug
//   npm run videos -- --poster-at 6    grab the poster frame at 6s instead of 40% in
//
// Masters stay out of git; the encoded outputs are committed.
//
// Note on settings: this content is dense high-contrast particle detail, which is
// effectively structured noise. Quality-based encoding (CRF alone) does not converge on
// it — a CRF 23 encode of a 93 MB master came out at 111 MB. So the bitrate is hard-capped
// via maxrate/bufsize, and deblocking is turned down, since it otherwise smooths away
// exactly the fine specks that are the point of the image.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readdir, stat, mkdir, writeFile, access } from 'node:fs/promises';
import { join, extname, basename, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const RAW_DIR = join(root, 'media', 'raw');
const OUT_DIR = join(root, 'public', 'videos');
const MANIFEST = join(root, 'src', 'js', 'videos-data.js');

// Where the files are served from. Swap this for an R2 / CDN origin
// (e.g. 'https://media.example.com') and nothing else has to change.
const MEDIA_BASE = '';

const SOURCE_EXTS = new Set(['.mov', '.mp4', '.mkv', '.m4v', '.avi', '.webm']);

// Main rendition: full 1080x1920. See note above on why the bitrate cap is hard.
// fps is a ceiling, not a target — see rateArgs.
const MAIN = {
    maxrate: '4M',
    bufsize: '8M',
    crf: 26,
    fps: 60,
    maxWidth: 1080,
    maxHeight: 1920,
    x264Params: 'deblock=-2,-2:aq-mode=3:aq-strength=1.1:psy-rd=1.1,0.20',
};

// Hover preview in the strip: a thumbnail, so it is small and has no audio track at all
// (smaller, and it sidesteps iOS muted-autoplay quirks).
const PREVIEW = { maxrate: '700k', bufsize: '1400k', crf: 30, fps: 30, width: 480 };

// Only resample when the source is faster than the ceiling. Forcing a rate would otherwise
// convert a 24fps master to 60 by duplicating frames at a 2.5:1 ratio — no added detail,
// a bigger file, and visible judder from the uneven duplication.
const rateArgs = (sourceFps, ceiling) =>
    sourceFps > ceiling + 0.01 ? ['-r', String(ceiling)] : [];

const POSTER_WIDTH = 640;

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const flagValue = (f) => {
    const i = args.indexOf(f);
    return i !== -1 ? args[i + 1] : undefined;
};

const force = hasFlag('--force');
const only = flagValue('--only');
const posterAtOverride = flagValue('--poster-at');

const exists = (p) => access(p).then(() => true, () => false);

function slugify(name) {
    return name
        .toLowerCase()
        .replace(/\.[^.]+$/, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

function titleize(slug) {
    return slug.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

async function ffmpeg(inputArgs) {
    // maxBuffer bumped: ffmpeg is chatty on stderr even at -loglevel error.
    await run(ffmpegPath, inputArgs, { maxBuffer: 1024 * 1024 * 32 });
}

async function probe(file) {
    const { stdout } = await run(ffprobeStatic.path, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height,r_frame_rate',
        '-show_entries', 'format=duration',
        '-of', 'json',
        file,
    ]);
    const info = JSON.parse(stdout);
    const stream = info.streams?.[0] ?? {};
    const [num, den] = String(stream.r_frame_rate ?? '0/1').split('/').map(Number);
    return {
        width: stream.width,
        height: stream.height,
        fps: den ? num / den : 0,
        duration: Number(info.format?.duration ?? 0),
    };
}

// Downscale only if the master is larger than the target box; never upscale, and keep
// dimensions even (yuv420p requires it).
const fitFilter = (w, h) =>
    `scale='min(${w},iw)':'min(${h},ih)':force_original_aspect_ratio=decrease:flags=lanczos,` +
    `scale=trunc(iw/2)*2:trunc(ih/2)*2`;

async function encodeMain(src, dest, sourceFps) {
    await ffmpeg([
        '-y', '-loglevel', 'error',
        '-i', src,
        '-map', '0:v:0', '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'slower',
        '-crf', String(MAIN.crf),
        '-maxrate', MAIN.maxrate,
        '-bufsize', MAIN.bufsize,
        ...rateArgs(sourceFps, MAIN.fps),
        '-vf', fitFilter(MAIN.maxWidth, MAIN.maxHeight),
        '-pix_fmt', 'yuv420p',
        '-profile:v', 'high',
        '-x264-params', MAIN.x264Params,
        '-movflags', '+faststart',
        '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
        dest,
    ]);
}

async function encodePreview(src, dest, sourceFps) {
    await ffmpeg([
        '-y', '-loglevel', 'error',
        '-i', src,
        '-an',
        '-c:v', 'libx264',
        '-preset', 'slow',
        '-crf', String(PREVIEW.crf),
        '-maxrate', PREVIEW.maxrate,
        '-bufsize', PREVIEW.bufsize,
        ...rateArgs(sourceFps, PREVIEW.fps),
        '-vf', `scale=${PREVIEW.width}:-2:flags=lanczos`,
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        dest,
    ]);
}

async function encodePoster(src, dest, atSeconds) {
    await ffmpeg([
        '-y', '-loglevel', 'error',
        '-ss', String(atSeconds),
        '-i', src,
        '-frames:v', '1',
        '-vf', `scale=${POSTER_WIDTH}:-2:flags=lanczos`,
        '-c:v', 'libwebp', '-quality', '72',
        dest,
    ]);
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(2)} MB`;

// Cloudflare Pages refuses to deploy any single asset over 25 MiB.
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;

async function loadExistingManifest() {
    if (!(await exists(MANIFEST))) return new Map();
    try {
        const mod = await import(`${pathToFileURL(MANIFEST).href}?t=${Date.now()}`);
        return new Map((mod.videosData ?? []).map((v) => [v.id, v]));
    } catch (err) {
        console.warn(`  ! could not read existing manifest, starting fresh: ${err.message}`);
        return new Map();
    }
}

async function writeManifest(entries) {
    const body = entries
        .map((entry) => {
            const lines = [
                `        id: ${JSON.stringify(entry.id)},`,
                `        title: ${JSON.stringify(entry.title)},`,
                `        date: ${JSON.stringify(entry.date)},`,
                `        duration: ${entry.duration},`,
                `        width: ${entry.width},`,
                `        height: ${entry.height},`,
                `        src: ${JSON.stringify(entry.src)},`,
                `        preview: ${JSON.stringify(entry.preview)},`,
                `        poster: ${JSON.stringify(entry.poster)},`,
                `        description: ${JSON.stringify(entry.description ?? '')},`,
                `        pinnedIndex: ${JSON.stringify(entry.pinnedIndex ?? null)},`,
                `        relatedWork: ${JSON.stringify(entry.relatedWork ?? null)},`,
                `        instagram: ${JSON.stringify(entry.instagram ?? null)},`,
            ];
            return `    {\n${lines.join('\n')}\n    }`;
        })
        .join(',\n');

    const file = `// Generated by scripts/encode-videos.mjs — run \`npm run videos\`.
//
// Technical fields (duration, width, height, src, preview, poster) are rewritten on every
// run. The editorial fields — title, date, description, pinnedIndex, relatedWork,
// instagram — are preserved, so they are safe to edit by hand here.
//
// date is a plain YYYY-MM-DD day. Fragments are shown newest first, except that any with a
// pinnedIndex (0, 1, 2, ...) are lifted to the front in that order; pinnedIndex: null means
// the fragment just sorts by date.

// Serving origin for the media files. Empty means "same origin as the site"; point it at an
// R2 bucket or CDN (e.g. 'https://media.example.com') to move the files off the repo.
export const MEDIA_BASE = ${JSON.stringify(MEDIA_BASE)};

export const videosData = [
${body}
];

export const videoUrl = (path) => \`\${MEDIA_BASE}\${path}\`;
`;
    await writeFile(MANIFEST, file, 'utf8');
}

async function main() {
    await mkdir(OUT_DIR, { recursive: true });
    await mkdir(RAW_DIR, { recursive: true });

    const files = (await readdir(RAW_DIR))
        .filter((f) => SOURCE_EXTS.has(extname(f).toLowerCase()))
        .sort();

    if (files.length === 0) {
        console.log(`No source videos found in media/raw/`);
        console.log(`Drop your masters there (.mov/.mp4/...) and run this again.`);
        return;
    }

    const existing = await loadExistingManifest();
    const entries = [];
    let encoded = 0;

    for (const file of files) {
        const slug = slugify(basename(file));
        if (only && slug !== only) {
            const prior = existing.get(slug);
            if (prior) entries.push(prior);
            continue;
        }

        const src = join(RAW_DIR, file);
        const mainOut = join(OUT_DIR, `${slug}.mp4`);
        const previewOut = join(OUT_DIR, `${slug}.preview.mp4`);
        const posterOut = join(OUT_DIR, `${slug}.poster.webp`);

        const srcStat = await stat(src);
        const upToDate =
            !force &&
            (await exists(mainOut)) &&
            (await exists(previewOut)) &&
            (await exists(posterOut)) &&
            (await stat(mainOut)).mtimeMs > srcStat.mtimeMs;

        const meta = await probe(src);
        // Default to 40% in: frame 0 is very often a fade-up or a black frame.
        const posterAt = posterAtOverride !== undefined
            ? Number(posterAtOverride)
            : Math.max(0, meta.duration * 0.4);

        if (upToDate) {
            console.log(`= ${slug} (up to date)`);
        } else {
            console.log(`> ${slug}  ${meta.width}x${meta.height} ${meta.fps.toFixed(0)}fps ${meta.duration.toFixed(1)}s  ${mb(srcStat.size)}`);
            const started = Date.now();
            await encodeMain(src, mainOut, meta.fps);
            await encodePreview(src, previewOut, meta.fps);
            await encodePoster(src, posterOut, posterAt);
            const took = ((Date.now() - started) / 1000).toFixed(0);

            const mainSize = (await stat(mainOut)).size;
            const ratio = (srcStat.size / mainSize).toFixed(1);
            console.log(
                `  main ${mb(mainSize)} (${ratio}x smaller)` +
                `  preview ${mb((await stat(previewOut)).size)}` +
                `  poster ${mb((await stat(posterOut)).size)}` +
                `  [${took}s]`
            );
            if (mainSize > PAGES_FILE_LIMIT) {
                console.warn(
                    `  ! ${slug}.mp4 is over the 25 MiB Cloudflare Pages per-file limit — ` +
                    `the deploy will reject it. Lower MAIN.maxrate or trim the clip.`
                );
            }
            encoded++;
        }

        const out = await probe(mainOut);
        const prior = existing.get(slug) ?? {};
        entries.push({
            ...prior,
            id: slug,
            title: prior.title ?? titleize(slug),
            date: prior.date ?? srcStat.mtime.toISOString().slice(0, 10),
            duration: Number(out.duration.toFixed(2)),
            width: out.width,
            height: out.height,
            src: `/videos/${slug}.mp4`,
            preview: `/videos/${slug}.preview.mp4`,
            poster: `/videos/${slug}.poster.webp`,
        });
    }

    await writeManifest(entries);

    const total = entries.length;
    console.log(`\n${total} video${total === 1 ? '' : 's'} in manifest (${encoded} encoded this run).`);
    console.log(`Wrote src/js/videos-data.js`);
}

main().catch((err) => {
    console.error(err.stderr?.toString() || err.message || err);
    process.exit(1);
});
