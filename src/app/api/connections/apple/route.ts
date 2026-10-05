import { NextResponse, after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { verifyAppleCredentials, listAppleCalendars } from "@/lib/providers/apple";
import { syncAppleConnection } from "@/lib/sync/apple";

const connectSchema = z.object({
  // Trimmed before validating: autofill and paste routinely leave a trailing
  // space, and Apple rejects the credential without saying why -- which is
  // indistinguishable from genuinely wrong details.
  username: z.string().trim().email(),
  appSpecificPassword: z.string().trim().min(1),
  serverUrl: z.string().trim().url().optional(),
});

/**
 * Apple's own complaint, made safe to show. This app is private and
 * invite-gated, so the real reason beats a generic line by a mile. The
 * password is redacted first, in case a client library ever echoes the
 * request it built back in the error.
 */
function appleFailureMessage(error: unknown, secret: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  const detail = (secret ? raw.split(secret).join("***") : raw).replace(/\s+/g, " ").trim().slice(0, 300);

  if (/\b401\b|unauthoriz|authenticat|forbidden|\b403\b/i.test(detail)) {
    return "Apple rejected those credentials. Use the Apple ID itself (an @icloud.com address works most reliably) with a freshly generated app-specific password.";
  }
  if (!detail) {
    return "Couldn't reach iCloud, and Apple gave no reason. Try again shortly.";
  }
  return `Couldn't sign in to iCloud. Apple said: ${detail}`;
}

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
  } catch (error) {
    // This used to be a bare catch, so a wrong password, an Apple outage and
    // a request that never left the building all produced the same sentence
    // with nothing in the logs either.
    console.error("iCloud connect failed for", username, error);
    return NextResponse.json({ error: appleFailureMessage(error, appSpecificPassword) }, { status: 401 });
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

  // Don't make the request wait on the initial sync — respond now, sync in the background.
  after(() => syncAppleConnection(connection.id, /* isInitialSync */ true).catch((err) => console.error("Initial Apple sync failed", err)));

  return NextResponse.json({ ok: true });
}
