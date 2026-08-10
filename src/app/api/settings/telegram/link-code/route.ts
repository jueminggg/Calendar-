import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const CODE_TTL_MINUTES = 15;

export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const code = randomBytes(6).toString("hex");
  const expiresAt = new Date(Date.now() + CODE_TTL_MINUTES * 60_000);
  await prisma.user.update({
    where: { id: session.userId },
    data: { telegramLinkCode: code, telegramLinkCodeExpiresAt: expiresAt },
  });

  return NextResponse.json({ code, expiresInMinutes: CODE_TTL_MINUTES });
}
