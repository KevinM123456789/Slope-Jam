"use client";

import { use, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic,
  MicOff,
  ChevronLeft,
  Share2,
  Settings,
  Headphones,
  HeadphoneOff,
  LogOut,
} from "lucide-react";
import { useRoom } from "@/contexts/room-context";
import { useAudioDucking } from "@/hooks/use-audio-ducking";
import { useVoiceActivity } from "@/hooks/use-voice-activity";
import { usePeerVoice } from "@/hooks/use-peer-voice";
import { NowPlayingCard } from "@/components/now-playing-card";
import { ParticipantsList } from "@/components/participants-list";
import { DuckingSlider } from "@/components/ducking-slider";
import { PingOverlay } from "@/components/ping-overlay";

interface RoomPageProps {
  params: Promise<{ code: string }>;
}

export default function RoomPage({ params }: RoomPageProps) {
  const { code } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  // CRITICAL: Host status is ONLY determined by URL param from landing page
  // Once set, it should not change during the session
  const isHostParam = searchParams.get("host") === "true";
  const [isHostLocked] = useState(isHostParam); // Lock host status on mount
  
  const [showSettings, setShowSettings] = useState(false);
  const [copied, setCopied] = useState(false);
  const [micPermissionGranted, setMicPermissionGranted] = useState(false);
  const [micInitialized, setMicInitialized] = useState(false);
  const [showMicRetry, setShowMicRetry] = useState(false);
  // Track info received from host (for guests)
  const [guestTrack, setGuestTrack] = useState<{
    isPlaying: boolean;
    title?: string;
    artist?: string;
    album?: string;
    albumArt?: string;
  } | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const hasShownConnectedToast = useRef(false);
  const hasUserGesture = useRef(false);
  
  // Debug mode - show connection status
  const isDev = process.env.NODE_ENV === "development";

  // Room context
  const {
    localUser,
    setRoomCode,
    isHost,
    setIsHost,
    participants,
    addParticipant,
    removeParticipant,
    updateParticipant,
    isMuted,
    setIsMuted,
    isInFlowMode,
    setIsInFlowMode,
    lastPingFrom,
    clearPing,
  } = useRoom();

  // Set room code and host status on mount (using locked value)
  useEffect(() => {
    setRoomCode(code);
    setIsHost(isHostLocked);
  }, [code, isHostLocked, setRoomCode, setIsHost]);

  // Redirect if no local user
  useEffect(() => {
    if (!localUser) {
      router.push("/");
    }
  }, [localUser, router]);

  const {
    duckingLevel,
    isSomeoneSpeaking,
    isPlaying,
    musicVolume,
    togglePlayPause,
    setDuckingLevel,
  } = useAudioDucking();

  // Note: Spotify state is fully isolated in NowPlayingCard component
  // It uses its own useSpotify hook to prevent voice/mic components from re-rendering

  // Safe local user for hooks - ensures non-empty values
  const safeLocalUser = localUser ?? { 
    id: crypto.randomUUID(), 
    displayName: "Guest", 
    hasSpotify: false 
  };

  // WebRTC voice chat
  const {
    isConnected: isPeerConnected,
    isConnecting: isPeerConnecting,
    initializePeer,
    toggleMute: togglePeerMute,
    isMicMuted: isPeerMuted,
    broadcastSpeakingState,
    broadcastFlowMode,
    broadcastMuteState,
    broadcastTrackInfo,
    sendPingTo,
    participantCount,
    replaceLocalTrack,
    isHardwareMicMuted,
    error: peerError,
  } = usePeerVoice({
    roomCode: code,
    localUser: safeLocalUser,
    isHost: isHostLocked, // Use locked host status to prevent role collision
    onParticipantJoin: addParticipant,
    onParticipantLeave: removeParticipant,
    onParticipantUpdate: updateParticipant,
    onRemoteSpeaking: (peerId, isSpeaking) => {
      updateParticipant(peerId, { isSpeaking });
    },
    onPingReceived: (fromName) => {
      toast.info(`${fromName} is trying to reach you!`, {
        id: "ping-received",
        duration: 5000,
      });
      if (navigator.vibrate) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }
    },
    // Guests receive track info from host
    onTrackInfo: (track) => {
      if (!isHostLocked) {
        setGuestTrack(track);
      }
    },
  });

  // Voice activity detection for local auto-ducking (increased sensitivity)
  const {
    isMicEnabled,
    isSpeaking: isUserSpeaking,
    currentRMS,
    isAudioInterrupted,
    enableMic,
    disableMic,
    resumeAudioContext,
  } = useVoiceActivity({
    threshold: 0.008, // Lower threshold for better sensitivity at normal volumes
    speakingDelay: 150, // Faster response
    silenceDelay: 800, // Faster recovery
  });

  // Initialize microphone with iOS-compatible settings
  // iOS requires user gesture before AudioContext can be started
