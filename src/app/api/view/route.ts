import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { logInfo } from "@/lib/logger";
import { DRIVER_VIEW_VALUE, VIEW_COOKIE } from "@/lib/effective-role";

// Włącza/wyłącza „podgląd kierowcy" dla bieżącego użytkownika (cookie).
// Dostępne tylko dla kont z uprawnieniem canActAsDriver.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  if (!session.user.canActAsDriver || session.user.role === "KIEROWCA") {
    return NextResponse.json({ message: "Brak uprawnień do podglądu kierowcy." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const enable = body?.mode === DRIVER_VIEW_VALUE;

  const res = NextResponse.json({ ok: true, mode: enable ? DRIVER_VIEW_VALUE : "panel" });
  if (enable) {
    res.cookies.set(VIEW_COOKIE, DRIVER_VIEW_VALUE, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    res.cookies.set(VIEW_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  logInfo("driver_view_toggled", { userId: session.user.id, mode: enable ? "driver" : "panel" });
  return res;
}
