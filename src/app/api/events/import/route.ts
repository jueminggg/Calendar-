import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const importSchema = z.object({
  events: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        location: z.string().optional(),
        startAt: z.string(),
        endAt: z.string(),
        allDay: z.boolean().optional(),
      }),
    )
    .min(1),
});

/** Bulk-creates native events, used after the user reviews screenshot-parsed drafts. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const created = await prisma.$transaction(
    parsed.data.events.map((e) =>
      prisma.event.create({
        data: {
          userId: session.userId,
          source: "NATIVE",
          importedVia: "screenshot",
          title: e.title,
          description: e.description,
          location: e.location,
          startAt: new Date(e.startAt),
          endAt: new Date(e.endAt),
          allDay: e.allDay ?? false,
          status: "CONFIRMED",
        },
      }),
    ),
  );

  return NextResponse.json({ count: created.length });
}
