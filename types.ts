export enum VisualizerMode {
  Orbit = 'ORBIT',
  Wave = 'WAVE',
  Grid = 'GRID',
  Chaos = 'CHAOS'
}

export interface VisualConfig {
  mode: VisualizerMode;
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
