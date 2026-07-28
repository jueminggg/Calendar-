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
  date: z.string(),
  startAt: z.string().optional(),
  endAt: z.string().optional(),
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
  const date = new Date(data.date);

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
    },
  });

  return NextResponse.json({ task });
}
