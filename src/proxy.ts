import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { BASE_PATH } from "@/lib/base-path";

// Must match `basePath` in next.config.ts. In this custom-server (Passenger)
// setup, req.nextUrl.basePath comes back empty in middleware even though
// pathname still carries the basePath prefix — confirmed at runtime — so
// it can't be trusted here and BASE_PATH is used directly instead.

const PUBLIC_ROUTES = [`${BASE_PATH}/login`, `${BASE_PATH}/forgot-password`, `${BASE_PATH}/reset-password`];

// Assets the browser (and iOS "Add to Home Screen") must be able to fetch
// while logged out — otherwise the redirect-to-login turns the PWA manifest
// and its icons into HTML and the install/home-screen icon breaks.
const PUBLIC_ASSETS = [
  `${BASE_PATH}/manifest.webmanifest`,
  `${BASE_PATH}/icons/`,
  `${BASE_PATH}/favicon.ico`,
];

// The KIEROWCA (driver) role only gets the read-only calendar and the
// read-only detail of a rental it's assigned to. Everything else — creating
// a rental, devices, upcoming list, SMS, settings — is redirected back to
// the calendar, so pages don't each need their own role guard.
const DRIVER_ALLOWED_PREFIXES = [`${BASE_PATH}/kalendarz`];
const DRIVER_BLOCKED_PATHS = [`${BASE_PATH}/kalendarz/wynajem/nowy`];

export default auth((req) => {
  const { pathname } = req.nextUrl;

  if (PUBLIC_ASSETS.some((asset) => pathname === asset || pathname.startsWith(asset))) {
    return NextResponse.next();
  }

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

  if (isLoggedIn && req.auth?.user?.role === "KIEROWCA" && !isPublicRoute) {
    const allowed =
      DRIVER_ALLOWED_PREFIXES.some((prefix) => pathname.startsWith(prefix)) &&
      !DRIVER_BLOCKED_PATHS.some((blocked) => pathname === blocked || pathname.startsWith(`${blocked}/`));
    if (!allowed) {
      return NextResponse.redirect(new URL(`${BASE_PATH}/kalendarz`, req.nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
