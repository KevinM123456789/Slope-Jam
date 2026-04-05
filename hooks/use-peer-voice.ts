"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RoomParticipant } from "@/contexts/room-context";

interface PeerMessage {
  type: "user-info" | "speaking-state" | "ping" | "flow-mode" | "peer-list" | "mute-state" | "track-info";
  payload: unknown;
}

interface TrackInfoPayload {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string;
}

interface UserInfoPayload {
  displayName: string;
  hasSpotify: boolean;
  isHost: boolean;
}

interface SpeakingStatePayload {
  isSpeaking: boolean;
}

interface FlowModePayload {
  isInFlowMode: boolean;
}

interface PeerListPayload {
  peerIds: string[];
}

interface UsePeerVoiceOptions {
  roomCode: string;
  localUser: {
    id: string;
    displayName: string;
    hasSpotify: boolean;
  };
  isHost: boolean;
  onParticipantJoin?: (participant: RoomParticipant) => void;
  onParticipantLeave?: (peerId: string) => void;
  onParticipantUpdate?: (peerId: string, updates: Partial<RoomParticipant>) => void;
  onRemoteSpeaking?: (peerId: string, isSpeaking: boolean) => void;
  onPingReceived?: (fromName: string) => void;
  onTrackInfo?: (track: TrackInfoPayload) => void;
}

interface PeerConnection {
  peerId: string;
  dataConnection: import("peerjs").DataConnection | null;
  mediaConnection: import("peerjs").MediaConnection | null;
  audioElement: HTMLAudioElement | null;
  confirmed: boolean; // FIX: only true after "open" fires
}

function generatePeerId(roomCode: string, isHost: boolean): string {
  const sanitizedCode = roomCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (isHost) {
    return `slopejam-${sanitizedCode}-host`;
  }
  const uid = crypto.randomUUID().slice(0, 8);
  return `slopejam-${sanitizedCode}-${uid}`;
}

function getHostPeerId(roomCode: string): string {
  const sanitizedCode = roomCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `slopejam-${sanitizedCode}-host`;
}

