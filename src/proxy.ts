import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";

// Must match `basePath` in next.config.ts. In this custom-server (Passenger)
// setup, req.nextUrl.basePath comes back empty in middleware even though
// pathname still carries the basePath prefix — confirmed at runtime — so
// it can't be trusted here and BASE_PATH is used directly instead.

const PUBLIC_ROUTES = [`${BASE_PATH}/login`, `${BASE_PATH}/forgot-password`, `${BASE_PATH}/reset-password`];

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
