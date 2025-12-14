import React, { useState, useRef, useEffect, useCallback } from 'react';
import ThreeScene from './components/ThreeScene';
import { generateVisualConfig } from './services/geminiService';
import { VisualConfig, VisualizerMode, AudioData } from './types';
import { Mic, Upload, Play, Pause, Wand2, Music2, Loader2, Volume2 } from 'lucide-react';

// Default initial state
const INITIAL_CONFIG: VisualConfig = {
  mode: VisualizerMode.Orbit,
  primaryColor: "#00d4ff",
  secondaryColor: "#ff0055",
  backgroundColor: "#1a0b2e", // Deep purple/blue start
  particleSize: 0.6,
  rotationSpeed: 0.5,
  sensitivity: 1.2,
  bloomIntensity: 1.2,
  description: "Initialize visuals..."
};

const App: React.FC = () => {
  // Application State
  const [config, setConfig] = useState<VisualConfig>(INITIAL_CONFIG);
  const [prompt, setPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceType, setSourceType] = useState<'mic' | 'file' | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);

  // Audio References
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | MediaElementAudioSourceNode | null>(null);
  const audioElemRef = useRef<HTMLAudioElement | null>(null);
  
  // Data ref to share with ThreeJS loop without re-renders
  const audioDataRef = useRef<AudioData>({
    frequencyData: new Uint8Array(128),
    overallAmplitude: 0,
    bass: 0,
    mid: 0,
    treble: 0
  });

  const requestRef = useRef<number>(0);

  // --- Audio Engine Setup ---
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512; // Controls resolution of frequency data
      analyserRef.current.smoothingTimeConstant = 0.8;
    }
    return { ctx: audioContextRef.current, analyser: analyserRef.current };
  };

  const handleMicInput = async () => {
    try {
      const { ctx, analyser } = initAudioContext();
      if (!ctx || !analyser) return;

      if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      // Cleanup previous
      if (sourceNodeRef.current) sourceNodeRef.current.disconnect();

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      
      sourceNodeRef.current = source;
      setSourceType('mic');
      setIsPlaying(true);
      setAudioName("Microphone Input");
      startAnalysisLoop();
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Could not access microphone. Please check permissions.");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (audioElemRef.current) {
      audioElemRef.current.pause();
      audioElemRef.current.src = URL.createObjectURL(file);
    } else {
      audioElemRef.current = new Audio(URL.createObjectURL(file));
    }
    
    setAudioName(file.name);
    setupFileSource();
  };

  const setupFileSource = async () => {
    if (!audioElemRef.current) return;
    
    const { ctx, analyser } = initAudioContext();
    if (!ctx || !analyser) return;

    if (ctx.state === 'suspended') await ctx.resume();

    if (!sourceNodeRef.current || sourceType !== 'file') {
       try {
         const source = ctx.createMediaElementSource(audioElemRef.current);
         source.connect(analyser);
         analyser.connect(ctx.destination);
         sourceNodeRef.current = source;
       } catch (e) {
         // Likely already connected
       }
    }

    setSourceType('file');
    audioElemRef.current.play().then(() => {
      setIsPlaying(true);
      startAnalysisLoop();
    }).catch(e => console.error(e));

    audioElemRef.current.onended = () => setIsPlaying(false);
  };

  const togglePlayPause = () => {
    if (sourceType === 'file' && audioElemRef.current) {
      if (isPlaying) {
        audioElemRef.current.pause();
        setIsPlaying(false);
      } else {
        audioElemRef.current.play();
        setIsPlaying(true);
      }
    } else if (sourceType === 'mic') {
      setIsPlaying(!isPlaying);
      if (!isPlaying && audioContextRef.current?.state === 'suspended') {
        audioContextRef.current.resume();
      }
    }
  };

  // --- Audio Analysis Loop ---
  const startAnalysisLoop = useCallback(() => {
    const analyse = () => {
      if (!analyserRef.current) return;

      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      analyserRef.current.getByteFrequencyData(dataArray);

      let sum = 0;
      let bassSum = 0;
      let midSum = 0;
      let trebleSum = 0;

      const bassLimit = Math.floor(bufferLength * 0.1); 
      const midLimit = Math.floor(bufferLength * 0.5);

      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
        if (i < bassLimit) bassSum += dataArray[i];
        else if (i < midLimit) midSum += dataArray[i];
        else trebleSum += dataArray[i];
      }

      audioDataRef.current = {
        frequencyData: dataArray,
        overallAmplitude: sum / bufferLength,
        bass: bassSum / bassLimit,
        mid: midSum / (midLimit - bassLimit),
        treble: trebleSum / (bufferLength - midLimit)
      };

      requestRef.current = requestAnimationFrame(analyse);
    };
    requestRef.current = requestAnimationFrame(analyse);
  }, []);

  useEffect(() => {
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // --- Gemini Generation ---
  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    
    // Simulate thinking time if API is fast
    const configResult = await generateVisualConfig(prompt);
    
    setConfig(configResult);
    setIsGenerating(false);
  };

  return (
    <div className="relative w-full h-screen overflow-hidden selection:bg-cyan-500 selection:text-black">
      
      {/* 3D Visualizer Background */}
      <ThreeScene config={config} audioDataRef={audioDataRef} />

      {/* UI Overlay */}
      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">
        
        {/* Header */}
        <div className="pointer-events-auto flex justify-between items-start">
          <div>
            <h1 className="text-4xl font-bold tracking-tighter text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
              FERRO
            </h1>
            <p className="text-xs text-gray-200 mt-1 tracking-widest uppercase opacity-80 drop-shadow-md">
              Generative Audio Visualizer
            </p>
          </div>

          <div className="flex gap-2">
             {/* Source Controls */}
             {!sourceType ? (
                <div className="flex gap-2">
                   <button 
                    onClick={handleMicInput}
                    className="flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md border border-white/10 hover:border-cyan-500 rounded-lg text-white transition-all text-sm font-medium hover:shadow-[0_0_15px_rgba(6,182,212,0.5)]"
                  >
                    <Mic className="w-4 h-4" /> Use Mic
                  </button>
                  <label className="cursor-pointer flex items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-md border border-white/10 hover:border-cyan-500 rounded-lg text-white transition-all text-sm font-medium hover:shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                    <Upload className="w-4 h-4" /> Upload MP3
                    <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" />
                  </label>
                </div>
             ) : (
                <div className="flex items-center gap-3 bg-black/60 backdrop-blur-md px-4 py-2 rounded-lg border border-white/10 shadow-lg">
                  <div className="flex flex-col">
                    <span className="text-[10px] text-gray-300 uppercase tracking-wider">Now Playing</span>
                    <span className="text-sm font-semibold max-w-[150px] truncate">{audioName || "Unknown Source"}</span>
                  </div>
                  <div className="h-8 w-[1px] bg-white/20 mx-1"></div>
                  <button onClick={togglePlayPause} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                    {isPlaying ? <Pause className="w-5 h-5 text-cyan-400" /> : <Play className="w-5 h-5 text-white" />}
                  </button>
                  <button onClick={() => {
                    setSourceType(null);
                    setIsPlaying(false);
                    if(audioElemRef.current) audioElemRef.current.pause();
                    if(sourceNodeRef.current) sourceNodeRef.current.disconnect();
                  }} className="text-xs text-gray-400 hover:text-white underline ml-2">
                    Change Source
                  </button>
                </div>
             )}
          </div>
        </div>

        {/* Center Prompt Area (Bottom) */}
        <div className="pointer-events-auto w-full max-w-2xl mx-auto mb-8">
           
           {/* Info Display */}
           <div className="flex justify-between items-end mb-4 px-2">
              <div className="text-right ml-auto">
                 <div className="text-[10px] text-gray-200 uppercase tracking-widest mb-1 shadow-black drop-shadow-md font-semibold">Current Mode</div>
                 <div className="flex items-center gap-2 justify-end">
                    <div className="w-2 h-2 rounded-full shadow-lg" style={{backgroundColor: config.primaryColor, boxShadow: `0 0 10px ${config.primaryColor}`}}></div>
                    <span className="text-lg font-bold font-mono drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" style={{color: config.primaryColor}}>{config.mode}</span>
                 </div>
                 <p className="text-xs text-white mt-1 max-w-xs text-right opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{config.description}</p>
              </div>
           </div>

           {/* Input Bar */}
           <div className="relative group shadow-2xl">
              <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-purple-600 rounded-xl opacity-50 blur group-hover:opacity-100 transition duration-500"></div>
              <div className="relative flex items-center bg-black/80 backdrop-blur-xl rounded-xl p-1 border border-white/10">
                 <div className="pl-4">
                    <Wand2 className={`w-5 h-5 ${isGenerating ? 'text-purple-400 animate-pulse' : 'text-gray-400'}`} />
                 </div>
                 <input 
                    type="text" 
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
                    placeholder="Describe the vibe... (e.g. 'Sunset over ocean', 'Neon cyberpunk city', 'Morning mist')"
                    className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-gray-400 px-4 py-3 font-medium outline-none"
                    disabled={isGenerating}
                 />
                 <button 
                    onClick={handleGenerate}
                    disabled={isGenerating || !prompt}
                    className="px-6 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 border border-white/5"
                 >
                    {isGenerating ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" /> Generating
                      </>
                    ) : (
                      "Transform"
                    )}
                 </button>
              </div>
           </div>
        </div>

      </div>

      {/* Intro Overlay if no source selected */}
      {!sourceType && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 bg-black/10 backdrop-blur-[2px]">
           <div className="text-center opacity-60">
              <Music2 className="w-24 h-24 mx-auto mb-4 text-white drop-shadow-lg" />
              <p className="text-xl font-light tracking-widest uppercase text-white drop-shadow-md">Waiting for Audio Input</p>
           </div>
        </div>
      )}
    </div>
  );
};

export default App;