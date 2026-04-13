import { auth } from "@/lib/auth";
import { 
  pausePlayback, 
  resumePlayback, 
  skipToNext,
  skipToPrevious,
} from "@/lib/spotify";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { action } = await request.json();
    const accessToken = session.accessToken;

    switch (action) {
      case "play":
        await resumePlayback(accessToken);
        return NextResponse.json({ success: true, action: "play" });
      
      case "pause":
        await pausePlayback(accessToken);
        return NextResponse.json({ success: true, action: "pause" });
      
      case "next":
        await skipToNext(accessToken);
        return NextResponse.json({ success: true, action: "next" });

      case "previous":
        await skipToPrevious(accessToken);
        return NextResponse.json({ success: true, action: "previous" });
      
      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }
 } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error controlling playback:", message);
    return NextResponse.json(
      { error: "Failed to control playback", detail: message },
      { status: 500 }
    );
  }
}
