import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const schema = z.object({ timezone: z.string().min(1).max(100) });

/** Keeps User.timezone in sync with the browser's real IANA zone — it otherwise
 * has no way to move off its "UTC" default, which silently threw off anything
 * that resolves wall-clock times server-side (namely screenshot import). */
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: session.userId }, data: { timezone: parsed.data.timezone } });
  return NextResponse.json({ ok: true });
}
