import { NextRequest, NextResponse } from "next/server";
import {
  exchangeMicrosoftCode,
  fetchMicrosoftAccountEmail,
  listMicrosoftCalendars,
} from "@/lib/providers/microsoft";
import { MICROSOFT_STATE_COOKIE } from "@/lib/providers/oauth-state";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { syncMicrosoftConnection } from "@/lib/sync/microsoft";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/login", request.url));

  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const expectedState = request.cookies.get(MICROSOFT_STATE_COOKIE)?.value;
  const error = searchParams.get("error_description") ?? searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/settings/connections?error=${encodeURIComponent(error)}`, request.url));
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/settings/connections?error=invalid_state", request.url));
  }

  const { account, accessToken, expiresOn, serializedCache } = await exchangeMicrosoftCode(code);
  const email = await fetchMicrosoftAccountEmail(accessToken);

  const connection = await prisma.calendarConnection.upsert({
    where: { userId_provider_label: { userId: session.userId, provider: "MICROSOFT", label: email } },
    create: {
      userId: session.userId,
      provider: "MICROSOFT",
      label: email,
      refreshToken: encrypt(serializedCache),
      providerAccountId: account.homeAccountId,
      tokenExpiresAt: expiresOn ?? undefined,
      status: "ACTIVE",
    },
    update: {
      refreshToken: encrypt(serializedCache),
      providerAccountId: account.homeAccountId,
      tokenExpiresAt: expiresOn ?? undefined,
      status: "ACTIVE",
      lastError: null,
    },
  });

  const calendars = await listMicrosoftCalendars(accessToken);
  for (const cal of calendars) {
    await prisma.calendarList.upsert({
      where: { connectionId_externalId: { connectionId: connection.id, externalId: cal.externalId } },
      create: {
        connectionId: connection.id,
        externalId: cal.externalId,
        name: cal.name,
        isPrimary: cal.isPrimary,
      },
      update: { name: cal.name, isPrimary: cal.isPrimary },
    });
  }

  await syncMicrosoftConnection(connection.id, /* isInitialSync */ true);

  const res = NextResponse.redirect(new URL("/settings/connections?connected=microsoft", request.url));
  res.cookies.delete(MICROSOFT_STATE_COOKIE);
  return res;
}
