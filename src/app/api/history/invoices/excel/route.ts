import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-guards";
import { importExcelInvoices, type ExcelImportFile } from "@/lib/invoicing/excel-import";
import { logError, logInfo } from "@/lib/logger";

// Import faktur sprzed Fakturowni z plików Excela / ZIP-a folderu z Dysku
// (wniosek 9). mode=preview — tylko odczyt i dopasowanie, bez zapisu;
// mode=import — zapis. Tylko ADMIN.
const MAX_BYTES = 60 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ message: "Wybierz pliki Excela albo ZIP folderu z faktur." }, { status: 400 });
  const dryRun = form.get("mode") !== "import";
  const files: ExcelImportFile[] = [];
  let total = 0;
  for (const entry of form.getAll("files")) {
    if (typeof entry === "string") continue;
    total += entry.size;
    if (total > MAX_BYTES) return NextResponse.json({ message: "Pliki razem przekraczają 60 MB — wgraj je w kilku częściach." }, { status: 400 });
    files.push({ name: entry.name, data: new Uint8Array(await entry.arrayBuffer()) });
  }
  if (!files.length) return NextResponse.json({ message: "Wybierz pliki Excela albo ZIP folderu z faktur." }, { status: 400 });

  try {
    const report = await importExcelInvoices(files, { dryRun });
    logInfo("excel_invoices_import", { userId: session.user.id, dryRun, files: report.files, created: report.created, updated: report.updated, errors: report.errors.length });
    return NextResponse.json({ dryRun, ...report });
  } catch (err) {
    logError("excel_invoices_import_failed", err, { userId: session.user.id, dryRun });
    return NextResponse.json({ message: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
