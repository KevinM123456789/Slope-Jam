import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const session = await auth();

  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { volumePercent } = await request.json();

  try {
    await fetch(
      `https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(volumePercent)}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${session.accessToken}` },
      }
    );
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Volume control error:", error);
    return NextResponse.json({ error: "Failed to set volume" }, { status: 500 });
  }
}
