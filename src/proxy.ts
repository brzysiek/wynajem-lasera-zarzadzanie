import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Must match `basePath` in next.config.ts. In this custom-server (Passenger)
// setup, req.nextUrl.basePath comes back empty in middleware even though
// pathname still carries the "/wynajem" prefix — confirmed at runtime — so
// it can't be trusted here and is hardcoded instead.
const BASE_PATH = "/wynajem";

const PUBLIC_ROUTES = [`${BASE_PATH}/login`];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isPublicRoute = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));

  if (!isLoggedIn && !isPublicRoute) {
    const loginUrl = new URL(`${BASE_PATH}/login`, req.nextUrl);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isLoggedIn && isPublicRoute) {
    return NextResponse.redirect(new URL(`${BASE_PATH}/kalendarz`, req.nextUrl));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
