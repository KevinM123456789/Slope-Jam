import { useState, useCallback, useRef, useEffect } from "react";

export interface Participant {
  id: string;
  name: string;
  isSpeaking: boolean;
  isMuted: boolean;
  mutedByMe: boolean; // Whether the current user has muted this participant
}

interface UseAudioDuckingOptions {
  duckingLevel?: number; // 0-100, percentage to duck to when someone speaks
  fadeSpeed?: number; // ms for fade transition
}

export function useAudioDucking(options: UseAudioDuckingOptions = {}) {
  const { duckingLevel: initialDuckingLevel = 20, fadeSpeed = 150 } = options;

  const [isMuted, setIsMuted] = useState(false);
  const [musicVolume, setMusicVolume] = useState(100);
  const [duckingLevel, setDuckingLevel] = useState(initialDuckingLevel);
  const [isSomeoneSpeaking, setIsSomeoneSpeaking] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isPlaying, setIsPlaying] = useState(true);

  const targetVolumeRef = useRef(100);
  const animationRef = useRef<number | null>(null);

  // Simulated current track
  const [currentTrack] = useState({
    title: "Powder Day Vibes",
    artist: "Mountain Beats",
    albumArt: "/album-placeholder.jpg",
    duration: 234,
    currentTime: 67,
  });

  // Animate volume changes for smooth ducking
  const animateVolume = useCallback((target: number) => {
    targetVolumeRef.current = target;

    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const animate = () => {
      setMusicVolume((current) => {
        const diff = targetVolumeRef.current - current;
        if (Math.abs(diff) < 1) {
          return targetVolumeRef.current;
        }
        const step = diff * (fadeSpeed / 1000);
        animationRef.current = requestAnimationFrame(animate);
        return current + step;
      });
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [fadeSpeed]);

  // Handle ducking when speaking state changes
  useEffect(() => {
    if (isSomeoneSpeaking) {
      animateVolume(duckingLevel);
    } else {
      animateVolume(100);
    }
  }, [isSomeoneSpeaking, duckingLevel, animateVolume]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev);
  }, []);

  const togglePlayPause = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  // Toggle muting a specific participant (for the current user only)
  const toggleMuteParticipant = useCallback((participantId: string) => {
    setParticipants((prev) =>
      prev.map((p) =>
        p.id === participantId ? { ...p, mutedByMe: !p.mutedByMe } : p
      )
    );
  }, []);

  // Simulate voice activity detection
  const simulateSpeaking = useCallback((participantId: string, speaking: boolean) => {
    setParticipants((prev) =>
      prev.map((p) => (p.id === participantId ? { ...p, isSpeaking: speaking } : p))
    );
  }, []);

  // Update global speaking state based on non-muted participants only
  useEffect(() => {
    const unmutedSpeakers = participants.some(
      (p) => p.isSpeaking && !p.mutedByMe && p.id !== "user"
    );
    setIsSomeoneSpeaking(unmutedSpeakers);
  }, [participants]);

  // Initialize with only the current user (no placeholder users)
  useEffect(() => {
    setParticipants([
      { id: "user", name: "You", isSpeaking: false, isMuted: false, mutedByMe: false },
    ]);
  }, []);

  return {
    // State
    isMuted,
    musicVolume,
    duckingLevel,
    isSomeoneSpeaking,
    participants,
    isPlaying,
    currentTrack,

    // Actions
    toggleMute,
    togglePlayPause,
    setDuckingLevel,
    simulateSpeaking,
    toggleMuteParticipant,
  };
}
