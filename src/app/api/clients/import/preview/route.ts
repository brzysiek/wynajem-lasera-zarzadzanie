import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { previewHubspotImport } from "@/lib/clients/hubspot-import-run";
import { logError, logInfo } from "@/lib/logger";

// Podgląd importu klientów z HubSpota (dry run) — NIC nie zapisuje, ani w
// panelu, ani w HubSpocie. Tylko ADMIN (spec, sekcja 4).
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    const preview = await previewHubspotImport();
    logInfo("hubspot_import_preview", {
      userId: session.user.id,
      contacts: preview.report.contactsFetched,
      clientsToCreate: preview.clientsToCreate,
    });
    return NextResponse.json(preview);
  } catch (err) {
    logError("hubspot_import_preview_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
