"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface UseVoiceActivityOptions {
  threshold?: number; // RMS threshold for voice detection (0-1)
  speakingDelay?: number; // ms to wait before confirming speaking
  silenceDelay?: number; // ms to wait before confirming silence
  duckedVolume?: number; // Volume to duck to (0-100)
  normalVolume?: number; // Normal volume (0-100)
}

interface UseVoiceActivityReturn {
  isMicEnabled: boolean;
  isSpeaking: boolean;
  currentRMS: number;
  enableMic: (existingStream?: MediaStream) => Promise<boolean>;
  disableMic: () => void;
  toggleMic: () => Promise<boolean>;
  resumeAudioContext: () => Promise<void>; // Manual resume for tab switch
}

export function useVoiceActivity(
  options: UseVoiceActivityOptions = {}
): UseVoiceActivityReturn {
  const {
    threshold = 0.008, // Lower threshold for better sensitivity at normal speaking volumes
    speakingDelay = 150, // Faster response to voice
    silenceDelay = 800, // Slightly faster recovery
  } = options;

  const [isMicEnabled, setIsMicEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [currentRMS, setCurrentRMS] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const speakingStartTimeRef = useRef<number | null>(null);
  const silenceStartTimeRef = useRef<number | null>(null);
  const isCurrentlySpeakingRef = useRef(false);
  
  // Resume audio context when it gets suspended (happens on tab switch)
  const resumeAudioContext = useCallback(async () => {
    if (audioContextRef.current?.state === "suspended") {
      try {
        await audioContextRef.current.resume();
      } catch {
        // Failed to resume, will retry on next interaction
      }
    }
  }, []);

  // Volume control DISABLED - calling setVolume API can trigger Spotify Connect 
  // and steal playback from the mobile app. Visual-only ducking indicator for now.
  const handleVolumeChange = useCallback(
    (_shouldDuck: boolean) => {
      // NO-OP: Volume control disabled to prevent Spotify from taking over audio
      // The UI will still show ducking state visually via isSpeaking
    },
    []
  );

  const analyzeAudio = useCallback(() => {
    if (!analyserRef.current) return;

    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) for volume level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    setCurrentRMS(rms);

    const now = Date.now();
    const isAboveThreshold = rms > threshold;

    if (isAboveThreshold) {
      // Voice detected
      silenceStartTimeRef.current = null;

      if (!speakingStartTimeRef.current) {
        speakingStartTimeRef.current = now;
      } else if (
        now - speakingStartTimeRef.current >= speakingDelay &&
        !isCurrentlySpeakingRef.current
      ) {
        // Confirmed speaking after delay
        isCurrentlySpeakingRef.current = true;
        setIsSpeaking(true);
        handleVolumeChange(true);
      }
    } else {
      // Silence detected
      speakingStartTimeRef.current = null;

      if (isCurrentlySpeakingRef.current) {
        if (!silenceStartTimeRef.current) {
          silenceStartTimeRef.current = now;
        } else if (now - silenceStartTimeRef.current >= silenceDelay) {
          // Confirmed silence after delay
          isCurrentlySpeakingRef.current = false;
          setIsSpeaking(false);
          handleVolumeChange(false);
        }
      }
    }

    animationFrameRef.current = requestAnimationFrame(analyzeAudio);
  }, [threshold, speakingDelay, silenceDelay, handleVolumeChange]);

  const enableMic = useCallback(async (existingStream?: MediaStream): Promise<boolean> => {
    try {
      // Request mic with iOS-compatible settings
      // iOS Safari requires explicit constraints for proper audio session handling
      const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
  },
});

      // Create AudioContext - iOS requires this to be created after user gesture
      // Using standard sample rate for better iOS compatibility
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioContext = new AudioContextClass({
        latencyHint: "interactive",
      });

      // iOS: Must resume AudioContext after user gesture
      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      // Auto-resume if iOS suspends the context when Spotify starts playing
      audioContext.addEventListener("statechange", () => {
        if (audioContext.state === "suspended") {
          audioContext.resume().catch(() => {});
        }
      });
      
      const analyser = audioContext.createAnalyser();
      // Larger FFT for better buffering and less CPU
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.5;
      analyser.minDecibels = -85;
      analyser.maxDecibels = -10;

      // Clone the stream for analysis so the original stays available for WebRTC
const analysisStream = existingStream ? existingStream.clone() : stream;
const source = audioContext.createMediaStreamSource(analysisStream);
      source.connect(analyser);
      // Don't connect to destination - we only analyze, prevents iOS audio session conflicts

     audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      streamRef.current = stream;

      // Re-enable mic track if iOS mutes it during audio session reconfiguration
      stream.getAudioTracks().forEach((track) => {
        track.onmute = () => {
          track.enabled = true;
        };
      });

      setIsMicEnabled(true);

      // Start analyzing
      animationFrameRef.current = requestAnimationFrame(analyzeAudio);

      return true;
    } catch (error) {
      console.error("Failed to enable microphone:", error);
      return false;
    }
  }, [analyzeAudio]);

  const disableMic = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    // Stop audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    analyserRef.current = null;
    speakingStartTimeRef.current = null;
    silenceStartTimeRef.current = null;
    isCurrentlySpeakingRef.current = false;

    setIsMicEnabled(false);
    setIsSpeaking(false);
    setCurrentRMS(0);
  }, []);

  const toggleMic = useCallback(async (): Promise<boolean> => {
    if (isMicEnabled) {
      disableMic();
      return false;
    } else {
      return enableMic();
    }
  }, [isMicEnabled, enableMic, disableMic]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return {
    isMicEnabled,
    isSpeaking,
    currentRMS,
    enableMic,
    disableMic,
    toggleMic,
    resumeAudioContext,
  };
}
