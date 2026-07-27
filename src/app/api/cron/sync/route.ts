import { NextRequest, NextResponse } from "next/server";
import { syncAllConnections, renewWebhooks } from "@/lib/sync/run";

// Vercel Cron calls this on a schedule (see vercel.json). It's the reliability
// backbone: Google/Microsoft push notifications are a nice-to-have for near
// real-time updates, but this poll is what guarantees invites/edits/cancellations
// eventually show up even if a webhook was missed, expired, or never configured.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const result = await syncAllConnections();
  await renewWebhooks();

  return NextResponse.json(result);
}
