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

// Simple pseudo-noise function for JS (simulates organic movement)
function simpleNoise(x: number, y: number, z: number) {
    return Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);
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
  const surfaceMeshRef = useRef<THREE.Mesh | null>(null);
  const originalPositionsRef = useRef<Float32Array | null>(null);

  const composerRef = useRef<EffectComposer | null>(null);
  const bloomPassRef = useRef<UnrealBloomPass | null>(null);
  const backgroundMaterialRef = useRef<THREE.ShaderMaterial | null>(null);
  
  const frameIdRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const mouseRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  const targetMouseRef = useRef<THREE.Vector2>(new THREE.Vector2(0, 0));
  
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
        uEnergy: { value: 0 },
        uMood: { value: 0 },
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

        // Noise function
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
          float t = uTime * (0.1 + uMood * 0.4);
          vec2 p = uv * 2.0 - 1.0; 
          float frequency = mix(2.0, 8.0, uMood); 
          float complexity = mix(0.5, 1.5, uMood);
          float wave1 = sin(p.x * frequency + t) + sin(p.y * (frequency * 0.8) + t * 0.8);
          float wave2 = sin(p.x * (frequency * 1.5) - t * 1.5) + sin(p.y * (frequency * 1.2) + t * 0.5);
          float n = noise(uv * 10.0 + t) * uMood * 0.2;
          float intensity = (wave1 + wave2 * complexity) / (2.0 + complexity) + n;
          intensity = intensity * 0.5 + 0.5; 
          
          float mixSharpness = mix(0.5, 8.0, uMood); 
          float mixFactor = smoothstep(0.0, 1.0, uv.y * 0.6 + intensity * 0.4);
          mixFactor = clamp((mixFactor - 0.5) * (1.0 + uMood) + 0.5, 0.0, 1.0);

          vec3 base = mix(uColor1, uColor2, mixFactor);
          float glowThreshold = mix(0.4, 0.6, uMood);
          float glowSize = mix(0.4, 0.1, uMood); 
          float glow = smoothstep(glowThreshold, glowThreshold + glowSize, intensity);
          
          vec3 finalColor = mix(base, uColor3, glow * (0.5 + uEnergy * 0.5));
          float dist = distance(vUv, vec2(0.5));
          finalColor *= (1.2 - dist * 0.6); 
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

    // --- Instanced Mesh (Particles) ---
    // Will be initialized in the config effect but we set up the object here
    const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.2, 
      roughness: 0.5,
    });
    const particles = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);
    scene.add(particles);
    particlesRef.current = particles;

    // --- Surface Mesh (For Surface Mode) ---
    // Use an Icosahedron with high detail for organic deformations
    const surfaceGeometry = new THREE.IcosahedronGeometry(10, 20); // Radius 10, detail 20 (high poly)
    // Save original positions for vertex manipulation
    originalPositionsRef.current = new Float32Array(surfaceGeometry.attributes.position.array.length);
    originalPositionsRef.current.set(surfaceGeometry.attributes.position.array);

    const surfaceMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.8,
      roughness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.1,
      wireframe: false,
      flatShading: false,
    });
    const surfaceMesh = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
    surfaceMesh.visible = false;
    scene.add(surfaceMesh);
    surfaceMeshRef.current = surfaceMesh;


    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); 
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 1);
    pointLight.position.set(0, 0, 10);
    scene.add(pointLight);

    // Mouse Interaction
    const handleMouseMove = (e: MouseEvent) => {
      // Normalize mouse to -1 to 1
      targetMouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      targetMouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.005;

      // Smooth mouse movement
      mouseRef.current.lerp(targetMouseRef.current, 0.1);

      const audio = audioDataRef.current;
      
      // --- Analysis ---
      smoothedBassRef.current += (audio.bass - smoothedBassRef.current) * 0.15;
      const normalizedBass = Math.min(smoothedBassRef.current / 255, 1.0);

      const currentEnergy = (audio.bass + audio.mid + audio.treble) / (255 * 3);
      moodRef.current += (currentEnergy - moodRef.current) * 0.02; 
      const mood = Math.max(0, Math.min(1, moodRef.current * 1.5));

      hueShiftRef.current += 0.0002 + (mood * 0.001);
      if (hueShiftRef.current > 1) hueShiftRef.current -= 1;

      if (composerRef.current && bloomPassRef.current && backgroundMaterialRef.current && cameraRef.current) {
        
        const basePrimary = new THREE.Color(config.primaryColor);
        const baseSecondary = new THREE.Color(config.secondaryColor);
        const baseBg = new THREE.Color(config.backgroundColor);

        const dynamicPrimary = basePrimary.clone().offsetHSL(hueShiftRef.current, mood * 0.2, 0);
        const dynamicSecondary = baseSecondary.clone().offsetHSL(hueShiftRef.current, mood * 0.2, 0);
        const dynamicBg = baseBg.clone().offsetHSL(hueShiftRef.current * 0.2, 0, 0);

        // Update Background
        backgroundMaterialRef.current.uniforms.uTime.value = timeRef.current;
        backgroundMaterialRef.current.uniforms.uEnergy.value = normalizedBass; 
        backgroundMaterialRef.current.uniforms.uMood.value = mood;
        backgroundMaterialRef.current.uniforms.uColor1.value.lerp(dynamicBg, 0.1);
        backgroundMaterialRef.current.uniforms.uColor2.value.lerp(dynamicSecondary, 0.1);
        backgroundMaterialRef.current.uniforms.uColor3.value.lerp(dynamicPrimary, 0.1);

        // Update Camera
        const camSpeed = 0.001 + (mood * 0.005);
        cameraAngleRef.current += camSpeed;
        
        // Mouse influence on camera
        const mouseCamX = mouseRef.current.x * 2;
        const mouseCamY = mouseRef.current.y * 2;

        const baseRadius = 30;
        const zoom = normalizedBass * (5 + mood * 5);
        const radius = baseRadius - zoom;
        
        const camX = Math.sin(cameraAngleRef.current) * radius + mouseCamX;
        const camZ = Math.cos(cameraAngleRef.current) * radius;
        const camY = 5 + Math.sin(timeRef.current * 0.5) * 2 + ((Math.random() - 0.5) * mood * normalizedBass * 2) + mouseCamY;

        cameraRef.current.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.1);
        cameraRef.current.lookAt(0, 0, 0);

        // Update Bloom
        bloomPassRef.current.strength = config.bloomIntensity * 0.5 + (normalizedBass * (1 + mood));
        
        // --- Mode Switching Logic ---
        if (config.mode === VisualizerMode.Surface && surfaceMeshRef.current && originalPositionsRef.current) {
            // Surface Mode
            if (particlesRef.current) particlesRef.current.visible = false;
            surfaceMeshRef.current.visible = true;

            const mesh = surfaceMeshRef.current;
            // Update Mesh Material Color
            if (mesh.material instanceof THREE.MeshPhysicalMaterial) {
                mesh.material.color.lerp(dynamicPrimary, 0.1);
                mesh.material.emissive.lerp(dynamicSecondary, 0.1);
                mesh.material.emissiveIntensity = normalizedBass * 0.5;
            }

            // Vertex Manipulation
            const positionAttribute = mesh.geometry.attributes.position;
            const vertexCount = positionAttribute.count;
            const originalPos = originalPositionsRef.current;

            // Frequency bins mapped to vertices approximately
            const data = audio.frequencyData;
            const dataLen = data.length;

            for (let i = 0; i < vertexCount; i++) {
                const ox = originalPos[i * 3];
                const oy = originalPos[i * 3 + 1];
                const oz = originalPos[i * 3 + 2];

                // Map vertex index to frequency data
                const freqIndex = i % dataLen;
                const freqVal = data[freqIndex] / 255.0;

                // Noise based displacement
                const n = simpleNoise(ox * 0.2 + timeRef.current, oy * 0.2 + timeRef.current, oz * 0.2);
                
                // Audio influence
                const displacement = 1.0 + (freqVal * 0.5 * config.sensitivity) + (n * 0.2 * mood);

                // Mouse interaction for Surface
                // Project mouse to a 3D ray or simple distance check from projected screen coords?
                // Using a simplified world-space distance check for performance:
                // Assume mouse controls a point at z=10 roughly
                const mouseWorldX = mouseRef.current.x * 15;
                const mouseWorldY = mouseRef.current.y * 15;
                const distToMouse = Math.sqrt(Math.pow(ox - mouseWorldX, 2) + Math.pow(oy - mouseWorldY, 2));
                
                let mouseFactor = 0;
                if (distToMouse < 8) {
                    mouseFactor = (1 - distToMouse / 8) * 2.0; // Bulge out near mouse
                }

                const totalScale = displacement + mouseFactor;

                positionAttribute.setXYZ(
                    i, 
                    ox * totalScale, 
                    oy * totalScale, 
                    oz * totalScale
                );
            }
            positionAttribute.needsUpdate = true;
            mesh.rotation.y += 0.002;

        } else if (particlesRef.current) {
            // Particle Modes
            if (surfaceMeshRef.current) surfaceMeshRef.current.visible = false;
            particlesRef.current.visible = true;
            
            updateParticles(
              particlesRef.current, 
              timeRef.current, 
              config, 
              audio, 
              dynamicPrimary, 
              dynamicSecondary, 
              mood, 
              mouseRef.current
            );
        }
        
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
      window.removeEventListener('mousemove', handleMouseMove);
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
    mood: number,
    mouse: THREE.Vector2
  ) => {
    if (!mesh) return;

    // Re-geometry if needed logic is handled in config change usually, 
    // but for instanced mesh we assume one geometry for now or we'd need to recreate the mesh.
    // To support GeometryType change correctly, we'd need to recreate InstancedMesh in useEffect [config.geometryType].
    // Since we are in the loop, we just manipulate position.
    
    // *Correction*: To properly switch geometry on the fly for particles, we need to rebuild the mesh.
    // However, the current structure rebuilds everything on [config] change, so geometry switch works.

    const data = audio.frequencyData;
    const bass = audio.bass;
    const mid = audio.mid;
    const count = mesh.count;
    
    const rotationFactor = cfg.mode === VisualizerMode.Ferrofluid ? 0.2 : 1.0;
    mesh.rotation.y += (0.001 + mood * 0.005) * cfg.rotationSpeed * rotationFactor;
    mesh.rotation.z += (0.0005 + mood * 0.002) * rotationFactor;

    const explosion = 1 + (bass / 50) * (0.5 + mood);
    const goldenRatio = (1 + Math.sqrt(5)) / 2;
    const angleIncrement = Math.PI * 2 * goldenRatio;
    
    // Mouse World Position approximation (at z=0 plane mostly)
    const mouseWorldX = mouse.x * 20;
    const mouseWorldY = mouse.y * 20;

    for (let i = 0; i < count; i++) {
      const freqIndex = Math.floor((i / count) * data.length);
      const freqValue = data[freqIndex] || 0;
      const normalizedFreq = freqValue / 255; 

      let x = 0, y = 0, z = 0;
      let scale = cfg.particleSize * (0.5 + normalizedFreq);
      
      const rand1 = Math.sin(i * 12.34);

      if (cfg.mode === VisualizerMode.Ferrofluid) {
          const t = i / count;
          const inclination = Math.acos(1 - 2 * t);
          const azimuth = angleIncrement * i;
          
          const radiusBase = 12; 
          
          const sx = Math.sin(inclination) * Math.cos(azimuth);
          const sy = Math.sin(inclination) * Math.sin(azimuth);
          const sz = Math.cos(inclination);
          
          const noiseFreq = 0.5;
          const noiseAmp = 4 + (bass / 255) * 8; 
          
          const n1 = simpleNoise(sx * 3 + time, sy * 3 + time, sz * 3);
          const n2 = simpleNoise(sx * 10, sy * 10 + time * 2, sz * 10); 
          
          const spike = Math.max(0, n1 + n2 * 0.5);
          const displacement = radiusBase + (spike * noiseAmp * (0.5 + mood));

          x = sx * displacement;
          y = sy * displacement;
          z = sz * displacement;

          scale *= (1.2 - (displacement - radiusBase) / 10);
          dummy.rotation.set(0,0,0);
      }
      else if (cfg.mode === VisualizerMode.Orbit) {
        const theta = i * 0.1 + time * (cfg.rotationSpeed + mood);
        const expansion = (bass / 255) * (5 + mood * 10);
        const radius = 10 + expansion + (rand1 * mood * 5);
        x = Math.sin(theta) * radius * Math.cos(i * 0.05 + time * 0.1);
        y = Math.cos(theta) * radius * Math.sin(i * 0.05 + time * 0.1);
        z = (Math.sin(i * 0.1) * 10) + (mid / 255 * 5);
      } 
      else if (cfg.mode === VisualizerMode.Wave) {
        x = (i % 50 - 25) * 1.5;
        z = (Math.floor(i / 50) - 20) * 1.5;
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
        if (mood > 0.7) {
            x += (Math.random() - 0.5) * 0.5;
            y += (Math.random() - 0.5) * 0.5;
            z += (Math.random() - 0.5) * 0.5;
        }
      }
      else if (cfg.mode === VisualizerMode.Chaos) {
         x = (Math.sin(i)*20) * explosion;
         y = (Math.cos(i)*20) * explosion;
         z = (Math.sin(i*0.5)*20) * explosion;
      }

      // --- Mouse Interaction for Particles ---
      // Simple repulsion/swirl force
      const dx = x - mouseWorldX;
      const dy = y - mouseWorldY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      const repulsionRadius = 10;
      
      if (dist < repulsionRadius) {
          const force = (1 - dist / repulsionRadius) * 5;
          x += (dx / dist) * force;
          y += (dy / dist) * force;
          // Scale up particles near mouse
          scale *= 1.5;
      }

      if (mood > 0.6 && normalizedFreq > 0.5) scale *= 1.5;

      dummy.position.set(x, y, z);
      
      if (cfg.mode !== VisualizerMode.Ferrofluid) {
          dummy.rotation.set(time + x, time + y, time + z);
      } else {
        dummy.lookAt(0,0,0);
      }
      
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Color
      let mixFactor = normalizedFreq;
      if (mood > 0.6) {
          mixFactor = smoothstep(0.4, 0.6, normalizedFreq);
      }
      const mixedColor = cPrimary.clone().lerp(cSecondary, mixFactor);
      if (bass > 230 && mood > 0.3) {
        mixedColor.lerp(new THREE.Color(0xffffff), 0.5 * normalizedFreq);
      }
      
      // Highlight near mouse
      if (dist < repulsionRadius) {
         mixedColor.lerp(new THREE.Color(0xffffff), 0.3);
      }

      mesh.setColorAt(i, mixedColor);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Re-instantiate particles when geometry type changes
  useEffect(() => {
     if (!particlesRef.current || !sceneRef.current) return;
     
     // Dispose old
     particlesRef.current.geometry.dispose();
     
     // Create new geometry based on config
     let geometry: THREE.BufferGeometry;
     switch (config.geometryType) {
      case GeometryType.Sphere:
        geometry = new THREE.SphereGeometry(0.5, 12, 12);
        break;
      case GeometryType.Tetrahedron:
        geometry = new THREE.TetrahedronGeometry(0.6);
        break;
      case GeometryType.Octahedron:
        geometry = new THREE.OctahedronGeometry(0.5);
        break;
      case GeometryType.Torus:
        geometry = new THREE.TorusGeometry(0.4, 0.15, 8, 16);
        break;
      case GeometryType.Cone:
        geometry = new THREE.ConeGeometry(0.4, 1, 16);
        break;
      case GeometryType.Box:
      default:
        geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    }
    
    particlesRef.current.geometry = geometry;

  }, [config.geometryType]);


  return <div ref={containerRef} className="absolute inset-0 z-0 bg-black" />;
};

export default ThreeScene;