const initMic = useCallback(async () => {
  if (!localUser) return false;

  try {
    // Single getUserMedia call — shared between VAD and WebRTC
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: { ideal: 44100 },
        channelCount: { ideal: 1 },
      },
    });

    micStreamRef.current = stream;
    setMicPermissionGranted(true);
    setShowMicRetry(false);

    // Pass stream to VAD for analysis
    await enableMic(stream);
    
    // Pass same stream to WebRTC for transmission
    await initializePeer(stream);

    setMicInitialized(true);

    if (!hasShownConnectedToast.current) {
      hasShownConnectedToast.current = true;
      toast.success("Voice chat connected!", {
        id: "voice-connected",
        duration: 2000,
      });
    }

    return true;
  } catch (error) {
    setMicPermissionGranted(false);
    setShowMicRetry(true);

    if (error instanceof DOMException && error.name === "NotAllowedError") {
      toast.error("Microphone access blocked.", { id: "mic-blocked" });
    } else {
      toast.error("Failed to connect microphone.", { id: "mic-error" });
    }
    return false;
  }
}, [localUser, enableMic, initializePeer]);

  // Auto-enable microphone on mount (but only after user has interacted)
  // iOS Safari requires a user gesture before we can use AudioContext
  useEffect(() => {
    // Try to init if we already have permission from a previous session
    const tryAutoInit = async () => {
      if (!localUser) return;
      
      // Check if permission was already granted
      try {
        const permissionStatus = await navigator.permissions.query({ 
          name: "microphone" as PermissionName 
        });
        
        if (permissionStatus.state === "granted") {
          // Permission already granted, safe to auto-init
          await initMic();
        } else {
          // Need user gesture - show the retry button
          setShowMicRetry(true);
        }
      } catch {
        // permissions API not supported (Safari), try anyway
        // but set a flag so we know we might need user gesture
        setShowMicRetry(true);
        // Still try to init - if it fails, user will see retry button
        await initMic();
      }
    };

    tryAutoInit();

    return () => {
      // Cleanup mic stream on unmount
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync mute state with actual audio track and broadcast to peers
  useEffect(() => {
    if (micStreamRef.current) {
      micStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = !isMuted;
      });
    }
    // Also sync with peer mute
    if (isPeerMuted !== isMuted) {
      togglePeerMute();
    }
    // Broadcast mute state change to all peers so they see updated status
    if (isPeerConnected) {
      broadcastSpeakingState(!isMuted && isUserSpeaking);
    }
  }, [isMuted, isPeerMuted, togglePeerMute, isPeerConnected, broadcastSpeakingState, isUserSpeaking]);

  // Broadcast speaking state when it changes (only if not muted)
  useEffect(() => {
    if (isPeerConnected) {
      // Only broadcast speaking if not muted
      broadcastSpeakingState(isUserSpeaking && !isMuted);
    }
  }, [isUserSpeaking, isMuted, isPeerConnected, broadcastSpeakingState]);

  // Broadcast flow mode changes
  useEffect(() => {
    if (isPeerConnected) {
      broadcastFlowMode(isInFlowMode);
    }
  }, [isInFlowMode, isPeerConnected, broadcastFlowMode]);

  // Wake Lock API to prevent screen dimming + Audio Context resume on tab return
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;

    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch {
        // Wake lock not supported or denied
      }
    };

    requestWakeLock();

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        // Re-request wake lock
        requestWakeLock();
        
        // Resume audio context if it was suspended during tab switch
        if (typeof resumeAudioContext === "function") {
          await resumeAudioContext();
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      wakeLock?.release();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [resumeAudioContext]);

  // Handle mute toggle - also broadcast to peers for iOS sync
  const handleRestoreAudio = useCallback(async () => {
    try {
      await resumeAudioContext();
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micStreamRef.current = newStream;
      await enableMic(newStream);
      await replaceLocalTrack(newStream);
    } catch {
      toast.error("Failed to restore audio. Try rejoining.", { id: "audio-restore" });
    }
  }, [resumeAudioContext, enableMic, replaceLocalTrack]);
  const handleMuteToggle = useCallback(() => {
    const newMuteState = !isMuted;
    setIsMuted(newMuteState);
    
    // Broadcast mute state change to peers immediately
    if (isPeerConnected) {
      broadcastMuteState(newMuteState);
    }
    
    toast.info(newMuteState ? "Microphone muted" : "Microphone unmuted", { 
      id: "mute-toggle",
      duration: 1500 
    });
  }, [isMuted, setIsMuted, isPeerConnected, broadcastMuteState]);

  // Handle flow mode toggle
  const handleFlowModeToggle = useCallback(() => {
    setIsInFlowMode(!isInFlowMode);
    if (!isInFlowMode) {
      toast.info("Flow Mode ON - Audio muted, focus on riding", { 
        id: "flow-mode",
        duration: 3000 
      });
    } else {
      toast.info("Flow Mode OFF - Welcome back!", { id: "flow-mode" });
    }
  }, [isInFlowMode, setIsInFlowMode]);

  // Handle targeted ping to a specific participant
  const handlePingParticipant = useCallback((peerId: string) => {
    sendPingTo(peerId);
    toast.success("Ping sent!", { id: "ping-sent", duration: 1500 });
  }, [sendPingTo]);

  const handleShare = useCallback(async () => {
    const shareUrl = `${window.location.origin}/room/${code}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: "Join my Slope Jam",
          text: `Join my music session on Slope Jam! Room code: ${code}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    } else {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [code]);

  const handleLeave = useCallback(() => {
    // Cleanup
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
    }
    disableMic();
    router.push("/");
  }, [disableMic, router]);

  // Handle sign out - cleanup mic before signing out
  const handleSignOut = useCallback(async () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(track => track.stop());
    }
    disableMic();
    await signOut({ callbackUrl: "/" });
  }, [disableMic]);

  // Show loading state while user is being loaded from session storage
  if (!localUser) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-muted border-t-orange animate-spin" />
          <p className="text-muted-foreground">Loading room...</p>
        </div>
      </main>
    );
  }

  // Show error if connection failed
  if (peerError && !isPeerConnected && !isPeerConnecting) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
        <div className="flex flex-col items-center gap-4 text-center max-w-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <MicOff className="w-8 h-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-foreground">Connection Failed</h1>
          <p className="text-muted-foreground">{peerError}</p>
          <div className="flex gap-3 mt-4">
            <button
              onClick={() => router.push("/")}
              className="px-6 py-3 rounded-xl bg-muted text-foreground font-medium"
            >
              Go Home
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-xl bg-orange text-orange-foreground font-medium"
            >
              Try Again
            </button>
          </div>
        </div>
      </main>
    );
  }

  // Check if any remote participant is speaking (for cross-user ducking)
