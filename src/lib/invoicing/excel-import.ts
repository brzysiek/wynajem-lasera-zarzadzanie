import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { loadInvoiceClassifier, matchData } from "@/lib/history/invoice-import";
import { paymentTypeOf, type ExcelInvoice } from "@/lib/invoicing/excel-invoice";
import { expandFiles, readInvoiceFile, type ExcelImportFile } from "@/lib/invoicing/excel-files";

export type { ExcelImportFile };

// Import faktur sprzed Fakturowni z plików Excela (wniosek 9). Biuro pobiera
// folder faktur wynajmu z Dysku (ZIP) albo wybiera pliki .xls/.xlsx; panel
// czyta szablon, zapisuje do client_invoices (source = EXCEL, ujemny
// identyfikator z numeru) i dopasowuje nabywcę jak faktury z Fakturowni
// (NIP → alias → nazwa). Idempotentny: ten sam numer = ta sama faktura;
// decyzje biura w dopasowaniach nie są nadpisywane.


export type ExcelImportReport = {
  files: number; // przeczytane pliki Excela
  otherFiles: number; // PDF-y i inne pliki z ZIP-a — pomijane
  created: number;
  updated: number;
  unchanged: number;
  skipped: { file: string; reason: string }[];
  errors: { file: string; message: string }[];
  invoices: { number: string; issueDate: string; buyerName: string; totalNet: number; client: string | null; state: string }[];
};

const day = (s: string) => new Date(`${s}T12:00:00.000Z`);

export async function importExcelInvoices(files: ExcelImportFile[], opts: { dryRun: boolean }): Promise<ExcelImportReport> {
  const { sheets, other } = expandFiles(files);
  const report: ExcelImportReport = { files: sheets.length, otherFiles: other, created: 0, updated: 0, unchanged: 0, skipped: [], errors: [], invoices: [] };

  // Ten sam numer w kilku plikach (np. .xls i .xlsx) — liczy się ostatni.
  const parsed = new Map<number, { inv: ExcelInvoice; file: string }>();
  for (const f of sheets) {
    const r = readInvoiceFile(f);
    if (r.ok) parsed.set(r.invoice.syntheticId, { inv: r.invoice, file: f.name });
    else if (r.skip) report.skipped.push({ file: f.name, reason: r.message });
    else report.errors.push({ file: f.name, message: r.message });
  }
  if (parsed.size === 0) return report;

  const list = [...parsed.values()];
  const [existing, fromFakturownia, classify] = await Promise.all([
    prisma.clientInvoice.findMany({ where: { fakturowniaInvoiceId: { in: [...parsed.keys()] } } }),
    // Numer wystawiony już w Fakturowni (od 014/03/2026) — nie dublujemy.
    prisma.clientInvoice.findMany({ where: { source: "FAKTUROWNIA", number: { in: list.map((x) => x.inv.number) } }, select: { number: true } }),
    loadInvoiceClassifier(),
  ]);
  const byId = new Map(existing.map((e) => [e.fakturowniaInvoiceId, e]));
  const inFakturownia = new Set(fromFakturownia.map((x) => x.number));
  const clientIds = new Set<string>();
  const rows: { data: ExcelInvoice; file: string; clientId: string | null; state: string }[] = [];

  for (const { inv, file } of list.sort((a, b) => a.inv.issueDate.localeCompare(b.inv.issueDate) || a.inv.number.localeCompare(b.inv.number))) {
    if (inFakturownia.has(inv.number)) {
      report.skipped.push({ file, reason: `${inv.number} jest już w Fakturowni` });
      continue;
    }
    const fields = {
      source: "EXCEL",
      sourceFile: file.slice(0, 191),
      number: inv.number,
      issueDate: day(inv.issueDate),
      sellDate: day(inv.sellDate),
      buyerName: inv.buyerName.slice(0, 191),
      buyerTaxNo: inv.buyerTaxNo,
      totalNet: new Prisma.Decimal(inv.totalNet),
      totalGross: new Prisma.Decimal(inv.totalGross),
      paymentTo: inv.paymentTo ? day(inv.paymentTo) : null,
      paymentType: paymentTypeOf(inv.paymentMethod),
      positionsSummary: inv.positions.map((p) => p.name).join("; ").slice(0, 2000),
    };
    const prev = byId.get(inv.syntheticId);
    if (!prev) {
      const m = matchData(classify({ fakturowniaInvoiceId: inv.syntheticId, buyerName: inv.buyerName, buyerTaxNo: inv.buyerTaxNo }));
      if (!opts.dryRun) await prisma.clientInvoice.create({ data: { fakturowniaInvoiceId: inv.syntheticId, ...fields, ...m } });
      report.created++;
      rows.push({ data: inv, file, clientId: m.clientId, state: m.matchState });
      if (m.clientId) clientIds.add(m.clientId);
      continue;
    }
    const changed =
      prev.number !== fields.number ||
      prev.buyerName !== fields.buyerName ||
      prev.buyerTaxNo !== fields.buyerTaxNo ||
      !prev.totalNet.equals(fields.totalNet) ||
      !prev.totalGross.equals(fields.totalGross) ||
      prev.sellDate.getTime() !== fields.sellDate.getTime() ||
      prev.positionsSummary !== fields.positionsSummary;
    if (changed) {
      if (!opts.dryRun) await prisma.clientInvoice.update({ where: { id: prev.id }, data: fields });
      report.updated++;
    } else report.unchanged++;
    rows.push({ data: inv, file, clientId: prev.clientId, state: prev.matchState });
    if (prev.clientId) clientIds.add(prev.clientId);
  }

  const clients = clientIds.size ? await prisma.client.findMany({ where: { id: { in: [...clientIds] } }, select: { id: true, name: true, shortName: true } }) : [];
  const names = new Map(clients.map((c) => [c.id, c.shortName ?? c.name]));
  report.invoices = rows.map((r) => ({
    number: r.data.number,
    issueDate: r.data.issueDate,
    buyerName: r.data.buyerName,
    totalNet: r.data.totalNet,
    client: r.clientId ? (names.get(r.clientId) ?? null) : null,
    state: r.state,
  }));
  return report;
}
