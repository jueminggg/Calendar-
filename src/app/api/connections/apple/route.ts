import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { verifyAppleCredentials, listAppleCalendars } from "@/lib/providers/apple";
import { syncAppleConnection } from "@/lib/sync/apple";

const connectSchema = z.object({
  username: z.string().email(),
  appSpecificPassword: z.string().min(1),
  serverUrl: z.string().url().optional(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = connectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { username, appSpecificPassword, serverUrl } = parsed.data;

  let client;
  try {
    client = await verifyAppleCredentials(username, appSpecificPassword, serverUrl);
  } catch {
    return NextResponse.json(
      { error: "Couldn't sign in to iCloud. Double-check the email and app-specific password." },
      { status: 401 },
    );
  }

  const connection = await prisma.calendarConnection.upsert({
    where: { userId_provider_label: { userId: session.userId, provider: "APPLE", label: username } },
    create: {
      userId: session.userId,
      provider: "APPLE",
      label: username,
      caldavUsername: username,
      caldavPassword: encrypt(appSpecificPassword),
      caldavServerUrl: serverUrl,
      status: "ACTIVE",
    },
    update: {
      caldavPassword: encrypt(appSpecificPassword),
      caldavServerUrl: serverUrl,
      status: "ACTIVE",
      lastError: null,
    },
  });

  const calendars = await listAppleCalendars(client);
  for (const cal of calendars) {
    await prisma.calendarList.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: cal.externalId } },
      create: {
        connectionId: connection.id,
        externalId: cal.externalId,
        name: cal.name,
        color: cal.color,
      },
      update: { name: cal.name, color: cal.color },
    });
  }

  try {
    await syncAppleConnection(connection.id, /* isInitialSync */ true);
  } catch (err) {
    return NextResponse.json({
      ok: true,
      warning: `Connected, but the first sync failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return NextResponse.json({ ok: true });
}
