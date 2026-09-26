import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { previewDealsImport } from "@/lib/leads/hubspot-sync";
import { logError, logInfo } from "@/lib/logger";

// Podgląd importu transakcji HubSpot → Sygnały — NIC nie zapisuje. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });
  try {
    const preview = await previewDealsImport();
    logInfo("leads_import_preview", { userId: session.user.id, toImport: preview.toImport });
    return NextResponse.json(preview);
  } catch (err) {
    logError("leads_import_preview_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
