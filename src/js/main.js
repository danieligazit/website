import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';
import { worksData } from './works-data.js';

// Configuration
const WIDTH = 1000;
const PARTICLES = WIDTH * WIDTH;
const SUB_PARTICLES = 8;
const TOTAL_POINTS = PARTICLES * SUB_PARTICLES;
const SPHERE_RADIUS = 300.0;

// Performance monitoring
let frameCount = 0;
let lastFpsCheck = performance.now();
let currentFps = 60;
let performanceLevel = 1.0; // 1.0 = full quality, reduces if performance is poor
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
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// GPGPU Setup
const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

const computeShaderPosition = `
    uniform float uTime;
    uniform float uSpeed;
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

        float dt = 0.04;
        
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

const visualMaterial = new THREE.ShaderMaterial({
    uniforms: {
        texturePosition: { value: null },
        uRadius: { value: SPHERE_RADIUS },
        uFocus: { value: 300.0 },
        uAperture: { value: 5.0 },
        uTime: { value: 0.0 },
        uMode: { value: 0 },
        uLightMode: { value: 0.0 }, // 0 = dark, 1 = light
        uHueShift: { value: 0.0 } // Color shift -1.0 to 1.0
    },
    vertexShader: `
        uniform sampler2D texturePosition;
        uniform float uRadius;
        uniform float uFocus;
        uniform float uAperture;
        uniform int uMode;
        
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
            gl_PointSize = (baseSize + blurRadius * 1.5) * ( 500.0 / distToCamera );
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
            
            // Light mode colors (for light background) - more saturated dark colors
            vec3 lightModeDarkBlue = vec3(0.35, 0.18, 1);  //  Dark blue
            vec3 lightModeBlack = vec3(0.05, 0.05, 0.08);     // Near black
            vec3 lightModeDarkGold = vec3(0.25, 0.25, 0.28);  // Vibrant dark gold/orange

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
                // Light mode: use higher alpha for dark particles, normal blending
                alpha = baseAlpha * 1.5;
                finalColor = starColor * scintillation * glow;
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

// Detect if device is mobile/tablet (needed early for UI setup)
const isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || 
                       (navigator.maxTouchPoints && navigator.maxTouchPoints > 2);

// UI Elements
const elValFocus = document.getElementById('val-focus');
const elValAperture = document.getElementById('val-aperture');
const elValStatus = document.getElementById('val-status');
const elValFps = document.getElementById('val-fps');
const elValPoints = document.getElementById('val-points');
const elValQuality = document.getElementById('val-quality');

elValAperture.innerText = currentAperture.toFixed(2);

// Add mobile tilt debug display (only on mobile) - insert before the invert reality button
if (isMobileDevice) {
    const dataDisplay = document.querySelector('.data-display');
    const invertRealityDiv = document.querySelector('#nav-theme').parentElement;
    
    const tiltDebug = document.createElement('div');
    tiltDebug.style.borderTop = '1px solid rgba(255,255,255,0.2)';
    tiltDebug.style.paddingTop = '8px';
    tiltDebug.style.marginTop = '8px';
    tiltDebug.style.marginBottom = '8px';
    tiltDebug.innerHTML = `
        <div>ORIENT: <span class="value" id="val-orient-status">WAITING</span></div>
        <div>TILT: <span class="value" id="val-alpha">0</span> | <span class="value" id="val-beta">0</span> | <span class="value" id="val-gamma">0</span> (<span class="value" id="val-tilt-mag">0</span>)</div>
    `;
    
    // Insert before the invert reality button
    dataDisplay.insertBefore(tiltDebug, invertRealityDiv);
}

// Router Configuration
const routes = {
    '/': { mode: 0, showWorks: false, showContact: false },
    '/works': { mode: 3, showWorks: true, showContact: false },
    '/contact': { mode: 0, showWorks: false, showContact: true }
};

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
}

