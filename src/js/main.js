import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { worksData } from './works-data.js';
import { showsData } from './shows-data.js';
import { videosData } from './videos-data.js';
import * as fragments from './fragments.js';

// Configuration (the simulation grid size depends on the GPU, so it is set below the renderer)
const SUB_PARTICLES = 8;
const SPHERE_RADIUS = 300.0;

// Detect if device is mobile/tablet (needed early for shader setup)
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

// Performance monitoring
let frameCount = 0;
let lastFpsCheck = performance.now();
let lastFrameTime = performance.now();
let currentFps = 60;
let performanceLevel = 1.0; // share of particles drawn; 1.0 = all of them
let performanceCheckDelay = 2000; // Wait 2 seconds before first check

// Scene Setup
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020204);
scene.fog = new THREE.FogExp2(0x020204, 0.002);

// Store background colors for theme switching
const darkBgColor = new THREE.Color(0x020204);
const lightBgColor = new THREE.Color(0xf5f5f7);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 0.1);

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);

// ----------------------------------------
// Quality tiers
// ----------------------------------------
//
// A capable GPU gets exactly the full-quality field: the 1000x1000 grid at up to 2x pixel
// density, every particle drawn. Weaker hardware is recognised up front from the renderer
// string, so it starts at a level it can hold instead of stuttering for seconds while the
// frame-rate controller below works its way down.
//
//   full        discrete GPUs, Apple silicon, anything unrecognised. Unchanged.
//   integrated  Intel integrated graphics. Same grid, so a capable one can climb back to
//               full quality; it just starts lower.
//   software    WebGL running on the CPU (hardware acceleration off, or a blocklisted
//               driver). A smaller grid, since the simulation pass alone would swamp it.
//
// ?quality=full|integrated|software forces a tier, for testing.
function detectGpuTier() {
    const forced = new URLSearchParams(window.location.search).get('quality');
    if (['full', 'integrated', 'software'].includes(forced)) return forced;

    let name = '';
    try {
        const gl = renderer.getContext();
        const info = gl.getExtension('WEBGL_debug_renderer_info');
        name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    } catch {
        return 'full';
    }
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(name)) return 'software';
    // Intel Arc is a discrete card and belongs in the full tier.
    if (/intel/i.test(name) && !/\barc\b/i.test(name)) return 'integrated';
    return 'full';
}

const gpuTier = detectGpuTier();

const WIDTH = gpuTier === 'software' ? 500 : 1000;
const TOTAL_POINTS = WIDTH * WIDTH * SUB_PARTICLES;

// Pixel-density steps, highest first. The first is what the screen asks for (capped at
// 2x, as before); the controller only steps down when the frame rate leaves no choice.
const basePixelRatio = Math.min(window.devicePixelRatio, 2);
const pixelRatioSteps = [...new Set([basePixelRatio, 1.5, 1, 0.75, ...(gpuTier === 'software' ? [0.5] : [])]
    .filter((r) => r <= basePixelRatio))];

const TIER_START = {
    full:       { level: 1.0, ratio: basePixelRatio },
    integrated: { level: 0.6, ratio: 1 },
    software:   { level: 0.5, ratio: 0.75 },
}[gpuTier];

performanceLevel = TIER_START.level;
let pixelRatioIndex = Math.max(0, pixelRatioSteps.findIndex((r) => r <= TIER_START.ratio));
renderer.setPixelRatio(pixelRatioSteps[pixelRatioIndex]);
container.appendChild(renderer.domElement);

// GPGPU Setup
const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

const computeShaderPosition = `
    uniform float uTime;
    uniform float uSpeed;
    uniform float uDeltaTime;
    uniform int uMode; // 0:Thomas, 1:Pickover, 2:FractalDream, 3:Thomas Variant
    
    float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 tmpPos = texture2D( texturePosition, uv );
        
        float x = tmpPos.x;
        float y = tmpPos.y;
        float z = tmpPos.z;
        float w = tmpPos.w;

        // Use actual delta time, clamped to reasonable values. The ceiling only matters below
        // ~50fps (a 60fps frame is 0.083 here); it is high enough that a slow machine, or one
        // stepping the simulation every other frame, still moves at the same speed.
        float dt = clamp(uDeltaTime, 0.001, 0.25);
        
        // Params for attractors
        float a = 1.2; float b = 0.19;

        float dx = 0.0; float dy = 0.0; float dz = 0.0;

        // Standard attractors
        w += 0.003 * uSpeed;
        
        if(uMode == 0) { // Thomas (Homepage/Contact)
            dx = sin(y * a + w) - (b * x);
            dy = sin(z * a + w) - (b * y);
            dz = sin(x * a + w) - (b * z);
        } 
        else if(uMode == 1) { // Pickover (Popcorn)
            a = -0.05; b = 0.1;
            float c = 1.0;
            float h = 0.5;
            float nx = x - h * sin(y + tan(c * y));
            float ny = y - h * sin(x + tan(c * x));
            float nz = z - h * sin(x + tan(c * x)) * 0.5 - h * sin(y + tan(c * y)) * 0.5;
            dx = (nx - x) * 10.0;
            dy = (ny - y) * 10.0;
            dz = (nz - z) * 10.0;
        } else if(uMode == 2) { // Fractal Dream
            a = -1.4; b = 1.6;
            float c = 1.0; float d = 0.7;
            float nx = sin(y * b + w) + c * sin(x * b);
            float ny = sin(x * a + w) + d * sin(y * a);
            float nz = cos(x * y * 0.1 + w);
            dx = (nx - x);
            dy = (ny - y);
            dz = (nz - z);
        } else if(uMode == 3) { // Thomas Variant (Works)
            a = 1.1; b = 0.23; // More dramatic constants for noticeable change
            dx = sin(y * a + w) - (b * x);
            dy = sin(z * a + w) - (b * y);
            dz = sin(x * a + w) - (b * z);
        }
        
        x += dx * dt * uSpeed;
        y += dy * dt * uSpeed;
        z += dz * dt * uSpeed;

        // Bounds check
        float limit = 60.0;
        if(uMode == 1) limit = 15.0;
        if(uMode == 2) limit = 15.0;
        if(uMode == 3) limit = 60.0;

        if( length(vec3(x,y,z)) > limit ) {
            vec2 seed = uv + vec2(uTime, uTime);
            float scale = (uMode == 0 || uMode == 3) ? 10.0 : ((uMode == 1) ? 6.0 : 0.1);
            x = (rand(seed) - 0.5) * scale;
            y = (rand(seed + 1.0) - 0.5) * scale;
            z = (rand(seed + 2.0) - 0.5) * scale;
        }

        gl_FragColor = vec4( x, y, z, w );
    }
`;

const dtPosition = gpuCompute.createTexture();
const posArray = dtPosition.image.data;

for (let i = 0; i < posArray.length; i += 4) {
    posArray[i + 0] = (Math.random() - 0.5) * 100.0;
    posArray[i + 1] = (Math.random() - 0.5) * 100.0;
    posArray[i + 2] = (Math.random() - 0.5) * 100.0;
    posArray[i + 3] = Math.random();
}

const positionVariable = gpuCompute.addVariable("texturePosition", computeShaderPosition, dtPosition);
gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);

positionVariable.material.uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0.0 },
    uDeltaTime: { value: 0.016 }, // ~60fps baseline
    uMode: { value: 0 } // Start with Thomas
};

const error = gpuCompute.init();
if (error !== null) console.error(error);

// Visualization
const visualGeometry = new THREE.BufferGeometry();
const initialPositions = new Float32Array(TOTAL_POINTS * 3);
const uvs = new Float32Array(TOTAL_POINTS * 2);
const scatters = new Float32Array(TOTAL_POINTS * 3);

let index = 0;
for (let j = 0; j < WIDTH; j++) {
    for (let i = 0; i < WIDTH; i++) {
        for (let k = 0; k < SUB_PARTICLES; k++) {
            uvs[index * 2 + 0] = i / (WIDTH - 1);
            uvs[index * 2 + 1] = j / (WIDTH - 1);
            initialPositions[index * 3 + 0] = 0;
            initialPositions[index * 3 + 1] = 0;
            initialPositions[index * 3 + 2] = 0;
            
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.sqrt(Math.random());
            scatters[index * 3 + 0] = Math.cos(angle) * radius;
            scatters[index * 3 + 1] = Math.sin(angle) * radius;
            scatters[index * 3 + 2] = Math.random();
            index++;
        }
    }
}

visualGeometry.setAttribute('position', new THREE.BufferAttribute(initialPositions, 3));
visualGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
visualGeometry.setAttribute('aScatter', new THREE.BufferAttribute(scatters, 3));
visualGeometry.setDrawRange(0, Math.floor(TOTAL_POINTS * performanceLevel));

