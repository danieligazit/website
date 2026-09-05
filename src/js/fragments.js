// ========================================
// FRAGMENTS — short video work
// ========================================
//
// Three pieces:
//   1. A grid of the clips, reached from the nav. On desktop the wheel also scrubs it
//      into view from the landing page, so the particle field recedes as the grid rises.
//      Touch-drag is not used for that, because the gesture already belongs to the
//      attractor ("Touch & explore") and one drag cannot mean two things.
//   2. A fullscreen reader that plays a clip on a loop. Nothing advances on its own —
//      only an arrow, a tap on the frame's edge, a swipe or a keypress moves on.
//
// Nothing heavier than a poster image loads until the visitor acts: preview clips attach
// their source on first hover, and the full 1080x1920 file only loads on open.

import { videosData, videoUrl } from './videos-data.js';

// Newest first, except that pinned fragments are lifted to the front in pinnedIndex order.
// Sorted here rather than baked into the generated manifest, so editing a date or a pin by
// hand reorders the page without having to re-run the encoder.
export const fragments = [...videosData].sort((a, b) => {
    const pa = Number.isInteger(a.pinnedIndex) ? a.pinnedIndex : Infinity;
    const pb = Number.isInteger(b.pinnedIndex) ? b.pinnedIndex : Infinity;
    if (pa !== pb) return pa - pb;
    return (b.date ?? '').localeCompare(a.date ?? '');
});

// Day granularity, matching the DD.MM.YYYY the shows list already uses.
function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return d ? `${d}.${m}.${y}` : iso;
}

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canHover = window.matchMedia('(hover: hover)').matches;
// Matches the breakpoint where the CSS hides the prev/next arrows.
const compactLayout = window.matchMedia('(max-width: 768px)');

// Wheel distance that takes the grid from hidden to fully revealed.
const REVEAL_DISTANCE = 480;
// Past this much of the gesture, letting go snaps open rather than back. Roughly one
// notch of a physical mouse wheel, so a deliberate scroll commits but a stray one doesn't.
const SNAP_THRESHOLD = 0.25;
// The gesture counts as finished after this long without a wheel event. Generous on
// purpose: a mouse wheel ticks with gaps, and each tick must chain into the same gesture
// rather than starting a new one that can never reach the threshold.
const GESTURE_IDLE_MS = 300;

const gridPanel = document.getElementById('fragments-grid-panel');
const grid = document.getElementById('fragments-grid');
const countEl = document.getElementById('fragments-count');

const panel = document.getElementById('fragments-panel');
const backdrop = panel?.querySelector('.fragments-backdrop');
const video = document.getElementById('fragments-video');
const progressEl = document.getElementById('fragments-progress');
const metaEl = document.getElementById('fragments-meta');
const soundBtn = document.getElementById('fragments-sound');
const prevBtn = document.getElementById('fragments-prev');
const nextBtn = document.getElementById('fragments-next');
const closeBtn = document.getElementById('close-fragments');
const gridCloseBtn = document.getElementById('close-fragments-grid');

const root = document.documentElement;

let currentIndex = -1;
let isOpen = false;         // reader
let isRevealed = false;     // grid
let onLanding = false;      // is the current route '/'
let gestureAccum = 0;       // wheel distance accumulated across the current gesture
let gestureTimer = null;
let onNavigate = () => {};

const hasFragments = () => fragments.length > 0;

export const isFragmentsOpen = () => isOpen;
export const isGridRevealed = () => isRevealed;

