import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getMicrosoftAuthUrl } from "@/lib/providers/microsoft";
import { getSession } from "@/lib/session";
import { MICROSOFT_STATE_COOKIE } from "@/lib/providers/oauth-state";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const state = randomBytes(16).toString("hex");
  const url = await getMicrosoftAuthUrl(state);

  const res = NextResponse.redirect(url);
  res.cookies.set(MICROSOFT_STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
  return res;
}
