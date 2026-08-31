import { Prisma } from "@prisma/client";

// Prisma connection-level codes: unreachable, timed out, and closed-by-server.
// A cold client raises PrismaClientInitializationError instead, but a warm one
// that loses its pool mid-request reports the same trouble as a known error.
const CONNECTION_ERROR_CODES = new Set(["P1000", "P1001", "P1002", "P1008", "P1017"]);

// Turn an unexpected server-side failure into something the sign-in screen can
// actually show. This app is private and invite-gated, so naming the piece of
// configuration at fault is worth far more than hiding it -- the values
// themselves are never included.
export function serverErrorMessage(error: unknown): string {
  const isConnectionError =
    error instanceof Prisma.PrismaClientInitializationError ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      CONNECTION_ERROR_CODES.has(error.code));

  if (isConnectionError) {
    return "The server can't reach its database. Check DATABASE_URL and that the database is running.";
  }
  if (error instanceof Error && error.message.includes("SESSION_SECRET")) {
    return "The server is missing SESSION_SECRET. Set it in the environment and restart.";
  }
  return "Something went wrong on the server. Check the server logs for details.";
}