const visualMaterial = new THREE.ShaderMaterial({
    uniforms: {
        texturePosition: { value: null },
        uRadius: { value: SPHERE_RADIUS },
        uFocus: { value: 300.0 },
        uAperture: { value: 5.0 },
        uTime: { value: 0.0 },
        uMode: { value: 0 },
        uLightMode: { value: 0.0 }, // 0 = dark, 1 = light
        uHueShift: { value: 0.0 }, // Color shift -1.0 to 1.0
        uIsMobile: { value: isMobileDevice ? 1.0 : 0.0 }, // Mobile device flag
        // Current pixel ratio over the screen's own. Points are sized in canvas pixels, so
        // without this they would grow on screen whenever the resolution is stepped down.
        uSizeScale: { value: pixelRatioSteps[pixelRatioIndex] / basePixelRatio }
    },
    vertexShader: `
        uniform sampler2D texturePosition;
        uniform float uRadius;
        uniform float uFocus;
        uniform float uAperture;
        uniform int uMode;
        uniform float uIsMobile;
        uniform float uSizeScale;

        attribute vec3 aScatter;
        
        varying float vDist;
        varying float vBlur;
        varying float vSeed;
        varying vec3 vPos;

        void main() {
            vec4 posData = texture2D( texturePosition, uv );
            vec3 pos = posData.xyz;
            
            // Scale correction
            float scale = 15.0;
            if(uMode == 1) scale = 40.0;
            if(uMode == 2) scale = 35.0;
            if(uMode == 3) scale = 15.0;
            
            vec3 visualPos = pos * scale;
            vPos = visualPos; // Pass to fragment

            // Projection
            vec3 dir = normalize(visualPos + vec3(0.001));
            float intensity = length(visualPos) * 0.015;
            
            // Standard sphere projection
            vec3 displayPos = dir * (uRadius + intensity * 40.0);

            vec4 mvPosition = modelViewMatrix * vec4( displayPos, 1.0 );
            
            // DOF Calc
            float distToCamera = -mvPosition.z;
            float focusFuzz = (aScatter.z - 0.5) * 200.0;
            float blurFactor = abs(distToCamera - (uFocus + focusFuzz));
            float maxBlur = smoothstep(0.0, 500.0, blurFactor);
            float blurRadius = maxBlur * uAperture;

            mvPosition.xy += aScatter.xy * blurRadius;

            vDist = intensity;
            vBlur = maxBlur;
            vSeed = aScatter.z;

            gl_Position = projectionMatrix * mvPosition;
            
            float baseSize = 1.0 + (aScatter.z * 2.0);
            // Reduce particle size on mobile (0.7x scale)
            float mobileScale = mix(1.0, 0.7, uIsMobile);
            float pointSize = (baseSize + blurRadius * 1.5) * ( 500.0 / distToCamera ) * mobileScale;
            // At reduced resolution, shrink to match, but not below a pixel, where points
            // would drop out entirely. At full resolution uSizeScale is 1 and this is a no-op.
            gl_PointSize = max(pointSize * uSizeScale, min(pointSize, 1.0));
        }
    `,
    fragmentShader: `
        uniform float uTime;
        uniform float uAperture;
        uniform int uMode;
        uniform float uLightMode;
        uniform float uHueShift;

        varying float vDist;
        varying float vBlur;
        varying float vSeed;
        varying vec3 vPos;

        // HSV to RGB conversion
        vec3 hsv2rgb(vec3 c) {
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        // RGB to HSV conversion
        vec3 rgb2hsv(vec3 c) {
            vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
            vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
            vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));

            float d = q.x - min(q.w, q.y);
            float e = 1.0e-10;
            return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }

        vec3 getStarColor(float t, float lightMode) {
            // Dark mode colors (for dark background)
            vec3 darkModeBlue = vec3(0.5, 0.7, 1.0);
            vec3 darkModeWhite = vec3(1.0, 0.95, 0.9);
            vec3 darkModeGold = vec3(1.0, 0.6, 0.3);
            
            // Light mode colors (for light background) - saturated and lighter
            vec3 lightModeDarkBlue = vec3(0.3, 0.5, 0.95);    // Bright blue
            vec3 lightModeBlack = vec3(0.85, 0.3, 0.55);      // Vibrant magenta/pink
            vec3 lightModeDarkGold = vec3(0.15, 0.65, 0.75);  // Bright cyan/teal

            vec3 color1, color2, color3;
            if (lightMode > 0.5) {
                // Light mode: use dark colors with variation
                color1 = lightModeDarkBlue;
                color2 = lightModeBlack;
                color3 = lightModeDarkGold;
            } else {
                // Dark mode: use light colors
                color1 = darkModeBlue;
                color2 = darkModeWhite;
                color3 = darkModeGold;
            }

            vec3 baseColor;
            if (t < 0.5) baseColor = mix(color1, color2, t * 2.0);
            else baseColor = mix(color2, color3, (t - 0.5) * 2.0);
            
            // Apply hue shift
            vec3 hsv = rgb2hsv(baseColor);
            hsv.x = fract(hsv.x + uHueShift); // Shift hue, wrap around
            return hsv2rgb(hsv);
        }

        void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;
            
            vec3 starColor = getStarColor(vSeed, uLightMode);
            
            float twinkleSpeed = 2.0 + vSeed * 3.0;
            float twinkle = 0.7 + 0.3 * sin(uTime * twinkleSpeed + vSeed * 10.0);
            float scintillation = mix(twinkle, 1.0, vBlur);
            
            float glow = 1.0 - (dist * 2.0);
            glow = pow(glow, 1.5);
            
            float fade = pow(vBlur, 0.5);
            float apertureFactor = smoothstep(0.0, 10.0, uAperture);
            float minAlpha = mix(0.3, 0.002, apertureFactor);
            
            // Adjust alpha and color based on light mode
            float baseAlpha = mix(0.3, minAlpha, fade);
            float alpha;
            vec3 finalColor;
            
            if (uLightMode > 0.5) {
                // Light mode: boost alpha and color saturation for vibrant colors
                alpha = baseAlpha * 1.1;
                // Boost color intensity and reduce glow darkening effect
                float lightGlow = mix(0.3, 0.8, glow);
                finalColor = starColor * scintillation * lightGlow;
            } else {
                // Dark mode: use standard alpha for light particles, additive blending
                alpha = baseAlpha;
                finalColor = starColor * scintillation * glow;
            }
            
            gl_FragColor = vec4( finalColor, alpha );
        }
    `,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true
});

const particleSystem = new THREE.Points(visualGeometry, visualMaterial);
scene.add(particleSystem);

// State
let currentMode = 0; // 0: Thomas (Homepage & Contact), 1: Pickover (Works)
let currentSimSpeed = 0.0;
let lastInteractionTime = 0;
let isInteracting = false;
let targetFocus = 300.0;
let targetAperture = 3.5;
let targetHueShift = 0.0;
let currentFocus = 300.0;
let currentAperture = 3.5;
let currentHueShift = 0.0;


// Add mobile tilt debug display (only on mobile) - insert before the invert reality button
// Router Configuration
const routes = {
    '/': { mode: 0, showWorks: false, showContact: false, showLive: false, showFragments: false },
    '/works': { mode: 3, showWorks: true, showContact: false, showLive: false, showFragments: false, worksFilter: 'all' },
    '/music': { mode: 3, showWorks: true, showContact: false, showLive: false, showFragments: false, worksFilter: 'released' },
    '/live': { mode: 0, showWorks: false, showContact: false, showLive: true, showFragments: false },
    '/about': { mode: 0, showWorks: false, showContact: true, showLive: false, showFragments: false },
    // The panel was Contact before it carried the bio; old links still open it.
    '/contact': { mode: 0, showWorks: false, showContact: true, showLive: false, showFragments: false },
    '/fragments': { mode: 0, showWorks: false, showContact: false, showLive: false, showFragments: true }
};

// /fragments/<slug> deep-links a single clip. Real paths rather than hashes, so that link
// previews and crawlers see a distinct URL per fragment.
function resolveRoute(path) {
    if (routes[path]) return { route: routes[path], fragmentId: null };

    const match = path.match(/^\/fragments\/([^/]+)\/?$/);
    if (match) {
        const id = decodeURIComponent(match[1]);
        if (videosData.some(v => v.id === id)) {
            return { route: routes['/fragments'], fragmentId: id };
        }
    }
    return { route: null, fragmentId: null };
}

// ========================================
// CONTACT PANEL FUNCTIONALITY
// ========================================

const contactPanel = document.getElementById('contact-panel');
const contactBackdrop = document.querySelector('.contact-backdrop');
const closeContactBtn = document.getElementById('close-contact');
const emailLink = document.getElementById('email-link');
const copyToast = document.getElementById('copy-toast');

// Open/Close Contact Panel
function openContactPanel() {
    contactPanel.classList.add('active');
    // Add class to body for mobile styling
    if (isMobileDevice) {
        document.body.classList.add('panel-open');
    }
}