function closeContactPanel(shouldNavigate = false) {
    if (!contactPanel) return;
    contactPanel.classList.remove('active');
    
    // Navigate back to home if we're on /contact and explicitly requested
    if (shouldNavigate && window.location.pathname === '/contact') {
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
// THEME TOGGLE FUNCTIONALITY
// ========================================

// Check for saved theme preference or default to dark mode
const savedTheme = localStorage.getItem('theme') || 'dark';
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

let currentFilter = 'all';

// Open/Close Works Panel
function openWorksPanel() {
    worksPanel.classList.add('active');
    renderWorks(currentFilter);
}

function closeWorksPanel(shouldNavigate = false) {
    if (!worksPanel) return; // Safety check
    worksPanel.classList.remove('active');
    // Close all expanded items
    document.querySelectorAll('.work-item.expanded').forEach(item => {
        item.classList.remove('expanded');
    });
    
    // Navigate back to home if we're on /works and explicitly requested
    if (shouldNavigate && window.location.pathname === '/works') {
        navigate('/', true);
    }
}

// Navigation Logic
function setAttractor(mode, pushState = true, showWorks = false, showContact = false) {
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
        document.getElementById('nav-works').classList.add('active');
    } else {
        closeWorksPanel();
    }
    
    // Handle contact panel
    if (showContact) {
        openContactPanel();
        closeWorksPanel();
        document.getElementById('nav-contact').classList.add('active');
    } else {
        closeContactPanel();
    }
    
    // Find and activate current nav item based on mode
    if (!showWorks && !showContact) {
        const path = Object.keys(routes).find(p => routes[p].mode === mode && !routes[p].showWorks && !routes[p].showContact);
        
        if (path && pushState) {
            history.pushState({ path }, '', path);
        }
    } else if (showWorks && pushState) {
        history.pushState({ path: '/works' }, '', '/works');
    } else if (showContact && pushState) {
        history.pushState({ path: '/contact' }, '', '/contact');
    }
}

// Route to page based on URL
function navigate(path, pushState = true) {
    const route = routes[path] || routes['/'];
    setAttractor(route.mode, pushState, route.showWorks, route.showContact);
}

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
    const path = window.location.pathname;
    navigate(path, false);
});

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

document.getElementById('nav-contact').addEventListener('click', (e) => {
    e.preventDefault();
    navigate('/contact');
});

// Initialize route on page load
navigate(window.location.pathname, false);

// Render works based on filter
function renderWorks(filter = 'all') {
    const filteredWorks = filter === 'all' 
        ? worksData 
        : worksData.filter(work => work.tags.includes(filter));
    
    // Group by year
    const worksByYear = {};
    filteredWorks.forEach(work => {
        if (!worksByYear[work.year]) {
            worksByYear[work.year] = [];
        }
        worksByYear[work.year].push(work);
    });
    
    // Sort years descending
    const years = Object.keys(worksByYear).sort((a, b) => b - a);
    
    // Build HTML
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
    document.querySelectorAll('.work-item').forEach(item => {
        const header = item.querySelector('.work-item-header');
        header.addEventListener('click', () => {
            toggleWorkItem(item);
        });
    });
    
    // Add event listeners to platform tabs
    document.querySelectorAll('.platform-tab').forEach(tab => {
        tab.addEventListener('click', (e) => {
            e.stopPropagation();
            switchPlatform(tab);
        });
    });
}

function toggleWorkItem(item) {
    const wasExpanded = item.classList.contains('expanded');
    
    // Simply toggle current item without affecting others
    if (wasExpanded) {
        item.classList.remove('expanded');
    } else {
        item.classList.add('expanded');
    }
}

function createWorkHTML(work) {
    const monthText = work.month ? `${work.month} ` : '';
    const typeLabel = work.type.charAt(0).toUpperCase() + work.type.slice(1);
    
    // Determine work type
    const isAVWork = work.type === 'audiovisual';
    const isPerformance = work.performanceImages && work.performanceImages.length > 0;
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
    
    // Check if Apple Music is available
    const hasAppleMusic = work.appleMusic?.id;
    
    // Determine current theme for embeds
    const isLightMode = document.body.classList.contains('light-mode');
    const spotifyTheme = isLightMode ? '1' : '0';
    const appleMusicTheme = isLightMode ? 'light' : 'dark';
    
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
                    <div class="platform-tabs">
                        <button class="platform-tab active" data-platform="spotify">Spotify</button>
                        <button class="platform-tab" data-platform="apple" ${!hasAppleMusic ? 'disabled' : ''}>Apple Music</button>
                    </div>
                    <div class="player-container">
                        <div class="player-content active" data-platform="spotify">
                            <iframe 
                                src="https://open.spotify.com/embed/${work.spotify.type}/${work.spotify.id}?utm_source=generator&theme=${spotifyTheme}" 
                                width="100%" 
                                height="${work.spotify.type === 'album' ? '352' : '152'}" 
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
                                    height="${work.appleMusic.type === 'album' ? '450' : '175'}" 
                                    style="width:100%;overflow:hidden;border-radius:10px;" 
                                    sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation" 
                                    src="https://embed.music.apple.com/us/${work.appleMusic.type}/${work.appleMusic.id}?theme=${appleMusicTheme}">
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
    const workItem = clickedTab.closest('.work-item');
    const platform = clickedTab.dataset.platform;
    
    // Update tabs
    workItem.querySelectorAll('.platform-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    clickedTab.classList.add('active');
    
    // Update player content
    workItem.querySelectorAll('.player-content').forEach(content => {
        content.classList.remove('active');
    });
    workItem.querySelector(`.player-content[data-platform="${platform}"]`).classList.add('active');
}

// Filter functionality
filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        
        // Update active filter
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Re-render works
        renderWorks(currentFilter);
    });
});

