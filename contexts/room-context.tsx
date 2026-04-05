"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";

// Room participant type - simplified for privacy/battery (no track sharing)
export interface RoomParticipant {
  id: string;
  peerId: string;
  displayName: string;
  isHost: boolean;
  hasSpotify: boolean;
  isSpeaking: boolean;
  isMuted: boolean;
  isInFlowMode: boolean;
}

// Local user type stored in sessionStorage
export interface LocalUser {
  id: string;
  displayName: string;
  hasSpotify: boolean;
}

interface RoomContextType {
  // Local user info
  localUser: LocalUser | null;
  setLocalUser: (user: LocalUser) => void;
  
  // Room state
  roomCode: string | null;
  setRoomCode: (code: string) => void;
  isHost: boolean;
  setIsHost: (isHost: boolean) => void;
  
  // Participants
  participants: RoomParticipant[];
  addParticipant: (participant: RoomParticipant) => void;
  removeParticipant: (peerId: string) => void;
  updateParticipant: (peerId: string, updates: Partial<RoomParticipant>) => void;
  
  // Mute state (mic is always-on by default, this tracks mute toggle)
  isMuted: boolean;
  setIsMuted: (muted: boolean) => void;
  wasMutedBeforeFlowMode: boolean; // Track state before entering flow mode
  
  // Flow mode
  isInFlowMode: boolean;
  setIsInFlowMode: (inFlow: boolean) => void;
  
  // Ping
  sendPing: () => void;
  lastPingFrom: string | null;
  clearPing: () => void;
}

const RoomContext = createContext<RoomContextType | null>(null);

const LOCAL_USER_KEY = "slope-jam-user";

export function RoomProvider({ children }: { children: ReactNode }) {
  // Local user state - persisted in sessionStorage
  const [localUser, setLocalUserState] = useState<LocalUser | null>(null);
  
  // Room state
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  
  // Mute state - mic is always-on by default
  const [isMuted, setIsMuted] = useState(false);
  const [wasMutedBeforeFlowMode, setWasMutedBeforeFlowMode] = useState(false);
  
  // Flow mode - synced with mute state
  const [isInFlowMode, setIsInFlowModeInternal] = useState(false);
  
  // Flow mode toggle that syncs with mute
  const setIsInFlowMode = useCallback((inFlow: boolean) => {
    if (inFlow) {
      // Entering flow mode - save current mute state and force mute
      setWasMutedBeforeFlowMode(isMuted);
      setIsMuted(true);
    } else {
      // Exiting flow mode - restore previous mute state
      setIsMuted(wasMutedBeforeFlowMode);
    }
    setIsInFlowModeInternal(inFlow);
  }, [isMuted, wasMutedBeforeFlowMode]);
  
  // Ping
  const [lastPingFrom, setLastPingFrom] = useState<string | null>(null);
  const pingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load local user from sessionStorage on mount
  useEffect(() => {
    const stored = sessionStorage.getItem(LOCAL_USER_KEY);
    if (stored) {
      try {
        setLocalUserState(JSON.parse(stored));
      } catch {
        sessionStorage.removeItem(LOCAL_USER_KEY);
      }
    }
  }, []);

  // Save local user to sessionStorage
  const setLocalUser = useCallback((user: LocalUser) => {
    setLocalUserState(user);
    sessionStorage.setItem(LOCAL_USER_KEY, JSON.stringify(user));
  }, []);

  // Participant management
  const addParticipant = useCallback((participant: RoomParticipant) => {
    setParticipants((prev) => {
      // Don't add if already exists
      if (prev.some((p) => p.peerId === participant.peerId)) {
        return prev;
      }
      return [...prev, participant];
    });
  }, []);

  const removeParticipant = useCallback((peerId: string) => {
    setParticipants((prev) => prev.filter((p) => p.peerId !== peerId));
  }, []);

  const updateParticipant = useCallback((peerId: string, updates: Partial<RoomParticipant>) => {
    setParticipants((prev) =>
      prev.map((p) => (p.peerId === peerId ? { ...p, ...updates } : p))
    );
  }, []);

  // Ping functionality
  const sendPing = useCallback(() => {
    // This will be connected to PeerJS broadcast later
    // For now, it sets the ping locally
    setLastPingFrom(localUser?.displayName || "Someone");
    
    // Clear ping after 5 seconds
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
    }
    pingTimeoutRef.current = setTimeout(() => {
      setLastPingFrom(null);
    }, 5000);
  }, [localUser?.displayName]);

  const clearPing = useCallback(() => {
    setLastPingFrom(null);
    if (pingTimeoutRef.current) {
      clearTimeout(pingTimeoutRef.current);
    }
  }, []);

  return (
    <RoomContext.Provider
      value={{
        localUser,
        setLocalUser,
        roomCode,
        setRoomCode,
        isHost,
        setIsHost,
        participants,
        addParticipant,
        removeParticipant,
        updateParticipant,
        isMuted,
        setIsMuted,
        wasMutedBeforeFlowMode,
        isInFlowMode,
        setIsInFlowMode,
        sendPing,
        lastPingFrom,
        clearPing,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom must be used within a RoomProvider");
  }
  return context;
}