function closeContactPanel(shouldNavigate = false) {
    if (!contactPanel) return;
    contactPanel.classList.remove('active');
    // Remove class from body (mobile only)
    if (isMobileDevice) {
        document.body.classList.remove('panel-open');
    }
    
    // Navigate back to home if we're on /about and explicitly requested
    if (shouldNavigate && ['/about', '/contact'].includes(window.location.pathname)) {
        navigate('/', true);
    }
}

// Copy email functionality - click to copy
if (emailLink) {
    emailLink.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = 'danieligazit@gmail.com';
        
        try {
            await navigator.clipboard.writeText(email);
            
            // Show toast notification
            if (copyToast) {
                copyToast.classList.add('show');
                
                setTimeout(() => {
                    copyToast.classList.remove('show');
                }, 2500);
            }
        } catch (err) {
            console.error('Failed to copy email:', err);
        }
    });
}

// Event listeners
if (contactBackdrop) contactBackdrop.addEventListener('click', () => closeContactPanel(true));
if (closeContactBtn) closeContactBtn.addEventListener('click', () => closeContactPanel(true));

// ========================================
// END CONTACT PANEL FUNCTIONALITY
// ========================================

// ========================================
// LIVE PANEL FUNCTIONALITY
// ========================================

const livePanel = document.getElementById('live-panel');
const liveBackdrop = document.querySelector('.live-backdrop');
const closeLiveBtn = document.getElementById('close-live');
const upcomingShowsContainer = document.getElementById('upcoming-shows');
const pastShowsContainer = document.getElementById('past-shows');

// Open/Close Live Panel
function openLivePanel() {
    livePanel.classList.add('active');
    renderShows();
    // Add class to body for mobile styling
    if (isMobileDevice) {
        document.body.classList.add('panel-open');
    }
}

function closeLivePanel(shouldNavigate = false) {
    if (!livePanel) return;
    livePanel.classList.remove('active');
    // Remove class from body (mobile only)
    if (isMobileDevice) {
        document.body.classList.remove('panel-open');
    }
    
    // Navigate back to home if we're on /live and explicitly requested
    if (shouldNavigate && window.location.pathname === '/live') {
        navigate('/', true);
    }
}

// Format date for display (YYYY-MM-DD to DD.MM.YYYY)
function formatShowDate(dateStr) {
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

// Split shows by date rather than by which list they were entered in, so a show moves
// to Past by itself the day after it happens.
function splitShowsByDate() {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const all = [...showsData.upcoming, ...showsData.past];
    return {
        upcoming: all.filter(show => show.date >= today).sort((a, b) => a.date.localeCompare(b.date)),
        past: all.filter(show => show.date < today).sort((a, b) => b.date.localeCompare(a.date)),
    };
}

// Render shows lists
function renderShows() {
    const shows = splitShowsByDate();

    // Render upcoming shows
    if (upcomingShowsContainer) {
        if (shows.upcoming.length === 0) {
            upcomingShowsContainer.innerHTML = '<div class="no-shows-message">No upcoming shows announced yet. Stay tuned!</div>';
        } else {
            upcomingShowsContainer.innerHTML = shows.upcoming.map(show => `
                <div class="show-item upcoming">
                    <span class="show-date">${formatShowDate(show.date)}</span>
                    <span class="show-venue">${show.venue}</span>
                    <span class="show-city">${show.city}</span>
                    ${show.ticketLink ? `<a href="${show.ticketLink}" target="_blank" rel="noopener noreferrer" class="show-ticket-link">Tickets</a>` : ''}
                </div>
            `).join('');
        }
    }
    
    // Render past shows
    if (pastShowsContainer) {
        pastShowsContainer.innerHTML = shows.past.map(show => {
            // A show that has moved over from upcoming keeps its event page as the link
            const link = show.link || show.ticketLink;
            return `
            <div class="show-item">
                <span class="show-date">${formatShowDate(show.date)}</span>
                ${link
                    ? `<a href="${link}" target="_blank" rel="noopener noreferrer" class="show-venue">${show.venue}</a>`
                    : `<span class="show-venue">${show.venue}</span>`}
                <span class="show-city">${show.city}</span>
            </div>
        `;
        }).join('');
    }
}

// Event listeners
if (liveBackdrop) liveBackdrop.addEventListener('click', () => closeLivePanel(true));
if (closeLiveBtn) closeLiveBtn.addEventListener('click', () => closeLivePanel(true));

// ========================================
// END LIVE PANEL FUNCTIONALITY
// ========================================

// ========================================
// THEME TOGGLE FUNCTIONALITY
// ========================================

// Saved preference first, then the per-device default resolved by the inline script in
// index.html — reading it back rather than recomputing it keeps the two from drifting.
// The final fallback only matters if main.js is loaded outside that shell.
const savedTheme = localStorage.getItem('theme') || window.__initialTheme || 'light';
const themeToggleBtn = document.getElementById('nav-theme');

// Check if user has clicked the button before (for pulse FTUE)
const hasInvertedReality = localStorage.getItem('hasInvertedReality');

// Apply pulse animation only if user hasn't clicked before
if (!hasInvertedReality && themeToggleBtn) {
    themeToggleBtn.classList.add('pulse');
}

// Apply saved theme on load
if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    scene.background.copy(lightBgColor);
    scene.fog.color.copy(lightBgColor);
    visualMaterial.uniforms.uLightMode.value = 1.0;
    visualMaterial.blending = THREE.NormalBlending;
} else {
    visualMaterial.uniforms.uLightMode.value = 0.0;
    visualMaterial.blending = THREE.AdditiveBlending;
}

// Toggle theme
function toggleTheme(e) {
    e.preventDefault();
    const isLight = document.body.classList.toggle('light-mode');
    
    // Mark that user has clicked the button (stop pulse for future visits)
    localStorage.setItem('hasInvertedReality', 'true');
    if (themeToggleBtn) {
        themeToggleBtn.classList.remove('pulse');
    }
    
    if (isLight) {
        scene.background.copy(lightBgColor);
        scene.fog.color.copy(lightBgColor);
        visualMaterial.uniforms.uLightMode.value = 1.0;
        visualMaterial.blending = THREE.NormalBlending;
        localStorage.setItem('theme', 'light');
    } else {
        scene.background.copy(darkBgColor);
        scene.fog.color.copy(darkBgColor);
        visualMaterial.uniforms.uLightMode.value = 0.0;
        visualMaterial.blending = THREE.AdditiveBlending;
        localStorage.setItem('theme', 'dark');
    }
    
    // Re-render works if works panel is open (to update embedded player themes)
    if (worksPanel && worksPanel.classList.contains('active')) {
        renderWorks(currentFilter);
    }
}

if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', toggleTheme);
}

document.getElementById('nav-theme-mobile').addEventListener('click', toggleTheme);

// ========================================
// END THEME TOGGLE FUNCTIONALITY
// ========================================

// ========================================
// WORKS PANEL FUNCTIONALITY
// ========================================

const worksPanel = document.getElementById('works-panel');
const worksBackdrop = document.querySelector('.works-backdrop');
const closeWorksBtn = document.getElementById('close-works');
const worksList = document.getElementById('works-list');
const filterBtns = document.querySelectorAll('.filter-btn');

// Desktop split layout elements
const worksNav = document.getElementById('works-nav');
const worksDetailContent = document.getElementById('works-detail-content');
const closeWorksMobileBtn = document.querySelector('.close-works-mobile');

let currentFilter = 'all';
let selectedWorkId = null;

// Released Music is Selected Works under the 'released' filter, served at its own path
// so it can be linked to directly.
function worksPath() {
    return currentFilter === 'released' ? '/music' : '/works';
}

function isWorksPath(path) {
    return path === '/works' || path === '/music';
}

// A work counts as released when it's on the streaming services.
function isReleased(work) {
    return Boolean(work.spotify || work.appleMusic);
}

function setWorksFilter(filter) {
    currentFilter = filter;
    document.querySelectorAll('.filter-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === filter);
    });
    document.querySelectorAll('.works-sidebar-header h2, .works-header h2').forEach(h => {
        h.textContent = filter === 'released' ? 'Released Music' : 'Selected Works';
    });
}

function updateWorksNavActive() {
    document.getElementById('nav-works').classList.toggle('active', currentFilter !== 'released');
    document.getElementById('nav-music').classList.toggle('active', currentFilter === 'released');
}
let isDesktopLayout = !isMobileDevice && window.innerWidth > 768;

// Check if we should use desktop layout
function checkLayoutMode() {
    isDesktopLayout = !isMobileDevice && window.innerWidth > 768;
}

window.addEventListener('resize', () => {
    const wasDesktop = isDesktopLayout;
    checkLayoutMode();
    // Re-render if layout mode changed
    if (wasDesktop !== isDesktopLayout && worksPanel.classList.contains('active')) {
        renderWorks(currentFilter);
    }
});