// Event listeners
worksBackdrop.addEventListener('click', () => closeWorksPanel(true));
closeWorksBtn.addEventListener('click', () => closeWorksPanel(true));

// ========================================
// END WORKS PANEL FUNCTIONALITY
// ========================================

// ========================================
// INPUT DETECTION (Mobile vs Desktop)
// ========================================

console.log('Device detection - isMobileDevice:', isMobileDevice);
console.log('DeviceOrientationEvent available:', typeof DeviceOrientationEvent !== 'undefined');

// Mobile Orientation State
let orientationBaseline = null; // Start as null, will be set on first reading
let isDormant = true;
const TILT_THRESHOLD = 25; // degrees - threshold to activate from dormant (increased for stability)
const DORMANT_TIMEOUT = 800; // ms - how long to wait before going dormant (increased for better stability)
const STABILITY_THRESHOLD = 5; // degrees - how stable must it be to go dormant (allows for sensor jitter)
let lastOrientationChange = 0;
let orientationInitialized = false;
let lastAlpha = 0, lastBeta = 0, lastGamma = 0; // Track last values for smoothing
let stabilityCheckValues = []; // Track recent values for stability check

// Device Orientation (Mobile/Tablet)
if (isMobileDevice && window.DeviceOrientationEvent) {
    console.log('Mobile device with orientation support detected');
    
    // Check if iOS requires permission
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        console.log('iOS device - permission required');
        // iOS 13+ requires permission - we'll request it on first interaction
        let permissionGranted = false;
        
        // Create permission button
        const requestPermission = async () => {
            try {
                const permission = await DeviceOrientationEvent.requestPermission();
                if (permission === 'granted') {
                    permissionGranted = true;
                    startOrientationListener();
                }
            } catch (error) {
                console.error('Error requesting device orientation permission:', error);
            }
        };
        
        // Request permission on any user interaction
        const requestOnInteraction = () => {
            if (!permissionGranted) {
                requestPermission();
                // Remove listeners after first attempt
                document.removeEventListener('click', requestOnInteraction);
                document.removeEventListener('touchstart', requestOnInteraction);
            }
        };
        
        document.addEventListener('click', requestOnInteraction, { once: true });
        document.addEventListener('touchstart', requestOnInteraction, { once: true });
    } else {
        // Android or older iOS - works without permission
        console.log('Android or older iOS - starting listener directly');
        startOrientationListener();
    }
} else {
    console.log('Not mobile or no orientation support. isMobile:', isMobileDevice, 'hasAPI:', !!window.DeviceOrientationEvent);
}

