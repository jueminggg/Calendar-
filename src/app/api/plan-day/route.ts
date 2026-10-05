import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { runPlanDay } from "@/lib/runPlanDay";

const bodySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD"),
  // Exposed for flexibility, but the UI doesn't currently offer a way to
  // change these — v1 just uses the defaults.
  dayStartHour: z.number().int().min(0).max(23).optional(),
  dayEndHour: z.number().int().min(1).max(24).optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId }, select: { timezone: true } });
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let result;
  try {
    result = await runPlanDay(session.userId, user.timezone || "UTC", parsed.data.date, {
      dayStartHour: parsed.data.dayStartHour,
      dayEndHour: parsed.data.dayEndHour,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Couldn't plan that day.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  return NextResponse.json(result);
}
