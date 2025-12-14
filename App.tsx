import React, { useState, useRef, useEffect, useCallback } from 'react';
import ThreeScene from './components/ThreeScene';
import { generateVisualConfig } from './services/geminiService';
import { VisualConfig, VisualizerMode, AudioData, GeometryType } from './types';
import { Mic, Upload, Play, Pause, Wand2, Music2, Loader2, Shapes, ChevronLeft, ChevronRight, Activity } from 'lucide-react';

// Default initial state
const INITIAL_CONFIG: VisualConfig = {
  mode: VisualizerMode.Ferrofluid, // Start with the new cool mode
  geometryType: GeometryType.Sphere,
  primaryColor: "#00d4ff",
  secondaryColor: "#ff0055",
  backgroundColor: "#2a1b3d", 
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
  
  // Data ref
  const audioDataRef = useRef<AudioData>({
    frequencyData: new Uint8Array(128),
    overallAmplitude: 0,
    bass: 0,
    mid: 0,
    treble: 0
  });

  const requestRef = useRef<number>(0);

  // --- Manual Controls ---
  const cycleMode = (direction: 'left' | 'right') => {
    const modes = Object.values(VisualizerMode);
    const currentIndex = modes.indexOf(config.mode);
    let newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0) newIndex = modes.length - 1;
    if (newIndex >= modes.length) newIndex = 0;
    
    setConfig(prev => ({ ...prev, mode: modes[newIndex] }));
  };

  const cycleGeometry = (direction: 'left' | 'right') => {
    const geometries = Object.values(GeometryType);
    const currentIndex = geometries.indexOf(config.geometryType);
    let newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex < 0) newIndex = geometries.length - 1;
    if (newIndex >= geometries.length) newIndex = 0;
    
    setConfig(prev => ({ ...prev, geometryType: geometries[newIndex] }));
  };


  // --- Audio Engine Setup ---
  const initAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioContext();
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 512;
      analyserRef.current.smoothingTimeConstant = 0.8;
    }
    return { ctx: audioContextRef.current, analyser: analyserRef.current };
  };

  const cleanupAudio = () => {
    if (audioElemRef.current) {
      audioElemRef.current.pause();
      audioElemRef.current.src = "";
      audioElemRef.current.load();
    }
    if (sourceNodeRef.current) {
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    setIsPlaying(false);
  };

  const handleMicInput = async () => {
    try {
      cleanupAudio(); 

      const { ctx, analyser } = initAudioContext();
      if (!ctx || !analyser) return;

      if (ctx.state === 'suspended') await ctx.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
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

    cleanupAudio();

    const newAudio = new Audio(URL.createObjectURL(file));
    audioElemRef.current = newAudio;
    
    setAudioName(file.name);
    setupFileSource();

    e.target.value = '';
  };

  const setupFileSource = async () => {
    if (!audioElemRef.current) return;
    
    const { ctx, analyser } = initAudioContext();
    if (!ctx || !analyser) return;

    if (ctx.state === 'suspended') await ctx.resume();

    try {
      const source = ctx.createMediaElementSource(audioElemRef.current);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      sourceNodeRef.current = source;
      
      setSourceType('file');
      
      await audioElemRef.current.play();
      setIsPlaying(true);
      startAnalysisLoop();
    } catch (e) {
      console.error("Error setting up file source:", e);
    }

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

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
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
                    cleanupAudio();
                    setSourceType(null);
                  }} className="text-xs text-gray-400 hover:text-white underline ml-2">
                    Change Source
                  </button>
                </div>
             )}
          </div>
        </div>

        {/* Center Prompt Area (Bottom) */}
        <div className="pointer-events-auto w-full max-w-2xl mx-auto mb-8">
           
           {/* Info Display & Controls */}
           <div className="flex justify-between items-end mb-4 px-2">
              <div className="text-right ml-auto">
                 <div className="text-[10px] text-gray-200 uppercase tracking-widest mb-1 shadow-black drop-shadow-md font-semibold">Config</div>
                 
                 <div className="flex items-center gap-4 justify-end">
                    
                    {/* Geometry Switcher */}
                    <div className="flex items-center gap-1 bg-black/30 backdrop-blur-sm rounded-lg border border-white/5 p-1 hover:border-white/20 transition-colors">
                      <button onClick={() => cycleGeometry('left')} className="p-1 hover:text-cyan-400 text-gray-400"><ChevronLeft className="w-3 h-3" /></button>
                      <div className="flex items-center gap-1.5 opacity-90 px-2 min-w-[100px] justify-center">
                          <Shapes className="w-3 h-3 text-gray-300" />
                          <span className="text-xs font-mono text-gray-200 tracking-wider">{config.geometryType}</span>
                      </div>
                      <button onClick={() => cycleGeometry('right')} className="p-1 hover:text-cyan-400 text-gray-400"><ChevronRight className="w-3 h-3" /></button>
                    </div>

                    <div className="w-[1px] h-3 bg-white/20"></div>

                    {/* Mode Switcher */}
                    <div className="flex items-center gap-1 bg-black/30 backdrop-blur-sm rounded-lg border border-white/5 p-1 hover:border-white/20 transition-colors">
                      <button onClick={() => cycleMode('left')} className="p-1 hover:text-cyan-400 text-gray-400"><ChevronLeft className="w-3 h-3" /></button>
                      <div className="flex items-center gap-2 justify-center px-2 min-w-[120px]">
                        <Activity className="w-3 h-3" style={{color: config.primaryColor}} />
                        <span className="text-sm font-bold font-mono drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]" style={{color: config.primaryColor}}>
                          {config.mode}
                        </span>
                      </div>
                      <button onClick={() => cycleMode('right')} className="p-1 hover:text-cyan-400 text-gray-400"><ChevronRight className="w-3 h-3" /></button>
                    </div>
                 </div>

                 <p className="text-xs text-white mt-2 max-w-xs text-right opacity-90 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">{config.description}</p>
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
                    placeholder="Describe the vibe... (e.g. 'Liquid metal bass', 'Soft clouds', 'Geometric tech')"
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