function startOrientationListener() {
    console.log('Starting device orientation listener...');
    
    // Update status indicator
    const statusEl = document.getElementById('val-orient-status');
    if (statusEl) statusEl.innerText = 'LISTENING';
    
    window.addEventListener('deviceorientation', (e) => {
        let alpha = e.alpha !== null ? e.alpha : 0; // 0-360
        let beta = e.beta !== null ? e.beta : 0;   // -180 to 180
        let gamma = e.gamma !== null ? e.gamma : 0; // -90 to 90
        
        // Apply exponential smoothing to reduce jitter (0.3 = 30% new, 70% old)
        const smoothing = 0.3;
        if (orientationInitialized) {
            alpha = lastAlpha + smoothing * (alpha - lastAlpha);
            beta = lastBeta + smoothing * (beta - lastBeta);
            gamma = lastGamma + smoothing * (gamma - lastGamma);
        }
        lastAlpha = alpha;
        lastBeta = beta;
        lastGamma = gamma;
        
        // Initialize baseline on first reading
        if (!orientationInitialized) {
            orientationBaseline = { alpha, beta, gamma };
            orientationInitialized = true;
            console.log('Orientation baseline initialized:', orientationBaseline);
            if (statusEl) statusEl.innerText = 'ACTIVE';
            return;
        }
        
        // Calculate magnitude of tilt from baseline
        const deltaBeta = Math.abs(beta - orientationBaseline.beta);
        const deltaGamma = Math.abs(gamma - orientationBaseline.gamma);
        const tiltMagnitude = Math.sqrt(deltaBeta * deltaBeta + deltaGamma * deltaGamma);
        
        // Update debug display (mobile only)
        if (isMobileDevice) {
            const elAlpha = document.getElementById('val-alpha');
            const elBeta = document.getElementById('val-beta');
            const elGamma = document.getElementById('val-gamma');
            const elTiltMag = document.getElementById('val-tilt-mag');
            
            if (elAlpha) elAlpha.innerText = alpha.toFixed(1) + '°';
            if (elBeta) elBeta.innerText = beta.toFixed(1) + '°';
            if (elGamma) elGamma.innerText = gamma.toFixed(1) + '°';
            if (elTiltMag) elTiltMag.innerText = tiltMagnitude.toFixed(1) + '°';
        }
        
        const now = performance.now();
        
        // Add current values to stability check buffer
        stabilityCheckValues.push({ beta, gamma, time: now });
        // Keep only last 10 samples (roughly 300ms worth at ~30Hz sensor rate)
        if (stabilityCheckValues.length > 10) {
            stabilityCheckValues.shift();
        }
        
        // Calculate stability: standard deviation of recent values
        let isStable = false;
        if (stabilityCheckValues.length >= 5) {
            const avgBeta = stabilityCheckValues.reduce((sum, v) => sum + v.beta, 0) / stabilityCheckValues.length;
            const avgGamma = stabilityCheckValues.reduce((sum, v) => sum + v.gamma, 0) / stabilityCheckValues.length;
            const varianceBeta = stabilityCheckValues.reduce((sum, v) => sum + Math.pow(v.beta - avgBeta, 2), 0) / stabilityCheckValues.length;
            const varianceGamma = stabilityCheckValues.reduce((sum, v) => sum + Math.pow(v.gamma - avgGamma, 2), 0) / stabilityCheckValues.length;
            const stdDev = Math.sqrt(varianceBeta + varianceGamma);
            
            isStable = stdDev < STABILITY_THRESHOLD;
        }
        
        // Determine if we should be active or dormant
        if (isDormant && tiltMagnitude > TILT_THRESHOLD) {
            // Activate from dormant state - only check threshold when dormant
            isDormant = false;
            lastOrientationChange = now;
            stabilityCheckValues = []; // Clear stability buffer when activating
            if (statusEl) statusEl.innerText = 'ACTIVE';
        }
        
        if (!isDormant) {
            // We're active - calculate and apply visual parameters
            
            // Calculate deltas from baseline (when it was dormant)
            let alphaRawDelta = alpha - orientationBaseline.alpha;
            // Handle alpha wraparound (0-360)
            if (alphaRawDelta > 180) alphaRawDelta -= 360;
            if (alphaRawDelta < -180) alphaRawDelta += 360;
            
            const betaDelta = beta - orientationBaseline.beta;
            const gammaDelta = gamma - orientationBaseline.gamma;
            
            // Map to bounded ranges using sine waves
            // Each completes a full cycle every 180 degrees of rotation
            
            // Gamma (left-right) → Focus (150-550)
            const focusRange = 200.0; // +/- 200 from center
            const focusCenter = 300.0;
            const focusOscillation = focusRange * Math.sin(gammaDelta * Math.PI / 90);
            targetFocus = focusCenter + focusOscillation;
            
            // Beta (front-back) → Aperture (3-8)
            const apertureRange = 2.5; // +/- 2.5 from center
            const apertureCenter = 5.5;
            const apertureOscillation = apertureRange * Math.sin(betaDelta * Math.PI / 90);
            targetAperture = apertureCenter + apertureOscillation;
            
            // Alpha (compass rotation) → Hue shift (-0.2 to 0.2)
            const hueRange = 0.2;
            const hueOscillation = hueRange * Math.sin(alphaRawDelta * Math.PI / 90);
            targetHueShift = hueOscillation;
            
            lastInteractionTime = now;
            isInteracting = true;
            
            // Check if we should go dormant (phone is stable in new position)
            if (isStable && (now - lastOrientationChange > DORMANT_TIMEOUT)) {
                // Transition to dormant - save current orientation as new baseline
                isDormant = true;
                orientationBaseline = { alpha, beta, gamma };
                stabilityCheckValues = []; // Clear stability buffer
                console.log('Went dormant, new baseline:', orientationBaseline);
                if (statusEl) statusEl.innerText = 'DORMANT';
            }
        }
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

// Animation Loop
const animate = () => {
    requestAnimationFrame(animate);
    const now = performance.now();
    
    // FPS Monitoring and Performance Adjustment
    frameCount++;
    const timeSinceLastCheck = now - lastFpsCheck;
    
    if (timeSinceLastCheck >= 1000 && now > performanceCheckDelay) {
        currentFps = (frameCount / timeSinceLastCheck) * 1000;
        frameCount = 0;
        lastFpsCheck = now;
        
        // Elegant proportional performance adjustment - targets 80 FPS
        const TARGET_FPS = 80;
        const MIN_PERFORMANCE = 0.25;
        const MAX_PERFORMANCE = 1.0;
        
        // Calculate how far we are from target (negative = below target, positive = above target)
        const fpsError = currentFps - TARGET_FPS;
        
        // Proportional adjustment: larger error = larger adjustment
        // Increased from 0.002 to 0.005 for more aggressive adjustment
        let adjustment = fpsError * 0.005;
        
        // Asymmetric adjustment: Fast to reduce, slow to increase (more gradual particle addition)
        if (adjustment > 0) {
            adjustment *= 0.15; // Only increase at 15% speed to avoid sudden particle spawning
        }
        
        // Apply adjustment (negative error reduces performance, positive error increases it)
        const newPerformanceLevel = Math.max(MIN_PERFORMANCE, Math.min(MAX_PERFORMANCE, performanceLevel + adjustment));
        
        // Only update if there's a meaningful change (avoid micro-adjustments)
        if (Math.abs(newPerformanceLevel - performanceLevel) > 0.001) {
            performanceLevel = newPerformanceLevel;
            updateParticleCount();
            const direction = adjustment > 0 ? 'Increasing' : 'Reducing';
        }
    }
    
    if (now - lastInteractionTime > 200) isInteracting = false;

    const targetSimSpeed = isInteracting ? 1.0 : 0.0;
    const lerpFactor = isInteracting ? 0.08 : 0.05;
    
    currentSimSpeed += (targetSimSpeed - currentSimSpeed) * lerpFactor;
    if (currentSimSpeed < 0.005) currentSimSpeed = 0.0;

    currentFocus += (targetFocus - currentFocus) * 0.1;
    currentAperture += (targetAperture - currentAperture) * 0.1;
    currentHueShift += (targetHueShift - currentHueShift) * 0.1;

    // Update UI displays
    if (elValFocus) elValFocus.innerText = currentFocus.toFixed(0);
    if (elValAperture) elValAperture.innerText = currentAperture.toFixed(1);
    if (elValFps) elValFps.innerText = currentFps.toFixed(0);
    
    const currentPointCount = Math.floor(TOTAL_POINTS * performanceLevel);
    if (elValPoints) {
        const pointsInMillions = (currentPointCount / 1000000).toFixed(2);
        elValPoints.innerText = `${pointsInMillions}M`;
    }
    if (elValQuality) elValQuality.innerText = `${(performanceLevel * 100).toFixed(0)}%`;
    
    if (elValStatus) {
        const isLightMode = document.body.classList.contains('light-mode');
        if (currentSimSpeed > 0.1) {
            elValStatus.innerText = "ACTIVE";
            elValStatus.style.color = isLightMode ? "#000000" : "#ffffff";
        } else {
            elValStatus.innerText = "DORMANT";
            elValStatus.style.color = "#666666";
        }
    }

    positionVariable.material.uniforms.uTime.value = now * 0.001;
    positionVariable.material.uniforms.uSpeed.value = currentSimSpeed;
    
    visualMaterial.uniforms.uFocus.value = currentFocus;
    visualMaterial.uniforms.uAperture.value = currentAperture;
    visualMaterial.uniforms.uHueShift.value = currentHueShift;
    visualMaterial.uniforms.uTime.value = now * 0.001;

    gpuCompute.compute();

    visualMaterial.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;

    // Rotate the whole system
    particleSystem.rotation.y += 0.0001 + (0.002 * currentSimSpeed);
    particleSystem.rotation.x += 0.00005 + (0.001 * currentSimSpeed);

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
    
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.remove();
            // Show logo and data display after loader is removed
            if (logoArea) logoArea.classList.add('loaded');
            if (dataDisplay) dataDisplay.classList.add('loaded');
        }, 0); // Reduced from 1000ms to 0ms
    }
}, 300); // Reduced from 1000ms to 300ms - total delay is now 800ms
