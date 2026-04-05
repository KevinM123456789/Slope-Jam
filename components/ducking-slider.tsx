"use client";

import { Volume2, VolumeX } from "lucide-react";

interface DuckingSliderProps {
  value: number;
  onChange: (value: number) => void;
}

export function DuckingSlider({ value, onChange }: DuckingSliderProps) {
  return (
    <div className="bg-card rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-foreground font-medium">Ducking Sensitivity</h4>
        <span className="text-2xl font-bold text-orange">{value}%</span>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        When someone speaks, music volume drops to this level
      </p>

      {/* Custom Slider */}
      <div className="relative">
        <div className="flex items-center gap-4">
          <VolumeX className="w-5 h-5 text-muted-foreground shrink-0" />
          
          <div className="relative flex-1 h-12 flex items-center">
            {/* Track background */}
            <div className="absolute inset-x-0 h-3 bg-muted rounded-full" />
            
            {/* Filled track */}
            <div
              className="absolute left-0 h-3 bg-orange rounded-full transition-all"
              style={{ width: `${value}%` }}
            />
            
            {/* Slider input */}
            <input
              type="range"
              min="0"
              max="100"
              value={value}
              onChange={(e) => onChange(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-target"
              style={{ touchAction: "none" }}
            />
            
            {/* Thumb */}
            <div
              className="absolute w-8 h-8 bg-orange rounded-full shadow-lg pointer-events-none transition-all flex items-center justify-center"
              style={{ left: `calc(${value}% - 16px)` }}
            >
              <div className="w-3 h-3 bg-orange-foreground rounded-full" />
            </div>
          </div>
          
          <Volume2 className="w-5 h-5 text-muted-foreground shrink-0" />
        </div>
      </div>

      {/* Preset buttons */}
      <div className="flex gap-2 mt-6">
        {[10, 20, 30, 50].map((preset) => (
          <button
            key={preset}
            onClick={() => onChange(preset)}
            className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all active:scale-95 touch-target ${
              value === preset
                ? "bg-orange text-orange-foreground"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {preset}%
          </button>
        ))}
      </div>

      {/* Explanation */}
      <div className="mt-6 p-4 bg-muted rounded-xl">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <strong className="text-foreground">How it works:</strong> When voice
          activity is detected from anyone in the Jam, the music automatically
          fades to your set level so you can hear each other clearly. Music
          returns to full volume when speaking stops.
        </p>
      </div>
    </div>
  );
}