// Open/Close Works Panel
function openWorksPanel() {
    worksPanel.classList.add('active');
    checkLayoutMode();
    renderWorks(currentFilter);
    // Add class to body for mobile styling
    if (isMobileDevice) {
        document.body.classList.add('panel-open');
    }
}

function closeWorksPanel(shouldNavigate = false) {
    if (!worksPanel) return; // Safety check
    worksPanel.classList.remove('active');
    // Close all expanded items
    document.querySelectorAll('.work-item.expanded').forEach(item => {
        item.classList.remove('expanded');
    });
    // Reset selection
    selectedWorkId = null;
    // Remove class from body (mobile only)
    if (isMobileDevice) {
        document.body.classList.remove('panel-open');
    }
    
    // Navigate back to home if we're on /works and explicitly requested
    if (shouldNavigate && isWorksPath(window.location.pathname)) {
        navigate('/', true);
    }
}

// Add mobile close button handler
if (closeWorksMobileBtn) {
    closeWorksMobileBtn.addEventListener('click', () => closeWorksPanel(true));
}

// Navigation Logic
function setAttractor(mode, pushState = true, showWorks = false, showContact = false, showLive = false, showFragments = false, fragmentId = null) {
    currentMode = mode;
    
    // Update Shaders
    positionVariable.material.uniforms.uMode.value = mode;
    visualMaterial.uniforms.uMode.value = mode;
    
    // Update active nav
    document.querySelectorAll('nav a').forEach(el => el.classList.remove('active'));
    
    // Handle works panel
    if (showWorks) {
        openWorksPanel();
        closeContactPanel();
        closeLivePanel();
        updateWorksNavActive();
    } else {
        closeWorksPanel();
    }
    
    // Handle contact panel
    if (showContact) {
        openContactPanel();
        closeWorksPanel();
        closeLivePanel();
        document.getElementById('nav-contact').classList.add('active');
    } else {
        closeContactPanel();
    }
    
    // Handle live panel
    if (showLive) {
        openLivePanel();
        closeWorksPanel();
        closeContactPanel();
        document.getElementById('nav-live').classList.add('active');
    } else {
        closeLivePanel();
    }
    
    // Handle fragments reader
    if (showFragments) {
        closeWorksPanel();
        closeContactPanel();
        closeLivePanel();
        fragments.setRevealed(true);
        // A bare /fragments shows the grid; /fragments/<slug> opens that clip on top of it.
        if (fragmentId) fragments.open(fragmentId, { pushState });
        else fragments.close();
        document.getElementById('nav-fragments').classList.add('active');
    } else {
        fragments.close();
        fragments.setRevealed(false);
    }

    // The strip is the landing page's entry point to the videos, so it belongs on / only.
    fragments.setLandingActive(!showWorks && !showContact && !showLive && !showFragments);

    // Find and activate current nav item based on mode
    if (!showWorks && !showContact && !showLive && !showFragments) {
        const path = Object.keys(routes).find(p => routes[p].mode === mode && !routes[p].showWorks && !routes[p].showContact && !routes[p].showLive && !routes[p].showFragments);
        
        if (path && pushState) {
            history.pushState({ path }, '', path);
        }
    } else if (showWorks && pushState) {
        history.pushState({ path: worksPath() }, '', worksPath());
    } else if (showLive && pushState) {
        history.pushState({ path: '/live' }, '', '/live');
    } else if (showContact && pushState) {
        history.pushState({ path: '/about' }, '', '/about');
    } else if (showFragments && pushState && !fragmentId) {
        // With a fragmentId the reader pushes /fragments/<slug> itself; a bare grid
        // reveal has to record its own URL.
        history.pushState({ path: '/fragments' }, '', '/fragments');
    }
}

// Route to page based on URL
function navigate(path, pushState = true) {
    // Strip any hash so /works#some-work resolves against the route table.
    const [pathname, hash] = path.split('#');
    const { route, fragmentId } = resolveRoute(pathname);

    // If route doesn't exist, redirect to 404 page
    if (!route) {
        window.location.href = '/404.html';
        return;
    }

    if (route.worksFilter) setWorksFilter(route.worksFilter);

    setAttractor(route.mode, pushState, route.showWorks, route.showContact, route.showLive, route.showFragments, fragmentId);

    if (hash) {
        history.replaceState({ path: pathname, workId: hash }, '', `${pathname}#${hash}`);
        handleWorkHash();
    }
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
    const path = window.location.pathname;
    navigate(path, false);
    // Also handle hash for work selection
    handleWorkHash();
});

// Handle hash changes for work selection
window.addEventListener('hashchange', () => {
    handleWorkHash();
});

// Handle work selection from URL hash
function handleWorkHash() {
    const hash = window.location.hash;
    if (hash && hash.startsWith('#')) {
        const workId = hash.substring(1);
        const work = worksData.find(w => w.id === workId);
        if (work) {
            // Make sure works panel is open
            if (!worksPanel.classList.contains('active')) {
                openWorksPanel();
            }
            
            // Small delay to ensure panel is rendered
            setTimeout(() => {
                if (isDesktopLayout) {
                    // Desktop: select the work
                    selectWork(workId, false); // false = don't push state again
                } else {
                    // Mobile: scroll to the work item
                    scrollToWorkItem(workId);
                }
            }, 100);
        }
    }
}

// Scroll to a work item on mobile
function scrollToWorkItem(workId) {
    const workItem = document.querySelector(`.work-item[data-work-id="${workId}"]`);
    if (workItem) {
        // Expand the item if it's not expanded
        if (!workItem.classList.contains('expanded')) {
            workItem.classList.add('expanded');
        }
        // Scroll into view
        workItem.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

// Navigation Event Listeners
document.getElementById('logo-btn').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/');
});

// nav-works now handled by navigate function

document.getElementById('nav-works').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/works');
});

document.getElementById('nav-music').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/music');
});

document.getElementById('nav-live').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/live');
});

document.getElementById('nav-contact').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/about');
});

document.getElementById('nav-fragments').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/fragments');
});

fragments.initFragments({ navigate });

// Initialize route on page load
navigate(window.location.pathname, false);

// Handle work hash on initial load (after a short delay for panel to render)
if (window.location.hash && isWorksPath(window.location.pathname)) {
    setTimeout(() => {
        handleWorkHash();
    }, 200);
}

// Render works based on filter
function renderWorks(filter = 'all') {
    const filteredWorks = filter === 'all'
        ? worksData
        : filter === 'released'
            ? worksData.filter(isReleased)
            : worksData.filter(work => work.tags.includes(filter));
    
    // Month order for sorting (null/undefined goes last)
    const monthOrder = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4,
        'May': 5, 'June': 6, 'July': 7, 'August': 8,
        'September': 9, 'October': 10, 'November': 11, 'December': 12
    };
    
    // Group by year
    const worksByYear = {};
    filteredWorks.forEach(work => {
        if (!worksByYear[work.year]) {
            worksByYear[work.year] = [];
        }
        worksByYear[work.year].push(work);
    });
    
    // Sort works within each year by month (descending - most recent first)
    Object.keys(worksByYear).forEach(year => {
        worksByYear[year].sort((a, b) => {
            const monthA = monthOrder[a.month] || 0;
            const monthB = monthOrder[b.month] || 0;
            return monthB - monthA; // Descending (December before January)
        });
    });
    
    // Sort years descending
    const years = Object.keys(worksByYear).sort((a, b) => b - a);
    
    // Desktop split layout
    if (isDesktopLayout && worksNav && worksDetailContent) {
        renderWorksNav(years, worksByYear);
        
        // Get first work by visual order (first year descending, first work in that year)
        const getFirstVisualWork = () => {
            if (years.length > 0 && worksByYear[years[0]].length > 0) {
                return worksByYear[years[0]][0];
            }
            return filteredWorks[0];
        };
        
        // Check URL hash for pre-selected work
        const hashWorkId = window.location.hash ? window.location.hash.substring(1) : null;
        const hashWork = hashWorkId ? filteredWorks.find(w => w.id === hashWorkId) : null;
        
        // Select from hash (always takes priority), or existing selection, or first work
        if (hashWork) {
            // Hash always takes priority
            selectWork(hashWork.id, false);
        } else if (!selectedWorkId && filteredWorks.length > 0) {
            const firstWork = getFirstVisualWork();
            if (firstWork) selectWork(firstWork.id);
        } else if (selectedWorkId) {
            // Re-render selected work (might have changed with filter)
            const stillExists = filteredWorks.find(w => w.id === selectedWorkId);
            if (stillExists) {
                selectWork(selectedWorkId);
            } else if (filteredWorks.length > 0) {
                const firstWork = getFirstVisualWork();
                if (firstWork) selectWork(firstWork.id);
            } else {
                worksDetailContent.innerHTML = `
                    <div class="works-detail-placeholder">
                        <span>No works match this filter</span>
                    </div>
                `;
            }
        }
    }
    
    // Mobile drawer layout (always render for mobile fallback)
    if (worksList) {
        let html = '';
        years.forEach(year => {
            html += `
                <div class="work-year-group">
                    <div class="work-year-header">${year}</div>
                    ${worksByYear[year].map(work => createWorkHTML(work)).join('')}
                </div>
            `;
        });
        
        worksList.innerHTML = html;
        
        // Add event listeners to work items for click
        worksList.querySelectorAll('.work-item').forEach(item => {
            const header = item.querySelector('.work-item-header');
            header.addEventListener('click', () => {
                toggleWorkItem(item);
            });
        });
        
        // Add event listeners to platform tabs
        worksList.querySelectorAll('.platform-tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.stopPropagation();
                switchPlatform(tab);
            });
        });
    }
}

