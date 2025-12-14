export enum VisualizerMode {
  Orbit = 'ORBIT',
  Wave = 'WAVE',
  Grid = 'GRID',
  Chaos = 'CHAOS',
  Ferrofluid = 'FERROFLUID',
  Surface = 'SURFACE'
}

export enum GeometryType {
  Box = 'BOX',
  Sphere = 'SPHERE',
  Tetrahedron = 'TETRAHEDRON',
  Octahedron = 'OCTAHEDRON',
  Torus = 'TORUS',
  Cone = 'CONE'
}

export interface VisualConfig {
  mode: VisualizerMode;
  geometryType: GeometryType; // Shape of the particles
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  particleSize: number;
  rotationSpeed: number;
  sensitivity: number; // 0.1 to 3.0
  bloomIntensity: number;
  description: string;
}

export interface AudioData {
  frequencyData: Uint8Array;
  overallAmplitude: number;
  bass: number;
  mid: number;
  treble: number;
}