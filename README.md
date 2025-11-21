# Strange Attractors Portfolio

A stunning WebGL portfolio featuring GPU-accelerated particle systems, strange attractors, and real-time physics simulations. Built with Three.js and GPGPU computation for smooth, performant generative art.

## ✨ Features

- **GPU-Accelerated Particle Systems**: Millions of particles simulated in real-time using GPU computation
- **Multiple Strange Attractors**: 
  - Thomas Attractor (smooth, ribbon-like flows)
  - Bedhead Attractor (tangled, industrial patterns)
  - Fractal Dream (symmetric, alien structures)
  - Event Horizon (black hole physics with accretion disk)
- **Interactive Camera Effects**: Dynamic depth of field and focus control via mouse movement
- **Hot Reload Development**: Instant updates as you save files
- **Modern Build Pipeline**: Vite for lightning-fast builds and optimal production bundles

## 🚀 Quick Start

### Prerequisites

- Node.js (v18 or higher recommended)
- npm or yarn

### Installation

```bash
# Install dependencies
npm install
```

### Development

Start the development server with hot reload:

```bash
npm run dev
```

The site will automatically open in your browser at `http://localhost:3000`

Any changes you make to the source files will instantly update in the browser!

### Build for Production

```bash
npm run build
```

This creates an optimized build in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## 📁 Project Structure

```
website/
├── src/
│   ├── index.html           # Main attractors page
│   ├── horizon.html         # Event horizon black hole page
│   ├── styles/
│   │   └── main.css         # Global styles
│   └── js/
│       ├── attractors.js    # Main strange attractors simulation
│       └── horizon.js       # Black hole singularity simulation
├── package.json
├── vite.config.js           # Vite configuration
└── README.md
```

## 🎮 Interactive Features

### Main Page (Strange Attractors)
- **Mouse Movement**: Controls focus distance and aperture (depth of field)
- **Navigation Links**: Switch between different attractor equations in real-time
- **Logo Click**: Returns to the default Thomas attractor

### Event Horizon Page
- **Mouse Movement**: Controls camera angle and accelerates time
- **Black Hole Physics**: Particles orbit and fall into the singularity
- **Automatic Respawn**: Particles regenerate at the accretion disk outer edge

## 🛠 Technology Stack

- **Three.js**: WebGL 3D rendering
- **GPUComputationRenderer**: GPGPU physics simulation
- **Vite**: Build tool and dev server
- **ES6 Modules**: Modern JavaScript architecture

## 🎨 Customization

### Adjusting Particle Count

Edit the configuration constants in `src/js/attractors.js` or `src/js/horizon.js`:

```javascript
const WIDTH = 600;           // Grid size (WIDTH × WIDTH particles)
const SUB_PARTICLES = 5;     // Particles per grid point
```

⚠️ **Note**: Higher values create more particles but require more GPU power.

### Adding New Attractors

1. Add new attractor equations in the compute shader's `main()` function
2. Create a new mode case (e.g., `uMode == 3`)
3. Add a navigation handler in the event listeners section
4. Adjust the scale correction in the vertex shader

### Styling

Modify `src/styles/main.css` to customize:
- Colors and typography
- UI layout and positioning
- Animations and transitions

## 📊 Performance Tips

- **Reduce particle count** on lower-end GPUs
- **Disable depth of field** by setting `uAperture` to 0
- **Lower pixel ratio** in renderer setup for better FPS
- **Use Chrome/Edge** for best WebGL performance

## 🌐 Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari (limited WebGL support)

WebGL 2.0 and GPGPU compute shaders required.

## 📝 License

MIT License - feel free to use this for your own portfolio or projects!

## 🙏 Acknowledgments

- Strange attractor equations from various mathematical research
- Three.js community for excellent WebGL tools
- GPU computation techniques inspired by particle system research

---

**Enjoy exploring the strange attractors!** 🌌✨

