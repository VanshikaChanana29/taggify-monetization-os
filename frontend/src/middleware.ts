import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "taggify_session";

// First gate only: no cookie → login page. Whether the session is still valid
// is decided by the API (a 401 sends the browser back to /login).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/login" || request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.next();
  }
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
