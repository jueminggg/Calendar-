import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const SELECT = {
  telegramChatId: true,
  telegramMorningAgendaEnabled: true,
  telegramMorningAgendaTime: true,
  telegramEveningAgendaEnabled: true,
  telegramEveningAgendaTime: true,
} as const;

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId }, select: SELECT });
  const { telegramChatId, ...rest } = user;
  return NextResponse.json({ linked: telegramChatId !== null, ...rest });
}

const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
const updateSchema = z.object({
  telegramMorningAgendaEnabled: z.boolean().optional(),
  telegramMorningAgendaTime: z.string().regex(timeRegex, "Use HH:MM").optional(),
  telegramEveningAgendaEnabled: z.boolean().optional(),
  telegramEveningAgendaTime: z.string().regex(timeRegex, "Use HH:MM").optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const user = await prisma.user.update({ where: { id: session.userId }, data: parsed.data, select: SELECT });
  const { telegramChatId, ...rest } = user;
  return NextResponse.json({ linked: telegramChatId !== null, ...rest });
}

export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.user.update({ where: { id: session.userId }, data: { telegramChatId: null } });
  return NextResponse.json({ ok: true });
}
