import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, Mic, MicOff, Volume2, Loader2 } from 'lucide-react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, arrayBufferToBase64 } from '../services/audioUtils';
import { Product, UserLocation } from '../types';
import { displayProductsTool } from '../services/geminiService';

interface VoiceModeProps {
  isOpen: boolean;
  onClose: () => void;
  location: UserLocation;
  onProductsFound: (products: Product[]) => void;
}

const VoiceMode: React.FC<VoiceModeProps> = ({ isOpen, onClose, location, onProductsFound }) => {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState<number>(0); // For visualization

  // Refs for audio handling
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const sessionRef = useRef<any>(null); // To hold the live session
  
  // Clean up function
  const cleanup = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (outputContextRef.current) {
      outputContextRef.current.close();
      outputContextRef.current = null;
    }
    // Note: session.close() is not strictly typed in all versions but we should try
    // Assuming sessionRef.current doesn't expose close explicitly in provided types, 
    // usually we just drop the connection.
    sessionRef.current = null;
    
    setIsConnected(false);
    setIsConnecting(false);
    setVolume(0);
  }, []);

  useEffect(() => {
    if (isOpen) {
      startLiveSession();
    } else {
      cleanup();
    }
    return () => {
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const startLiveSession = async () => {
    setIsConnecting(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      
      // Setup Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      audioContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      
      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const modelId = 'gemini-2.5-flash-native-audio-preview-09-2025';

      const sessionPromise = ai.live.connect({
        model: modelId,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          // Fixed: systemInstruction as simple string
          systemInstruction: `You are Lumière, a stylist. The user is in ${location.city}. Talk about fashion. If you recommend items, use the tool 'displayProducts'.`,
          tools: [{ functionDeclarations: [displayProductsTool] }]
        },
        callbacks: {
          onopen: () => {
            console.log('Live Session Opened');
            setIsConnected(true);
            setIsConnecting(false);
            
            // Start streaming audio
            const source = inputCtx.createMediaStreamSource(stream);
            sourceRef.current = source;
            
            // Use ScriptProcessor for raw PCM access (Standard for this API usage)
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processorRef.current = processor;
            
            processor.onaudioprocess = (e) => {
              if (isMuted) return; // Simple software mute
              
              const inputData = e.inputBuffer.getChannelData(0);
              
              // Visualization data
              let sum = 0;
              for(let i=0; i<inputData.length; i+=100) sum += Math.abs(inputData[i]);
              setVolume(Math.min(1, sum / (inputData.length/100) * 5));

              // Convert Float32 to Int16 for Gemini
              const l = inputData.length;
              const int16 = new Int16Array(l);
              for (let i = 0; i < l; i++) {
                int16[i] = inputData[i] * 32768;
              }
              
              const base64Data = arrayBufferToBase64(int16.buffer);
              
              sessionPromise.then(session => {
                  session.sendRealtimeInput({
                    media: {
                        mimeType: 'audio/pcm;rate=16000',
                        data: base64Data
                    }
                  });
              });
            };
            
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (msg: LiveServerMessage) => {
            // Handle Audio Output
            const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (audioData && outputCtx) {
               const audioBuffer = await decodeAudioData(
                 base64ToUint8Array(audioData),
                 outputCtx
               );
               
               const src = outputCtx.createBufferSource();
               src.buffer = audioBuffer;
               src.connect(outputCtx.destination);
               
               const now = outputCtx.currentTime;
               // Ensure gapless playback
               const startTime = Math.max(now, nextStartTimeRef.current);
               src.start(startTime);
               nextStartTimeRef.current = startTime + audioBuffer.duration;
            }

            // Handle Tool Calls (Recommendations)
            if (msg.toolCall) {
                for (const fc of msg.toolCall.functionCalls) {
                    if (fc.name === 'displayProducts') {
                        const products = (fc.args as any).products;
                        onProductsFound(products);
                        
                        // Send success response
                        sessionPromise.then(session => {
                            session.sendToolResponse({
                                functionResponses: {
                                    id: fc.id,
                                    name: fc.name,
                                    response: { result: 'Products displayed to user.' }
                                }
                            });
                        });
                    }
                }
            }
          },
          onclose: () => {
            console.log('Live Session Closed');
            cleanup();
          },
          onerror: (err) => {
            console.error('Live Session Error', err);
            cleanup();
          }
        }
      });
      
      sessionRef.current = sessionPromise;
      
    } catch (err) {
      console.error("Failed to start live session", err);
      setIsConnecting(false);
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="bg-lux-dark border border-lux-gray rounded-2xl p-8 w-full max-w-md flex flex-col items-center shadow-2xl animate-in fade-in zoom-in duration-300">
        <div className="flex justify-between w-full mb-8">
          <h2 className="text-xl font-serif text-lux-gold">Lumière Live</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Visualizer Circle */}
        <div className="relative w-32 h-32 flex items-center justify-center mb-8">
            {isConnecting ? (
                <Loader2 className="w-12 h-12 text-lux-gold animate-spin" />
            ) : (
                <>
                <div 
                    className="absolute inset-0 rounded-full bg-lux-gold opacity-20 transition-transform duration-75"
                    style={{ transform: `scale(${1 + volume})` }}
                />
                <div 
                    className="absolute inset-2 rounded-full bg-lux-gold opacity-30 transition-transform duration-100"
                    style={{ transform: `scale(${1 + volume * 0.7})` }}
                />
                <div className="z-10 bg-black rounded-full p-6 border-2 border-lux-gold">
                    <Mic className="w-8 h-8 text-lux-gold" />
                </div>
                </>
            )}
        </div>

        <p className="text-center text-gray-300 mb-8">
          {isConnecting ? 'Connecting to Stylist...' : 'Listening... Speak naturally to discuss trends, prices, and ideas.'}
        </p>

        <div className="flex gap-4">
          <button 
            onClick={() => setIsMuted(!isMuted)}
            className={`p-4 rounded-full border ${isMuted ? 'bg-red-500/20 border-red-500 text-red-500' : 'bg-lux-gray border-gray-600 text-white hover:bg-gray-700'}`}
          >
            {isMuted ? <MicOff /> : <Mic />}
          </button>
          <button 
            onClick={onClose}
            className="p-4 rounded-full bg-red-600 hover:bg-red-700 text-white transition-colors"
          >
            <X />
          </button>
        </div>
      </div>
    </div>
  );
};

export default VoiceMode;