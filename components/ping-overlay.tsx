"use client";

import { motion } from "framer-motion";
import { Bell, X } from "lucide-react";
import { useEffect, useRef } from "react";

interface PingOverlayProps {
  fromName: string;
  onDismiss: () => void;
}

// Play a short, high-pitched audio alert that plays over music
function playPingAlert() {
  try {
    const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    
    // Create a short, attention-grabbing high-pitched alert
    const oscillator1 = audioContext.createOscillator();
    const oscillator2 = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator1.connect(gainNode);
    oscillator2.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // High-pitched dual-tone alert (like a notification ping)
    oscillator1.type = "sine";
    oscillator2.type = "sine";
    
    // First beep
    oscillator1.frequency.setValueAtTime(1800, audioContext.currentTime);
    oscillator2.frequency.setValueAtTime(2200, audioContext.currentTime);
    
    // Second beep (higher)
    oscillator1.frequency.setValueAtTime(2000, audioContext.currentTime + 0.12);
    oscillator2.frequency.setValueAtTime(2400, audioContext.currentTime + 0.12);
    
    // Third beep (highest - attention!)
    oscillator1.frequency.setValueAtTime(2200, audioContext.currentTime + 0.24);
    oscillator2.frequency.setValueAtTime(2600, audioContext.currentTime + 0.24);
    
    // Volume envelope - loud enough to hear over music
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.02);
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + 0.1);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.12);
    gainNode.gain.linearRampToValueAtTime(0.5, audioContext.currentTime + 0.14);
    gainNode.gain.setValueAtTime(0.5, audioContext.currentTime + 0.22);
    gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.24);
    gainNode.gain.linearRampToValueAtTime(0.6, audioContext.currentTime + 0.26);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.4);
    
    oscillator1.start(audioContext.currentTime);
    oscillator2.start(audioContext.currentTime);
    oscillator1.stop(audioContext.currentTime + 0.4);
    oscillator2.stop(audioContext.currentTime + 0.4);
    
    // Vibrate pattern
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 150]);
    }
  } catch {
    // Audio not available, still try vibration
    if (navigator.vibrate) {
      navigator.vibrate([100, 50, 100, 50, 150]);
    }
  }
}

export function PingOverlay({ fromName, onDismiss }: PingOverlayProps) {
  const hasPlayedAlert = useRef(false);

  // Play alert sound once
  useEffect(() => {
    if (!hasPlayedAlert.current) {
      hasPlayedAlert.current = true;
      playPingAlert();
    }
  }, []);

  // Auto-dismiss after 4 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-red-500/20 backdrop-blur-sm"
      onClick={onDismiss}
    >
      <motion.div
        initial={{ scale: 0.5, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.8, opacity: 0, y: -20 }}
        transition={{ type: "spring", damping: 15, stiffness: 300 }}
        className="relative bg-card border-2 border-red-500 rounded-2xl p-6 mx-4 max-w-xs w-full shadow-2xl shadow-red-500/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-3 right-3 p-1.5 rounded-full bg-muted text-muted-foreground hover:bg-muted/80 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Ping content */}
        <div className="flex items-center gap-4">
          {/* Animated bell */}
          <motion.div
            animate={{
              rotate: [0, -15, 15, -15, 15, 0],
              scale: [1, 1.1, 1, 1.1, 1],
            }}
            transition={{
              duration: 0.6,
              repeat: 2,
            }}
            className="w-14 h-14 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0"
          >
            <Bell className="w-7 h-7 text-white" />
          </motion.div>

          {/* Message */}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold text-foreground truncate">
              {fromName}
            </p>
            <p className="text-sm text-red-400 font-medium">
              is trying to reach you!
            </p>
          </div>
        </div>

        {/* Tap to dismiss hint */}
        <p className="text-xs text-muted-foreground text-center mt-4">
          Tap anywhere to dismiss
        </p>
      </motion.div>
    </motion.div>
  );
}
