import { GoogleGenAI, Type } from "@google/genai";
import { VisualConfig, VisualizerMode } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const DEFAULT_CONFIG: VisualConfig = {
  mode: VisualizerMode.Orbit,
  primaryColor: "#00ffcc",
  secondaryColor: "#ff00ff",
  backgroundColor: "#1a1a2e",
  particleSize: 0.5,
  rotationSpeed: 0.5,
  sensitivity: 1.5,
  bloomIntensity: 1.0,
  description: "Default cyberpunk aesthetic"
};

export const generateVisualConfig = async (prompt: string): Promise<VisualConfig> => {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `Generate a JSON configuration for a 3D music visualizer based on this vibe/prompt: "${prompt}". 
      
      Determine the best visual mode, colors, and parameters to match the feeling of the music described.
      Modes explained:
      - ORBIT: Spherical arrangement, good for electronic/pop.
      - WAVE: Linear flowing waves, good for chill/ambient.
      - GRID: Structured matrix, good for techno/industrial.
      - CHAOS: Random explosion, good for rock/experimental.
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            mode: {
              type: Type.STRING,
              enum: [VisualizerMode.Orbit, VisualizerMode.Wave, VisualizerMode.Grid, VisualizerMode.Chaos]
            },
            primaryColor: { type: Type.STRING, description: "Hex color code for main elements" },
            secondaryColor: { type: Type.STRING, description: "Hex color code for accents" },
            backgroundColor: { type: Type.STRING, description: "Hex color code for background. DO NOT USE PURE BLACK. Use dark colors like #111, #0a1020, #1a0505 etc." },
            particleSize: { type: Type.NUMBER, description: "0.1 to 2.0" },
            rotationSpeed: { type: Type.NUMBER, description: "0.0 to 2.0" },
            sensitivity: { type: Type.NUMBER, description: "Audio reactivity multiplier, 0.5 to 3.0" },
            bloomIntensity: { type: Type.NUMBER, description: "0.0 to 3.0" },
            description: { type: Type.STRING, description: "Short rationale for the design" }
          },
          required: ["mode", "primaryColor", "secondaryColor", "backgroundColor", "particleSize", "rotationSpeed", "sensitivity", "bloomIntensity", "description"]
        }
      }
    });

    if (response.text) {
      return JSON.parse(response.text) as VisualConfig;
    }
    return DEFAULT_CONFIG;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return DEFAULT_CONFIG;
  }
};