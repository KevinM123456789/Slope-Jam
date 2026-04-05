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

interface UsePeerVoiceOptions {
  roomCode: string;
  localUser: { id: string; displayName: string; hasSpotify: boolean };
  isHost: boolean;
  onParticipantJoin?: (participant: RoomParticipant) => void;
  onParticipantLeave?: (peerId: string) => void;
  onParticipantUpdate?: (peerId: string, updates: Partial<RoomParticipant>) => void;
  onRemoteSpeaking?: (peerId: string, isSpeaking: boolean) => void;
  onPingReceived?: (fromName: string) => void;
  onTrackInfo?: (track: TrackInfoPayload) => void;
}

interface PeerConn {
  peerId: string;
  mediaConnection: import("peerjs").MediaConnection | null;
  audioElement: HTMLAudioElement | null;
}

export function usePeerVoice(options: UsePeerVoiceOptions) {
  const { roomCode, localUser, isHost, onParticipantJoin, onParticipantLeave, onParticipantUpdate, onRemoteSpeaking, onPingReceived, onTrackInfo } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(1);

  const peerRef = useRef<import("peerjs").default | null>(null);
  const ablyRef = useRef<import("ably").Realtime | null>(null);
  const channelRef = useRef<import("ably").RealtimeChannel | null>(null);
  const connectionsRef = useRef<Map<string, PeerConn>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localUserRef = useRef(localUser);
  const isHostRef = useRef(isHost);

  useEffect(() => { localUserRef.current = localUser; }, [localUser]);

  const broadcastToChannel = useCallback((type: string, payload: unknown) => {
    channelRef.current?.publish(type, payload).catch(() => {});
  }, []);

  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    broadcastToChannel("speaking-state", { isSpeaking, peerId: peerRef.current?.id });
  }, [broadcastToChannel]);

  const broadcastFlowMode = useCallback((isInFlowMode: boolean) => {
    broadcastToChannel("flow-mode", { isInFlowMode, peerId: peerRef.current?.id });
  }, [broadcastToChannel]);

  const broadcastMuteState = useCallback((isMuted: boolean) => {
    broadcastToChannel("mute-state", { isMuted, peerId: peerRef.current?.id });
  }, [broadcastToChannel]);

  const broadcastTrackInfo = useCallback((track: TrackInfoPayload) => {
    if (!isHostRef.current) return;
    broadcastToChannel("track-info", track);
  }, [broadcastToChannel]);

  const sendPingTo = useCallback((targetPeerId: string) => {
    broadcastToChannel("ping", { targetPeerId, fromName: localUserRef.current?.displayName ?? "Someone" });
  }, [broadcastToChannel]);

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

      // Get Ably token from our API
      const tokenRes = await fetch("/api/ably-token");
      const tokenRequest = await tokenRes.json();

      const { Realtime } = await import("ably");
      const ably = new Realtime({ authCallback: (_data, callback) => callback(null, tokenRequest) });
      ablyRef.current = ably;

      const channel = ably.channels.get(`slopejam-${roomCode}`);
      channelRef.current = channel;

      const { default: Peer } = await import("peerjs");
      const uid = crypto.randomUUID().slice(0, 8);
      const peerId = isHost ? `slopejam-${roomCode}-host` : `slopejam-${roomCode}-${uid}`;

      const peer = new Peer(peerId, {
        debug: 0,
        config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
          {
            urls: "turn:openrelay.metered.ca:443?transport=tcp",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      },
      });

      peer.on("open", (id) => {
        setLocalPeerId(id);
        setIsConnected(true);
        setIsConnecting(false);
        peerRef.current = peer;

        // Announce presence on Ably channel
        channel.publish("join", {
          peerId: id,
          displayName: localUserRef.current.displayName,
          hasSpotify: localUserRef.current.hasSpotify,
          isHost,
        });

        // Subscribe to channel messages
        channel.subscribe((msg) => {
          const data = msg.data as Record<string, unknown>;
          const remotePeerId = data.peerId as string;
          if (!remotePeerId || remotePeerId === id) return;

          switch (msg.name) {
            case "join": {
              // Connect to new peer via WebRTC
              if (!connectionsRef.current.has(remotePeerId) && localStreamRef.current) {
                const mediaConn = peer.call(remotePeerId, localStreamRef.current);
                const conn: PeerConn = { peerId: remotePeerId, mediaConnection: mediaConn, audioElement: null };
                connectionsRef.current.set(remotePeerId, conn);

                mediaConn.on("stream", (remoteStream) => {
                  const audio = new Audio();
                  audio.srcObject = remoteStream;
                  audio.autoplay = true;
                  audio.preload = "auto";
                  conn.audioElement = audio;
                  audio.play().catch(() => {});
                });
              }

              onParticipantJoin?.({
                id: crypto.randomUUID(),
                peerId: remotePeerId,
                displayName: data.displayName as string,
                hasSpotify: data.hasSpotify as boolean,
                isHost: data.isHost as boolean,
                isSpeaking: false,
                isMuted: false,
                isInFlowMode: false,
              });
              setParticipantCount(prev => prev + 1);
              break;
            }
            case "leave": {
              onParticipantLeave?.(remotePeerId);
              const conn = connectionsRef.current.get(remotePeerId);
              if (conn) { conn.mediaConnection?.close(); conn.audioElement?.pause(); }
              connectionsRef.current.delete(remotePeerId);
              setParticipantCount(prev => Math.max(1, prev - 1));
              break;
            }
            case "speaking-state":
              onRemoteSpeaking?.(remotePeerId, data.isSpeaking as boolean);
              onParticipantUpdate?.(remotePeerId, { isSpeaking: data.isSpeaking as boolean });
              break;
            case "flow-mode":
              onParticipantUpdate?.(remotePeerId, { isInFlowMode: data.isInFlowMode as boolean });
              break;
            case "mute-state":
              onParticipantUpdate?.(remotePeerId, { isMuted: data.isMuted as boolean });
              break;
            case "ping":
              if (data.targetPeerId === id) onPingReceived?.(data.fromName as string);
              break;
            case "track-info":
              if (!isHostRef.current) onTrackInfo?.(data as unknown as TrackInfoPayload);
              break;
          }
        });
      });

      // Handle incoming WebRTC calls
      peer.on("call", (mediaConn) => {
        if (localStreamRef.current) mediaConn.answer(localStreamRef.current);
        const remotePeerId = mediaConn.peer;
        let conn = connectionsRef.current.get(remotePeerId);
        if (!conn) {
          conn = { peerId: remotePeerId, mediaConnection: mediaConn, audioElement: null };
          connectionsRef.current.set(remotePeerId, conn);
        }
        mediaConn.on("stream", (remoteStream) => {
          const audio = new Audio();
          audio.srcObject = remoteStream;
          audio.autoplay = true;
          audio.preload = "auto";
          conn!.audioElement = audio;
          audio.play().catch(() => {});
        });
      });

      peer.on("error", (err) => {
        if (err.type !== "peer-unavailable") setError(err.message);
        setIsConnecting(false);
      });

      peer.on("disconnected", () => { setIsConnected(false); peer.reconnect(); });

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  }, [roomCode, isHost, onParticipantJoin, onParticipantLeave, onParticipantUpdate, onRemoteSpeaking, onPingReceived, onTrackInfo]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) { audioTrack.enabled = !audioTrack.enabled; setIsMicMuted(!audioTrack.enabled); }
    }
  }, []);

  const connectToPeer = useCallback((_peerId: string) => {
    // Connections now handled via Ably presence — no manual connect needed
  }, []);

  useEffect(() => {
    return () => {
      channelRef.current?.publish("leave", { peerId: peerRef.current?.id }).catch(() => {});
      channelRef.current?.unsubscribe();
      ablyRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      connectionsRef.current.forEach((conn) => { conn.mediaConnection?.close(); conn.audioElement?.pause(); });
      peerRef.current?.destroy();
    };
  }, []);

  return { isConnected, isConnecting, localPeerId, error, participantCount, localStream, initializePeer, connectToPeer, toggleMute, isMicMuted, broadcastSpeakingState, broadcastFlowMode, broadcastMuteState, broadcastTrackInfo, sendPingTo };
}
