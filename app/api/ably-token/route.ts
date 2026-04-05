import { NextResponse } from "next/server";
import Ably from "ably";

export async function GET() {
  const client = new Ably.Rest(process.env.ABLY_API_KEY!);
  const tokenRequest = await client.auth.createTokenRequest({
    clientId: crypto.randomUUID(),
  });
  return NextResponse.json(tokenRequest);
}
