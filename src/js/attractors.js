import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/examples/jsm/misc/GPUComputationRenderer.js';

// --- CONFIGURATION ---
const WIDTH = 1200; 
const PARTICLES = WIDTH * WIDTH;
const SUB_PARTICLES = 8; 
const TOTAL_POINTS = PARTICLES * SUB_PARTICLES; 
const SPHERE_RADIUS = 300.0;

// --- SCENE SETUP ---
const container = document.getElementById('canvas-container');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020204);
scene.fog = new THREE.FogExp2(0x020204, 0.002); 

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 0, 0.1); 

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
container.appendChild(renderer.domElement);

// --- GPGPU SETUP ---
const gpuCompute = new GPUComputationRenderer(WIDTH, WIDTH, renderer);

const computeShaderPosition = `
    uniform float uTime;
    uniform float uSpeed;
    uniform int uMode; // 0:Thomas, 1:Bedhead, 2:FractalDream
    
    // Pseudo-random for resets
    float rand(vec2 co){
        return fract(sin(dot(co.xy ,vec2(12.9898,78.233))) * 43758.5453);
    }

    void main() {
        vec2 uv = gl_FragCoord.xy / resolution.xy;
        vec4 tmpPos = texture2D( texturePosition, uv );
        
        float x = tmpPos.x;
        float y = tmpPos.y;
        float z = tmpPos.z;
        float t = tmpPos.w; 

        float dt = 0.04; 
        
        // Default Params (Thomas)
        float a = 1.2; 
        float b = 0.19;
        
        // Bedhead Params
        if(uMode == 1) { a = 0.06; b = 0.98; }
        
        // Fractal Dream Params
        float c = 1.2; 
        float d = 1.6;
        if(uMode == 2) { a = -1.4; b = 1.6; c = 1.0; d = 0.7; }

        for ( int k = 0; k < 3; k++ ) {
            t += 0.003 * uSpeed; 
            
            float dx = 0.0; 
            float dy = 0.0; 
            float dz = 0.0;

            if(uMode == 0) {
                // --- THOMAS ATTRACTOR (Smooth, Ribbons) ---
                dx = sin(y * a + t) - (b * x);
                dy = sin(z * a + t) - (b * y);
                dz = sin(x * a + t) - (b * z);
            } 
            else if(uMode == 1) {
                // --- BEDHEAD ATTRACTOR (Tangled, Industrial) ---
                float nx = sin(x * y / b) * y + cos(a * x - y + t);
                float ny = x + sin(y + t) / b;
                float nz = sin(x * 0.5 + t); // Artificial Z flow
                
                dx = (nx - x);
                dy = (ny - y);
                dz = (nz - z) * 0.5;
                
                // Bedhead is wild, tame it
                dx *= 0.5; dy *= 0.5; dz *= 0.5;
            }
            else if(uMode == 2) {
                // --- FRACTAL DREAM ATTRACTOR (Symmetric, Alien) ---
                float nx = sin(y * b + t) + c * sin(x * b);
                float ny = sin(x * a + t) + d * sin(y * a);
                float nz = cos(x * y * 0.1 + t); // Z flux
                
                dx = (nx - x);
                dy = (ny - y);
                dz = (nz - z);
            }

            x += dx * dt * uSpeed;
            y += dy * dt * uSpeed;
            z += dz * dt * uSpeed;
        }

        // Bounds Check - Different attractors have different scales
        float limit = 60.0;
        if(uMode == 1) limit = 10.0; // Bedhead is compact
        if(uMode == 2) limit = 15.0; // Fractal Dream is medium

        if( length(vec3(x,y,z)) > limit ) {
            // Reset
            vec2 seed = uv + vec2(uTime, uTime);
            float scale = (uMode == 0) ? 10.0 : 0.1;
            x = (rand(seed) - 0.5) * scale;
            y = (rand(seed + 1.0) - 0.5) * scale;
            z = (rand(seed + 2.0) - 0.5) * scale;
        }

        gl_FragColor = vec4( x, y, z, t );
    }
`;

const dtPosition = gpuCompute.createTexture();
const posArray = dtPosition.image.data;

for (let i = 0; i < posArray.length; i += 4) {
    posArray[i + 0] = (Math.random() - 0.5) * 10.0; 
    posArray[i + 1] = (Math.random() - 0.5) * 10.0; 
    posArray[i + 2] = (Math.random() - 0.5) * 10.0; 
    posArray[i + 3] = Math.random() * 100.0; 
}

const positionVariable = gpuCompute.addVariable("texturePosition", computeShaderPosition, dtPosition);
gpuCompute.setVariableDependencies(positionVariable, [positionVariable]);

positionVariable.material.uniforms = {
    uTime: { value: 0 },
    uSpeed: { value: 0.0 },
    uMode: { value: 0 } // 0 = Thomas
};

const error = gpuCompute.init();
if (error !== null) console.error(error);

