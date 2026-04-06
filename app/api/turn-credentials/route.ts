import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    urls: [
      `turn:${process.env.TURN_URL}:80`,
      `turn:${process.env.TURN_URL}:443`,
      `turn:${process.env.TURN_URL}:443?transport=tcp`,
    ],
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_PASSWORD,
  });
}