// Render navigation list for desktop split layout
function renderWorksNav(years, worksByYear) {
    let html = '';
    years.forEach(year => {
        html += `<div class="works-nav-year">${year}</div>`;
        worksByYear[year].forEach(work => {
            const isActive = selectedWorkId === work.id;
            const typeLabel = work.type.charAt(0).toUpperCase() + work.type.slice(1);
            html += `
                <div class="works-nav-item ${isActive ? 'active' : ''}" data-work-id="${work.id}">
                    ${work.coverArt ? `
                        <div class="works-nav-item-thumb">
                            <img src="${work.coverArt}" alt="${work.title}">
                        </div>
                    ` : ''}
                    <div class="works-nav-item-info">
                        <div class="works-nav-item-title">${work.title}</div>
                        <div class="works-nav-item-meta">
                            <span>${work.month ? work.month + ' ' : ''}${work.year}</span>
                            <span class="work-tag">${typeLabel}</span>
                        </div>
                        ${work.description ? `<div class="works-nav-item-desc">${work.description}</div>` : ''}
                    </div>
                </div>
            `;
        });
    });
    
    worksNav.innerHTML = html;
    
    // Add click handlers
    worksNav.querySelectorAll('.works-nav-item').forEach(item => {
        item.addEventListener('click', () => {
            const workId = item.dataset.workId;
            selectWork(workId);
        });
    });
    
    // Setup scroll spy (optional - scroll in nav to auto-select)
    setupScrollSpy();
}

// Select a work and show its detail
function selectWork(workId, pushState = true) {
    selectedWorkId = workId;
    
    // Update nav active states
    worksNav.querySelectorAll('.works-nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.workId === workId);
    });
    
    // Find the work data
    const work = worksData.find(w => w.id === workId);
    if (!work) return;
    
    // Render detail view
    renderWorkDetail(work);
    
    // Scroll nav item into view if needed
    const activeNavItem = worksNav.querySelector(`.works-nav-item[data-work-id="${workId}"]`);
    if (activeNavItem) {
        activeNavItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    
    // Update URL hash (without triggering hashchange again)
    if (pushState && window.location.hash !== `#${workId}`) {
        history.pushState({ path: worksPath(), workId }, '', `${worksPath()}#${workId}`);
    }
}

// Render detail view for a work
// Direct links to every platform a release is on. The embedded players are previews for
// anyone not signed in, so these are how most visitors will actually listen.
function listenLinks(work) {
    const links = [];
    if (work.spotify?.id) {
        links.push({ name: 'Spotify', url: `https://open.spotify.com/${work.spotify.type}/${work.spotify.id}` });
    }
    if (work.appleMusic?.id) {
        links.push({ name: 'Apple Music', url: `https://music.apple.com/us/${work.appleMusic.type}/${work.appleMusic.id}` });
    }
    if (work.tidal?.id) {
        links.push({ name: 'Tidal', url: `https://tidal.com/browse/${work.tidal.type}/${work.tidal.id}` });
    }
    if (work.youtubeMusic?.id) {
        const url = work.youtubeMusic.type === 'playlist'
            ? `https://music.youtube.com/playlist?list=${work.youtubeMusic.id}`
            : `https://music.youtube.com/watch?v=${work.youtubeMusic.id}`;
        links.push({ name: 'YouTube Music', url });
    }
    return links;
}

function listenLinksHTML(work) {
    const links = listenLinks(work);
    if (links.length === 0) return '';
    return `
        <div class="listen-links">
            <span class="listen-label">Listen on</span>
            ${links.map(l => `<a href="${l.url}" target="_blank" rel="noopener noreferrer">${l.name} ↗</a>`).join('')}
        </div>
    `;
}

function renderWorkDetail(work) {
    const monthText = work.month ? `${work.month} ` : '';
    const typeLabel = work.type.charAt(0).toUpperCase() + work.type.slice(1);
    
    const isAVWork = work.type === 'audiovisual';
    const isPerformance = hasPerformanceMedia(work);
    const isMusicWork = work.spotify || work.appleMusic?.id;
    
    if (isMusicWork) {
        renderMusicDetail(work, monthText, typeLabel, isAVWork, isPerformance);
        return;
    }

    // Build header section
    let html = `
        <div class="detail-work-header">
            ${work.coverArt ? `
                <div class="detail-cover-art">
                    <img src="${work.coverArt}" alt="${work.title}">
                </div>
            ` : ''}
            <div class="detail-info">
                <div class="detail-title">${work.title}</div>
                <div class="detail-meta">
                    <span>${monthText}${work.year}</span>
                    <span class="work-tag">${typeLabel}</span>
                </div>
                ${work.description ? `<div class="detail-description">${work.description}</div>` : ''}
                ${work.longDescription ? `<div class="detail-description" style="margin-top: 0.5rem;">${work.longDescription}</div>` : ''}
            </div>
        </div>
        <div class="detail-content">
            ${renderDetailContent(work, isMusicWork, isAVWork, isPerformance)}
        </div>
    `;
    
    worksDetailContent.innerHTML = html;

    // Each side of a video/photo pair grows in proportion to its aspect ratio, which is
    // what makes them come out the same height. The photo's ratio is only known once it
    // has loaded; until then the CSS assumes a 2:3 portrait.
    const pairPhoto = worksDetailContent.querySelector('.work-media-photo img');
    if (pairPhoto) {
        const setRatio = () => {
            if (pairPhoto.naturalHeight) {
                pairPhoto.parentElement.style.setProperty('--ratio', pairPhoto.naturalWidth / pairPhoto.naturalHeight);
            }
        };
        pairPhoto.complete ? setRatio() : pairPhoto.addEventListener('load', setRatio, { once: true });
    }

    // Add event listeners to platform tabs
    worksDetailContent.querySelectorAll('.platform-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchPlatform(tab);
        });
    });
}

// Releases: the cover and notes on the left, the player on the right at the pane's full
// height so an album's whole tracklist is in view.
function renderMusicDetail(work, monthText, typeLabel, isAVWork, isPerformance) {
    const isAlbum = work.spotify?.type === 'album';

    worksDetailContent.innerHTML = `
        <div class="detail-music ${isAlbum ? 'is-album' : ''}">
            <div class="detail-music-aside">
                ${work.coverArt ? `
                    <div class="detail-cover-art">
                        <img src="${work.coverArt}" alt="${work.title}">
                    </div>
                ` : ''}
                <div class="detail-info">
                    <div class="detail-title">${work.title}</div>
                    <div class="detail-meta">
                        <span>${monthText}${work.year}</span>
                        <span class="work-tag">${typeLabel}</span>
                    </div>
                    ${work.description ? `<div class="detail-description">${work.description}</div>` : ''}
                    ${work.longDescription ? `<div class="detail-description" style="margin-top: 0.5rem;">${work.longDescription}</div>` : ''}
                    ${listenLinksHTML(work)}
                </div>
            </div>
            <div class="detail-content">
                ${renderDetailContent(work, true, isAVWork, isPerformance)}
            </div>
        </div>
    `;

    worksDetailContent.querySelectorAll('.platform-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchPlatform(tab);
        });
    });
}

