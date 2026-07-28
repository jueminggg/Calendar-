import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { parseEventsFromImage } from "@/lib/providers/screenshot-import";

export const maxDuration = 60;

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("image");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "No image provided" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "File must be an image" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "Image is too large (max 10MB)" }, { status: 400 });
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: session.userId } });
  const buffer = Buffer.from(await file.arrayBuffer());

  let events;
  try {
    events = await parseEventsFromImage(buffer.toString("base64"), file.type, {
      timezone: user.timezone,
      referenceDate: new Date(),
    });
  } catch (err) {
    console.error("Screenshot parse failed", err);
    const message = err instanceof Error ? err.message : "Couldn't read events from that image.";
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (events.length === 0) {
    return NextResponse.json({ error: "No events found in that screenshot." }, { status: 422 });
  }

  return NextResponse.json({ events });
}
