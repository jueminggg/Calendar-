import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { syncConnection } from "@/lib/sync/run";

export async function POST(_request: NextRequest, ctx: RouteContext<"/api/connections/[id]/sync">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const connection = await prisma.calendarConnection.findUnique({ where: { id } });
  if (!connection || connection.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    await syncConnection(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
