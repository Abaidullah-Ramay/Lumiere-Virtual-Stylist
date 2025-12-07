import React, { useEffect, useRef, useState, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { base64ToUint8Array, decodeAudioData, arrayBufferToBase64 } from '../services/audioUtils';
import { Product, UserLocation } from '../types';
import { displayProductsTool } from '../services/geminiService';

interface VoiceModeProps {
  isOpen: boolean;
  onClose: () => void;
  location: UserLocation;
  onProductsFound: (products: Product[]) => void;
  onUserTranscript: (text: string, isFinal: boolean) => void;
  onModelTranscript: (text: string, isFinal: boolean) => void;
}

const VoiceMode: React.FC<VoiceModeProps> = ({ 
  isOpen, 
  onClose, 
  location, 
  onProductsFound,
  onUserTranscript,
  onModelTranscript
}) => {
  // Refs for audio handling and session management
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const outputContextRef = useRef<AudioContext | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSessionRef = useRef<any>(null);
  const isMountedRef = useRef<boolean>(false);
  
  // Transcript buffers
  const userTranscriptBuffer = useRef<string>("");
  const modelTranscriptBuffer = useRef<string>("");

  // Clean up function
  const cleanup = useCallback(() => {
    // 1. Close the Gemini Session
    if (activeSessionRef.current) {
        try {
            activeSessionRef.current.close();
        } catch (e) {
            console.error("Error closing session:", e);
        }
        activeSessionRef.current = null;
    }

    // 2. Stop Audio Processing
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
    
    // 3. Stop Media Stream (Mic)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // 4. Close Audio Contexts
    if (audioContextRef.current) {
      if (audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      audioContextRef.current = null;
    }
    if (outputContextRef.current) {
      if (outputContextRef.current.state !== 'closed') {
        outputContextRef.current.close();
      }
      outputContextRef.current = null;
    }
    
    // 5. Reset Buffers
    userTranscriptBuffer.current = "";
    modelTranscriptBuffer.current = "";
    nextStartTimeRef.current = 0;
  }, []);

  useEffect(() => {
    isMountedRef.current = true;

    if (isOpen) {
      startLiveSession();
    } else {
      cleanup();
    }

    return () => {
      isMountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const startLiveSession = async () => {
    try {
      const apiKey = process.env.API_KEY;
      if (!apiKey) {
        console.error("API Key missing");
        if (isMountedRef.current) onClose();
        return;
      }
      
      const ai = new GoogleGenAI({ apiKey });
      
      // Setup Audio Contexts
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Ensure contexts are running
      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      audioContextRef.current = inputCtx;
      outputContextRef.current = outputCtx;
      
      // Get Mic Stream
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const modelId = 'gemini-2.5-flash-native-audio-preview-09-2025';

      // Connect to Live API
      // We capture the promise so we can send data to it, but we also store the result in activeSessionRef
      const sessionPromise = ai.live.connect({
        model: modelId,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are Lumiere, a stylist. The user is in ${location.city}. Talk about fashion. If you recommend items, use the tool 'displayProducts'.`,
          tools: [{ functionDeclarations: [displayProductsTool] }]
        },
        callbacks: {
          onopen: () => {
            console.log('Live Session Opened');
            
            if (!isMountedRef.current || !inputCtx || !streamRef.current) return;

            // Start streaming audio
            try {
                const source = inputCtx.createMediaStreamSource(streamRef.current);
                sourceRef.current = source;
                
                const processor = inputCtx.createScriptProcessor(4096, 1, 1);
                processorRef.current = processor;
                
                processor.onaudioprocess = (e) => {
                  if (!isMountedRef.current) return;
                  
                  const inputData = e.inputBuffer.getChannelData(0);
                  const l = inputData.length;
                  const int16 = new Int16Array(l);
                  for (let i = 0; i < l; i++) {
                    int16[i] = inputData[i] * 32768;
                  }
                  
                  const base64Data = arrayBufferToBase64(int16.buffer);
                  
                  // Send audio data only if session is ready
                  sessionPromise.then(session => {
                      if (isMountedRef.current) {
                          try {
                              session.sendRealtimeInput({
                                media: {
                                    mimeType: 'audio/pcm;rate=16000',
                                    data: base64Data
                                }
                              });
                          } catch (err) {
                              console.error("Error sending audio:", err);
                          }
                      }
                  });
                };
                
                source.connect(processor);
                processor.connect(inputCtx.destination);
            } catch (err) {
                console.error("Error initializing audio stream processing:", err);
            }
          },
          onmessage: async (msg: LiveServerMessage) => {
            if (!isMountedRef.current) return;

            try {
                // 1. Handle Transcripts
                const serverContent = msg.serverContent;
                if (serverContent) {
                    if (serverContent.inputTranscription) {
                        userTranscriptBuffer.current += serverContent.inputTranscription.text;
                        onUserTranscript(userTranscriptBuffer.current, false);
                    }
                    if (serverContent.outputTranscription) {
                        modelTranscriptBuffer.current += serverContent.outputTranscription.text;
                        onModelTranscript(modelTranscriptBuffer.current, false);
                    }
                    
                    if (serverContent.turnComplete) {
                        if (userTranscriptBuffer.current) {
                            onUserTranscript(userTranscriptBuffer.current, true);
                            userTranscriptBuffer.current = "";
                        }
                        if (modelTranscriptBuffer.current) {
                            onModelTranscript(modelTranscriptBuffer.current, true);
                            modelTranscriptBuffer.current = "";
                        }
                    }
                }

                // 2. Handle Audio Output
                const audioData = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (audioData && outputContextRef.current) {
                   const audioBuffer = await decodeAudioData(
                     base64ToUint8Array(audioData),
                     outputContextRef.current
                   );
                   
                   const src = outputContextRef.current.createBufferSource();
                   src.buffer = audioBuffer;
                   src.connect(outputContextRef.current.destination);
                   
                   const now = outputContextRef.current.currentTime;
                   // Ensure we don't schedule too far in the past or future if there was a gap
                   const startTime = Math.max(now, nextStartTimeRef.current);
                   
                   src.start(startTime);
                   nextStartTimeRef.current = startTime + audioBuffer.duration;
                }

                // 3. Handle Tool Calls
                if (msg.toolCall) {
                    for (const fc of msg.toolCall.functionCalls) {
                        if (fc.name === 'displayProducts') {
                            const products = (fc.args as any).products;
                            onProductsFound(products);
                            
                            sessionPromise.then(session => {
                                if (isMountedRef.current) {
                                    session.sendToolResponse({
                                        functionResponses: {
                                            id: fc.id,
                                            name: fc.name,
                                            response: { result: 'Products displayed to user.' }
                                        }
                                    });
                                }
                            });
                        }
                    }
                }
            } catch (err) {
                console.error("Error processing message:", err);
            }
          },
          onclose: () => {
            console.log('Live Session Closed');
            if (isMountedRef.current) {
                onClose();
            }
          },
          onerror: (err) => {
            console.error('Live Session Error', err);
            // Only close if it's a fatal error that stopped the session
            // Often retrying or ignoring transient errors is better
            // onClose(); 
          }
        }
      });
      
      // Store the active session object once it resolves
      const session = await sessionPromise;
      if (isMountedRef.current) {
          activeSessionRef.current = session;
      } else {
          // If we unmounted while connecting, close immediately
          session.close();
      }
      
    } catch (err) {
      console.error("Failed to start live session", err);
      if (isMountedRef.current) onClose();
    }
  };

  if (!isOpen) return null;

  return null;
};

export default VoiceMode;