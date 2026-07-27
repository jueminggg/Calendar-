import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifySessionToken, COOKIE_NAME } from "@/lib/session";

const PUBLIC_PATHS = ["/login", "/signup"];
const PUBLIC_API_PREFIXES = ["/api/auth", "/api/webhooks", "/api/cron"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_API_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/icons") ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
