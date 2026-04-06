"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { RoomParticipant } from "@/contexts/room-context";

interface TrackInfoPayload {
  isPlaying: boolean;
  title?: string;
  artist?: string;
  album?: string;
  albumArt?: string;
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
  const myPeerIdRef = useRef<string | null>(null);
  const joinedPeerIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => { localUserRef.current = localUser; }, [localUser]);

  const publishToChannel = useCallback((type: string, payload: unknown) => {
    channelRef.current?.publish(type, payload).catch(() => {});
  }, []);

  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    publishToChannel("speaking-state", { isSpeaking, peerId: myPeerIdRef.current });
  }, [publishToChannel]);

  const broadcastFlowMode = useCallback((isInFlowMode: boolean) => {
    publishToChannel("flow-mode", { isInFlowMode, peerId: myPeerIdRef.current });
  }, [publishToChannel]);

  const broadcastMuteState = useCallback((isMuted: boolean) => {
    publishToChannel("mute-state", { isMuted, peerId: myPeerIdRef.current });
  }, [publishToChannel]);

  const broadcastTrackInfo = useCallback((track: TrackInfoPayload) => {
    if (!isHostRef.current) return;
    publishToChannel("track-info", { ...track, peerId: myPeerIdRef.current });
  }, [publishToChannel]);

  const sendPingTo = useCallback((targetPeerId: string) => {
    publishToChannel("ping", { targetPeerId, fromName: localUserRef.current?.displayName ?? "Someone", peerId: myPeerIdRef.current });
  }, [publishToChannel]);

  const connectToPeer = useCallback((_peerId: string) => {}, []);

  const makeAudioConnection = useCallback((remotePeerId: string) => {
    if (!peerRef.current || !localStreamRef.current) return;
    if (connectionsRef.current.has(remotePeerId)) return;
    if (!remotePeerId || remotePeerId === myPeerIdRef.current) return;


    const mediaConn = peerRef.current.call(remotePeerId, localStreamRef.current);
    if (!mediaConn) return;

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
  }, []);

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

  const [tokenRes, turnRes] = await Promise.all([
  fetch("/api/ably-token"),
  fetch("/api/turn-credentials"),
]);
const tokenRequest = await tokenRes.json();
const turnCredentials = await turnRes.json();

      const { Realtime } = await import("ably");
      const ably = new Realtime({ authCallback: (_data, callback) => callback(null, tokenRequest) });
      ablyRef.current = ably;

      const channel = ably.channels.get(`slopejam-${roomCode}`, {
  params: { rewind: "0" }
});
      channelRef.current = channel;

      const { default: Peer } = await import("peerjs");
      const uid = crypto.randomUUID().slice(0, 8);
      const timestamp = Date.now().toString(36);
      const peerId = isHost
        ? `slopejam-${roomCode}-host-${timestamp}`
        : `slopejam-${roomCode}-${uid}`;

      const peer = new Peer(peerId, {
        debug: 0,
        config: {
          iceServers: [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  {
    urls: turnCredentials.urls,
    username: turnCredentials.username,
    credential: turnCredentials.credential,
  },
          ],
        },
      });

      peer.on("open", (id) => {
        myPeerIdRef.current = id;
        peerRef.current = peer;
        setLocalPeerId(id);
        setIsConnected(true);
        setIsConnecting(false);

        // Subscribe BEFORE announcing so we don't miss responses
        channel.subscribe((msg) => {
          const data = msg.data as Record<string, unknown>;
          const remotePeerId = data.peerId as string;

          // FIX: ignore our own messages
          if (!remotePeerId || remotePeerId === myPeerIdRef.current) return;

          switch (msg.name) {
            case "join": {
              // FIX: deduplicate
              if (joinedPeerIdsRef.current.has(remotePeerId)) break;
const displayName = data.displayName as string;
const nameKey = `name-${displayName}`;
if (joinedPeerIdsRef.current.has(nameKey)) break;
joinedPeerIdsRef.current.add(remotePeerId);
joinedPeerIdsRef.current.add(nameKey);

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

              // If I'm host, call the new guest AND re-announce so late joiners get my ID
             if (isHostRef.current) {
  makeAudioConnection(remotePeerId);
              }
              break;
            }

            case "host-announce": {
              // Guest connects to host via WebRTC
              if (!isHostRef.current) {
                const hostPeerId = data.hostPeerId as string;
                if (hostPeerId && hostPeerId !== myPeerIdRef.current) {
                  makeAudioConnection(hostPeerId);
                }
              }
              break;
            }

            case "leave": {
              onParticipantLeave?.(remotePeerId);
              const conn = connectionsRef.current.get(remotePeerId);
              if (conn) { conn.mediaConnection?.close(); conn.audioElement?.pause(); }
              connectionsRef.current.delete(remotePeerId);
              joinedPeerIdsRef.current.delete(remotePeerId);
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
              if (data.targetPeerId === myPeerIdRef.current) onPingReceived?.(data.fromName as string);
              break;

            case "track-info":
              if (!isHostRef.current) onTrackInfo?.(data as unknown as TrackInfoPayload);
              break;
          }
        });

        // Small delay ensures subscribe is ready before we announce
        setTimeout(() => {
          publishToChannel("join", {
            peerId: id,
            displayName: localUserRef.current.displayName,
            hasSpotify: localUserRef.current.hasSpotify,
            isHost,
          });

          if (isHost) {
            publishToChannel("host-announce", { hostPeerId: id, peerId: id });
          }
        }, 500);
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
  }, [roomCode, isHost, onParticipantJoin, onParticipantLeave, onParticipantUpdate, onRemoteSpeaking, onPingReceived, onTrackInfo, makeAudioConnection, publishToChannel]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) { audioTrack.enabled = !audioTrack.enabled; setIsMicMuted(!audioTrack.enabled); }
    }
  }, []);

  useEffect(() => {
    return () => {
      publishToChannel("leave", { peerId: myPeerIdRef.current });
      channelRef.current?.unsubscribe();
      ablyRef.current?.close();
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      connectionsRef.current.forEach((conn) => { conn.mediaConnection?.close(); conn.audioElement?.pause(); });
      peerRef.current?.destroy();
    };
  }, [publishToChannel]);

  return { isConnected, isConnecting, localPeerId, error, participantCount, localStream, initializePeer, connectToPeer, toggleMute, isMicMuted, broadcastSpeakingState, broadcastFlowMode, broadcastMuteState, broadcastTrackInfo, sendPingTo };
}
