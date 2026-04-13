"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import useSWR from "swr";
import { useSession } from "next-auth/react";

// Simplified track info - NO progress/duration to reduce re-renders and lag
export interface SpotifyTrack {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string;
}

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface UseSpotifyOptions {
  enabled?: boolean; // If false, won't fetch (for guests who receive data via socket)
}

export function useSpotify(options: UseSpotifyOptions = {}) {
  const { enabled = true } = options;
  const { status } = useSession();
  const [isVisible, setIsVisible] = useState(true);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // SWR with focus-aware polling - MUST be defined before useEffect that uses mutate
  // Throttled to 10 seconds to prevent lag/choppiness - we only need metadata, not real-time sync
  // CRITICAL: Only fetch if enabled (host only) to reduce network traffic and prevent lag
  const { data, error, isLoading, mutate } = useSWR<SpotifyTrack>(
    // Only fetch if enabled AND authenticated AND document is visible
    enabled && status === "authenticated" && isVisible ? "/api/spotify/now-playing" : null,
    fetcher,
    {
      refreshInterval: isVisible ? 10000 : 0, // 10 seconds when visible, stop when hidden
      revalidateOnFocus: false, // Don't auto-refetch on focus (we handle manually)
      revalidateOnReconnect: false, // Don't auto-refetch on reconnect
      dedupingInterval: 5000, // Prevent duplicate requests within 5s
     compare: (a, b) => {
        if (!a && !b) return true;
        if (!a || !b) return false;
        return a.title === b.title &&
               a.artist === b.artist &&
               a.albumArt === b.albumArt &&
               a.isPlaying === b.isPlaying;
      },
    }
  );

  // Focus polling - refresh when returning to tab
  // Now placed AFTER useSWR so mutate is defined
  useEffect(() => {
    const handleVisibilityChange = () => {
      const nowVisible = document.visibilityState === "visible";
      setIsVisible(nowVisible);
      
      // Immediately fetch current track when returning to tab (only if enabled)
      if (nowVisible && enabled && status === "authenticated") {
        mutate();
      }
    };

    // Set initial state
    setIsVisible(document.visibilityState === "visible");
    
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, status, mutate]);

  // Cleanup polling when visibility changes
  useEffect(() => {
    if (!isVisible && pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  }, [isVisible]);

  // Manual refresh function that respects visibility and enabled state
  const refreshTrack = useCallback(() => {
    if (enabled && isVisible && status === "authenticated") {
      mutate();
    }
  }, [enabled, isVisible, status, mutate]);

  return {
    track: data ?? { isPlaying: false },
    isLoading,
    error,
    isAuthenticated: status === "authenticated",
    isAuthLoading: status === "loading",
    mutate, // Expose mutate for manual refresh after playback controls
    refreshTrack, // Visibility-aware refresh
    isVisible, // Expose visibility state if needed
  };
}