// --- VISUALIZATION SHADER ---
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
        uMode: { value: 0 } // Need mode for scaling logic
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

        void main() {
            vec4 posData = texture2D( texturePosition, uv );
            vec3 pos = posData.xyz;
            
            // --- SCALE CORRECTION ---
            // Different attractors need different zooms to fit the sphere
            float scale = 15.0; // Thomas (Default)
            if(uMode == 1) scale = 60.0; // Bedhead (Needs zoom)
            if(uMode == 2) scale = 35.0; // Fractal Dream (Medium)
            
            vec3 visualPos = pos * scale; 
            
            vec3 dir = normalize(visualPos + vec3(0.001));
            float intensity = length(visualPos) * 0.015;
            
            vec3 spherePos = dir * (uRadius + intensity * 40.0);
            vec4 mvPosition = modelViewMatrix * vec4( spherePos, 1.0 );
            
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
        varying float vDist;
        varying float vBlur;
        varying float vSeed;

        vec3 getStarColor(float t) {
            vec3 blue = vec3(0.5, 0.7, 1.0);
            vec3 white = vec3(1.0, 0.95, 0.9);
            vec3 gold = vec3(1.0, 0.6, 0.3);
            if (t < 0.5) return mix(blue, white, t * 2.0);
            else return mix(white, gold, (t - 0.5) * 2.0);
        }

        void main() {
            vec2 coord = gl_PointCoord - vec2(0.5);
            float dist = length(coord);
            if (dist > 0.5) discard;
            
            vec3 starColor = getStarColor(vSeed);
            
            float twinkleSpeed = 2.0 + vSeed * 3.0;
            float twinkle = 0.7 + 0.3 * sin(uTime * twinkleSpeed + vSeed * 10.0);
            float scintillation = mix(twinkle, 1.0, vBlur); 
            
            float glow = 1.0 - (dist * 2.0);
            glow = pow(glow, 1.5);
            
            float fade = pow(vBlur, 0.5); 
            float apertureFactor = smoothstep(0.0, 10.0, uAperture);
            float minAlpha = mix(0.3, 0.002, apertureFactor);
            float alpha = mix(0.3, minAlpha, fade); 
            
            gl_FragColor = vec4( starColor * scintillation * glow, alpha ); 
        }
    `,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: true
});

const particleSystem = new THREE.Points(visualGeometry, visualMaterial);
scene.add(particleSystem);

// --- INTERACTION & STATE ---
let currentSimSpeed = 0.0;
let lastInteractionTime = 0;
let isInteracting = false;

let targetFocus = 300.0;
let targetAperture = 5.0;
let currentFocus = 300.0;
let currentAperture = 5.0;

// Navigation State
let currentAttractor = 0; // 0=Thomas, 1=Bedhead, 2=Dream

const elValFocus = document.getElementById('val-focus');
const elValAperture = document.getElementById('val-aperture');
const elValStatus = document.getElementById('val-status');
const elValEq = document.getElementById('val-eq');
const elTrack = document.getElementById('track-title');

elValAperture.innerText = currentAperture.toFixed(2);

// --- NAVIGATION LOGIC ---
function setAttractor(mode, name, track) {
    currentAttractor = mode;
    
    // Update Shaders
    positionVariable.material.uniforms.uMode.value = mode;
    visualMaterial.uniforms.uMode.value = mode;
    
    // Update UI
    elValEq.innerText = name;
    elTrack.innerText = track;
    
    // Update Active Link
    document.querySelectorAll('nav a').forEach(el => el.classList.remove('active'));
}

document.getElementById('logo-btn').addEventListener('click', () => setAttractor(0, 'THOMAS', 'HOME.BASE'));
document.getElementById('nav-works').addEventListener('click', (e) => {
    setAttractor(1, 'BEDHEAD', 'SELECTED.WORKS');
    e.target.classList.add('active');
});
document.getElementById('nav-research').addEventListener('click', (e) => {
    setAttractor(2, 'FRACTAL-DREAM', 'RESEARCH.LAB');
    e.target.classList.add('active');
});
document.getElementById('nav-performances').addEventListener('click', (e) => {
    setAttractor(0, 'THOMAS', 'LIVE.PERFORMANCE'); // Re-use Thomas for now
    e.target.classList.add('active');
});

document.addEventListener('mousemove', (e) => {
    const nx = e.clientX / window.innerWidth;
    const ny = e.clientY / window.innerHeight;
    
    targetFocus = 100.0 + (nx * 500.0);
    targetAperture = ny * 10.0;
    
    lastInteractionTime = performance.now();
    isInteracting = true;
});

// --- ANIMATION LOOP ---
const animate = () => {
    requestAnimationFrame(animate);
    const now = performance.now();
    
    if (now - lastInteractionTime > 200) isInteracting = false;

    const targetSimSpeed = isInteracting ? 1.0 : 0.0;
    const lerpFactor = isInteracting ? 0.08 : 0.05;
    currentSimSpeed += (targetSimSpeed - currentSimSpeed) * lerpFactor;
    if (currentSimSpeed < 0.005) currentSimSpeed = 0.0;

    currentFocus += (targetFocus - currentFocus) * 0.1;
    currentAperture += (targetAperture - currentAperture) * 0.1;

    if (elValFocus) elValFocus.innerText = currentFocus.toFixed(0);
    if (elValAperture) elValAperture.innerText = currentAperture.toFixed(1);
    
    if (elValStatus) {
        if (currentSimSpeed > 0.1) {
            elValStatus.innerText = "ACTIVE";
            elValStatus.style.color = "#ffffff";
        } else {
            elValStatus.innerText = "DORMANT";
            elValStatus.style.color = "#666666";
        }
    }

    positionVariable.material.uniforms.uTime.value = now * 0.001;
    positionVariable.material.uniforms.uSpeed.value = currentSimSpeed;
    
    visualMaterial.uniforms.uFocus.value = currentFocus;
    visualMaterial.uniforms.uAperture.value = currentAperture;
    visualMaterial.uniforms.uTime.value = now * 0.001; 
    visualMaterial.uniforms.uAperture.value = currentAperture; // For alpha scaling

    gpuCompute.compute();

    visualMaterial.uniforms.texturePosition.value = gpuCompute.getCurrentRenderTarget(positionVariable).texture;

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
    if (loader) {
        loader.style.opacity = '0';
        setTimeout(() => loader.remove(), 1000);
    }
}, 1000);

