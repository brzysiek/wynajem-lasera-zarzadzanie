// Faktury sprzed Fakturowni (do 13/03/2026) — wystawiane w szablonie Excela
// „Faktura wzór” (folder faktur wynajmu na Dysku; wniosek 9). Parser czyta
// komórki po etykietach, nie po sztywnych adresach, więc drobne przesunięcia
// wierszy w starszych plikach nie przeszkadzają. Czysty moduł (vitest bez
// aliasu "@/") — wejście to wiersze arkusza (SheetJS sheet_to_json header:1).

export type Cell = string | number | boolean | null | undefined;

export type ExcelInvoice = {
  number: string; // „03/01/2026”
  syntheticId: number; // ujemny, stały: 03/01/2026 → -202601003 (klucz jak fakturowniaInvoiceId)
  issueDate: string; // RRRR-MM-DD
  sellDate: string;
  buyerName: string;
  buyerAddress: string | null;
  buyerTaxNo: string | null; // same cyfry
  paymentMethod: string | null; // „przelew 7 dni”, „gotówka”
  paymentTo: string | null;
  positions: { name: string; net: number; gross: number }[];
  totalNet: number;
  totalGross: number;
};

export type ExcelInvoiceResult = { ok: true; invoice: ExcelInvoice } | { ok: false; skip?: boolean; message: string };

const text = (c: Cell) => (c == null ? "" : String(c)).replace(/\s+/g, " ").trim();
const norm = (c: Cell) =>
  text(c)
    .toLowerCase()
    .replace(/ł/g, "l")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

function num(c: Cell): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const t = text(c).replace(/\s|zł/g, "").replace(",", ".");
  return /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// „12-01-2026 r.”, „19.01.2026”, liczba seryjna Excela albo Date → RRRR-MM-DD.
