"use client";

import { useState, useEffect, useCallback } from "react";
import { Users, Mic, MicOff, VolumeX, Volume2, Headphones, Crown, Bell } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { RoomParticipant } from "@/contexts/room-context";

interface ParticipantsListProps {
  participants: RoomParticipant[];
  onMuteParticipant: (participantId: string) => void;
  onPingParticipant?: (peerId: string) => void;
  isUserSpeaking?: boolean;
  localUserId?: string;
  isPinged?: boolean; // Whether the local user has been pinged
}

// Animated audio wave bars component
function AudioWave({ color = "bg-green-400" }: { color?: string }) {
  return (
    <div className="flex items-end gap-0.5 h-5">
      {[0, 1, 2, 3].map((i) => (
        <motion.div
          key={i}
          className={`w-1 rounded-full ${color}`}
          initial={{ height: 4 }}
          animate={{
            height: [4, 12 + Math.random() * 8, 6, 16 + Math.random() * 4, 4],
          }}
          transition={{
            duration: 0.8,
            repeat: Infinity,
            repeatType: "loop",
            delay: i * 0.1,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}

export function ParticipantsList({ 
  participants, 
  onMuteParticipant, 
  onPingParticipant,
  isUserSpeaking = false,
  localUserId,
  isPinged = false,
}: ParticipantsListProps) {
  // Track ping cooldowns per participant (30 seconds)
  const [pingCooldowns, setPingCooldowns] = useState<Record<string, number>>({});
  
  // Handle ping with cooldown
  const handlePing = useCallback((peerId: string) => {
    if (pingCooldowns[peerId]) return; // Still on cooldown
    
    onPingParticipant?.(peerId);
    
    // Set 30 second cooldown
    setPingCooldowns(prev => ({ ...prev, [peerId]: 30 }));
  }, [pingCooldowns, onPingParticipant]);
  
  // Countdown timer for cooldowns
  useEffect(() => {
    const hasActiveCooldowns = Object.values(pingCooldowns).some(v => v > 0);
    if (!hasActiveCooldowns) return;
    
    const interval = setInterval(() => {
      setPingCooldowns(prev => {
        const updated = { ...prev };
        Object.keys(updated).forEach(key => {
          if (updated[key] > 0) {
            updated[key] -= 1;
          } else {
            delete updated[key];
          }
        });
        return updated;
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, [pingCooldowns]);
  return (
    <div className="bg-card rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <Users className="w-5 h-5 text-muted-foreground" />
        <span className="text-sm font-medium text-muted-foreground">
          {participants.length} in Jam
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {participants.map((participant) => {
          const isLocalUser = participant.id === localUserId || participant.peerId === localUserId;
          // Only show speaking state if not muted - green glow requires unmuted AND voice activity
          const isSpeaking = isLocalUser 
            ? (isUserSpeaking && !participant.isMuted) 
            : (participant.isSpeaking && !participant.isMuted);
          const isRemoteMuted = !isLocalUser && participant.isMuted;

          return (
            <motion.div
              key={participant.peerId}
              className="relative"
              layout
            >
              {/* Animated glow effect for speaking */}
              <AnimatePresence>
                {isSpeaking && !participant.isInFlowMode && (
                  <motion.div
                    className="absolute inset-0 rounded-xl"
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  >
                    <motion.div
                      className={`absolute inset-0 rounded-xl ${
                        isLocalUser ? "bg-green-400/20" : "bg-blue/20"
                      }`}
                      animate={{
                        opacity: [0.3, 0.6, 0.3],
                        scale: [1, 1.02, 1],
                      }}
                      transition={{
                        duration: 1.5,
                        repeat: Infinity,
                        ease: "easeInOut",
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
              
              {/* Main card */}
              <motion.div
                className={`relative flex items-center justify-between px-4 py-3 rounded-xl ${
                  isRemoteMuted ? "bg-muted/50 opacity-60" : "bg-muted"
                } ${participant.isInFlowMode ? "border-l-4 border-blue" : ""}`}
                animate={{
                  borderColor: isSpeaking && !participant.isInFlowMode
                    ? isLocalUser 
                      ? "rgb(74, 222, 128)"
                      : "hsl(var(--blue))"
                    : "transparent",
                  boxShadow: isSpeaking && !participant.isInFlowMode
                    ? isLocalUser
                      ? "0 0 20px rgba(74, 222, 128, 0.5)"
                      : "0 0 20px hsla(var(--blue), 0.5)"
                    : "0 0 0px transparent",
                }}
                style={{
                  borderWidth: participant.isInFlowMode ? undefined : 2,
                  borderStyle: "solid",
                }}
                transition={{ duration: 0.3, ease: "easeOut" }}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {/* Avatar */}
                  <motion.div
                    className={`relative w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                      isLocalUser
                        ? "bg-orange text-orange-foreground"
                        : "bg-secondary text-secondary-foreground"
                    }`}
                    animate={{ scale: isSpeaking && !participant.isInFlowMode ? 1.1 : 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    {participant.displayName.charAt(0).toUpperCase()}
                    
                    {/* Host crown */}
                    {participant.isHost && (
                      <div className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Crown className="w-2.5 h-2.5 text-yellow-900" />
                      </div>
                    )}
                  </motion.div>

                  {/* Name and status */}
                  <div className="flex flex-col min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-foreground font-medium truncate">
                        {participant.displayName}
                        {isLocalUser && " (You)"}
                      </span>
                      
                      {/* Badges */}
                      {!participant.hasSpotify && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue/20 text-blue flex items-center gap-0.5 flex-shrink-0">
                          <Mic className="w-2.5 h-2.5" />
                          <span>Mic Only</span>
                        </span>
                      )}
                      
                      {participant.isInFlowMode && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue/20 text-blue flex items-center gap-0.5 flex-shrink-0">
                          <Headphones className="w-2.5 h-2.5" />
                          <span>Flow</span>
                        </span>
                      )}
                      
                      {/* PINGED badge - Only shown to the local user who was pinged */}
                      <AnimatePresence>
                        {isLocalUser && isPinged && (
                          <motion.span
                            initial={{ scale: 0.5, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.5, opacity: 0 }}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-red-500 text-white font-bold flex items-center gap-1 flex-shrink-0"
                          >
                            <Bell className="w-2.5 h-2.5" />
                            <span>PINGED</span>
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    
                    {/* Speaking indicator text */}
                    <AnimatePresence mode="wait">
                      {isSpeaking && !participant.isInFlowMode ? (
                        <motion.span
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: 4 }}
                          className={`text-xs font-medium ${
                            isLocalUser ? "text-green-400" : "text-blue"
                          }`}
                        >
                          Speaking...
                        </motion.span>
                      ) : (
                        <motion.span
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          className="text-xs text-muted-foreground"
                        >
                          {participant.isInFlowMode 
                            ? "In the zone" 
                            : participant.isMuted 
                            ? "Muted" 
                            : "Listening"}
                        </motion.span>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Audio wave indicator */}
                  <AnimatePresence>
                    {isSpeaking && !participant.isInFlowMode && (
                      <motion.div
                        className="mr-1"
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.8 }}
                      >
                        <AudioWave color={isLocalUser ? "bg-green-400" : "bg-blue"} />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Mic status with glow */}
                  <motion.div
                    className="relative"
                    animate={{
                      scale: isLocalUser && isUserSpeaking ? [1, 1.15, 1] : 1,
                    }}
                    transition={{
                      duration: 0.6,
                      repeat: isLocalUser && isUserSpeaking ? Infinity : 0,
                    }}
                  >
                    <AnimatePresence>
                      {isLocalUser && isUserSpeaking && (
                        <motion.div
                          className="absolute inset-0 -m-3 rounded-full bg-green-400/40 blur-md"
                          initial={{ opacity: 0, scale: 0.5 }}
                          animate={{ opacity: [0.4, 0.8, 0.4], scale: [1, 1.2, 1] }}
                          exit={{ opacity: 0, scale: 0.5 }}
                          transition={{ duration: 1, repeat: Infinity }}
                        />
                      )}
                    </AnimatePresence>
                    
                    {participant.isMuted || participant.isInFlowMode ? (
                      <MicOff className="w-5 h-5 text-muted-foreground relative z-10" />
                    ) : (
                      <motion.div
                        animate={{
                          filter: isLocalUser && isUserSpeaking
                            ? "drop-shadow(0 0 8px rgba(74, 222, 128, 0.8))"
                            : "drop-shadow(0 0 0px transparent)",
                        }}
                      >
                        <Mic className={`w-5 h-5 relative z-10 ${
                          isLocalUser && isUserSpeaking ? "text-green-400" : "text-success"
                        }`} />
                      </motion.div>
                    )}
                  </motion.div>

                  {/* Ping button - Only show for remote users in Flow Mode */}
                  {!isLocalUser && participant.isInFlowMode && (
                    <motion.button
                      onClick={() => handlePing(participant.peerId)}
                      disabled={!!pingCooldowns[participant.peerId]}
                      className={`relative px-3 py-2 rounded-lg font-bold text-xs transition-all active:scale-95 ${
                        pingCooldowns[participant.peerId]
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-red-500 text-white hover:bg-red-600"
                      }`}
                      whileTap={{ scale: 0.95 }}
                      aria-label={`Ping ${participant.displayName}`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5" />
                        <span>
                          {pingCooldowns[participant.peerId] 
                            ? `Ping (${pingCooldowns[participant.peerId]}s)` 
                            : "Ping"}
                        </span>
                      </div>
                    </motion.button>
                  )}

                  {/* Mute button for remote participants */}
                  {!isLocalUser && (
                    <button
                      onClick={() => onMuteParticipant(participant.peerId)}
                      className={`p-2 rounded-lg touch-target transition-all active:scale-95 ${
                        isRemoteMuted
                          ? "bg-destructive/20 text-destructive"
                          : "bg-secondary/50 text-muted-foreground"
                      }`}
                      aria-label={isRemoteMuted ? `Unmute ${participant.displayName}` : `Mute ${participant.displayName}`}
                    >
                      {isRemoteMuted ? (
                        <VolumeX className="w-5 h-5" />
                      ) : (
                        <Volume2 className="w-5 h-5" />
                      )}
                    </button>
                  )}
                </div>
              </motion.div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
