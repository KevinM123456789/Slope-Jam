import { auth } from "@/lib/auth";
import { getCurrentPlayback } from "@/lib/spotify";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ isPlaying: false }, { status: 401 });
  }

  try {
    const playback = await getCurrentPlayback(session.accessToken);

    if (!playback || !playback.item) {
      return NextResponse.json({ isPlaying: false });
    }

    return NextResponse.json({
      isPlaying: playback.is_playing,
      title: playback.item.name,
      artist: playback.item.artists.map((a) => a.name).join(", "),
      album: playback.item.album.name,
      albumArt: playback.item.album.images[0]?.url,
    });
  } catch (error) {
    console.error("Error fetching now playing:", error);
    return NextResponse.json({ isPlaying: false });
  }
}