export function usePeerVoice(options: UsePeerVoiceOptions) {
  const {
    roomCode,
    localUser,
    isHost,
    onParticipantJoin,
    onParticipantLeave,
    onParticipantUpdate,
    onRemoteSpeaking,
    onPingReceived,
    onTrackInfo,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(1);

  const peerRef = useRef<import("peerjs").default | null>(null);
  const connectionsRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectedPeerIdsRef = useRef<Set<string>>(new Set());
  const localPeerIdRef = useRef<string | null>(null);
  const localUserRef = useRef(localUser);
  const isHostRef = useRef(isHost);

  // Keep refs in sync so callbacks always have fresh values
  useEffect(() => {
    localUserRef.current = localUser;
  }, [localUser]);

  const broadcast = useCallback((message: PeerMessage) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.confirmed && conn.dataConnection?.open) {
        try {
          conn.dataConnection.send(message);
        } catch {
          // Ignore send errors
        }
      }
    });
  }, []);

  const broadcastPeerList = useCallback(() => {
    if (!isHostRef.current) return;
    const peerIds = Array.from(connectedPeerIdsRef.current);
    broadcast({
      type: "peer-list",
      payload: { peerIds } as PeerListPayload,
    });
  }, [broadcast]);

  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    broadcast({ type: "speaking-state", payload: { isSpeaking } as SpeakingStatePayload });
  }, [broadcast]);

  const sendPingTo = useCallback((targetPeerId: string) => {
    const conn = connectionsRef.current.get(targetPeerId);
    if (conn?.confirmed && conn.dataConnection?.open) {
      conn.dataConnection.send({
        type: "ping",
        payload: {
          fromName: localUserRef.current?.displayName ?? "Someone",
          fromPeerId: localUserRef.current?.id ?? "",
        },
      });
    }
  }, []);

  const broadcastFlowMode = useCallback((isInFlowMode: boolean) => {
    broadcast({ type: "flow-mode", payload: { isInFlowMode } as FlowModePayload });
  }, [broadcast]);

  const broadcastMuteState = useCallback((isMuted: boolean) => {
    broadcast({ type: "mute-state", payload: { isMuted } });
  }, [broadcast]);

  const broadcastTrackInfo = useCallback((track: TrackInfoPayload) => {
    if (!isHostRef.current) return;
    broadcast({ type: "track-info", payload: track });
  }, [broadcast]);

  // FIX: handleDataMessage uses refs instead of stale closure values
  const handleDataMessage = useCallback((peerId: string, message: PeerMessage) => {
    switch (message.type) {
      case "user-info": {
        const payload = message.payload as UserInfoPayload;
        onParticipantJoin?.({
          id: crypto.randomUUID(),
          peerId,
          displayName: payload.displayName,
          hasSpotify: payload.hasSpotify,
          isHost: payload.isHost,
          isSpeaking: false,
          isMuted: false,
          isInFlowMode: false,
        });
        setParticipantCount(connectionsRef.current.size + 1);
        broadcastPeerList();
        break;
      }
      case "speaking-state": {
        const payload = message.payload as SpeakingStatePayload;
        onRemoteSpeaking?.(peerId, payload.isSpeaking);
        onParticipantUpdate?.(peerId, { isSpeaking: payload.isSpeaking });
        break;
      }
      case "ping": {
        const payload = message.payload as { fromName: string };
        onPingReceived?.(payload.fromName);
        break;
      }
      case "flow-mode": {
        const payload = message.payload as FlowModePayload;
        onParticipantUpdate?.(peerId, { isInFlowMode: payload.isInFlowMode });
        break;
      }
      case "peer-list": {
        // FIX: use ref for localPeerId to avoid stale closure
        if (!isHostRef.current) {
          const payload = message.payload as PeerListPayload;
          for (const otherPeerId of payload.peerIds) {
            const existing = connectionsRef.current.get(otherPeerId);
            // FIX: only skip if connection is confirmed open, not just pending
            if ((!existing || !existing.confirmed) && otherPeerId !== localPeerIdRef.current) {
              connectToPeer(otherPeerId);
            }
          }
        }
        break;
      }
      case "mute-state": {
        const payload = message.payload as { isMuted: boolean };
        onParticipantUpdate?.(peerId, { isMuted: payload.isMuted });
        break;
      }
      case "track-info": {
        if (!isHostRef.current) {
          const payload = message.payload as TrackInfoPayload;
          onTrackInfo?.(payload);
        }
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastPeerList, onParticipantJoin, onParticipantUpdate, onRemoteSpeaking, onPingReceived, onTrackInfo]);

  const connectToPeer = useCallback((targetPeerId: string) => {
    if (!peerRef.current || !localStreamRef.current) return;

    // FIX: only block if connection is confirmed open — not just pending
    const existing = connectionsRef.current.get(targetPeerId);
    if (existing?.confirmed) return;
    if (targetPeerId === localPeerIdRef.current) return;

    const peer = peerRef.current;

    const connection: PeerConnection = {
      peerId: targetPeerId,
      dataConnection: null,
      mediaConnection: null,
      audioElement: null,
      confirmed: false, // starts unconfirmed
    };

    // FIX: add to map immediately to block duplicate attempts,
    // but confirmed = false so broadcast ignores it
    connectionsRef.current.set(targetPeerId, connection);

    const dataConn = peer.connect(targetPeerId, { reliable: true });
    connection.dataConnection = dataConn;

    // FIX: connection timeout — if open doesn't fire in 5s, clean up and allow retry
    const openTimeout = setTimeout(() => {
      if (!connection.confirmed) {
        connectionsRef.current.delete(targetPeerId);
        dataConn.close();
      }
    }, 5000);

    dataConn.on("open", () => {
      clearTimeout(openTimeout);
      connection.confirmed = true; // FIX: mark confirmed only after open

      connectedPeerIdsRef.current.add(targetPeerId);

      dataConn.send({
        type: "user-info",
        payload: {
          displayName: localUserRef.current?.displayName ?? "Guest",
          hasSpotify: localUserRef.current?.hasSpotify ?? false,
          isHost: isHostRef.current,
        } as UserInfoPayload,
      });

      if (localStreamRef.current) {
        const mediaConn = peer.call(targetPeerId, localStreamRef.current);
        connection.mediaConnection = mediaConn;

        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.preload = "auto";
          connection.audioElement = audio;
          audio.play().catch(() => {});
        });
      }
    });

    dataConn.on("data", (data) => {
      handleDataMessage(targetPeerId, data as PeerMessage);
    });

    dataConn.on("close", () => {
      clearTimeout(openTimeout);
      onParticipantLeave?.(targetPeerId);
      connectionsRef.current.delete(targetPeerId);
      connectedPeerIdsRef.current.delete(targetPeerId);
      setParticipantCount(connectionsRef.current.size + 1);
      broadcastPeerList();
    });

    dataConn.on("error", () => {
      clearTimeout(openTimeout);
      connectionsRef.current.delete(targetPeerId);
      connectedPeerIdsRef.current.delete(targetPeerId);
    });

  }, [handleDataMessage, broadcastPeerList, onParticipantLeave]);

  const initializePeer = useCallback(async () => {
    if (peerRef.current) return;

    setIsConnecting(true);
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          sampleRate: { ideal: 16000 },
          channelCount: { ideal: 1 },
        },
      });

      localStreamRef.current = stream;
      setLocalStream(stream);

      const { default: Peer } = await import("peerjs");

      const peerId = generatePeerId(roomCode, isHost);

      const peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      peer.on("open", (id) => {
        localPeerIdRef.current = id; // FIX: store in ref immediately
        setLocalPeerId(id);
        setIsConnected(true);
        setIsConnecting(false);

        if (!isHost) {
          const hostPeerId = getHostPeerId(roomCode);
          let retryCount = 0;

          const tryConnectToHost = () => {
            if (retryCount >= 5) {
              setError("Could not find room host. They may have left.");
              return;
            }

            // FIX: only retry if not already confirmed connected
            const existing = connectionsRef.current.get(hostPeerId);
            if (!existing?.confirmed) {
              // Clear stale pending entry before retrying
              if (existing && !existing.confirmed) {
                connectionsRef.current.delete(hostPeerId);
              }
              connectToPeer(hostPeerId);
            }

            retryCount++;
            retryTimeoutRef.current = setTimeout(() => {
              const conn = connectionsRef.current.get(hostPeerId);
              if (!conn?.confirmed) {
                tryConnectToHost();
              }
            }, 2000);
          };

          tryConnectToHost();
        }
      });

      peer.on("connection", (dataConn) => {
        const remotePeerId = dataConn.peer;

        const connection: PeerConnection = {
          peerId: remotePeerId,
          dataConnection: dataConn,
          mediaConnection: null,
          audioElement: null,
          confirmed: false,
        };

        // FIX: don't add to map until open fires
        dataConn.on("open", () => {
          connection.confirmed = true;
          connectionsRef.current.set(remotePeerId, connection);
          connectedPeerIdsRef.current.add(remotePeerId);
          setParticipantCount(connectionsRef.current.size + 1);

          dataConn.send({
            type: "user-info",
            payload: {
              displayName: localUserRef.current?.displayName ?? "Guest",
              hasSpotify: localUserRef.current?.hasSpotify ?? false,
              isHost: isHostRef.current,
            } as UserInfoPayload,
          });

          if (isHostRef.current) {
            setTimeout(() => broadcastPeerList(), 500);
          }
        });

        dataConn.on("data", (data) => {
          handleDataMessage(remotePeerId, data as PeerMessage);
        });

        dataConn.on("close", () => {
          onParticipantLeave?.(remotePeerId);
          connectionsRef.current.delete(remotePeerId);
          connectedPeerIdsRef.current.delete(remotePeerId);
          setParticipantCount(connectionsRef.current.size + 1);
          broadcastPeerList();
        });
      });

      peer.on("call", (mediaConn) => {
        const remotePeerId = mediaConn.peer;

        if (localStreamRef.current) {
          mediaConn.answer(localStreamRef.current);
        }

        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.preload = "auto";

          const existing = connectionsRef.current.get(remotePeerId);
          if (existing) {
            existing.mediaConnection = mediaConn;
            existing.audioElement = audio;
          }

          audio.play().catch(() => {});
        });
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && isHost) {
          setError("Another host is already in this room.");
        } else if (err.type === "peer-unavailable") {
          // Expected when host doesn't exist yet — retry handles this
        } else {
          setError(err.message);
        }
        setIsConnecting(false);
      });

      peer.on("disconnected", () => {
        setIsConnected(false);
        peer.reconnect();
      });

      peerRef.current = peer;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, isHost, connectToPeer, broadcastPeerList, handleDataMessage]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      connectionsRef.current.forEach((conn) => {
        conn.dataConnection?.close();
        conn.mediaConnection?.close();
        conn.audioElement?.pause();
      });
      peerRef.current?.destroy();
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    localPeerId,
    error,
    participantCount,
    localStream,
    initializePeer,
    connectToPeer,
    toggleMute,
    isMicMuted,
    broadcastSpeakingState,
    broadcastFlowMode,
    broadcastMuteState,
    broadcastTrackInfo,
    sendPingTo,
  };
}}

