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
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement | null;
}

export function usePeerVoice(options: UsePeerVoiceOptions) {
  const {
    roomCode, localUser, isHost,
    onParticipantJoin, onParticipantLeave, onParticipantUpdate,
    onRemoteSpeaking, onPingReceived, onTrackInfo,
  } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [localPeerId, setLocalPeerId] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMicMuted, setIsMicMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [participantCount, setParticipantCount] = useState(1);

  const ablyRef = useRef<import("ably").Realtime | null>(null);
  const channelRef = useRef<import("ably").RealtimeChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localUserRef = useRef(localUser);
  const isHostRef = useRef(isHost);
  useEffect(() => { isHostRef.current = isHost; }, [isHost]);
  const myPeerIdRef = useRef<string | null>(null);
  const peersRef = useRef<Map<string, PeerConn>>(new Map());
  const joinedPeerIdsRef = useRef<Set<string>>(new Set());
  const iceConfigRef = useRef<RTCConfiguration>({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

  useEffect(() => { localUserRef.current = localUser; }, [localUser]);

  const publish = useCallback((type: string, payload: unknown) => {
    channelRef.current?.publish(type, payload).catch(() => {});
  }, []);

  const broadcastSpeakingState = useCallback((isSpeaking: boolean) => {
    publish("speaking-state", { isSpeaking, peerId: myPeerIdRef.current });
  }, [publish]);

  const broadcastFlowMode = useCallback((isInFlowMode: boolean) => {
    publish("flow-mode", { isInFlowMode, peerId: myPeerIdRef.current });
  }, [publish]);

  const broadcastMuteState = useCallback((isMuted: boolean) => {
    publish("mute-state", { isMuted, peerId: myPeerIdRef.current });
  }, [publish]);

  const broadcastTrackInfo = useCallback((track: TrackInfoPayload) => {
    if (!isHostRef.current) return;
    publish("track-info", { ...track, peerId: myPeerIdRef.current });
  }, [publish]);

  const sendPingTo = useCallback((targetPeerId: string) => {
    publish("ping", {
      targetPeerId,
      fromName: localUserRef.current?.displayName ?? "Someone",
      peerId: myPeerIdRef.current,
    });
  }, [publish]);

  const connectToPeer = useCallback((_peerId: string) => {}, []);

  const createPC = useCallback((remotePeerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(iceConfigRef.current);

    // Add local audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    // Play remote audio when tracks arrive
    pc.ontrack = (event) => {
      const conn = peersRef.current.get(remotePeerId);
      if (!conn) return;
      const audio = new Audio();
      audio.srcObject = event.streams[0];
      audio.autoplay = true;
      conn.audioEl = audio;
      audio.play().catch(() => {});
    };

    // Send ICE candidates via Ably
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        publish("ice-candidate", {
          targetPeerId: remotePeerId,
          candidate: event.candidate.toJSON(),
          peerId: myPeerIdRef.current,
        });
      }
    };

    return pc;
  }, [publish]);

 const initiateCall = useCallback(async (remotePeerId: string) => {
  console.log("INITIATE CALL to:", remotePeerId, "myId:", myPeerIdRef.current);
  if (peersRef.current.has(remotePeerId)) return;
  if (remotePeerId === myPeerIdRef.current) return;

    const pc = createPC(remotePeerId);
    peersRef.current.set(remotePeerId, { peerId: remotePeerId, pc, audioEl: null });

    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true });
      await pc.setLocalDescription(offer);
      console.log("SENDING OFFER to:", remotePeerId, "from:", myPeerIdRef.current);
publish("offer", {
      publish("offer", {
        targetPeerId: remotePeerId,
        offer: { type: offer.type, sdp: offer.sdp },
        peerId: myPeerIdRef.current,
      });
    } catch (err) {
      console.error("Offer failed:", err);
      peersRef.current.delete(remotePeerId);
      pc.close();
    }
  }, [createPC, publish]);

  const initializePeer = useCallback(async (existingStream?: MediaStream) => {
   console.log("INITIALIZE PEER CALLED, already exists:", !!ablyRef.current);
    if (ablyRef.current) return;
    setIsConnecting(true);
    setError(null);

    try {
      // Single stream — used for both VAD and WebRTC
      const stream = existingStream ?? await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      localStreamRef.current = stream;
      setLocalStream(stream);

      // Load TURN credentials
      const turnRes = await fetch("/api/turn-credentials");
      const turnData = await turnRes.json();
      iceConfigRef.current = {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          ...turnData.urls.map((url: string) => ({
            urls: url,
            username: turnData.username,
            credential: turnData.credential,
          })),
        ],
      };

      // Connect Ably
      const tokenRes = await fetch("/api/ably-token");
      const tokenRequest = await tokenRes.json();
      const { Realtime } = await import("ably");
      const ably = new Realtime({
        authCallback: (_data, callback) => callback(null, tokenRequest),
      });
      ablyRef.current = ably;

      const myPeerId = crypto.randomUUID();
      myPeerIdRef.current = myPeerId;

      const channel = ably.channels.get(`slopejam-${roomCode}`, {
        params: { rewind: "0" },
      });
      channelRef.current = channel;

      channel.subscribe((msg) => {
        const data = msg.data as Record<string, unknown>;
        const fromPeerId = data.peerId as string;
        if (!fromPeerId || fromPeerId === myPeerId) return;

        switch (msg.name) {
          case "join": {
  console.log("JOIN RECEIVED from:", fromPeerId, data.displayName);
            if (joinedPeerIdsRef.current.has(fromPeerId)) break;
            const displayName = data.displayName as string;
            const nameKey = `name-${displayName}`;
            if (joinedPeerIdsRef.current.has(nameKey)) break;
            joinedPeerIdsRef.current.add(fromPeerId);
            joinedPeerIdsRef.current.add(nameKey);

            onParticipantJoin?.({
              id: crypto.randomUUID(),
              peerId: fromPeerId,
              displayName,
              hasSpotify: data.hasSpotify as boolean,
              isHost: data.isHost as boolean,
              isSpeaking: false,
              isMuted: false,
              isInFlowMode: false,
            });
            setParticipantCount(prev => prev + 1);

         // Host calls each new guest
console.log("IS HOST:", isHostRef.current, "will call:", fromPeerId);
if (isHostRef.current) {
  setTimeout(() => initiateCall(fromPeerId), 500);
}
            break;
          }

          case "offer": {
  console.log("OFFER RECEIVED, target:", data.targetPeerId, "myId:", myPeerId, "match:", data.targetPeerId === myPeerId);
  if (data.targetPeerId !== myPeerId) break;
  (async () => {
    console.log("PROCESSING OFFER from:", fromPeerId);
              let conn = peersRef.current.get(fromPeerId);
if (!conn) {
  const pc = createPC(fromPeerId);
  // Add local tracks so the other side can hear us
  if (localStreamRef.current) {
    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current!);
    });
  }
  conn = { peerId: fromPeerId, pc, audioEl: null };
  peersRef.current.set(fromPeerId, conn);
}
              try {
                await conn.pc.setRemoteDescription(
                  new RTCSessionDescription(data.offer as RTCSessionDescriptionInit)
                );
                const answer = await conn.pc.createAnswer({ offerToReceiveAudio: true });
                await conn.pc.setLocalDescription(answer);
                publish("answer", {
                  targetPeerId: fromPeerId,
                  answer: { type: answer.type, sdp: answer.sdp },
                  peerId: myPeerId,
                });
              } catch (err) {
                console.error("Answer failed:", err);
              }
            })();
            break;
          }

          case "answer": {
            if (data.targetPeerId !== myPeerId) break;
            const conn = peersRef.current.get(fromPeerId);
            if (conn) {
              conn.pc.setRemoteDescription(
                new RTCSessionDescription(data.answer as RTCSessionDescriptionInit)
              ).catch(err => console.error("Set answer failed:", err));
            }
            break;
          }

          case "ice-candidate": {
            if (data.targetPeerId !== myPeerId) break;
            const conn = peersRef.current.get(fromPeerId);
            if (conn && data.candidate) {
              conn.pc.addIceCandidate(
                new RTCIceCandidate(data.candidate as RTCIceCandidateInit)
              ).catch(err => console.error("ICE candidate failed:", err));
            }
            break;
          }

          case "leave": {
            onParticipantLeave?.(fromPeerId);
            const conn = peersRef.current.get(fromPeerId);
            if (conn) { conn.pc.close(); conn.audioEl?.pause(); }
            peersRef.current.delete(fromPeerId);
            joinedPeerIdsRef.current.delete(fromPeerId);
            setParticipantCount(prev => Math.max(1, prev - 1));
            break;
          }

          case "speaking-state":
            onRemoteSpeaking?.(fromPeerId, data.isSpeaking as boolean);
            onParticipantUpdate?.(fromPeerId, { isSpeaking: data.isSpeaking as boolean });
            break;

          case "flow-mode":
            onParticipantUpdate?.(fromPeerId, { isInFlowMode: data.isInFlowMode as boolean });
            break;

          case "mute-state":
            onParticipantUpdate?.(fromPeerId, { isMuted: data.isMuted as boolean });
            break;

          case "ping":
            if (data.targetPeerId === myPeerId) onPingReceived?.(data.fromName as string);
            break;

          case "track-info":
            if (!isHostRef.current) onTrackInfo?.(data as unknown as TrackInfoPayload);
            break;
        }
      });

      // Announce presence after subscribing
      setTimeout(() => {
        publish("join", {
          peerId: myPeerId,
          displayName: localUserRef.current.displayName,
          hasSpotify: localUserRef.current.hasSpotify,
          isHost,
        });
      }, 300);

      setLocalPeerId(myPeerId);
      setIsConnected(true);
      setIsConnecting(false);

    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect");
      setIsConnecting(false);
    }
  }, [roomCode, isHost, onParticipantJoin, onParticipantLeave, onParticipantUpdate,
      onRemoteSpeaking, onPingReceived, onTrackInfo, publish, createPC, initiateCall]);

  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) { track.enabled = !track.enabled; setIsMicMuted(!track.enabled); }
    }
  }, []);

  useEffect(() => {
    return () => {
      publish("leave", { peerId: myPeerIdRef.current });
      channelRef.current?.unsubscribe();
      ablyRef.current?.close();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      peersRef.current.forEach(conn => { conn.pc.close(); conn.audioEl?.pause(); });
    };
  }, [publish]);

  return {
    isConnected, isConnecting, localPeerId, error, participantCount,
    localStream, initializePeer, connectToPeer, toggleMute, isMicMuted,
    broadcastSpeakingState, broadcastFlowMode, broadcastMuteState,
    broadcastTrackInfo, sendPingTo,
  };
}