function formatDuration(seconds) {
    const s = Math.round(seconds);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ----------------------------------------
// Grid
// ----------------------------------------

function buildGrid() {
    if (!grid || !hasFragments()) return;

    if (countEl) countEl.textContent = String(fragments.length).padStart(2, '0');

    grid.innerHTML = fragments
        .map(
            (v, i) => `
        <button class="fragment-tile" data-index="${i}" type="button" aria-label="Play ${v.title}">
            <img class="fragment-tile-poster" src="${videoUrl(v.poster)}" alt="" loading="lazy" decoding="async">
            <span class="fragment-tile-meta">
                <span class="fragment-tile-top">
                    <span class="fragment-tile-date">${formatDate(v.date)}</span>
                    <span class="fragment-tile-duration">${formatDuration(v.duration)}</span>
                </span>
                <span class="fragment-tile-title">${v.title}</span>
            </span>
        </button>`
        )
        .join('');

    grid.querySelectorAll('.fragment-tile').forEach((tile) => {
        tile.addEventListener('click', () => open(Number(tile.dataset.index)));
        // Hover previews are for pointer devices only; touch has no hover state and
        // shouldn't spend the data.
        if (canHover && !prefersReducedMotion) {
            tile.addEventListener('pointerenter', (e) => {
                if (e.pointerType === 'touch') return;
                playTilePreview(tile);
            });
            tile.addEventListener('pointerleave', () => stopTilePreview(tile));
        }
    });
}

// The preview <video> is created on first hover, not up front — preloading every preview
// would be ~19 MB for a page nobody has interacted with yet.
function playTilePreview(tile) {
    const data = fragments[Number(tile.dataset.index)];
    if (!data) return;

    let el = tile.querySelector('.fragment-tile-video');
    if (!el) {
        el = document.createElement('video');
        el.className = 'fragment-tile-video';
        el.muted = true;
        el.loop = true;
        el.playsInline = true;
        el.preload = 'auto';
        el.src = videoUrl(data.preview);
        tile.appendChild(el);
    }
    el.play().then(
        () => tile.classList.add('previewing'),
        () => {} // autoplay refused; the poster stays, which is a fine outcome
    );
}

function stopTilePreview(tile) {
    const el = tile.querySelector('.fragment-tile-video');
    if (!el) return;
    tile.classList.remove('previewing');
    el.pause();
    el.currentTime = 0;
}

// ----------------------------------------
// Reveal
// ----------------------------------------

// The wheel sets a target and the displayed value eases toward it each frame, because
// writing raw wheel deltas straight to --reveal feels rigid — a mouse wheel arrives in
// discrete ~100px jumps rather than a continuous stream.
//
// Note the division of labour: requestAnimationFrame only ever *smooths* the live
// gesture. It never decides state. rAF is paused in a hidden or background tab, so
// anything that depends on a frame arriving can simply never run — which would strand
// the grid part-way, invisible but still covering the page and eating clicks.
// The committed state is always a class, applied synchronously, with a CSS transition.
const FOLLOW_RATE = 11; // higher settles faster; time-based, so frame rate doesn't matter

let targetReveal = 0;
let displayReveal = 0;
let rafId = null;
let lastFrame = 0;

function step(now) {
    // If the tab goes away mid-gesture, settle immediately rather than waiting for a
    // frame that will not arrive.
    if (document.hidden) {
        rafId = null;
        setRevealed(targetReveal >= SNAP_THRESHOLD, { navigate: true });
        return;
    }

    const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 1 / 60;
    lastFrame = now;

    const diff = targetReveal - displayReveal;
    if (Math.abs(diff) < 0.002) {
        displayReveal = targetReveal;
        root.style.setProperty('--reveal', String(targetReveal));
        rafId = null;
        return;
    }

    displayReveal += diff * (1 - Math.exp(-dt * FOLLOW_RATE));
    root.style.setProperty('--reveal', displayReveal.toFixed(4));
    rafId = requestAnimationFrame(step);
}

function startScrub() {
    document.body.classList.add('fragments-scrubbing');
    if (gridPanel) gridPanel.hidden = false;
    if (rafId === null) {
        lastFrame = 0;
        rafId = requestAnimationFrame(step);
    }
}

// Commits synchronously: state, class, and URL all settle here regardless of whether a
// frame ever renders. The CSS transition carries the visual from wherever the scrub left
// it to the committed end state.
export function setRevealed(revealed, { navigate = false } = {}) {
    if (!gridPanel || !hasFragments()) return;

    if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    targetReveal = revealed ? 1 : 0;
    displayReveal = targetReveal;

    isRevealed = revealed;
    if (revealed) {
        gridPanel.hidden = false;
        void gridPanel.offsetWidth; // flush layout so the transition has a start value
    }

    document.body.classList.remove('fragments-scrubbing');
    root.style.removeProperty('--reveal');
    document.body.classList.toggle('fragments-revealed', revealed);

    if (!revealed) {
        grid?.querySelectorAll('.fragment-tile').forEach(stopTilePreview);
        gridPanel.scrollTop = 0;
    }

    if (navigate) onNavigate(revealed ? '/fragments' : '/');
}

// Only the landing page and the grid respond to the wheel. The other panels do their own
// scrolling, and the reader is driven by explicit actions.
function onWheel(e) {
    if (isOpen || !hasFragments()) return;
    if (!onLanding && !isRevealed) return;

    // Once the grid is open the wheel belongs to the grid, until it is back at the top
    // and the visitor keeps scrolling up.
    if (isRevealed && (gridPanel.scrollTop > 0 || e.deltaY > 0)) return;
    if (!isRevealed && e.deltaY <= 0) return;

    e.preventDefault();

    // A gesture is a run of wheel events; the deltas accumulate across it, starting from
    // wherever the grid already is.
    if (gestureTimer === null) gestureAccum = isRevealed ? REVEAL_DISTANCE : 0;
    gestureAccum = Math.min(REVEAL_DISTANCE, Math.max(0, gestureAccum + e.deltaY));

    targetReveal = gestureAccum / REVEAL_DISTANCE;
    startScrub();

    clearTimeout(gestureTimer);
    gestureTimer = setTimeout(() => {
        gestureTimer = null;
        const shouldOpen = targetReveal >= SNAP_THRESHOLD;
        setRevealed(shouldOpen, { navigate: shouldOpen !== isRevealed });
    }, GESTURE_IDLE_MS);
}

// Only the landing route arms the wheel reveal.
export function setLandingActive(active) {
    onLanding = active;
}

// ----------------------------------------
// Reader
// ----------------------------------------

function buildProgress() {
    if (!progressEl) return;
    progressEl.innerHTML = fragments
        .map(() => `<span class="fragments-progress-seg"><i></i></span>`)
        .join('');
}

function updateProgress() {
    if (!progressEl) return;
    const segs = progressEl.querySelectorAll('.fragments-progress-seg');
    segs.forEach((seg, i) => {
        const bar = seg.querySelector('i');
        if (i < currentIndex) bar.style.transform = 'scaleX(1)';
        else if (i > currentIndex) bar.style.transform = 'scaleX(0)';
        else {
            const ratio = video.duration ? video.currentTime / video.duration : 0;
            bar.style.transform = `scaleX(${ratio})`;
        }
    });
}

function renderMeta(data) {
    if (!metaEl) return;
    const related = data.relatedWork
        ? `<a class="fragments-meta-link" href="/works#${data.relatedWork}" data-work="${data.relatedWork}">From ${data.relatedWork.replace(/-/g, ' ')} →</a>`
        : '';
    const instagram = data.instagram
        ? `<a class="fragments-meta-link" href="${data.instagram}" target="_blank" rel="noopener noreferrer">Instagram →</a>`
        : '';

    metaEl.innerHTML = `
        <div class="fragments-meta-main">
            <span class="fragments-meta-date">${formatDate(data.date)}</span>
            <span class="fragments-meta-title">${data.title}</span>
            ${data.description ? `<span class="fragments-meta-description">${data.description}</span>` : ''}
        </div>
        <div class="fragments-meta-links">
            <span class="fragments-meta-index">${String(currentIndex + 1).padStart(2, '0')} / ${String(fragments.length).padStart(2, '0')}</span>
            ${related}
            ${instagram}
        </div>`;

    metaEl.querySelector('[data-work]')?.addEventListener('click', (e) => {
        e.preventDefault();
        close();
        onNavigate(`/works#${data.relatedWork}`);
    });
}

// Only warm the next clip on a connection that can afford it — these are ~10 MB files.
function preloadNext() {
    const conn = navigator.connection;
    if (conn?.saveData || (conn?.effectiveType && !conn.effectiveType.includes('4g'))) return;

    const next = fragments[currentIndex + 1];
    if (!next) return;
    const link = document.getElementById('fragments-preload') || document.createElement('link');
    link.id = 'fragments-preload';
    link.rel = 'prefetch';
    link.as = 'video';
    link.href = videoUrl(next.src);
    if (!link.parentNode) document.head.appendChild(link);
}

function show(index, { replace = true } = {}) {
    const data = fragments[index];
    if (!data) return;

    currentIndex = index;
    // These are made to be watched round: a clip repeats until the visitor chooses to
    // move on, so nothing advances on its own.
    video.loop = true;
    video.poster = videoUrl(data.poster);
    video.src = videoUrl(data.src);
    video.muted = !soundEnabled();
    video.play().catch(() => {
        // An unmuted autoplay can be refused when there was no user gesture — a shared
        // /fragments/<slug> link opened cold, say. Fall back to muted so something plays,
        // but deliberately do not persist that: it is the browser's decision for this one
        // playback, not the visitor choosing silence. Persisting it here would let a
        // single blocked autoplay permanently flip the sound-on default.
        video.muted = true;
        updateSoundBtn();
        video.play().catch(() => {});
    });

    renderMeta(data);
    updateProgress();
    updateSoundBtn();

    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === fragments.length - 1;

    const path = `/fragments/${data.id}`;
    if (window.location.pathname !== path) {
        // replaceState while moving through the reel, so Back leaves the reader rather
        // than walking back through every clip.
        if (replace) history.replaceState({ path }, '', path);
        else history.pushState({ path }, '', path);
    }
}

function next() {
    if (currentIndex < fragments.length - 1) show(currentIndex + 1);
}

function prev() {
    if (currentIndex > 0) show(currentIndex - 1);
}

// Sound is on by default; only an explicit toggle turns it off. Opening a clip from the
// grid is a user gesture, so unmuted playback is allowed on that path.
const soundEnabled = () => localStorage.getItem('fragments-sound') !== 'off';
const setSoundEnabled = (on) => localStorage.setItem('fragments-sound', on ? 'on' : 'off');

function updateSoundBtn() {
    if (!soundBtn) return;
    soundBtn.textContent = video.muted ? 'Sound off' : 'Sound on';
    soundBtn.classList.toggle('muted', video.muted);
}

function toggleSound() {
    video.muted = !video.muted;
    setSoundEnabled(!video.muted);
    updateSoundBtn();
}

export function open(index = 0, { pushState = true } = {}) {
    if (!panel || !hasFragments()) return;
    const target = typeof index === 'string' ? fragments.findIndex((v) => v.id === index) : index;
    const resolved = target >= 0 ? target : 0;

    isOpen = true;
    panel.classList.add('active');
    // Lets the render loop idle the particle system while the reader covers the screen.
    document.body.classList.add('fragments-open');
    show(resolved, { replace: !pushState });
}

export function close({ navigateBack = false } = {}) {
    if (!panel || !isOpen) return;
    isOpen = false;
    panel.classList.remove('active');
    document.body.classList.remove('fragments-open');
    video.pause();
    video.removeAttribute('src');
    video.load(); // drop the buffer rather than leaving ~10 MB resident

    // Closing the reader returns to the grid it was opened from, not all the way home.
    if (navigateBack && window.location.pathname.startsWith('/fragments')) {
        onNavigate(isRevealed ? '/fragments' : '/');
    }
}

// ----------------------------------------
// Wiring
// ----------------------------------------

export function initFragments({ navigate } = {}) {
    if (!hasFragments()) return;
    onNavigate = navigate ?? (() => {});

    buildGrid();
    buildProgress();

    // The arrow works on every device; the wheel scrub is an addition on top of it.
    gridCloseBtn?.addEventListener('click', () => setRevealed(false, { navigate: true }));
    window.addEventListener('wheel', onWheel, { passive: false });

    closeBtn?.addEventListener('click', () => close({ navigateBack: true }));
    backdrop?.addEventListener('click', () => close({ navigateBack: true }));
    prevBtn?.addEventListener('click', prev);
    nextBtn?.addEventListener('click', next);
    soundBtn?.addEventListener('click', toggleSound);

    video?.addEventListener('timeupdate', updateProgress);
    video?.addEventListener('playing', preloadNext);
    video?.addEventListener('click', (e) => {
        // Without the arrows, the frame carries navigation: the outer thirds step between
        // fragments and the middle pauses, which is the convention for this kind of player.
        if (compactLayout.matches) {
            const rect = video.getBoundingClientRect();
            const x = (e.clientX - rect.left) / rect.width;
            if (x < 0.33) return prev();
            if (x > 0.67) return next();
        }
        video.paused ? video.play() : video.pause();
    });

    document.addEventListener('keydown', (e) => {
        if (isOpen) {
            if (e.key === 'Escape') close({ navigateBack: true });
            else if (e.key === 'ArrowRight') next();
            else if (e.key === 'ArrowLeft') prev();
            else if (e.key === 'm') toggleSound();
            else if (e.key === ' ') {
                e.preventDefault();
                video.paused ? video.play() : video.pause();
            }
        } else if (isRevealed && e.key === 'Escape') {
            setRevealed(false, { navigate: true });
        }
    });

    // Swipe between clips inside the reader.
    let touchStartX = 0;
    let touchStartY = 0;
    panel?.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].clientX;
        touchStartY = e.changedTouches[0].clientY;
    }, { passive: true });
    panel?.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].clientX - touchStartX;
        const dy = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy)) return;
        dx < 0 ? next() : prev();
    });

    // Don't keep decoding video in a hidden tab.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && isOpen) video.pause();
    });
}
