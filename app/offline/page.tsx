"use client";

import { WifiOff, Mountain } from "lucide-react";

export default function OfflinePage() {
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-6 text-center">
      <div className="relative mb-8">
        <Mountain className="w-24 h-24 text-muted-foreground" />
        <WifiOff className="w-10 h-10 text-orange absolute -bottom-2 -right-2" />
      </div>
      <h1 className="text-3xl font-bold text-foreground mb-4">
        No Signal on the Slopes
      </h1>
      <p className="text-muted-foreground text-lg max-w-sm mb-8">
        Looks like you&apos;ve hit a dead zone. The app will reconnect automatically when you&apos;re back in range.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-8 py-4 bg-orange text-orange-foreground font-semibold text-lg rounded-2xl active:scale-95 transition-transform"
      >
        Try Again
      </button>
    </main>
  );
}