export function excelDay(c: Cell | Date): string | null {
  if (c instanceof Date) return `${c.getUTCFullYear()}-${pad(c.getUTCMonth() + 1)}-${pad(c.getUTCDate())}`;
  if (typeof c === "number" && c > 20000 && c < 80000) {
    const d = new Date(Math.round((c - 25569) * 86_400_000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = text(c).match(/(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})/);
  if (m) return `${m[3]}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  const iso = text(c).match(/(\d{4})-(\d{2})-(\d{2})/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

// Pierwsza niepusta komórka na prawo od etykiety (w tym samym wierszu).
function rightOf(rows: Cell[][], r: number, c: number): Cell {
  for (let j = c + 1; j < (rows[r]?.length ?? 0); j++) if (text(rows[r][j])) return rows[r][j];
  return null;
}

function find(rows: Cell[][], test: (n: string) => boolean, from = 0): { r: number; c: number } | null {
  for (let r = from; r < rows.length; r++) {
    const row = rows[r] ?? [];
    for (let c = 0; c < row.length; c++) if (test(norm(row[c]))) return { r, c };
  }
  return null;
}

export function syntheticInvoiceId(number: string): number | null {
  const m = number.match(/^(\d{1,3})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [n, mm, yyyy] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mm < 1 || mm > 12 || n < 1 || n > 999) return null;
  return -(yyyy * 100000 + mm * 1000 + n);
}

export function parseExcelInvoice(rows: Cell[][], fileName = ""): ExcelInvoiceResult {
  // Faktury działu Inżynieria (numer „…/IN”, plik „FV IN_…”) to nie wynajmy.
  if (/(^|\s)FV\s*IN[_\s]/i.test(fileName)) return { ok: false, skip: true, message: "faktura działu Inżynieria — pominięta" };

  const title = find(rows, (n) => /faktura\s+vat\s+nr/.test(n));
  if (!title) return { ok: false, message: "to nie jest szablon faktury (brak „FAKTURA VAT NR”)" };
  const numberCell = text(rightOf(rows, title.r, title.c)) || text(rows[title.r][title.c]).replace(/.*nr\s*/i, "");
  const number = numberCell.replace(/\s/g, "");
  if (/\/IN$/i.test(number)) return { ok: false, skip: true, message: "faktura działu Inżynieria — pominięta" };
  const syntheticId = syntheticInvoiceId(number);
  if (syntheticId == null) return { ok: false, message: `nieczytelny numer faktury „${numberCell}”` };

  const issue = find(rows, (n) => n.startsWith("data wystawienia"));
  const sell = find(rows, (n) => n.startsWith("data wykonania") || n.startsWith("data sprzedazy"));
  const issueDate = issue ? excelDay(rightOf(rows, issue.r, issue.c)) : null;
  const sellDate = (sell ? excelDay(rightOf(rows, sell.r, sell.c)) : null) ?? issueDate;
  if (!issueDate || !sellDate) return { ok: false, message: `${number}: brak daty wystawienia` };

  const buyer = find(rows, (n) => n.startsWith("nabywca"));
  if (!buyer) return { ok: false, message: `${number}: brak nabywcy` };
  // Długa nazwa bywa przeniesiona do następnego wiersza (bez etykiety).
  const cont = !text(rows[buyer.r + 1]?.[buyer.c]) ? text(rightOf(rows, buyer.r + 1, buyer.c)) : "";
  const buyerName = [text(rightOf(rows, buyer.r, buyer.c)), cont].filter(Boolean).join(" ").trim();
  const addr = find(rows, (n) => n.startsWith("adres"), buyer.r);
  const nip = find(rows, (n) => /^nip/.test(n), buyer.r);
  const pay = find(rows, (n) => n.startsWith("sposob zaplaty"));
  const due = find(rows, (n) => n.startsWith("termin zaplaty"));
  const nipDigits = nip ? text(rightOf(rows, nip.r, nip.c)).replace(/\D/g, "") : "";

  // Pozycje: od nagłówka „Nazwa towaru…” do wiersza „RAZEM”.
  const head = find(rows, (n) => n.startsWith("nazwa towaru") || n.startsWith("nazwa uslugi"));
  const sum = find(rows, (n) => n === "razem", head?.r ?? 0);
  if (!head || !sum) return { ok: false, message: `${number}: brak tabeli pozycji` };
  const valueCols = (rows[head.r] ?? []).map((c, i) => (norm(c).startsWith("wartosc") ? i : -1)).filter((i) => i >= 0);
  const netCol = valueCols[0];
  const grossCol = valueCols[valueCols.length - 1];
  if (netCol == null || grossCol == null || netCol === grossCol) return { ok: false, message: `${number}: brak kolumn wartości` };

  const positions: ExcelInvoice["positions"] = [];
  for (let r = head.r + 1; r < sum.r; r++) {
    const name = text(rows[r]?.[head.c]);
    const net = num(rows[r]?.[netCol]);
    const gross = num(rows[r]?.[grossCol]);
    if (name && net != null && gross != null && !/^\(?z[lł]\)?$/i.test(name)) positions.push({ name, net, gross });
  }
  const totalNet = num(rows[sum.r]?.[netCol]) ?? positions.reduce((s, p) => s + p.net, 0);
  const totalGross = num(rows[sum.r]?.[grossCol]) ?? positions.reduce((s, p) => s + p.gross, 0);
  if (!positions.length || !(totalGross > 0)) return { ok: false, message: `${number}: brak pozycji albo kwot` };

  return {
    ok: true,
    invoice: {
      number,
      syntheticId,
      issueDate,
      sellDate,
      buyerName: buyerName || "—",
      buyerAddress: addr ? text(rightOf(rows, addr.r, addr.c)) || null : null,
      buyerTaxNo: nipDigits.length === 10 ? nipDigits : null,
      paymentMethod: pay ? text(rightOf(rows, pay.r, pay.c)) || null : null,
      paymentTo: due ? excelDay(rightOf(rows, due.r, due.c)) : null,
      positions,
      totalNet: Math.round(totalNet * 100) / 100,
      totalGross: Math.round(totalGross * 100) / 100,
    },
  };
}

// „przelew 7 dni” → transfer, „gotówka” → cash (jak payment_type Fakturowni).
export function paymentTypeOf(method: string | null): string | null {
  const m = (method ?? "").toLowerCase();
  if (/got[oó]w/.test(m)) return "cash";
  if (/przelew/.test(m)) return "transfer";
  return null;
}
