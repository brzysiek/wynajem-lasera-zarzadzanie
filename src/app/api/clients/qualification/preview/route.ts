import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { previewQualification } from "@/lib/clients/qualification-backfill";
import { logError, logInfo } from "@/lib/logger";

// Podgląd porządkowania bazy: klienci vs kontakty z zapytań — NIC nie
// zapisuje. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const p = await previewQualification();
    logInfo("clients_qualification_preview", { userId: session.user.id, qualified: p.qualified, unqualified: p.unqualified });
    return NextResponse.json(p);
  } catch (err) {
    logError("clients_qualification_preview_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
