import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VisualConfig, VisualizerMode, AudioData, GeometryType } from '../types';

// Helper function for GLSL-like smoothstep
function smoothstep(min: number, max: number, value: number) {
  const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
  return x * x * (3 - 2 * x);
}

interface ThreeSceneProps {
  config: VisualConfig;
  audioDataRef: React.MutableRefObject<AudioData>;
}

const ThreeScene: React.FC<ThreeSceneProps> = ({ config, audioDataRef }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const particlesRef = useRef<THREE.InstancedMesh | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const backgroundMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  
  const frameIdRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  
  // Dynamic evolution refs
  const hueShiftRef = useRef<number>(0);
  const cameraAngleRef = useRef<number>(0);
  const smoothedBassRef = useRef<number>(0);
  const moodRef = useRef<number>(0); // 0.0 (Calm) to 1.0 (Intense)

  // Constants
  const PARTICLE_COUNT = 2500;
  const dummy = new THREE.Object3D();

  // Initialize Scene
  useEffect(() => {
    if (!containerRef.current) return;

    // Setup basic Three.js components
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 30;
    camera.position.y = 5;
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Background Shader Mesh ---
    const bgGeometry = new THREE.PlaneGeometry(200, 200);
    const bgMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: 0 }, // Immediate audio energy
        uMood: { value: 0 },   // Smoothed long-term intensity (0=Gentle, 1=Intense)
        uColor1: { value: new THREE.Color(config.backgroundColor) },
        uColor2: { value: new THREE.Color(config.secondaryColor) },
        uColor3: { value: new THREE.Color(config.primaryColor) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        uniform float uEnergy;
        uniform float uMood;
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uColor3;
        varying vec2 vUv;

        // Noise function for organic texture
        float random (in vec2 st) {
            return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
        }

        float noise (in vec2 st) {
            vec2 i = floor(st);
            vec2 f = fract(st);
            float a = random(i);
            float b = random(i + vec2(1.0, 0.0));
            float c = random(i + vec2(0.0, 1.0));
            float d = random(i + vec2(1.0, 1.0));
            vec2 u = f * f * (3.0 - 2.0 * f);
            return mix(a, b, u.x) + (c - a)* u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
        }

        void main() {
          vec2 uv = vUv;
          
          // Time flows faster when mood is intense
          float t = uTime * (0.1 + uMood * 0.4);
          
          // Domain Warping
          vec2 p = uv * 2.0 - 1.0; 
          
          // Gentle Mode: Smooth, large waves
          // Intense Mode: Sharp, high-frequency ripples
          float frequency = mix(2.0, 8.0, uMood); 
          float complexity = mix(0.5, 1.5, uMood);

          float wave1 = sin(p.x * frequency + t) + sin(p.y * (frequency * 0.8) + t * 0.8);
          float wave2 = sin(p.x * (frequency * 1.5) - t * 1.5) + sin(p.y * (frequency * 1.2) + t * 0.5);
          
          // Add noise for intense texture
          float n = noise(uv * 10.0 + t) * uMood * 0.2;

          float intensity = (wave1 + wave2 * complexity) / (2.0 + complexity) + n;
          intensity = intensity * 0.5 + 0.5; // Normalize
          
          // --- Color Mixing Strategy ---
          
          // Base Gradient: Background <-> Secondary
          // When gentle, mix smoothly. When intense, create sharper separation.
          float mixSharpness = mix(0.5, 8.0, uMood); 
          float mixFactor = smoothstep(0.0, 1.0, uv.y * 0.6 + intensity * 0.4);
          // Sharpen the mixing curve based on mood
          mixFactor = clamp((mixFactor - 0.5) * (1.0 + uMood) + 0.5, 0.0, 1.0);

          vec3 base = mix(uColor1, uColor2, mixFactor);
          
          // Highlights: Primary Color
          // Gentle: Soft glow. Intense: Bright sparks.
          float glowThreshold = mix(0.4, 0.6, uMood);
          float glowSize = mix(0.4, 0.1, uMood); // Gentle = wide glow, Intense = concentrated
          float glow = smoothstep(glowThreshold, glowThreshold + glowSize, intensity);
          
          vec3 finalColor = mix(base, uColor3, glow * (0.5 + uEnergy * 0.5));
          
          // Vignette to keep focus center
          float dist = distance(vUv, vec2(0.5));
          finalColor *= (1.2 - dist * 0.6); 

          // Contrast boost for intense mood
          if(uMood > 0.5) {
             finalColor = pow(finalColor, vec3(1.1 + (uMood - 0.5)));
          }

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false 
    });
    const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
    bgMesh.position.z = -50;
    bgMesh.scale.set(2, 2, 1); 
    scene.add(bgMesh);
    backgroundMaterialRef.current = bgMaterial;


    // Post Processing (Bloom)
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.5; 
    bloomPass.strength = 1.0;
    bloomPassRef.current = bloomPass;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // --- Dynamic Geometry Selection ---
    let geometry: THREE.BufferGeometry;
    switch (config.geometryType) {
      case GeometryType.Sphere:
        geometry = new THREE.SphereGeometry(0.5, 16, 16);
        break;
      case GeometryType.Tetrahedron:
        geometry = new THREE.TetrahedronGeometry(0.6);
        break;
      case GeometryType.Octahedron:
        geometry = new THREE.OctahedronGeometry(0.5);
        break;
      case GeometryType.Torus:
        geometry = new THREE.TorusGeometry(0.4, 0.15, 12, 24);
        break;
      case GeometryType.Cone:
        geometry = new THREE.ConeGeometry(0.4, 1, 16);
        break;
      case GeometryType.Box:
      default:
        geometry = new THREE.BoxGeometry(1, 1, 1);
    }
    
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1, 
      roughness: 0.8,
      emissive: 0x000000,
      emissiveIntensity: 0.0
    });
    
    // Instanced Mesh
    const particles = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);
    scene.add(particles);
    particlesRef.current = particles;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(0, 0, 10);
    scene.add(pointLight);

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.005;

      const audio = audioDataRef.current;
      
      // --- Analysis: Calculate Mood & Energy ---
      // smoothedBassRef tracks immediate heavy hits (Kick drums)
      smoothedBassRef.current += (audio.bass - smoothedBassRef.current) * 0.15;
      const normalizedBass = Math.min(smoothedBassRef.current / 255, 1.0);

      // moodRef tracks the overall intensity of the song over time (Intro/Verse vs Chorus/Drop)
      const currentEnergy = (audio.bass + audio.mid + audio.treble) / (255 * 3);
      // Smooth transition for mood (slow attack, slow release)
      moodRef.current += (currentEnergy - moodRef.current) * 0.02; 
      // Clamp mood
      const mood = Math.max(0, Math.min(1, moodRef.current * 1.5)); // Multiply to reach 1.0 easier

      // --- Evolution: Color Shifting ---
      // Shift hue slowly, but faster if mood is high
      hueShiftRef.current += 0.0002 + (mood * 0.001);
      if (hueShiftRef.current > 1) hueShiftRef.current -= 1;

      if (particlesRef.current && composerRef.current && bloomPassRef.current && backgroundMaterialRef.current && cameraRef.current) {
        
        // Dynamic Colors derived from config
        // Gentle: Colors are closer to original, slightly pastel
        // Intense: Colors are saturated, hue-shifted
        const basePrimary = new THREE.Color(config.primaryColor);
        const baseSecondary = new THREE.Color(config.secondaryColor);
        const baseBg = new THREE.Color(config.backgroundColor);

        const dynamicPrimary = basePrimary.clone().offsetHSL(hueShiftRef.current, mood * 0.2, 0);
        const dynamicSecondary = baseSecondary.clone().offsetHSL(hueShiftRef.current, mood * 0.2, 0);
        const dynamicBg = baseBg.clone().offsetHSL(hueShiftRef.current * 0.2, 0, 0);

        // --- Update Shader ---
        backgroundMaterialRef.current.uniforms.uTime.value = timeRef.current;
        backgroundMaterialRef.current.uniforms.uEnergy.value = normalizedBass; 
        backgroundMaterialRef.current.uniforms.uMood.value = mood;
        
        backgroundMaterialRef.current.uniforms.uColor1.value.lerp(dynamicBg, 0.1);
        backgroundMaterialRef.current.uniforms.uColor2.value.lerp(dynamicSecondary, 0.1);
        backgroundMaterialRef.current.uniforms.uColor3.value.lerp(dynamicPrimary, 0.1);

        // --- Update Camera ---
        // Gentle: Slow, smooth float
        // Intense: Faster rotation, slight shake on bass
        const camSpeed = 0.001 + (mood * 0.005);
        cameraAngleRef.current += camSpeed;
        
        const baseRadius = 30;
        const zoom = normalizedBass * (5 + mood * 5); // Zoom more on intense beats
        const radius = baseRadius - zoom;
        
        const camX = Math.sin(cameraAngleRef.current) * radius;
        const camZ = Math.cos(cameraAngleRef.current) * radius;
        // Y position bobs gently or shakes
        const camY = 5 + Math.sin(timeRef.current * 0.5) * 2 + ((Math.random() - 0.5) * mood * normalizedBass * 2);

        cameraRef.current.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.1);
        cameraRef.current.lookAt(0, 0, 0);

        // --- Update Bloom ---
        // Bloom pulsates with music
        bloomPassRef.current.strength = config.bloomIntensity * 0.5 + (normalizedBass * (1 + mood));
        
        // --- Update Particles ---
        updateParticles(particlesRef.current, timeRef.current, config, audio, dynamicPrimary, dynamicSecondary, mood);
        
        composerRef.current.render();
      }
    };

    animate();

    const handleResize = () => {
      if (cameraRef.current && rendererRef.current && composerRef.current) {
        cameraRef.current.aspect = window.innerWidth / window.innerHeight;
        cameraRef.current.updateProjectionMatrix();
        rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        composerRef.current.setSize(window.innerWidth, window.innerHeight);
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameIdRef.current);
      if (rendererRef.current && containerRef.current) {
        containerRef.current.removeChild(rendererRef.current.domElement);
        rendererRef.current.dispose();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]); 

  // --- Particle Update Logic ---
  const updateParticles = (
    mesh: THREE.InstancedMesh, 
    time: number, 
    cfg: VisualConfig, 
    audio: AudioData,
    cPrimary: THREE.Color,
    cSecondary: THREE.Color,
    mood: number
  ) => {
    if (!mesh) return;

    const data = audio.frequencyData;
    const bass = audio.bass;
    const mid = audio.mid;
    const count = mesh.count;
    
    // Group Rotation
    // Gentle: Constant slow rotation
    // Intense: Fast rotation that reacts to bass
    mesh.rotation.y += (0.001 + mood * 0.005) * cfg.rotationSpeed;
    mesh.rotation.z += (0.0005 + mood * 0.002);

    for (let i = 0; i < count; i++) {
      const freqIndex = Math.floor((i / count) * data.length);
      const freqValue = data[freqIndex] || 0;
      const normalizedFreq = freqValue / 255; 

      let x = 0, y = 0, z = 0;
      
      // Base scale
      let scale = cfg.particleSize * (0.5 + normalizedFreq);
      // Boost scale in intense parts
      if (mood > 0.6 && normalizedFreq > 0.5) scale *= 1.5;

      const rand1 = Math.sin(i * 12.34);
      
      // --- Mode Logic with Mood Modifications ---
      
      if (cfg.mode === VisualizerMode.Orbit) {
        const theta = i * 0.1 + time * (cfg.rotationSpeed + mood);
        // Gentle: Tighter sphere. Intense: Explodes outward.
        const expansion = (bass / 255) * (5 + mood * 10);
        const radius = 10 + expansion + (rand1 * mood * 5);
        
        x = Math.sin(theta) * radius * Math.cos(i * 0.05 + time * 0.1);
        y = Math.cos(theta) * radius * Math.sin(i * 0.05 + time * 0.1);
        z = (Math.sin(i * 0.1) * 10) + (mid / 255 * 5);
      } 
      else if (cfg.mode === VisualizerMode.Wave) {
        x = (i % 50 - 25) * 1.5;
        z = (Math.floor(i / 50) - 20) * 1.5;
        // Gentle: Smooth rolling hills. Intense: Spiky mountains.
        const waveHeight = 5 + (bass / 255 * 10 * mood);
        const waveFreq = 0.2 + (mood * 0.5);
        y = Math.sin(x * waveFreq + time * (2 + mood * 2)) * waveHeight + (normalizedFreq * 10);
      } 
      else if (cfg.mode === VisualizerMode.Grid) {
        const gridSize = Math.ceil(Math.pow(count, 1/3));
        const spacing = 3 + (bass / 100 * mood); 
        const offset = (gridSize * spacing) / 2;
        x = (i % gridSize) * spacing - offset;
        y = (Math.floor((i / gridSize) % gridSize)) * spacing - offset;
        z = (Math.floor(i / (gridSize * gridSize))) * spacing - offset;
        
        // Jitter grid positions in intense mode
        if (mood > 0.7) {
            x += (Math.random() - 0.5) * 0.5;
            y += (Math.random() - 0.5) * 0.5;
            z += (Math.random() - 0.5) * 0.5;
        }
      }
      else if (cfg.mode === VisualizerMode.Chaos) {
         const explosion = 1 + (bass / 50) * (0.5 + mood);
         x = (Math.sin(i)*20) * explosion;
         y = (Math.cos(i)*20) * explosion;
         z = (Math.sin(i*0.5)*20) * explosion;
      }

      dummy.position.set(x, y, z);
      dummy.rotation.set(time + x, time + y, time + z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // --- Advanced Color Mixing (Separation) ---
      // Gentle: Smooth blend
      // Intense: Distinct bands
      let mixFactor = normalizedFreq;
      
      if (mood > 0.6) {
          // Sharpen the color transition to separate bass visuals from treble visuals
          mixFactor = smoothstep(0.4, 0.6, normalizedFreq);
      }

      const mixedColor = cPrimary.clone().lerp(cSecondary, mixFactor);
      
      // Flash brightness on beats
      if (bass > 230 && mood > 0.3) {
        mixedColor.lerp(new THREE.Color(0xffffff), 0.5 * normalizedFreq);
      }
      
      mesh.setColorAt(i, mixedColor);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-black" />;
};

export default ThreeScene;