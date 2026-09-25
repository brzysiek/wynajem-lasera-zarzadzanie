import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { runHubspotImportBatch } from "@/lib/clients/hubspot-import-run";
import { logError } from "@/lib/logger";

// Jedna partia importu klientów z HubSpota. UI woła w pętli, aż
// `finished` = true (partie, bo hosting ma limit czasu zapytania).
// Idempotentne — przerwanie i ponowne uruchomienie niczego nie dubluje.
// Zapis tylko w panelu; HubSpot wyłącznie czytany. Tylko ADMIN.
export async function POST() {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  try {
    return NextResponse.json(await runHubspotImportBatch());
  } catch (err) {
    logError("hubspot_import_batch_failed", err, { userId: session.user.id });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
