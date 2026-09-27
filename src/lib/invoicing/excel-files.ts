import * as XLSX from "xlsx";
import { unzipSync } from "fflate";
import { parseExcelInvoice, type Cell } from "./excel-invoice";

// Odczyt plików z importu faktur z Excela (wniosek 9): ZIP folderu z Dysku
// albo pojedyncze .xls / .xlsx → arkusze → parser szablonu. Bez bazy danych
// (vitest bez aliasu "@/").

export type ExcelImportFile = { name: string; data: Uint8Array };

const EXCEL = /\.(xls|xlsx|xlsm)$/i;
const base = (p: string) => p.split("/").pop() ?? p;

// Pliki z ZIP-a (bez katalogów, śmieci macOS) + pojedyncze arkusze.
export function expandFiles(files: ExcelImportFile[]): { sheets: ExcelImportFile[]; other: number } {
  const sheets: ExcelImportFile[] = [];
  let other = 0;
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const entries = unzipSync(f.data);
      for (const [path, data] of Object.entries(entries)) {
        if (path.endsWith("/") || path.includes("__MACOSX") || base(path).startsWith("._")) continue;
        if (EXCEL.test(path)) sheets.push({ name: base(path), data });
        else other++;
      }
    } else if (EXCEL.test(f.name)) sheets.push(f);
    else other++;
  }
  return { sheets, other };
}

export function readInvoiceFile(f: ExcelImportFile): ReturnType<typeof parseExcelInvoice> {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(f.data, { type: "array" });
  } catch {
    return { ok: false, message: "plik nie jest poprawnym arkuszem Excela" };
  }
  let last: ReturnType<typeof parseExcelInvoice> = { ok: false, message: "pusty skoroszyt" };
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Cell[]>(wb.Sheets[name], { header: 1, raw: true, defval: null, blankrows: true });
    last = parseExcelInvoice(rows, f.name);
    if (last.ok || last.skip) return last;
  }
  return last;
}
