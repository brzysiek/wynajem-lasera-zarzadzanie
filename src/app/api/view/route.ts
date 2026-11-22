import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { logInfo } from "@/lib/logger";
import { DRIVER_OWN_VIEW_VALUE, DRIVER_VIEW_VALUE, VIEW_COOKIE } from "@/lib/effective-role";

// Włącza/wyłącza „podgląd kierowcy" dla bieżącego użytkownika (cookie).
// Dostępne tylko dla kont z uprawnieniem canActAsDriver.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  // Rola AGENT: tylko odczyt (src/lib/permissions.ts).
  if (session.user.role === "AGENT") {
    return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  }
  if (!session.user.canActAsDriver || session.user.role === "KIEROWCA") {
    return NextResponse.json({ message: "Brak uprawnień do podglądu kierowcy." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  // Tryby: „driver” (wszystkie rezerwacje jak widzi kierowca), „driver_own” (tylko moje), inne = panel.
  const mode = body?.mode === DRIVER_VIEW_VALUE || body?.mode === DRIVER_OWN_VIEW_VALUE ? (body.mode as string) : null;
  const enable = mode !== null;

  const res = NextResponse.json({ ok: true, mode: mode ?? "panel" });
  if (enable) {
    res.cookies.set(VIEW_COOKIE, mode, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
  } else {
    res.cookies.set(VIEW_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  }
  logInfo("driver_view_toggled", { userId: session.user.id, mode: mode ?? "panel" });
  return res;
}
