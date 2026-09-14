import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/auth-guards";
import { logInfo, logWarn } from "@/lib/logger";
import { monthPeriod } from "@/lib/revenue/period";
import { matchVehicleByPlate, parseFuelInvoiceXml } from "@/lib/costs/fuel-invoice-parse";

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Faktury paliwowe (weryfikacja szacowanego kosztu z rzeczywistym) — ten sam
// wzorzec filtra okresu co GET /api/costs (sekcja 5): ?from=&to=,
// domyślnie bieżący miesiąc kalendarzowy. Data faktury bez okresu (parser
// nie wyciągnął daty) i tak trafia na listę — filtrowana osobno niżej.
export async function GET(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const params = req.nextUrl.searchParams;
  const fromParam = parseDate(params.get("from"));
  const toParam = parseDate(params.get("to"));

  let from: Date;
  let to: Date;
  if (fromParam && toParam) {
    from = fromParam;
    to = new Date(toParam);
    to.setHours(23, 59, 59, 999);
  } else {
    const now = new Date();
    const p = monthPeriod(now.getFullYear(), now.getMonth() + 1);
    from = p.start;
    to = p.end;
  }

  const invoices = await prisma.fuelInvoice.findMany({
    where: { invoiceDate: { gte: from, lte: to } },
    orderBy: { invoiceDate: "desc" },
    include: { vehicle: { select: { name: true } } },
  });

  return NextResponse.json({
    invoices: invoices.map((i) => ({
      id: i.id,
      fileName: i.fileName,
      invoiceNumber: i.invoiceNumber,
      invoiceDate: i.invoiceDate ? i.invoiceDate.toISOString() : null,
      sellerName: i.sellerName,
      amountNet: i.amountNet ? i.amountNet.toString() : null,
      amountGross: i.amountGross ? i.amountGross.toString() : null,
      currency: i.currency,
      vehiclePlateRaw: i.vehiclePlateRaw,
      vehicleId: i.vehicleId,
      vehicleName: i.vehicle?.name ?? null,
      matchSource: i.matchSource,
      uploadedAt: i.uploadedAt.toISOString(),
    })),
  });
}

const ALLOWED_EXT = /\.xml$/i;

// Upload 1+ plików XML (eksport z Fakturowni — patrz src/lib/costs/fuel-invoice-parse.ts
// dla formatu). multipart/form-data, pole "files" (wiele razy). Duplikat po
// numerze faktury pomijany, nie nadpisywany — jeśli trzeba poprawić już
// wgraną fakturę, usuń ją (DELETE [id]) i wgraj ponownie.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ message: "Brak uprawnień." }, { status: 403 });

  const formData = await req.formData().catch(() => null);
  const files = formData ? formData.getAll("files").filter((f): f is File => f instanceof File) : [];
  if (files.length === 0) {
    return NextResponse.json({ message: "Nie przesłano żadnych plików." }, { status: 400 });
  }

  const vehicles = await prisma.vehicle.findMany({ select: { id: true, plateNumber: true } });

  let createdCount = 0;
  let autoMatchedCount = 0;
  const duplicates: string[] = [];
  const failed: { fileName: string; reason: string }[] = [];

  for (const file of files) {
    if (!ALLOWED_EXT.test(file.name)) {
      failed.push({ fileName: file.name, reason: "To nie jest plik .xml — pobierz eksport XML (nie PDF)." });
      continue;
    }

    let text: string;
    try {
      text = await file.text();
    } catch {
      failed.push({ fileName: file.name, reason: "Nie udało się odczytać pliku." });
      continue;
    }

    const parsed = parseFuelInvoiceXml(text);

    if (parsed.invoiceNumber) {
      const existing = await prisma.fuelInvoice.findFirst({
        where: { invoiceNumber: parsed.invoiceNumber },
        select: { id: true },
      });
      if (existing) {
        duplicates.push(file.name);
        continue;
      }
    }

    const vehicleId = matchVehicleByPlate(parsed.vehiclePlateRaw, vehicles);
    if (vehicleId) autoMatchedCount += 1;

    await prisma.fuelInvoice.create({
      data: {
        fileName: file.name,
        invoiceNumber: parsed.invoiceNumber,
        invoiceDate: parsed.invoiceDate ? parseDate(parsed.invoiceDate) : null,
        sellerName: parsed.sellerName,
        amountNet: parsed.amountNet,
        amountGross: parsed.amountGross,
        currency: parsed.currency,
        rawXml: text,
        vehiclePlateRaw: parsed.vehiclePlateRaw,
        vehicleId,
        matchSource: vehicleId ? "AUTO" : null,
      },
    });
    createdCount += 1;
  }

  logInfo("fuel_invoices_uploaded", {
    userId: session.user.id,
    createdCount,
    autoMatchedCount,
    duplicates: duplicates.length,
    failed: failed.length,
  });
  if (failed.length > 0) {
    logWarn("fuel_invoices_upload_failed_files", { userId: session.user.id, failed });
  }

  return NextResponse.json({ created: createdCount, autoMatched: autoMatchedCount, duplicates, failed });
}
