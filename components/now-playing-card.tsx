"use client";

import { useState, useCallback, memo, useRef, useEffect } from "react";
import { 
  Play, 
  Pause, 
  SkipForward, 
  SkipBack,
  Volume2, 
  VolumeX, 
  Music, 
  Music2, 
  ExternalLink, 
  Loader2 
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useSpotify, type SpotifyTrack } from "@/hooks/use-spotify";
import Image from "next/image";

interface NowPlayingCardProps {
  volume: number;
  isDucking: boolean;
}

// Remote control API - sends commands to user's Spotify app (no playback transfer)
async function controlPlayback(action: "play" | "pause" | "next" | "previous"): Promise<boolean> {
  try {
    const response = await fetch("/api/spotify/control", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
body: JSON.stringify({ action }),
    });
    return response.ok;
  } catch (error) {
    console.error("Playback control error:", error);
    return false;
  }
}

// Memoized track display to prevent re-renders from parent state changes
const TrackDisplay = memo(function TrackDisplay({ 
  track, 
  isDucking,
  volume,
}: { 
  track: SpotifyTrack;
  isDucking: boolean;
  volume: number;
}) {
  return (
    <div className="flex gap-4">
      {/* Album Art */}
      <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center shrink-0 overflow-hidden relative">
        {track.albumArt ? (
          <Image
            src={track.albumArt}
            alt={track.album || "Album art"}
            fill
            className="object-cover"
            unoptimized
          />
        ) : (
          <Music className="w-8 h-8 text-muted-foreground" />
        )}
      </div>

      {/* Track Info */}
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-semibold text-foreground truncate">
          {track.title || "Unknown Track"}
        </h3>
        <p className="text-sm text-muted-foreground truncate">{track.artist || "Unknown Artist"}</p>

        {/* Volume indicator */}
        <div className="flex items-center gap-2 mt-2">
          {isDucking ? (
            <VolumeX className="w-3.5 h-3.5 text-blue" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
          )}
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-[100px]">
            <div
              className={`h-full rounded-full transition-all duration-150 ${
                isDucking ? "bg-blue" : "bg-[#1DB954]"
              }`}
              style={{ width: `${volume}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            {Math.round(volume)}%
          </span>
        </div>
      </div>
    </div>
  );
});

function NowPlayingCardInner({
  volume,
  isDucking,
}: NowPlayingCardProps) {
  const { status } = useSession();
  const { track, isLoading, mutate } = useSpotify({ enabled: true });
  const [isControlling, setIsControlling] = useState(false);
  const [activeButton, setActiveButton] = useState<string | null>(null);

  // Handle play/pause - remote control only
  const handlePlayPause = useCallback(async () => {
    if (isControlling) return;
    setIsControlling(true);
    setActiveButton("playPause");
    
    const action = track.isPlaying ? "pause" : "play";
    const success = await controlPlayback(action);
    
    if (success) {
      setTimeout(() => mutate(), 300);
    }
    
    setIsControlling(false);
    setActiveButton(null);
  }, [isControlling, track.isPlaying, mutate]);

  // Handle skip next - remote control only
  const handleNext = useCallback(async () => {
    if (isControlling) return;
    setIsControlling(true);
    setActiveButton("next");
    
    const success = await controlPlayback("next");
    
    if (success) {
      setTimeout(() => mutate(), 500);
    }
    
    setIsControlling(false);
    setActiveButton(null);
  }, [isControlling, mutate]);

  // Handle skip previous - remote control only
  const handlePrevious = useCallback(async () => {
    if (isControlling) return;
    setIsControlling(true);
    setActiveButton("previous");
    
    const success = await controlPlayback("previous");
    
    if (success) {
      setTimeout(() => mutate(), 500);
    }
    
    setIsControlling(false);
    setActiveButton(null);
  }, [isControlling, mutate]);

  // Handle manual resume when track exists but is paused
  const handleResume = useCallback(async () => {
    if (isControlling) return;
    setIsControlling(true);
    setActiveButton("resume");
    
    const success = await controlPlayback("play");
    
    if (success) {
      setTimeout(() => mutate(), 300);
    }
    
    setIsControlling(false);
    setActiveButton(null);
  }, [isControlling, mutate]);

  // Not authenticated - show info message (NO redirect button)
  if (status !== "authenticated") {
    return (
      <div className="bg-card rounded-2xl p-6">
        <div className="flex flex-col items-center justify-center gap-3 py-4">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center">
            <Music2 className="w-7 h-7 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="text-muted-foreground text-sm">
              Connect Spotify from the home page
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl p-6">
        <div className="flex items-center gap-4 animate-pulse">
          <div className="w-20 h-20 rounded-xl bg-muted" />
          <div className="flex-1">
            <div className="h-5 bg-muted rounded w-3/4 mb-2" />
            <div className="h-4 bg-muted rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }

  // Not playing anything and no track info - show Open Spotify button
  if (!track.isPlaying && !track.title) {
    return (
      <div className="bg-card rounded-2xl p-6">
        <div className="flex flex-col items-center justify-center gap-4 py-4">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center">
            <Music className="w-7 h-7 text-muted-foreground" />
          </div>
          <div className="text-center">
            <h3 className="text-base font-semibold text-foreground mb-1">Nothing Playing</h3>
            <p className="text-muted-foreground text-sm">Start music in your Spotify app</p>
          </div>
          <a
            href="spotify://"
            className="flex items-center justify-center gap-2 py-2.5 px-5 rounded-full bg-[#1DB954] text-white font-medium text-sm active:scale-[0.98] transition-transform"
          >
            <ExternalLink className="w-4 h-4" />
            Open Spotify
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl p-4 relative overflow-hidden">
      {/* Ducking indicator overlay */}
      {isDucking && (
        <div className="absolute inset-0 bg-blue/10 pointer-events-none" />
      )}

      {/* Memoized track display - prevents re-renders */}
      <TrackDisplay track={track} isDucking={isDucking} volume={volume} />

      {/* Playback Controls - Remote control buttons */}
      <div className="flex items-center justify-center gap-4 mt-4">
        {/* Skip Previous */}
        <button 
          onClick={handlePrevious}
          disabled={isControlling}
          className="w-11 h-11 rounded-full bg-muted text-foreground flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          aria-label="Previous track"
        >
          {activeButton === "previous" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <SkipBack className="w-5 h-5" />
          )}
        </button>

        {/* Play/Pause */}
        <button
          onClick={handlePlayPause}
          disabled={isControlling}
          className="w-14 h-14 rounded-full bg-[#1DB954] text-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-70"
          aria-label={track.isPlaying ? "Pause" : "Play"}
        >
          {activeButton === "playPause" ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : track.isPlaying ? (
            <Pause className="w-7 h-7" />
          ) : (
            <Play className="w-7 h-7 ml-1" />
          )}
        </button>

        {/* Skip Next */}
        <button 
          onClick={handleNext}
          disabled={isControlling}
          className="w-11 h-11 rounded-full bg-muted text-foreground flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
          aria-label="Next track"
        >
          {activeButton === "next" ? (
            <Loader2 className="w-5 h-5 animate-spin" />
          ) : (
            <SkipForward className="w-5 h-5" />
          )}
        </button>
      </div>

      {/* Ducking status */}
      {isDucking && (
        <div className="mt-3 flex items-center justify-center gap-2 text-blue text-xs">
          <div className="w-1.5 h-1.5 rounded-full bg-blue animate-pulse" />
          <span>Voice detected - audio ducked</span>
        </div>
      )}

      {/* Resume Music button - only show when paused but has track info */}
      {!track.isPlaying && track.title && (
        <div className="mt-3">
          <button
            onClick={handleResume}
            disabled={isControlling}
            className="w-full py-2.5 rounded-xl bg-[#1DB954] text-white font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-70"
          >
            {activeButton === "resume" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            Resume Music
          </button>
        </div>
      )}
    </div>
  );
}

// Export memoized component to prevent re-renders from parent state changes
export const NowPlayingCard = memo(NowPlayingCardInner);
