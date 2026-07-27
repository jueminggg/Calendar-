import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncMicrosoftConnection } from "@/lib/sync/microsoft";

type GraphNotification = {
  subscriptionId: string;
  clientState?: string;
  changeType: string;
};

export async function POST(request: NextRequest) {
  // Graph's subscription-creation handshake: echo the validation token back as plain text.
  const validationToken = request.nextUrl.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const body = await request.json().catch(() => null);
  const notifications: GraphNotification[] = body?.value ?? [];

  const expectedSecret = process.env.MICROSOFT_WEBHOOK_SECRET ?? "";
  const connectionIds = new Set<string>();

  for (const notification of notifications) {
    if (expectedSecret && notification.clientState !== expectedSecret) continue;

    const channel = await prisma.webhookChannel.findFirst({
      where: { channelId: notification.subscriptionId, provider: "MICROSOFT" },
    });
    if (channel) connectionIds.add(channel.connectionId);
  }

  for (const connectionId of connectionIds) {
    try {
      await syncMicrosoftConnection(connectionId);
    } catch (err) {
      console.error("Microsoft webhook sync failed", err);
    }
  }

  return NextResponse.json({ ok: true });
}
