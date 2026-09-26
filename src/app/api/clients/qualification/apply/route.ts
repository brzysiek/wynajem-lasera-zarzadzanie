import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { applyQualification } from "@/lib/clients/qualification-backfill";
import { logError, logInfo } from "@/lib/logger";

// Zapis porządkowania bazy i włączenie podziału klienci / kontakty z
// zapytań. Tylko ADMIN, po obejrzeniu podglądu.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const r = await applyQualification();
    logInfo("clients_qualification_applied", { userId: session.user.id, flagged: r.flagged });
    return NextResponse.json(r);
  } catch (err) {
    logError("clients_qualification_apply_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
