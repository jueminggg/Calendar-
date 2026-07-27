import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1).optional(),
  inviteCode: z.string(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const { email, password, name, inviteCode } = parsed.data;

  const requiredInvite = process.env.SIGNUP_SECRET;
  if (!requiredInvite) {
    return NextResponse.json(
      { error: "Sign-up is not configured. Set SIGNUP_SECRET on the server." },
      { status: 500 },
    );
  }
  if (inviteCode !== requiredInvite) {
    return NextResponse.json({ error: "Invalid invite code" }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: { email, passwordHash, name },
  });

  await createSessionCookie({ userId: user.id, email: user.email });

  return NextResponse.json({ ok: true });
}
