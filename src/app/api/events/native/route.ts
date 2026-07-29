import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

/** Deletes every native (in-app-only) event for the current user in one shot. */
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { count } = await prisma.event.deleteMany({ where: { userId: session.userId, source: "NATIVE" } });
  return NextResponse.json({ count });
}
