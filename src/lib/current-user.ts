import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// Deliberately kept out of lib/session.ts: proxy.ts imports that module, and
// pulling Prisma into the proxy bundle would drag the database client into a
// layer that only ever needs to check a signature.

// The session cookie is a self-contained JWT, so it keeps verifying perfectly
// long after the account it names has stopped existing. That failed silently --
// a signed-in shell over an empty calendar -- so confirm the account is really
// still there before trusting the cookie.
//
// Returns null only when the lookup SUCCEEDED and found nobody. An unreachable
// database throws instead, so an outage surfaces as an error and never signs
// anyone out.
export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  return prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true },
  });
}
