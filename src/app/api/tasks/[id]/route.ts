import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const updateSchema = z.object({
  title: z.string().min(1).optional(),
  notes: z.string().nullable().optional(),
  startAt: z.string().nullable().optional(),
  endAt: z.string().nullable().optional(),
  done: z.boolean().optional(),
  order: z.number().int().optional(),
  estimatedMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  deadline: z.string().nullable().optional(),
  priority: z.enum(["LOW", "MED", "HIGH"]).optional(),
  location: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const data = parsed.data;

  const updated = await prisma.task.update({
    where: { id },
    data: {
      title: data.title,
      notes: data.notes,
      startAt: data.startAt === undefined ? undefined : data.startAt ? new Date(data.startAt) : null,
      endAt: data.endAt === undefined ? undefined : data.endAt ? new Date(data.endAt) : null,
      done: data.done,
      order: data.order,
      estimatedMinutes: data.estimatedMinutes,
      deadline: data.deadline === undefined ? undefined : data.deadline ? new Date(data.deadline) : null,
      priority: data.priority,
      location: data.location,
    },
  });

  return NextResponse.json({ task: updated });
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<"/api/tasks/[id]">) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const task = await prisma.task.findUnique({ where: { id } });
  if (!task || task.userId !== session.userId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.task.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
