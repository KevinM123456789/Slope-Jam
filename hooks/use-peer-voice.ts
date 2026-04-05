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
  confirmed: boolean;
}

function generatePeerId(roomCode: string, isHost: boolean): string {
  const sanitizedCode = roomCode.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  if (isHost) return `slopejam-${sanitizedCode}-host`;
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

  useEffect(() => { localUserRef.current = localUser; }, [localUser]);

  const broadcast = useCallback((message: PeerMessage) => {
    connectionsRef.current.forEach((conn) => {
      if (conn.confirmed && conn.dataConnection?.open) {
        try { conn.dataConnection.send(message); } catch {}
      }
    });
  }, []);

  const broadcastPeerList = useCallback(() => {
    if (!isHostRef.current) return;
    const peerIds = Array.from(connectedPeerIdsRef.current);
    broadcast({ type: "peer-list", payload: { peerIds } as PeerListPayload });
  }, [broadcast]);

  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    broadcast({ type: "speaking-state", payload: { isSpeaking } as SpeakingStatePayload });
  }, [broadcast]);

  const sendPingTo = useCallback((targetPeerId: string) => {
    const conn = connectionsRef.current.get(targetPeerId);
    if (conn?.confirmed && conn.dataConnection?.open) {
      conn.dataConnection.send({
        type: "ping",
        payload: { fromName: localUserRef.current?.displayName ?? "Someone", fromPeerId: localUserRef.current?.id ?? "" },
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

  const handleDataMessage = useCallback((peerId: string, message: PeerMessage) => {
    switch (message.type) {
      case "user-info": {
        const payload = message.payload as UserInfoPayload;
        onParticipantJoin?.({ id: crypto.randomUUID(), peerId, displayName: payload.displayName, hasSpotify: payload.hasSpotify, isHost: payload.isHost, isSpeaking: false, isMuted: false, isInFlowMode: false });
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
        if (!isHostRef.current) {
          const payload = message.payload as PeerListPayload;
          for (const otherPeerId of payload.peerIds) {
            const existing = connectionsRef.current.get(otherPeerId);
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
          onTrackInfo?.(message.payload as TrackInfoPayload);
        }
        break;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [broadcastPeerList, onParticipantJoin, onParticipantUpdate, onRemoteSpeaking, onPingReceived, onTrackInfo]);

  const connectToPeer = useCallback((targetPeerId: string) => {
    if (!peerRef.current || !localStreamRef.current) return;
    const existing = connectionsRef.current.get(targetPeerId);
    if (existing?.confirmed) return;
    if (targetPeerId === localPeerIdRef.current) return;

    const peer = peerRef.current;
    const connection: PeerConnection = { peerId: targetPeerId, dataConnection: null, mediaConnection: null, audioElement: null, confirmed: false };
    connectionsRef.current.set(targetPeerId, connection);

    const dataConn = peer.connect(targetPeerId, { reliable: true });
    connection.dataConnection = dataConn;

    const openTimeout = setTimeout(() => {
      if (!connection.confirmed) {
        connectionsRef.current.delete(targetPeerId);
        dataConn.close();
      }
    }, 5000);

    dataConn.on("open", () => {
      clearTimeout(openTimeout);
      connection.confirmed = true;
      connectedPeerIdsRef.current.add(targetPeerId);
      dataConn.send({ type: "user-info", payload: { displayName: localUserRef.current?.displayName ?? "Guest", hasSpotify: localUserRef.current?.hasSpotify ?? false, isHost: isHostRef.current } as UserInfoPayload });
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

    dataConn.on("data", (data) => { handleDataMessage(targetPeerId, data as PeerMessage); });

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
        audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, sampleRate: { ideal: 16000 }, channelCount: { ideal: 1 } },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      const { default: Peer } = await import("peerjs");
      const peerId = generatePeerId(roomCode, isHost);
      const peer = new Peer(peerId, { debug: 0, config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }] } });

      peer.on("open", (id) => {
        localPeerIdRef.current = id;
        setLocalPeerId(id);
        setIsConnected(true);
        setIsConnecting(false);

        if (!isHost) {
          const hostPeerId = getHostPeerId(roomCode);
          let retryCount = 0;
          const tryConnectToHost = () => {
            if (retryCount >= 5) { setError("Could not find room host. They may have left."); return; }
            const existing = connectionsRef.current.get(hostPeerId);
            if (!existing?.confirmed) {
              if (existing && !existing.confirmed) connectionsRef.current.delete(hostPeerId);
              connectToPeer(hostPeerId);
            }
            retryCount++;
            retryTimeoutRef.current = setTimeout(() => {
              if (!connectionsRef.current.get(hostPeerId)?.confirmed) tryConnectToHost();
            }, 2000);
          };
          tryConnectToHost();
        }
      });

      peer.on("connection", (dataConn) => {
        const remotePeerId = dataConn.peer;
        const connection: PeerConnection = { peerId: remotePeerId, dataConnection: dataConn, mediaConnection: null, audioElement: null, confirmed: false };

        dataConn.on("open", () => {
          connection.confirmed = true;
          connectionsRef.current.set(remotePeerId, connection);
          connectedPeerIdsRef.current.add(remotePeerId);
          setParticipantCount(connectionsRef.current.size + 1);
          dataConn.send({ type: "user-info", payload: { displayName: localUserRef.current?.displayName ?? "Guest", hasSpotify: localUserRef.current?.hasSpotify ?? false, isHost: isHostRef.current } as UserInfoPayload });
          if (isHostRef.current) setTimeout(() => broadcastPeerList(), 500);
        });

        dataConn.on("data", (data) => { handleDataMessage(remotePeerId, data as PeerMessage); });

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
        if (localStreamRef.current) mediaConn.answer(localStreamRef.current);
        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.preload = "auto";
          const existing = connectionsRef.current.get(remotePeerId);
          if (existing) { existing.mediaConnection = mediaConn; existing.audioElement = audio; }
          audio.play().catch(() => {});
        });
      });

      peer.on("error", (err) => {
        if (err.type === "unavailable-id" && isHost) setError("Another host is already in this room.");
        else if (err.type !== "peer-unavailable") setError(err.message);
        setIsConnecting(false);
      });

      peer.on("disconnected", () => { setIsConnected(false); peer.reconnect(); });

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
      if (audioTrack) { audioTrack.enabled = !audioTrack.enabled; setIsMicMuted(!audioTrack.enabled); }
    }
  }, []);

  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      connectionsRef.current.forEach((conn) => { conn.dataConnection?.close(); conn.mediaConnection?.close(); conn.audioElement?.pause(); });
      peerRef.current?.destroy();
    };
  }, []);

  return { isConnected, isConnecting, localPeerId, error, participantCount, localStream, initializePeer, connectToPeer, toggleMute, isMicMuted, broadcastSpeakingState, broadcastFlowMode, broadcastMuteState, broadcastTrackInfo, sendPingTo };
}