interface UsePeerVoiceOptions {
  roomCode: string;
  localUser: {
    id: string;
    displayName: string;
    hasSpotify: boolean;
  };
  isHost: boolean;
  onParticipantJoin?: (participant: RoomParticipant) => void;
  onParticipantLeave?: (peerId: string) => void;
  onParticipantUpdate?: (peerId: string, updates: Partial<RoomParticipant>) => void;
  onRemoteSpeaking?: (peerId: string, isSpeaking: boolean) => void;
  onPingReceived?: (fromName: string) => void;
  onTrackInfo?: (track: TrackInfoPayload) => void; // For guests to receive host's Spotify info
}

interface PeerConnection {
  peerId: string;
  dataConnection: import("peerjs").DataConnection | null;
  mediaConnection: import("peerjs").MediaConnection | null;
  audioElement: HTMLAudioElement | null;
}

/**
 * Deterministic peer ID based on room code
 * Host gets a predictable ID so others can find them
 * Non-hosts get a unique ID but know where to find the host
 */
function generatePeerId(roomCode: string, isHost: boolean, uniqueId?: string): string {
  // Sanitize room code for PeerJS (alphanumeric only)
  const sanitizedCode = roomCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  
  if (isHost) {
    // Host gets deterministic ID based on room code
    return `slopejam-${sanitizedCode}-host`;
  }
  
  // Non-hosts get unique ID
  const uid = uniqueId || crypto.randomUUID().slice(0, 8);
  return `slopejam-${sanitizedCode}-${uid}`;
}

