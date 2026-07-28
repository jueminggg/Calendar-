import { NextRequest, NextResponse, after } from "next/server";
import { createOAuthClient, fetchGoogleAccountEmail, listGoogleCalendars } from "@/lib/providers/google";
import { GOOGLE_STATE_COOKIE } from "@/lib/providers/oauth-state";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { syncGoogleConnection } from "@/lib/sync/google";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(GOOGLE_STATE_COOKIE)?.value;
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/settings/connections?error=${encodeURIComponent(error)}`, request.url));
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings/connections?error=invalid_state", request.url));
  }

  const client = createOAuthClient();
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  const email = await fetchGoogleAccountEmail(client);

  const connection = await prisma.calendarConnection.upsert({
    where: { userId_provider_label: { userId: session.userId, provider: "GOOGLE", label: email } },
    create: {
      userId: session.userId,
      provider: "GOOGLE",
      label: email,
      accessToken: tokens.access_token ? encrypt(tokens.access_token) : null,
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scope: tokens.scope,
      status: "ACTIVE",
    },
    update: {
      accessToken: tokens.access_token ? encrypt(tokens.access_token) : undefined,
      refreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token) : undefined,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
      scope: tokens.scope,
      status: "ACTIVE",
      lastError: null,
    },
  });

  const calendars = await listGoogleCalendars(client);
  for (const cal of calendars) {
    await prisma.calendarList.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: cal.externalId } },
      create: {
        connectionId: connection.id,
        externalId: cal.externalId,
        name: cal.name,
        color: cal.color,
        isPrimary: cal.isPrimary,
      },
      update: { name: cal.name, color: cal.color, isPrimary: cal.isPrimary },
    });
  }

  // Fetching + storing events can take longer than a serverless function is
  // allowed to run, so don't make the user wait on it: redirect immediately
  // and let the initial sync finish in the background.
  after(() => syncGoogleConnection(connection.id, /* isInitialSync */ true));

  const res = NextResponse.redirect(new URL("/settings/connections?connected=google", request.url));
  res.cookies.delete(GOOGLE_STATE_COOKIE);
  return res;
}
