import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dateParam = request.nextUrl.searchParams.get("date");
  if (!dateParam) {
    return NextResponse.json({ error: "date query param is required (ISO date)" }, { status: 400 });
  }

  const tasks = await prisma.task.findMany({
    where: { userId: session.userId, date: new Date(dateParam) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ tasks });
}

const createSchema = z.object({
  title: z.string().min(1),
  notes: z.string().optional(),
  // Omit for a flexible goal/session (no fixed day yet, just a deadline) —
  // see the Task.date comment in schema.prisma.
  date: z.string().optional(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  deadline: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MED", "HIGH"]).optional(),
  location: z.string().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;
  const date = data.date ? new Date(data.date) : null;

  const maxOrder = await prisma.task.aggregate({
    where: { userId: session.userId, date },
    _max: { order: true },
  });

  const task = await prisma.task.create({
    data: {
      userId: session.userId,
      title: data.title,
      notes: data.notes,
      date,
      startAt: data.startAt ? new Date(data.startAt) : null,
      endAt: data.endAt ? new Date(data.endAt) : null,
      order: (maxOrder._max.order ?? 0) + 1,
      estimatedMinutes: data.estimatedMinutes,
      deadline: data.deadline ? new Date(data.deadline) : undefined,
      priority: data.priority,
      location: data.location,
    },
  });

  return NextResponse.json({ task });
}