function getHostPeerId(roomCode: string): string {
  const sanitizedCode = roomCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return `slopejam-${sanitizedCode}-host`;
}

export function usePeerVoice(options: UsePeerVoiceOptions) {
  const {
    roomCode,
    localUser,
    isHost,
    onParticipantJoin,
    onParticipantLeave,
    onParticipantUpdate,
    onRemoteSpeaking,
    onPingReceived,
    onTrackInfo,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(1);

  const peerRef = useRef<import("peerjs").default | null>(null);
  const connectionsRef = useRef<Map<string, PeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const connectedPeerIdsRef = useRef<Set<string>>(new Set());

  // Broadcast message to all connected peers
  const broadcast = useCallback((message: PeerMessage) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.dataConnection?.open) {
        try {
          conn.dataConnection.send(message);
        } catch {
          // Ignore send errors
        }
      }
    });
  }, []);

  // Broadcast the list of connected peers (host only)
  const broadcastPeerList = useCallback(() => {
    if (!isHost) return;
    
    const peerIds = Array.from(connectedPeerIdsRef.current);
    broadcast({
      type: "peer-list",
      payload: { peerIds } as PeerListPayload,
    });
  }, [isHost, broadcast]);

  // Send speaking state to all peers
  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    broadcast({
      type: "speaking-state",
      payload: { isSpeaking } as SpeakingStatePayload,
    });
  }, [broadcast]);

  // Send targeted ping to a specific peer
  const sendPingTo = useCallback((targetPeerId: string) => {
    const conn = connectionsRef.current.get(targetPeerId);
    if (conn?.dataConnection?.open) {
      conn.dataConnection.send({
        type: "ping",
        payload: { 
          fromName: localUser?.displayName ?? "Someone", 
          fromPeerId: localUser?.id ?? "" 
        },
      });
    }
  }, [localUser?.displayName, localUser?.id]);

  // Send flow mode update
  const broadcastFlowMode = useCallback((isInFlowMode: boolean) => {
    broadcast({
      type: "flow-mode",
      payload: { isInFlowMode } as FlowModePayload,
    });
  }, [broadcast]);

  // Send mute state update (for iOS real-time sync)
  const broadcastMuteState = useCallback((isMuted: boolean) => {
    broadcast({
      type: "mute-state",
      payload: { isMuted },
    });
  }, [broadcast]);

  // Host broadcasts track info to all guests (so they don't need to poll Spotify)
  const broadcastTrackInfo = useCallback((track: TrackInfoPayload) => {
    if (!isHost) return; // Only host broadcasts track info
    broadcast({
      type: "track-info",
      payload: track,
    });
  }, [isHost, broadcast]);

  // Connect to another peer
  const connectToPeer = useCallback((targetPeerId: string) => {
    if (!peerRef.current || !localStreamRef.current) return;
    if (connectionsRef.current.has(targetPeerId)) return;
    if (targetPeerId === localPeerId) return;

    const peer = peerRef.current;
    
    // Create data connection
    const dataConn = peer.connect(targetPeerId, { reliable: true });
    
    const connection: PeerConnection = {
      peerId: targetPeerId,
      dataConnection: dataConn,
      mediaConnection: null,
      audioElement: null,
    };

    dataConn.on("open", () => {
      // Send our user info
      dataConn.send({
        type: "user-info",
        payload: {
          displayName: localUser?.displayName ?? "Guest",
          hasSpotify: localUser?.hasSpotify ?? false,
          isHost,
        } as UserInfoPayload,
      });

      // Create media connection
      if (localStreamRef.current) {
        const mediaConn = peer.call(targetPeerId, localStreamRef.current);
        connection.mediaConnection = mediaConn;

        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          // Set larger buffer to prevent stuttering on slow connections
          audio.preload = "auto";
          connection.audioElement = audio;
          // Play with error handling
          audio.play().catch(() => {
            // Autoplay blocked, will play on user interaction
          });
        });
      }
    });

    dataConn.on("data", (data) => {
      handleDataMessage(targetPeerId, data as PeerMessage);
    });

    dataConn.on("close", () => {
      onParticipantLeave?.(targetPeerId);
      connectionsRef.current.delete(targetPeerId);
      connectedPeerIdsRef.current.delete(targetPeerId);
      setParticipantCount(connectionsRef.current.size + 1);
      broadcastPeerList();
    });

    connectionsRef.current.set(targetPeerId, connection);
    connectedPeerIdsRef.current.add(targetPeerId);
  }, [localPeerId, localUser, isHost, broadcastPeerList, onParticipantLeave]);

  // Handle incoming data message
  const handleDataMessage = useCallback((peerId: string, message: PeerMessage) => {
    switch (message.type) {
      case "user-info": {
        const payload = message.payload as UserInfoPayload;
        onParticipantJoin?.({
          id: crypto.randomUUID(),
          peerId,
          displayName: payload.displayName,
          hasSpotify: payload.hasSpotify,
          isHost: payload.isHost,
          isSpeaking: false,
          isMuted: false,
          isInFlowMode: false,
        });
        setParticipantCount(connectionsRef.current.size + 1);
        broadcastPeerList();
        break;
      }
      case "speaking-state": {
        const payload = message.payload as SpeakingStatePayload;
        onRemoteSpeaking?.(peerId, payload.isSpeaking);
        onParticipantUpdate?.(peerId, { isSpeaking: payload.isSpeaking });
        break;
      }
      case "ping": {
        const payload = message.payload as { fromName: string };
        onPingReceived?.(payload.fromName);
        break;
      }
      case "flow-mode": {
        const payload = message.payload as FlowModePayload;
        onParticipantUpdate?.(peerId, { isInFlowMode: payload.isInFlowMode });
        break;
      }
      case "peer-list": {
        // Non-hosts receive peer list from host and connect to any new peers
        if (!isHost) {
          const payload = message.payload as PeerListPayload;
          for (const otherPeerId of payload.peerIds) {
            if (!connectionsRef.current.has(otherPeerId) && otherPeerId !== localPeerId) {
              connectToPeer(otherPeerId);
            }
          }
        }
        break;
      }
      case "mute-state": {
        // Update participant mute status in real-time
        const payload = message.payload as { isMuted: boolean };
        onParticipantUpdate?.(peerId, { isMuted: payload.isMuted });
        break;
      }
      case "track-info": {
        // Guests receive track info from host
        if (!isHost) {
          const payload = message.payload as TrackInfoPayload;
          onTrackInfo?.(payload);
        }
        break;
      }
    }
  }, [isHost, localPeerId, onParticipantJoin, onParticipantUpdate, onRemoteSpeaking, onPingReceived, broadcastPeerList, connectToPeer]);

  // Initialize peer connection
  const initializePeer = useCallback(async () => {
    if (peerRef.current) return;

    setIsConnecting(true);
    setError(null);

    try {
      // Get microphone with optimized constraints for voice + background music
      // Using less aggressive processing to reduce CPU load and prevent stuttering
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: true },
          // Lower sample rate = less CPU, still fine for voice
          sampleRate: { ideal: 16000 },
          // Mono channel for voice
          channelCount: { ideal: 1 },
        },
      });
      
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Import PeerJS
      const { default: Peer } = await import("peerjs");
      
      const peerId = generatePeerId(roomCode, isHost);
      
      const peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        },
      });

      peer.on("open", (id) => {
        setLocalPeerId(id);
        setIsConnected(true);
        setIsConnecting(false);

        // Non-hosts: connect to the host
        if (!isHost) {
          const hostPeerId = getHostPeerId(roomCode);
          
          // Retry connecting to host a few times
          let retryCount = 0;
          const tryConnectToHost = () => {
            if (retryCount >= 5) {
              setError("Could not find room host. They may have left.");
              return;
            }
            
            connectToPeer(hostPeerId);
            retryCount++;
            
            // Check if connected after 2 seconds, retry if not
            retryTimeoutRef.current = setTimeout(() => {
              if (!connectionsRef.current.has(hostPeerId)) {
                tryConnectToHost();
              }
            }, 2000);
          };
          
          tryConnectToHost();
        }
      });

      // Handle incoming connections
      peer.on("connection", (dataConn) => {
        const remotePeerId = dataConn.peer;
        
        const connection: PeerConnection = {
          peerId: remotePeerId,
          dataConnection: dataConn,
          mediaConnection: null,
          audioElement: null,
        };

        dataConn.on("open", () => {
          // Send our info
          dataConn.send({
            type: "user-info",
            payload: {
              displayName: localUser?.displayName ?? "Guest",
              hasSpotify: localUser?.hasSpotify ?? false,
              isHost,
            } as UserInfoPayload,
          });

          connectedPeerIdsRef.current.add(remotePeerId);
          setParticipantCount(connectionsRef.current.size + 1);
          
          // Host broadcasts updated peer list
          if (isHost) {
            setTimeout(() => broadcastPeerList(), 500);
          }
        });

        dataConn.on("data", (data) => {
          handleDataMessage(remotePeerId, data as PeerMessage);
        });

        dataConn.on("close", () => {
          onParticipantLeave?.(remotePeerId);
          connectionsRef.current.delete(remotePeerId);
          connectedPeerIdsRef.current.delete(remotePeerId);
          setParticipantCount(connectionsRef.current.size + 1);
          broadcastPeerList();
        });

        connectionsRef.current.set(remotePeerId, connection);
      });

      // Handle incoming calls
      peer.on("call", (mediaConn) => {
        const remotePeerId = mediaConn.peer;
        
        // Answer with our stream
        if (localStreamRef.current) {
          mediaConn.answer(localStreamRef.current);
        }

        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.preload = "auto"; // Larger buffer for smoother playback
          
          const existing = connectionsRef.current.get(remotePeerId);
          if (existing) {
            existing.mediaConnection = mediaConn;
            existing.audioElement = audio;
          }
          
          // Play with error handling
          audio.play().catch(() => {
            // Autoplay blocked, will play on user interaction
          });
        });
      });

      peer.on("error", (err) => {
        // PeerJS "unavailable-id" means someone else has that ID (host already exists)
        if (err.type === "unavailable-id" && isHost) {
          setError("Another host is already in this room.");
        } else if (err.type === "peer-unavailable") {
          // This is expected when trying to connect to a host that doesn't exist yet
        } else {
          setError(err.message);
        }
        setIsConnecting(false);
      });

      peer.on("disconnected", () => {
        setIsConnected(false);
        // Try to reconnect
        peer.reconnect();
      });

      peerRef.current = peer;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  // CRITICAL: Minimal dependencies to prevent re-initialization when unrelated state changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode, isHost]);

  // Toggle microphone mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      
      connectionsRef.current.forEach((conn) => {
        conn.dataConnection?.close();
        conn.mediaConnection?.close();
        conn.audioElement?.pause();
      });
      
      peerRef.current?.destroy();
    };
  }, []);

  return {
    isConnected,
    isConnecting,
    localPeerId,
    error,
    participantCount,
    localStream,
    initializePeer,
    connectToPeer,
    toggleMute,
    isMicMuted,
    broadcastSpeakingState,
    broadcastFlowMode,
    broadcastMuteState,
    broadcastTrackInfo,
    sendPingTo,
  };
}