// Render the content section (embeds, gallery, etc.)
function renderDetailContent(work, isMusicWork, isAVWork, isPerformance) {
    const isLightMode = document.body.classList.contains('light-mode');
    const spotifyTheme = isLightMode ? '1' : '0';
    const appleMusicTheme = isLightMode ? 'light' : 'dark';
    
    let content = '';
    
    // Music embed (Spotify/Apple Music/Tidal/YouTube Music)
    if (isMusicWork) {
        const hasAppleMusic = work.appleMusic?.id;
        const hasTidal = work.tidal?.id;
        
        // Determine heights based on type
        const spotifyHeight = work.spotify?.type === 'album' ? 352 : 152;
        const appleMusicHeight = work.appleMusic?.type === 'album' ? 450 : 175;
        const tidalHeight = work.tidal?.type === 'album' ? 450 : 96;
        
        content += `
            <div class="platform-tabs">
                <button class="platform-tab active" data-platform="spotify">Spotify</button>
                <button class="platform-tab" data-platform="apple" ${!hasAppleMusic ? 'disabled' : ''}>Apple Music</button>
                <button class="platform-tab" data-platform="tidal" ${!hasTidal ? 'disabled' : ''}>Tidal</button>
            </div>
            <div class="player-container">
                <div class="player-content active" data-platform="spotify">
                    <iframe 
                        src="https://open.spotify.com/embed/${work.spotify.type}/${work.spotify.id}?utm_source=generator&theme=${spotifyTheme}"
                        height="${spotifyHeight}"
                        allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                        loading="lazy">
                    </iframe>
                </div>
                ${hasAppleMusic ? `
                    <div class="player-content" data-platform="apple">
                        <iframe 
                            src="https://embed.music.apple.com/us/${work.appleMusic.type}/${work.appleMusic.id}?app=music&theme=${appleMusicTheme}"
                            height="${appleMusicHeight}"
                            allow="autoplay *; encrypted-media *; fullscreen *"
                            sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                            loading="lazy">
                        </iframe>
                    </div>
                ` : ''}
                ${hasTidal ? `
                    <div class="player-content" data-platform="tidal">
                        <iframe 
                            src="https://embed.tidal.com/${work.tidal.type}s/${work.tidal.id}"
                            height="${tidalHeight}"
                            allow="encrypted-media"
                            loading="lazy">
                        </iframe>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // A/V embed (YouTube/Vimeo)
    if (isAVWork && work.platforms) {
        const platforms = work.platforms;
        const hasYoutube = platforms.youtube?.id;
        const hasVimeo = platforms.vimeo?.id;
        
        let youtubeUrl = '';
        if (hasYoutube) {
            youtubeUrl = `https://www.youtube.com/embed/${platforms.youtube.id}`;
            if (platforms.youtube.startTime) {
                youtubeUrl += `?start=${platforms.youtube.startTime}`;
            }
        }
        
        content += `
            <div class="player-container av-player">
                ${hasYoutube ? `
                    <div class="player-content active" data-platform="youtube">
                        <iframe 
                            src="${youtubeUrl}"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                            allowfullscreen
                            loading="lazy">
                        </iframe>
                    </div>
                ` : ''}
            </div>
        `;
    }
    
    // A video with a single photo: the two side by side, the same height.
    if (work.video?.src && work.performanceImages?.length === 1) {
        content += `
            <div class="work-media-pair">
                ${workVideoHTML(work)}
                <div class="work-media-photo">
                    <img src="${work.performanceImages[0]}" alt="${work.title} performance">
                </div>
            </div>
        `;
        return content;
    }

    content += workVideoHTML(work);

    // Performance gallery
    if (isPerformance && work.performanceImages) {
        content += `
            <div class="performance-gallery">
                ${work.performanceImages.map(img => `
                    <div class="performance-image">
                        <img src="${img}" alt="${work.title} performance">
                    </div>
                `).join('')}
            </div>
        `;
    }
    
    return content;
}

// Self-hosted documentation video. preload="none" so only the poster loads until the
// visitor presses play — these are ~20 MB files.
function workVideoHTML(work) {
    if (!work.video?.src) return '';
    return `
        <div class="work-video">
            <video src="${work.video.src}" ${work.video.poster ? `poster="${work.video.poster}"` : ''}
                   controls playsinline preload="none"></video>
        </div>
    `;
}

// A performance is anything documented with photos or a video of its own.
function hasPerformanceMedia(work) {
    return work.performanceImages?.length > 0 || Boolean(work.video?.src);
}

// Setup scroll spy for nav (scroll in detail panel could trigger nav updates)
function setupScrollSpy() {
    // For now, scroll spy is click-based only
    // Could add IntersectionObserver later for scroll-based selection
}

function toggleWorkItem(item) {
    const wasExpanded = item.classList.contains('expanded');
    const workId = item.dataset.workId;
    
    // Simply toggle current item without affecting others
    if (wasExpanded) {
        item.classList.remove('expanded');
        // Clear hash when collapsing
        if (window.location.hash === `#${workId}`) {
            history.pushState({ path: worksPath() }, '', worksPath());
        }
    } else {
        item.classList.add('expanded');
        // Update URL hash when expanding (mobile)
        if (workId && window.location.hash !== `#${workId}`) {
            history.pushState({ path: worksPath(), workId }, '', `${worksPath()}#${workId}`);
        }
    }
}

function createWorkHTML(work) {
    const monthText = work.month ? `${work.month} ` : '';
    const typeLabel = work.type.charAt(0).toUpperCase() + work.type.slice(1);
    
    // Determine work type
    const isAVWork = work.type === 'audiovisual';
    const isPerformance = hasPerformanceMedia(work);
    const isMusicWork = work.spotify || work.appleMusic?.id;
    
    if (isPerformance && !isMusicWork) {
        return createPerformanceWorkHTML(work, monthText, typeLabel);
    } else if (isAVWork) {
        return createAVWorkHTML(work, monthText, typeLabel);
    } else {
        return createMusicWorkHTML(work, monthText, typeLabel);
    }
}

function createMusicWorkHTML(work, monthText, typeLabel) {
    const coverArtHTML = work.coverArt 
        ? `<div class="work-cover-art"><img src="${work.coverArt}" alt="${work.title} cover"></div>`
        : '';
    
    const expandedClass = work.expandedByDefault ? 'expanded auto-expand' : '';
    
    // Check platform availability
    const hasAppleMusic = work.appleMusic?.id;
    const hasTidal = work.tidal?.id;
    
    // Determine current theme for embeds
    const isLightMode = document.body.classList.contains('light-mode');
    const spotifyTheme = isLightMode ? '1' : '0';
    const appleMusicTheme = isLightMode ? 'light' : 'dark';
    
    // Determine heights based on type
    const spotifyHeight = work.spotify?.type === 'album' ? 352 : 152;
    const appleMusicHeight = work.appleMusic?.type === 'album' ? 450 : 175;
    const tidalHeight = work.tidal?.type === 'album' ? 450 : 96;
    
    return `
        <div class="work-item ${expandedClass}" data-work-id="${work.id}">
            <div class="work-item-header">
                <div class="work-item-main">
                    ${coverArtHTML}
                    <div class="work-item-info">
                        <div class="work-item-title">${work.title}</div>
                        <div class="work-item-meta">
                            <span>${monthText}${work.year}</span>
                            <span class="work-tag">${typeLabel}</span>
                        </div>
                        ${work.description ? `<div class="work-item-description">${work.description}</div>` : ''}
                    </div>
                </div>
                <div class="work-expand-icon">▸</div>
            </div>
            <div class="work-details">
                <div class="work-details-inner">
                    ${listenLinksHTML(work)}
                    <div class="platform-tabs">
                        <button class="platform-tab active" data-platform="spotify">Spotify</button>
                        <button class="platform-tab" data-platform="apple" ${!hasAppleMusic ? 'disabled' : ''}>Apple Music</button>
                        <button class="platform-tab" data-platform="tidal" ${!hasTidal ? 'disabled' : ''}>Tidal</button>
                    </div>
                    <div class="player-container">
                        <div class="player-content active" data-platform="spotify">
                            <iframe 
                                src="https://open.spotify.com/embed/${work.spotify.type}/${work.spotify.id}?utm_source=generator&theme=${spotifyTheme}" 
                                width="100%" 
                                height="${spotifyHeight}" 
                                frameBorder="0" 
                                allowfullscreen="" 
                                allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                                loading="lazy">
                            </iframe>
                        </div>
                        ${hasAppleMusic ? `
                            <div class="player-content" data-platform="apple">
                                <iframe 
                                    allow="autoplay *; encrypted-media *; fullscreen *; clipboard-write" 
                                    frameborder="0" 
                                    height="${appleMusicHeight}" 
                                    style="width:100%;overflow:hidden;border-radius:10px;" 
                                    sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" 
                                    src="https://embed.music.apple.com/us/${work.appleMusic.type}/${work.appleMusic.id}?theme=${appleMusicTheme}">
                                </iframe>
                            </div>
                        ` : ''}
                        ${hasTidal ? `
                            <div class="player-content" data-platform="tidal">
                                <iframe 
                                    src="https://embed.tidal.com/${work.tidal.type}s/${work.tidal.id}"
                                    width="100%"
                                    height="${tidalHeight}"
                                    frameBorder="0"
                                    allow="encrypted-media"
                                    loading="lazy">
                                </iframe>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function createPerformanceWorkHTML(work, monthText, typeLabel) {
    const coverArtHTML = work.coverArt 
        ? `<div class="work-cover-art"><img src="${work.coverArt}" alt="${work.title}"></div>`
        : '';
    
    const expandedClass = work.expandedByDefault ? 'expanded auto-expand' : '';
    
    return `
        <div class="work-item ${expandedClass}" data-work-id="${work.id}">
            <div class="work-item-header">
                <div class="work-item-main">
                    ${coverArtHTML}
                    <div class="work-item-info">
                        <div class="work-item-title">${work.title}</div>
                        <div class="work-item-meta">
                            <span>${monthText}${work.year}</span>
                            <span class="work-tag">${typeLabel}</span>
                        </div>
                        ${work.description ? `<div class="work-item-description">${work.description}</div>` : ''}
                    </div>
                </div>
                <div class="work-expand-icon">▸</div>
            </div>
            <div class="work-details">
                <div class="work-details-inner">
                    ${work.longDescription ? `
                        <div class="performance-description">
                            ${work.longDescription}
                        </div>
                    ` : ''}
                    ${workVideoHTML(work)}
                    ${work.performanceImages && work.performanceImages.length > 0 ? `
                        <div class="performance-gallery">
                            ${work.performanceImages.map(img => `
                                <div class="performance-image">
                                    <img src="${img}" alt="${work.title} performance">
                                </div>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>
        </div>
    `;
}

function createAVWorkHTML(work, monthText, typeLabel) {
    const platforms = work.platforms || {};
    const hasYoutube = platforms.youtube?.id;
    const hasVimeo = platforms.vimeo?.id;
    const multiplePlatforms = hasYoutube && hasVimeo;
    
    const coverArtHTML = work.coverArt 
        ? `<div class="work-cover-art"><img src="${work.coverArt}" alt="${work.title} cover"></div>`
        : '';
    
    const expandedClass = work.expandedByDefault ? 'expanded auto-expand' : '';
    
    // Build YouTube embed URL
    let youtubeUrl = '';
    if (hasYoutube) {
        youtubeUrl = `https://www.youtube.com/embed/${platforms.youtube.id}`;
        if (platforms.youtube.startTime) {
            youtubeUrl += `?start=${platforms.youtube.startTime}`;
        }
    }
    
    // Build Vimeo embed URL
    const vimeoUrl = hasVimeo ? `https://player.vimeo.com/video/${platforms.vimeo.id}` : '';
    
    return `
        <div class="work-item ${expandedClass}" data-work-id="${work.id}">
            <div class="work-item-header">
                <div class="work-item-main">
                    ${coverArtHTML}
                    <div class="work-item-info">
                        <div class="work-item-title">${work.title}</div>
                        <div class="work-item-meta">
                            <span>${monthText}${work.year}</span>
                            <span class="work-tag">${typeLabel}</span>
                        </div>
                        ${work.description ? `<div class="work-item-description">${work.description}</div>` : ''}
                    </div>
                </div>
                <div class="work-expand-icon">▸</div>
            </div>
            <div class="work-details">
                <div class="work-details-inner">
                    ${multiplePlatforms ? `
                        <div class="platform-tabs">
                            ${hasYoutube ? '<button class="platform-tab active" data-platform="youtube">YouTube</button>' : ''}
                            ${hasVimeo ? `<button class="platform-tab ${!hasYoutube ? 'active' : ''}" data-platform="vimeo">Vimeo</button>` : ''}
                        </div>
                    ` : ''}
                    <div class="player-container av-player">
                        ${hasYoutube ? `
                            <div class="player-content active" data-platform="youtube">
                                <iframe 
                                    src="${youtubeUrl}" 
                                    width="100%" 
                                    height="405" 
                                    frameBorder="0" 
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                                    allowfullscreen
                                    loading="lazy">
                                </iframe>
                            </div>
                        ` : ''}
                        ${hasVimeo ? `
                            <div class="player-content ${!hasYoutube ? 'active' : ''}" data-platform="vimeo">
                                <iframe 
                                    src="${vimeoUrl}" 
                                    width="100%" 
                                    height="405" 
                                    frameBorder="0" 
                                    allow="autoplay; fullscreen; picture-in-picture" 
                                    allowfullscreen
                                    loading="lazy">
                                </iframe>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function switchPlatform(clickedTab) {
    // Find the container - could be .work-item (mobile drawer) or .detail-content (desktop detail)
    const container = clickedTab.closest('.work-item') || clickedTab.closest('.detail-content') || clickedTab.closest('.works-detail-content');
    if (!container) return;
    
    const platform = clickedTab.dataset.platform;
    
    // Find the platform-tabs parent and its sibling player-container
    const tabsParent = clickedTab.closest('.platform-tabs');
    const playerContainer = tabsParent?.nextElementSibling;
    
    // Update tabs
    tabsParent?.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    clickedTab.classList.add('active');
    
    // Update player content
    if (playerContainer) {
        playerContainer.querySelectorAll('.player-content').forEach(content => {
            content.classList.remove('active');
        });
        const targetContent = playerContainer.querySelector(`.player-content[data-platform="${platform}"]`);
        if (targetContent) {
            targetContent.classList.add('active');
        }
    }
}

// Filter functionality - sync all filter buttons (desktop sidebar + mobile drawer)
function setupFilterButtons() {
    const allFilterBtns = document.querySelectorAll('.filter-btn');
    allFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Sync both layouts' buttons
            setWorksFilter(btn.dataset.filter);

            // Moving into or out of Released swaps /works and /music
            if (window.location.pathname !== worksPath()) {
                history.replaceState({ path: worksPath() }, '', worksPath());
                updateWorksNavActive();
            }
            
            // Reset selection when filter changes
            selectedWorkId = null;
            
            // Re-render works
            renderWorks(currentFilter);
        });
    });
}
setupFilterButtons();

// Event listeners
worksBackdrop.addEventListener('click', () => closeWorksPanel(true));
closeWorksBtn.addEventListener('click', () => closeWorksPanel(true));

// ========================================
// END WORKS PANEL FUNCTIONALITY
// ========================================

// ========================================
// INPUT DETECTION (Mobile vs Desktop)
// ========================================

// ========================================
// INPUT HANDLING
// ========================================

// Touch controls for mobile
if (isMobileDevice) {
    const touchHint = document.getElementById('touch-hint');
    let hasInteracted = false;
    
    const updateFromTouch = (touch) => {
        const nx = touch.clientX / window.innerWidth;
        const ny = touch.clientY / window.innerHeight;
        
        targetFocus = 150.0 + (nx * 400.0);
        targetAperture = 8.0 - (nx * 5.0) + (ny * 1.5);
        targetHueShift = (ny - 0.5) * 0.4; // -0.2 to 0.2
        
        lastInteractionTime = performance.now();
        isInteracting = true;
        
        // Hide touch hint on first interaction
        if (!hasInteracted && touchHint) {
            touchHint.classList.add('hidden');
            hasInteracted = true;
        }
    };
    
    document.addEventListener('touchstart', (e) => {
        e.preventDefault();
        updateFromTouch(e.touches[0]);
    });
    
    document.addEventListener('touchmove', (e) => {
        e.preventDefault();
        updateFromTouch(e.touches[0]);
    });
    
    document.addEventListener('touchend', () => {
        // Keep last values, don't reset
    });
}

// Mouse Movement (Desktop)
if (!isMobileDevice) {
    document.addEventListener('mousemove', (e) => {
        const nx = e.clientX / window.innerWidth;
        const ny = e.clientY / window.innerHeight;
        
        // Direct mapping for desktop
        // Focus: 150-550
        targetFocus = 150.0 + (nx * 400.0);
        
        // Aperture: 3-8 with vertical influence
        targetAperture = 8.0 - (nx * 5.0) + (ny * 1.5);
        
        // Hue shift: -0.2 to 0.2 based on Y position
        targetHueShift = (ny - 0.5) * 0.4; // -0.2 to 0.2
        
        lastInteractionTime = performance.now();
        isInteracting = true;
    });
}

// Performance adjustment function
function updateParticleCount() {
    // Adjust draw count based on performance level
    const targetCount = Math.floor(TOTAL_POINTS * performanceLevel);
    visualGeometry.setDrawRange(0, targetCount);
}

// ----------------------------------------
// Frame-rate controller
// ----------------------------------------
//
// Quality only ever goes down. Once the machine has shown it can't hold the frame rate,
// the reduced level is kept for the rest of the visit rather than retried, so the field
// doesn't visibly thin and fill back in. A machine that holds 60fps never loses anything,
// so it renders exactly as before.
//
// The one exception is a tier that starts below full (Intel graphics, software): until its
// first slow reading it climbs, since it may well be capable. The first slow reading ends
// that for good, back at the last level it held.
//
// Knobs, given up one per step in this order:
//   1. particles drawn, down to half
//   2. pixel density, a step at a time
//   3. particles drawn, down to the floor
//   4. how often the simulation steps: every frame, then every 2nd / 3rd
// The first step needs two slow readings in a row (two seconds), so a single hitch — a
// page opening, a garbage-collection pause — doesn't cost anything; after that, every
// slow second cuts again until it's fast enough.
const FPS_SLOW = 50;    // below this, give something up
const FPS_STEADY = 57;  // at or above this, a starting-low tier keeps climbing
const MIN_LEVEL = isMobileDevice ? 0.5 : 0.1;

let computeEvery = 1;       // step the simulation every Nth frame
let slowChecks = 0;
let climbing = performanceLevel < 1.0 || pixelRatioIndex > 0;
let lastGoodLevel = performanceLevel;
let lastGoodRatioIndex = pixelRatioIndex;
let steadyChecks = 0;

function setPixelRatioStep(index) {
    pixelRatioIndex = index;
    const ratio = pixelRatioSteps[index];
    renderer.setPixelRatio(ratio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    visualMaterial.uniforms.uSizeScale.value = ratio / basePixelRatio;
}

function adjustQuality(fps) {
    if (fps < FPS_SLOW) {
        steadyChecks = 0;

        // A starting-low tier that hits its limit while climbing: go back to the last
        // level it held and stay there. No waiting for a second reading — it was fine a
        // moment ago, so the last step is the cause.
        if (climbing) {
            climbing = false;
            slowChecks = 0;
            performanceLevel = lastGoodLevel;
            updateParticleCount();
            if (pixelRatioIndex !== lastGoodRatioIndex) setPixelRatioStep(lastGoodRatioIndex);
            return;
        }

        // The first cut waits for a second slow reading, so a single hitch costs nothing.
        // Once a slowdown is confirmed, each further slow reading cuts straight away.
        if (++slowChecks < 2) return;

        // Cut in proportion to the shortfall, a bit under what it naively suggests so it
        // doesn't overshoot (nothing given up comes back): 45fps → about 18% less.
        // At least 5%, at most 20% at once.
        const cut = Math.min(0.2, Math.max(0.05, performanceLevel * (1 - fps / 60) * 0.7));

        if (performanceLevel > 0.5) {
            performanceLevel = Math.max(0.5, performanceLevel - cut);
            updateParticleCount();
        } else if (pixelRatioIndex < pixelRatioSteps.length - 1) {
            setPixelRatioStep(pixelRatioIndex + 1);
        } else if (performanceLevel > MIN_LEVEL) {
            performanceLevel = Math.max(MIN_LEVEL, performanceLevel - cut);
            updateParticleCount();
        } else if (computeEvery < 3) {
            computeEvery++;
        }
        return;
    }

    slowChecks = 0;
    if (!climbing || fps < FPS_STEADY) return;

    // Still climbing: particles first, then resolution once they're all back, with a few
    // steady seconds between resolution steps since each is a big jump in cost.
    lastGoodLevel = performanceLevel;
    lastGoodRatioIndex = pixelRatioIndex;
    steadyChecks++;

    if (performanceLevel < 1.0) {
        // Above 60 (a high-refresh screen) climbs in proportion; at 60 a small fixed
        // step, since the reading can't go higher.
        const step = Math.max(0.03, (fps - 60) * 0.005 * 0.15);
        performanceLevel = Math.min(1.0, performanceLevel + step);
        updateParticleCount();
    } else if (pixelRatioIndex > 0) {
        if (steadyChecks >= 3) {
            setPixelRatioStep(pixelRatioIndex - 1);
            steadyChecks = 0;
        }
    } else {
        climbing = false; // back to full quality; from here it can only go down
    }
}

// Debug readout: __quality() in the console.
window.__quality = () => ({
    tier: gpuTier,
    grid: WIDTH,
    fps: Math.round(currentFps),
    particles: `${(performanceLevel * 100).toFixed(1)}%`,
    climbing,
    pixelRatio: pixelRatioSteps[pixelRatioIndex],
    computeEvery,
});

// The simulation only changes state while it is moving: at speed zero a pass leaves every
// particle where it was (bar a one-off respawn of strays after an attractor change). So
// once the field has settled, steps are skipped entirely until it moves again.
let settledPasses = 0;
let lastComputedMode = null;
let framesSinceCompute = 0;
let pendingDelta = 0;


// Videos currently playing anywhere on the page (work videos, fragment previews). Media
// events don't bubble, so listen in the capture phase.
const playingVideos = new Set();
document.addEventListener('playing', (e) => {
    if (e.target instanceof HTMLVideoElement) playingVideos.add(e.target);
}, true);
['pause', 'ended', 'emptied'].forEach((type) => document.addEventListener(type, (e) => {
    playingVideos.delete(e.target);
}, true));
function isVideoPlaying() {
    for (const v of playingVideos) {
        if (!v.isConnected || v.paused) playingVideos.delete(v);
    }
    return playingVideos.size > 0;
}

// Animation Loop
const animate = () => {
    requestAnimationFrame(animate);

    // While a fragment is open or any video plays, freeze the field entirely — no
    // simulation step and no redraw, the canvas just keeps its last frame — so the video
    // gets the whole GPU.
    if (fragments.isFragmentsOpen() || fragments.isGridRevealed() || isVideoPlaying()) {
        lastFrameTime = performance.now();
        return;
    }

    const now = performance.now();
    const frameGap = now - lastFrameTime;

    // Calculate delta time (in seconds) - time since last frame
    const deltaTime = Math.min(frameGap / 1000, 0.1); // Cap at 100ms to prevent huge jumps
    lastFrameTime = now;

    // FPS Monitoring and Performance Adjustment
    // A long gap means the loop was paused (hidden tab, the fragments overlay), not slow:
    // start the measurement over rather than reading the pause as a terrible frame rate.
    if (frameGap > 250) {
        frameCount = 0;
        lastFpsCheck = now;
    }
    frameCount++;
    const timeSinceLastCheck = now - lastFpsCheck;

    if (timeSinceLastCheck >= 1000 && now > performanceCheckDelay) {
        currentFps = (frameCount / timeSinceLastCheck) * 1000;
        frameCount = 0;
        lastFpsCheck = now;
        adjustQuality(currentFps);
    }

    if (now - lastInteractionTime > 200) isInteracting = false;

    const targetSimSpeed = isInteracting ? 1.0 : 0.0;
    const lerpFactor = isInteracting ? 0.08 : 0.05;
    
    currentSimSpeed += (targetSimSpeed - currentSimSpeed) * lerpFactor;
    if (currentSimSpeed < 0.005) currentSimSpeed = 0.0;

    // Smooth easing for visual parameters (slower on mobile for better feel)
    const paramLerpFactor = isMobileDevice ? 0.03 : 0.08; // ~1-2 seconds on mobile, faster on desktop
    currentFocus += (targetFocus - currentFocus) * paramLerpFactor;
    currentAperture += (targetAperture - currentAperture) * paramLerpFactor;
    currentHueShift += (targetHueShift - currentHueShift) * paramLerpFactor;

    visualMaterial.uniforms.uFocus.value = currentFocus;
    visualMaterial.uniforms.uAperture.value = currentAperture;
    visualMaterial.uniforms.uHueShift.value = currentHueShift;
    visualMaterial.uniforms.uTime.value = now * 0.001;

    // Step the simulation: every frame normally, every Nth when the controller has had to
    // thin it out (carrying the skipped time so the motion keeps its speed), and not at
    // all once the field is at rest.
    const mode = positionVariable.material.uniforms.uMode.value;
    if (currentSimSpeed > 0 || mode !== lastComputedMode) settledPasses = 0;
    pendingDelta += deltaTime;
    framesSinceCompute++;

    if (settledPasses < 2 && framesSinceCompute >= computeEvery) {
        positionVariable.material.uniforms.uTime.value = now * 0.001;
        positionVariable.material.uniforms.uSpeed.value = currentSimSpeed;
        positionVariable.material.uniforms.uDeltaTime.value = pendingDelta * 5.0; // x speed multiplier
        gpuCompute.compute();
        lastComputedMode = mode;
        if (currentSimSpeed === 0) settledPasses++;
        framesSinceCompute = 0;
        pendingDelta = 0;
    } else if (settledPasses >= 2) {
        // At rest, nothing accumulates: the next movement starts from a single frame.
        framesSinceCompute = 0;
        pendingDelta = 0;
    }

    visualMaterial.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;

    // Rotate the whole system (frame-independent using deltaTime)
    // Base rotation per second: 0.006 + interaction boost (3x speed)
    particleSystem.rotation.y += (0.018 + (0.36 * currentSimSpeed)) * deltaTime * 0.65;
    particleSystem.rotation.x += (0.009 + (0.18 * currentSimSpeed)) * deltaTime * 0.65;

    renderer.render(scene, camera);
};

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

animate();

setTimeout(() => {
    const loader = document.getElementById('loader');
    const logoArea = document.querySelector('.logo-area');
    const dataDisplay = document.querySelector('.data-display');
    const touchHint = document.getElementById('touch-hint');
    
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.remove();
            // Show logo and data display after loader is removed
            if (logoArea) logoArea.classList.add('loaded');
            if (dataDisplay) dataDisplay.classList.add('loaded');
            // Show touch hint after a brief delay (mobile only)
            if (touchHint) {
                setTimeout(() => {
                    touchHint.classList.add('loaded');
                }, 300);
            }
        }, 0); // Reduced from 1000ms to 0ms
    }
}, 300); // Reduced from 1000ms to 300ms - total delay is now 800ms