const isRemoteSpeaking = participants.some(
    (p) => p.peerId !== localUser.id && p.isSpeaking && !p.isInFlowMode
  );

  // Apply Spotify volume ducking when speaking state changes
  useEffect(() => {
    if (!isHostLocked || !localUser?.hasSpotify) return;
    const shouldDuck = isUserSpeaking || isRemoteSpeaking;
    const targetVolume = shouldDuck ? duckingLevel : 100;
    fetch("/api/spotify/volume", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volumePercent: targetVolume }),
    }).catch(() => {});
  }, [isUserSpeaking, isRemoteSpeaking, duckingLevel, isHostLocked, localUser?.hasSpotify]);

  // Voice activity is only shown when unmuted
  const showVoiceActivity = !isMuted && isUserSpeaking;

  return (
    <main className="min-h-screen bg-background flex flex-col safe-area-top safe-area-bottom">
      {/* Ping Overlay */}
      <AnimatePresence>
        {lastPingFrom && (
          <PingOverlay fromName={lastPingFrom} onDismiss={clearPing} />
        )}
      </AnimatePresence>

      {/* Header */}
      <header className="sticky top-0 z-50 flex items-center justify-between px-4 py-4 border-b border-border bg-background/95 backdrop-blur-sm">
        <button
          onClick={handleLeave}
          className="flex items-center gap-1 text-muted-foreground touch-target active:opacity-70 transition-opacity"
        >
          <ChevronLeft className="w-6 h-6" />
          <span className="text-sm font-medium">Leave</span>
        </button>

        <div className="flex flex-col items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Room</span>
            <div 
              className={`w-2 h-2 rounded-full ${
                isPeerConnected 
                  ? "bg-green-500 animate-pulse" 
                  : isPeerConnecting 
                    ? "bg-yellow-500 animate-pulse" 
                    : "bg-red-500"
              }`}
              title={isPeerConnected ? "Connected" : isPeerConnecting ? "Connecting..." : "Not connected"}
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-lg font-mono font-bold text-foreground tracking-wider">
              {code}
            </span>
            {isPeerConnected && participantCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {participantCount} in Jam
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Interactive Mic Toggle in Header */}
          <button
            onClick={handleMuteToggle}
            disabled={isInFlowMode}
            className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-all active:scale-95 ${
              isMuted
                ? "bg-red-500 text-white"
                : "bg-muted text-green-500"
            } ${isInFlowMode ? "opacity-50" : ""}`}
          >
            {!isMuted && isUserSpeaking && (
              <motion.div
                className="absolute inset-0 rounded-full bg-green-500/30"
                animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.2, 0.5] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}
            {isMuted ? (
              <MicOff className="w-5 h-5 relative z-10" />
            ) : (
              <Mic className="w-5 h-5 relative z-10" />
            )}
          </button>

          <button
            onClick={handleShare}
            className="flex items-center gap-1 text-blue touch-target active:opacity-70 transition-opacity"
          >
            <Share2 className="w-5 h-5" />
            <span className="text-sm font-medium">{copied ? "Copied!" : "Share"}</span>
          </button>

          {/* Sign Out Button */}
          <button
            onClick={handleSignOut}
            className="flex items-center gap-1 text-muted-foreground touch-target active:opacity-70 transition-opacity"
            title="Sign out of Spotify"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Flow Mode Banner */}
      <AnimatePresence>
        {isInFlowMode && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-blue/20 border-b border-blue/30 overflow-hidden"
          >
            <div className="flex items-center justify-center gap-2 py-3">
              <HeadphoneOff className="w-5 h-5 text-blue" />
              <span className="text-blue font-medium">Flow Mode - Audio Muted</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col px-4 py-6 gap-6 overflow-y-auto">
       {(isAudioInterrupted || isHardwareMicMuted) && (
          <button
            onClick={handleRestoreAudio}
            className="w-full py-3 rounded-xl bg-orange text-white font-semibold text-sm flex items-center justify-center gap-2 animate-pulse"
          >
            🎙️ Tap to restore voice audio
          </button>
        )}

        {localUser.hasSpotify && (
          <NowPlayingCard
            volume={musicVolume}
            isDucking={isSomeoneSpeaking || isRemoteSpeaking}
            isHost={isHostLocked}
            guestTrack={guestTrack}
            onTrackChange={(track) => {
              if (isHostLocked && isPeerConnected) {
                broadcastTrackInfo(track);
              }
            }}
          />
        )}

        <ParticipantsList
          participants={[
            {
              id: localUser.id,
              peerId: localUser.id,
              displayName: localUser.displayName,
              isHost,
              hasSpotify: localUser.hasSpotify,
              isSpeaking: showVoiceActivity,
              isMuted: isMuted,
              isInFlowMode,
            },
            ...participants,
          ]}
          onMuteParticipant={(peerId) => updateParticipant(peerId, { isMuted: true })}
          onPingParticipant={handlePingParticipant}
          isUserSpeaking={showVoiceActivity}
          localUserId={localUser.id}
          isPinged={!!lastPingFrom}
        />

        {/* Flow Mode Toggle */}
        <button
          onClick={handleFlowModeToggle}
          className={`w-full flex items-center justify-center gap-3 py-4 rounded-xl transition-all ${
            isInFlowMode
              ? "bg-blue text-blue-foreground"
              : "bg-card text-foreground border border-border"
          }`}
        >
          {isInFlowMode ? (
            <HeadphoneOff className="w-6 h-6" />
          ) : (
            <Headphones className="w-6 h-6" />
          )}
          <span className="font-medium">
            {isInFlowMode ? "Exit Flow Mode" : "Enter Flow Mode"}
          </span>
        </button>

        {/* Audio Settings */}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="flex items-center justify-between w-full bg-card rounded-xl p-4 touch-target"
        >
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-muted-foreground" />
            <span className="text-foreground font-medium">Audio Settings</span>
          </div>
          <span className="text-sm text-muted-foreground">
            Ducking: {duckingLevel}%
          </span>
        </button>

        {showSettings && (
          <DuckingSlider value={duckingLevel} onChange={setDuckingLevel} />
        )}
      </div>

      {/* Microphone Control - Fixed at bottom */}
      <div className="px-4 pb-6 pt-2 flex flex-col gap-3">
        {showMicRetry && !micInitialized && (
          <button
            onClick={async () => {
              hasUserGesture.current = true;
              await initMic();
            }}
            className="w-full flex items-center justify-center gap-3 py-4 rounded-xl bg-orange text-orange-foreground font-medium active:scale-[0.98] transition-transform"
          >
            <Mic className="w-5 h-5" />
            <span>Check Microphone</span>
          </button>
        )}

        <AnimatePresence>
          {isMicEnabled && !isMuted && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center justify-center gap-3"
            >
              <div className="flex items-center gap-2">
                <motion.div
                  className={`w-3 h-3 rounded-full ${
                    isUserSpeaking ? "bg-green-400" : "bg-muted"
                  }`}
                  animate={isUserSpeaking ? { scale: [1, 1.2, 1] } : {}}
                  transition={{ duration: 0.5, repeat: isUserSpeaking ? Infinity : 0 }}
                />
                <span className="text-sm text-muted-foreground">
                  {isUserSpeaking ? "Speaking" : "Listening"}
                </span>
              </div>
              <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  className={`h-full ${isUserSpeaking ? "bg-green-400" : "bg-muted-foreground/50"}`}
                  animate={{ width: `${Math.min(currentRMS * 800, 100)}%` }}
                  transition={{ duration: 0.05 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Large Mute Toggle Button */}
        <motion.button
          onClick={handleMuteToggle}
          disabled={isInFlowMode}
          className={`w-full flex items-center justify-center gap-4 py-6 rounded-2xl touch-target-xl transition-all active:scale-[0.98] ${
            isMuted
              ? "bg-red-500 text-white"
              : "bg-muted/80 text-muted-foreground"
          } ${isInFlowMode ? "opacity-50 cursor-not-allowed" : ""}`}
          animate={{
            boxShadow: !isMuted && isUserSpeaking
              ? "0 0 30px rgba(74, 222, 128, 0.5)"
              : "0 0 0px transparent",
          }}
        >
          <motion.div
            animate={{
              scale: !isMuted && isUserSpeaking ? [1, 1.1, 1] : 1,
            }}
            transition={{ duration: 0.5, repeat: !isMuted && isUserSpeaking ? Infinity : 0 }}
          >
            {isMuted ? (
              <MicOff className="w-10 h-10" />
            ) : (
              <Mic className="w-10 h-10" />
            )}
          </motion.div>
          <div className="flex flex-col items-start">
            <span className="text-2xl font-bold">
              {isMuted ? "MUTED" : "UNMUTED"}
            </span>
            <span className="text-sm opacity-80">
              {isInFlowMode
                ? "Exit Flow Mode to unmute"
                : isMuted
                ? "Tap to unmute"
                : localUser.hasSpotify
                ? `Music ducks to ${duckingLevel}% when speaking`
                : "Voice-only mode"}
            </span>
          </div>
        </motion.button>

        {/* Debug Panel - Only visible in development */}
        {isDev && (
          <div className="mt-4 p-3 rounded-xl bg-muted/50 text-xs font-mono space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Socket:</span>
              <span className={isPeerConnected ? "text-green-500" : "text-red-500"}>
                {isPeerConnected ? "Connected" : isPeerConnecting ? "Connecting..." : "Disconnected"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Session:</span>
              <span className={localUser ? "text-green-500" : "text-red-500"}>
                {localUser ? "Active" : "Inactive"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Role:</span>
              <span className="text-foreground">{isHostLocked ? "Host" : "Guest"}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Mic:</span>
              <span className={micPermissionGranted ? "text-green-500" : "text-red-500"}>
                {micPermissionGranted ? "Granted" : "Pending"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Peers:</span>
              <span className="text-foreground">{participantCount}</span>
            </div>
            {peerError && (
              <div className="text-red-500 text-[10px] break-all">Error: {peerError}</div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
