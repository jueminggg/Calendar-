import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notifications = await prisma.notification.findMany({
    where: { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unreadCount = await prisma.notification.count({ where: { userId: session.userId, read: false } });

  return NextResponse.json({ notifications, unreadCount });
}

const patchSchema = z.object({
  markAllRead: z.boolean().optional(),
  ids: z.array(z.string()).optional(),
});

export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  if (parsed.data.markAllRead) {
    await prisma.notification.updateMany({ where: { userId: session.userId }, data: { read: true } });
  } else if (parsed.data.ids?.length) {
    await prisma.notification.updateMany({
      where: { userId: session.userId, id: { in: parsed.data.ids } },
      data: { read: true },
    });
  }

  return NextResponse.json({ ok: true });
}
