# Alexei Void Portfolio

A stunning single-page WebGL portfolio featuring GPU-accelerated particle systems, strange attractors, and real-time black hole physics. Built with Three.js and GPGPU computation for smooth, performant generative art.

## ✨ Features

- **Single Page Application**: Seamless navigation between different simulations with no page reloads
- **GPU-Accelerated Particle Systems**: Millions of particles simulated in real-time using GPU computation
- **Multiple Simulation Modes**:
  - **Homepage**: Thomas Attractor (smooth, ribbon-like flows)
  - **Selected Works**: Bedhead Attractor (tangled, industrial patterns)
  - **Research**: Fractal Dream Attractor (symmetric, alien structures)
  - **Contact**: Thomas Attractor (same as homepage)
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

Any changes you make to the source files will instantly update in the browser - **no page reloads needed**!

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
│   ├── index.html           # Single-page application
│   ├── styles/
│   │   └── main.css         # Global styles
│   └── js/
│       └── main.js          # Unified simulation engine
├── package.json
├── vite.config.js           # Vite configuration
└── README.md
```

## 🎮 Simulation Modes

### Homepage - Thomas Attractor
- **Visual**: Smooth, ribbon-like particle flows
- **Interaction**: Mouse X controls focus distance, Y controls aperture (depth of field)
- **Behavior**: Particles freeze when mouse stops moving
- **Colors**: Blue to white to gold gradient

### Selected Works - Bedhead Attractor
- **Visual**: Tangled, industrial particle patterns
- **Interaction**: Mouse X controls focus distance, Y controls aperture (depth of field)
- **Behavior**: Particles freeze when mouse stops moving

### Research - Fractal Dream Attractor
- **Visual**: Symmetric, alien geometric structures
- **Interaction**: Mouse X controls focus distance, Y controls aperture
- **Behavior**: Particles freeze when mouse stops moving

### Contact - Thomas Attractor
- **Visual**: Same as homepage - smooth, ribbon-like particle flows
- **Interaction**: Mouse X controls focus distance, Y controls aperture
- **Behavior**: Particles freeze when mouse stops moving

## 🛠 Technology Stack

- **Three.js**: WebGL 3D rendering
- **GPUComputationRenderer**: GPGPU physics simulation
- **Vite**: Build tool and dev server
- **ES6 Modules**: Modern JavaScript architecture

## 🎨 Customization

### Adjusting Particle Count

Edit the configuration constants in `src/js/main.js`:

```javascript
const WIDTH = 550;           // Grid size (WIDTH × WIDTH particles)
const SUB_PARTICLES = 5;     // Particles per grid point
```

⚠️ **Note**: Higher values create more particles but require more GPU power.

### Adding New Simulation Modes

1. Add a new mode number in the `computeShaderPosition` shader
2. Define the physics equations for your mode
3. Add vertex shader projection logic for visualization
4. Update the `modes` object with UI configuration
5. Add a navigation button and event listener

### Styling

Modify `src/styles/main.css` to customize:
- Colors and typography
- UI layout and positioning
- Animations and transitions

## 📊 Performance Tips

- **Reduce particle count** on lower-end GPUs
- **Disable depth of field** by setting aperture to 0
- **Lower pixel ratio** in renderer setup for better FPS
- **Use Chrome/Edge** for best WebGL performance

## 🌐 Browser Support

- Chrome/Edge (recommended)
- Firefox
- Safari (limited WebGL support)

WebGL 2.0 and GPGPU compute shaders required.

## 🎯 Navigation

- **Click "Alexei Void" logo**: Return to homepage (Thomas Attractor)
- **Selected Works link**: Switch to Bedhead Attractor
- **Research link**: Switch to Fractal Dream Attractor
- **Contact link**: Same as homepage (Thomas Attractor)

All transitions happen instantly with no page reload!

## 📝 License

MIT License - feel free to use this for your own portfolio or projects!

## 🙏 Acknowledgments

- Strange attractor equations from various mathematical research
- Three.js community for excellent WebGL tools
- GPU computation techniques inspired by particle system research

---

**Explore the intersection of art, mathematics, and code** 🌌✨
