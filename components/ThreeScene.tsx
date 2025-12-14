import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { VisualConfig, VisualizerMode, AudioData } from '../types';

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

  // Constants
  const PARTICLE_COUNT = 2000;
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

    // Renderer - Alpha not strictly needed now as we draw background in ThreeJS
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // --- Background Shader Mesh ---
    // Creates a fluid gradient background behind everything
    const bgGeometry = new THREE.PlaneGeometry(200, 200);
    const bgMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
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
        uniform vec3 uColor1;
        uniform vec3 uColor2;
        uniform vec3 uColor3;
        varying vec2 vUv;

        void main() {
          // Create a fluid movement
          float noise = sin(vUv.x * 3.0 + uTime * 0.5) * cos(vUv.y * 3.0 + uTime * 0.3);
          
          // Gradient mixing
          vec3 color = mix(uColor1, uColor2, vUv.y + noise * 0.2);
          color = mix(color, uColor3, vUv.x * 0.5 + sin(uTime * 0.2) * 0.2);
          
          // Darken edges slightly (Vignette)
          float dist = distance(vUv, vec2(0.5));
          color = mix(color, uColor1, dist * 0.8);

          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false // Don't write to depth buffer so particles are always in front
    });
    const bgMesh = new THREE.Mesh(bgGeometry, bgMaterial);
    bgMesh.position.z = -50;
    bgMesh.scale.set(2, 2, 1); // Scale to cover field of view
    scene.add(bgMesh);
    backgroundMaterialRef.current = bgMaterial;


    // Post Processing (Bloom)
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.5; // Only bloom bright things, not the background
    bloomPass.strength = 1.0;
    bloomPassRef.current = bloomPass;

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composerRef.current = composer;

    // Geometry & Material
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.1, 
      roughness: 0.8,
      emissive: 0x111111,
      emissiveIntensity: 0.2
    });
    
    // Instanced Mesh
    const particles = new THREE.InstancedMesh(geometry, material, PARTICLE_COUNT);
    scene.add(particles);
    particlesRef.current = particles;

    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
    scene.add(ambientLight);
    
    const pointLight = new THREE.PointLight(0xffffff, 2);
    pointLight.position.set(10, 20, 10);
    scene.add(pointLight);

    const dirLight = new THREE.DirectionalLight(0xffddcc, 1.2);
    dirLight.position.set(-10, 10, 5);
    scene.add(dirLight);

    // Grid
    const gridHelper = new THREE.GridHelper(100, 50, 0xffffff, 0xffffff);
    gridHelper.position.y = -15;
    (gridHelper.material as THREE.Material).opacity = 0.1;
    (gridHelper.material as THREE.Material).transparent = true;
    scene.add(gridHelper);

    // Animation Loop
    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      timeRef.current += 0.005;

      if (particlesRef.current && composerRef.current && bloomPassRef.current && backgroundMaterialRef.current) {
        
        // Update Background Uniforms
        backgroundMaterialRef.current.uniforms.uTime.value = timeRef.current;
        // Smoothly interpolate colors (optional, but simple assignment here)
        backgroundMaterialRef.current.uniforms.uColor1.value.set(config.backgroundColor);
        backgroundMaterialRef.current.uniforms.uColor2.value.set(config.secondaryColor);
        backgroundMaterialRef.current.uniforms.uColor3.value.set(config.primaryColor);

        // Update Bloom
        bloomPassRef.current.strength = config.bloomIntensity * 0.4 + (audioDataRef.current.bass / 500);
        
        // Dynamic Updates
        updateParticles(particlesRef.current, timeRef.current, config, audioDataRef.current);
        
        composerRef.current.render();
      }
    };

    animate();

    // Resize Handler
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
  }, []); // Run once on mount

  // Helper function to update particle transform
  const updateParticles = (
    mesh: THREE.InstancedMesh, 
    time: number, 
    cfg: VisualConfig, 
    audio: AudioData
  ) => {
    if (!mesh) return;

    const data = audio.frequencyData;
    const bass = audio.bass;
    const mid = audio.mid;
    const treble = audio.treble;
    const count = mesh.count;
    
    // Rotate entire mesh group slowly
    mesh.rotation.y += 0.002 * cfg.rotationSpeed;
    mesh.rotation.z += 0.001 * cfg.rotationSpeed;

    const colorPrimary = new THREE.Color(cfg.primaryColor);
    const colorSecondary = new THREE.Color(cfg.secondaryColor);

    for (let i = 0; i < count; i++) {
      const freqIndex = Math.floor((i / count) * data.length);
      const freqValue = data[freqIndex] || 0;
      const normalizedFreq = freqValue / 255; 

      let x = 0, y = 0, z = 0;
      let scale = cfg.particleSize * (1 + (normalizedFreq * cfg.sensitivity));

      const rand1 = Math.sin(i * 12.34);
      const rand2 = Math.cos(i * 45.67);
      const rand3 = Math.sin(i * 78.90);

      if (cfg.mode === VisualizerMode.Orbit) {
        const theta = i * 0.1 + time * cfg.rotationSpeed;
        const radius = 10 + (bass / 20) * rand1;
        x = Math.sin(theta) * radius * Math.cos(i * 0.05);
        y = Math.cos(theta) * radius * Math.sin(i * 0.05);
        z = (Math.sin(i * 0.1) * 10) + (mid / 20);
      } 
      else if (cfg.mode === VisualizerMode.Wave) {
        x = (i % 50 - 25) * 1.5;
        z = (Math.floor(i / 50) - 20) * 1.5;
        y = Math.sin(x * 0.2 + time * 2) * 5 + (normalizedFreq * 10);
      } 
      else if (cfg.mode === VisualizerMode.Grid) {
        const gridSize = Math.ceil(Math.pow(count, 1/3));
        const spacing = 3;
        const offset = (gridSize * spacing) / 2;
        x = (i % gridSize) * spacing - offset;
        y = (Math.floor((i / gridSize) % gridSize)) * spacing - offset;
        z = (Math.floor(i / (gridSize * gridSize))) * spacing - offset;
        scale *= (bass > 200 && rand1 > 0.8) ? 3 : 1;
      }
      else if (cfg.mode === VisualizerMode.Chaos) {
         x = rand1 * 20 * (1 + bass/100);
         y = rand2 * 20 * (1 + mid/100);
         z = rand3 * 20 * (1 + treble/100);
         mesh.rotation.x += 0.001;
      }

      dummy.position.set(x, y, z);
      dummy.rotation.set(time + x, time + y, time + z);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const mixedColor = colorPrimary.clone().lerp(colorSecondary, normalizedFreq);
      if (bass > 230) {
        mixedColor.offsetHSL(0, 0, 0.2);
      }
      mesh.setColorAt(i, mixedColor);
    }
    
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  const updateParticlePositions = (mesh: THREE.InstancedMesh, time: number, mode: VisualizerMode, bass: number) => {
    // Implicit
  };

  return <div ref={containerRef} className="absolute inset-0 z-0 bg-black" />;
};

export default ThreeScene;