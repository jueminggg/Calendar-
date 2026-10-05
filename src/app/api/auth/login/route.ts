import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import { createSessionCookie } from "@/lib/session";
import { serverErrorMessage } from "@/lib/server-error";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { email, password } = parsed.data;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
    }

    await createSessionCookie({ userId: user.id, email: user.email });
  } catch (error) {
    console.error("Sign-in failed:", error);
    return NextResponse.json({ error: serverErrorMessage(error) }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
