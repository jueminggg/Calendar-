import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/connections/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const connection = await prisma.calendarConnection.findUnique({ where: { id } });
  if (!connection || connection.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.calendarConnection.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
