"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { Mountain, Headphones, Users, Music2, Check, Loader2, User, Mic } from "lucide-react";
import { useRoom } from "@/contexts/room-context";

export default function LandingPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { localUser, setLocalUser } = useRoom();
  
  const [roomCode, setRoomCode] = useState("");
  const [isJoining, setIsJoining] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [showNameInput, setShowNameInput] = useState(false);
  const [pendingAction, setPendingAction] = useState<"start" | "join" | null>(null);
  
  const isSpotifyConnected = status === "authenticated";

  // Pre-fill display name from Spotify or saved local user
  useEffect(() => {
    if (session?.user?.name) {
      setDisplayName(session.user.name);
    } else if (localUser?.displayName) {
      setDisplayName(localUser.displayName);
    }
  }, [session?.user?.name, localUser?.displayName]);

  const handleStartJam = () => {
    if (!displayName.trim()) {
      setShowNameInput(true);
      setPendingAction("start");
      return;
    }
    
    // Save local user
    setLocalUser({
      id: crypto.randomUUID(),
      displayName: displayName.trim(),
      hasSpotify: isSpotifyConnected,
    });
    
    // Generate a random 6-character room code
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    router.push(`/room/${code}?host=true`);
  };

  const handleJoinJam = () => {
    if (!displayName.trim()) {
      setShowNameInput(true);
      setPendingAction("join");
      return;
    }
    
    if (roomCode.trim().length >= 4) {
      // Save local user
      setLocalUser({
        id: crypto.randomUUID(),
        displayName: displayName.trim(),
        hasSpotify: isSpotifyConnected,
      });
      
      router.push(`/room/${roomCode.toUpperCase()}`);
    }
  };

  const handleNameSubmit = () => {
    if (!displayName.trim()) return;
    
    setShowNameInput(false);
    
    if (pendingAction === "start") {
      handleStartJam();
    } else if (pendingAction === "join" && roomCode.trim().length >= 4) {
      handleJoinJam();
    }
    
    setPendingAction(null);
  };

  return (
    <main className="min-h-screen bg-background flex flex-col safe-area-top safe-area-bottom">
      {/* Header */}
      <header className="flex items-center justify-center pt-12 pb-6 px-6">
        <div className="flex items-center gap-5">
          <div className="relative">
            <Mountain className="w-28 h-28 text-orange" />
            <Headphones className="w-14 h-14 text-blue absolute -bottom-2 -right-2" />
          </div>
          <h1 className="text-6xl font-bold text-foreground tracking-tight">
            Slope Jam
          </h1>
        </div>
      </header>

      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pb-8">
        <p className="text-muted-foreground text-center text-lg mb-8 max-w-xs leading-relaxed">
          Listen to music together while shredding the slopes. Voice chat with auto-ducking keeps the crew connected.
        </p>

        {/* Display Name Input (shown when needed) */}
        {showNameInput && (
          <div className="w-full max-w-sm mb-6 p-4 bg-card rounded-2xl border border-border">
            <label className="block text-sm font-medium text-foreground mb-2">
              What should we call you?
            </label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Your name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={20}
                  autoFocus
                  onKeyDown={(e) => e.key === "Enter" && handleNameSubmit()}
                  className="w-full bg-input text-foreground text-lg py-3 pl-10 pr-4 rounded-xl border border-border focus:border-blue focus:outline-none"
                />
              </div>
              <button
                onClick={handleNameSubmit}
                disabled={!displayName.trim()}
                className="px-6 py-3 bg-blue text-blue-foreground font-semibold rounded-xl active:scale-[0.98] transition-transform disabled:opacity-50"
              >
                OK
              </button>
            </div>
          </div>
        )}

        {/* Current User Display */}
        {displayName && !showNameInput && (
          <button
            onClick={() => setShowNameInput(true)}
            className="flex items-center gap-2 mb-6 px-4 py-2 bg-card rounded-full border border-border active:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 rounded-full bg-orange text-orange-foreground flex items-center justify-center text-sm font-bold">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span className="text-foreground font-medium">{displayName}</span>
            {isSpotifyConnected ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#1DB954]/20 text-[#1DB954]">
                Spotify
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-blue/20 text-blue flex items-center gap-1">
                <Mic className="w-3 h-3" />
                Mic Only
              </span>
            )}
          </button>
        )}

        {/* Spotify Connection Status */}
        <div className="w-full max-w-sm mb-8">
          {status === "loading" ? (
            <div className="flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-muted/50 border border-border">
              <Loader2 className="w-6 h-6 animate-spin text-[#1DB954]" />
              <span className="text-muted-foreground font-medium">Checking Spotify...</span>
            </div>
          ) : isSpotifyConnected ? (
            <div className="flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-[#1DB954]/10 border border-[#1DB954]/30">
              <Check className="w-6 h-6 text-[#1DB954]" />
              <span className="text-[#1DB954] font-medium">
                Connected as {session?.user?.name || "Spotify User"}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => signIn("spotify")}
                className="w-full flex items-center justify-center gap-3 py-4 px-6 rounded-2xl bg-[#1DB954] text-white font-bold text-lg active:scale-[0.98] transition-transform shadow-lg shadow-[#1DB954]/25 touch-target-lg"
              >
                <Music2 className="w-6 h-6" />
                Connect Spotify
              </button>
              <p className="text-xs text-muted-foreground text-center">
                Connect Spotify to control music, or join as voice-only guest
              </p>
            </div>
          )}
        </div>

        {/* Start a Jam Button - Primary Action (Orange) */}
        <button
          onClick={handleStartJam}
          className="w-full max-w-sm bg-orange text-orange-foreground font-bold text-xl py-6 px-8 rounded-2xl touch-target-lg active:scale-[0.98] transition-transform shadow-lg shadow-orange/25 mb-8"
        >
          START A JAM
        </button>

        {/* Divider */}
        <div className="flex items-center gap-4 w-full max-w-sm mb-8">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-sm font-medium">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Join Section */}
        {!isJoining ? (
          <button
            onClick={() => setIsJoining(true)}
            className="w-full max-w-sm bg-blue text-blue-foreground font-bold text-xl py-6 px-8 rounded-2xl touch-target-lg active:scale-[0.98] transition-transform shadow-lg shadow-blue/25"
          >
            JOIN A JAM
          </button>
        ) : (
          <div className="w-full max-w-sm flex flex-col gap-4">
            <div className="relative">
              <input
                type="text"
                placeholder="Enter room code"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={8}
                autoFocus
                className="w-full bg-input text-foreground text-center text-2xl font-mono tracking-widest py-5 px-6 rounded-2xl border-2 border-border focus:border-blue focus:outline-none touch-target-lg placeholder:text-muted-foreground placeholder:text-lg placeholder:tracking-normal placeholder:font-sans"
              />
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setIsJoining(false);
                  setRoomCode("");
                }}
                className="flex-1 bg-muted text-muted-foreground font-semibold text-lg py-4 px-6 rounded-xl touch-target active:scale-[0.98] transition-transform"
              >
                Cancel
              </button>
              <button
                onClick={handleJoinJam}
                disabled={roomCode.trim().length < 4}
                className="flex-1 bg-blue text-blue-foreground font-semibold text-lg py-4 px-6 rounded-xl touch-target active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100"
              >
                Join
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Features Footer */}
      <footer className="px-6 pb-8">
        <div className="flex justify-center gap-8 text-muted-foreground">
          <div className="flex flex-col items-center gap-2">
            <Users className="w-6 h-6" />
            <span className="text-xs">Voice Chat</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Headphones className="w-6 h-6" />
            <span className="text-xs">Auto-Ducking</span>
          </div>
          <div className="flex flex-col items-center gap-2">
            <Mountain className="w-6 h-6" />
            <span className="text-xs">Works Offline</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
