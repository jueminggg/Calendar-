import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const connections = await prisma.calendarConnection.findMany({
    where: { userId: session.userId },
    include: { calendars: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    connections: connections.map((c) => ({
      id: c.id,
      provider: c.provider,
      label: c.label,
      status: c.status,
      lastError: c.lastError,
      lastSyncAt: c.lastSyncAt,
      calendars: c.calendars.map((cal) => ({ id: cal.id, name: cal.name, enabled: cal.enabled, color: cal.color })),
    })),
  });
}
