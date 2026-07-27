import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncGoogleConnection } from "@/lib/sync/google";

/**
 * Google Calendar push notifications don't carry a body — they just tell us
 * "something changed on this channel," identified by the X-Goog-Channel-Id
 * header we set when calling events.watch(). We look up which connection that
 * channel belongs to and re-run an incremental sync for it.
 */
export async function POST(request: NextRequest) {
  const channelId = request.headers.get("x-goog-channel-id");
  const resourceState = request.headers.get("x-goog-resource-state");

  if (!channelId) return NextResponse.json({ ok: true });
  if (resourceState === "sync") {
    // Initial sync handshake sent when the channel is first created; nothing to do.
    return NextResponse.json({ ok: true });
  }

  const channel = await prisma.webhookChannel.findFirst({
    where: { channelId, provider: "GOOGLE" },
  });
  if (!channel) return NextResponse.json({ ok: true });

  try {
    await syncGoogleConnection(channel.connectionId);
  } catch (err) {
    console.error("Google webhook sync failed", err);
  }

  return NextResponse.json({ ok: true });
}
