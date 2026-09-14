"use client";

import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

type VehicleOption = { id: string; name: string };
type MatchSource = "AUTO" | "MANUAL" | null;

type InvoiceRow = {
  id: string;
  fileName: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  sellerName: string | null;
  amountNet: string | null;
  amountGross: string | null;
  currency: string | null;
  vehiclePlateRaw: string | null;
  vehicleId: string | null;
  vehicleName: string | null;
  matchSource: MatchSource;
  uploadedAt: string;
};

// Paleta premium — ten sam zestaw co cost-entries-manager.tsx.
const C = {
  surface: "#FFFFFF",
  border: "#E9EDF1",
  text: "#4A4A4A",
  muted: "#6F7378",
  faint: "#9AA1A8",
  brand: "#1B6FA8",
  brandSoft: "#EAF4FB",
  accent: "#E08A5C",
  amber: "#B06000",
  amberSoft: "#FEF7E0",
  red: "#D93025",
  redSoft: "#FCE8E6",
  green: "#1E9E6B",
  greenSoft: "#E7F6EF",
};

function fmtPln(amount: string | null): string {
  if (amount == null) return "—";
  const n = Number(amount);
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} zł`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

// Faktury paliwowe — weryfikacja szacowanego kosztu paliwa (wzór: spalanie ×
// odległość × cena/L, src/lib/costs/calc.ts) z rzeczywistymi wydatkami.
// Karty paliwowe są WSPÓLNE dla floty, ale stacja pyta o nr rejestracyjny
// przy tankowaniu — trafia na fakturę osobno, stąd dopasowanie do pojazdu po
// numerze, nie po koncie. Format wgrywanych plików: eksport XML z Fakturowni
// (nie PDF) — patrz src/lib/costs/fuel-invoice-parse.ts.
export function FuelInvoicesManager({
  initialFrom,
  initialTo,
  vehicles,
}: {
  initialFrom: string;
  initialTo: string;
  vehicles: VehicleOption[];
}) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/costs/fuel-invoices?from=${from}&to=${to}`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wczytać faktur.");
      setInvoices(Array.isArray(data?.invoices) ? data.invoices : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadSummary(null);
    setError(null);
    try {
      const formData = new FormData();
      for (const f of Array.from(files)) formData.append("files", f);
      const res = await fetch(`${BASE_PATH}/api/costs/fuel-invoices`, { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wgrać faktur.");

      const bits: string[] = [];
      if (data.created > 0) bits.push(`wgrano ${data.created}${data.autoMatched > 0 ? ` (${data.autoMatched} dopasowano automatycznie)` : ""}`);
      if (data.duplicates?.length > 0) bits.push(`${data.duplicates.length} pominięto jako duplikat`);
      if (data.failed?.length > 0) bits.push(`${data.failed.length} nie udało się odczytać`);
      setUploadSummary(bits.join(" · ") || "Nic nie wgrano.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function correctVehicle(row: InvoiceRow, vehicleId: string) {
    const prev = invoices;
    setInvoices((rows) => rows.map((r) => (r.id === row.id ? { ...r, vehicleId: vehicleId || null } : r)));
    const res = await fetch(`${BASE_PATH}/api/costs/fuel-invoices/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vehicleId: vehicleId || null }),
    });
    if (!res.ok) {
      setInvoices(prev);
      const data = await res.json().catch(() => null);
      alert(data?.message || "Nie udało się poprawić pojazdu.");
      return;
    }
    await load();
  }

  async function handleDelete(row: InvoiceRow) {
    if (!window.confirm(`Usunąć fakturę „${row.fileName}" (${fmtPln(row.amountGross)})?`)) return;
    const res = await fetch(`${BASE_PATH}/api/costs/fuel-invoices/${row.id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      alert(data?.message || "Nie udało się usunąć faktury.");
      return;
    }
    setInvoices((rows) => rows.filter((r) => r.id !== row.id));
  }

  const totalGross = invoices.reduce((s, r) => s + (r.amountGross ? Number(r.amountGross) : 0), 0);
  const unmatchedCount = invoices.filter((r) => !r.vehicleId).length;

  return (
    <div>
      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-[22px] sm:px-7">
          <div>
            <h1 className="m-0 text-[21px] font-normal italic" style={{ color: C.accent }}>
              Faktury paliwowe
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
              Wgraj eksport XML z Fakturowni (nie PDF) — system rozpozna numer rejestracyjny z pola „Nr. Pojazdu” i
              dopasuje pojazd automatycznie.
            </p>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xml"
              multiple
              className="hidden"
              onChange={(e) => void handleUpload(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
              style={{ background: C.accent }}
            >
              {uploading ? "Wgrywanie…" : "+ Wgraj faktury (XML)"}
            </button>
          </div>
        </div>

        {uploadSummary && (
          <div className="mx-4 mt-3 rounded-md px-3 py-2 text-[13px] sm:mx-7" style={{ background: C.greenSoft, color: C.green }}>
            {uploadSummary}
          </div>
        )}
        {error && (
          <div className="mx-4 mt-3 rounded-md px-3 py-2 text-[13px] sm:mx-7" style={{ background: C.redSoft, color: C.red }}>
            {error}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3 px-4 sm:px-7" style={{ color: C.muted }}>
          <label className="flex items-center gap-1.5 text-[13px]">
            Od
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border px-2 py-1 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px]">
            Do
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border px-2 py-1 text-[13px]"
              style={{ borderColor: C.border, color: C.text }}
            />
          </label>
          <span className="text-[13px]">
            {invoices.length} {invoices.length === 1 ? "faktura" : "faktur"} · razem {fmtPln(String(totalGross))}
            {unmatchedCount > 0 && (
              <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.amberSoft, color: C.amber }}>
                {unmatchedCount} nieprzypisanych
              </span>
            )}
          </span>
        </div>

        <div className="overflow-x-auto px-4 py-6 sm:px-7">
          {loading ? (
            <p className="py-8 text-center text-[13px]" style={{ color: C.faint }}>
              Ładowanie…
            </p>
          ) : invoices.length === 0 ? (
            <p className="py-8 text-center text-[13px]" style={{ color: C.faint }}>
              Brak faktur w tym okresie.
            </p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-[13px]">
              <thead>
                <tr style={{ color: C.faint }}>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Data
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Sprzedawca
                  </th>
                  <th className="border-b px-2 py-2 text-right font-semibold" style={{ borderColor: C.border }}>
                    Kwota brutto
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Nr rej. z faktury
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Pojazd
                  </th>
                  <th className="border-b px-2 py-2" style={{ borderColor: C.border }} />
                </tr>
              </thead>
              <tbody>
                {invoices.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="border-b px-2 py-2" style={{ borderColor: C.border, color: C.text }}>
                      {fmtDate(r.invoiceDate)}
                    </td>
                    <td className="border-b px-2 py-2" style={{ borderColor: C.border, color: C.text }}>
                      {r.sellerName ?? "—"}
                      <div className="text-[11px]" style={{ color: C.faint }}>
                        {r.fileName}
                      </div>
                    </td>
                    <td className="border-b px-2 py-2 text-right font-semibold" style={{ borderColor: C.border, color: C.text }}>
                      {fmtPln(r.amountGross)}
                    </td>
                    <td className="border-b px-2 py-2" style={{ borderColor: C.border, color: C.text }}>
                      {r.vehiclePlateRaw ?? <span style={{ color: C.faint }}>—</span>}
                    </td>
                    <td className="border-b px-2 py-2" style={{ borderColor: C.border }}>
                      <div className="flex items-center gap-2">
                        <select
                          value={r.vehicleId ?? ""}
                          onChange={(e) => void correctVehicle(r, e.target.value)}
                          className="rounded-md border px-2 py-1 text-[13px]"
                          style={{ borderColor: C.border, color: C.text }}
                        >
                          <option value="">— nieprzypisane —</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </select>
                        {r.matchSource === "AUTO" && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.brandSoft, color: C.brand }}>
                            auto
                          </span>
                        )}
                        {r.matchSource === "MANUAL" && (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.amberSoft, color: C.amber }}>
                            ręcznie
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="border-b px-2 py-2 text-right" style={{ borderColor: C.border }}>
                      <button
                        type="button"
                        onClick={() => void handleDelete(r)}
                        className="rounded-md px-2 py-1 text-[12px] font-medium hover:bg-[#FCE8E6]"
                        style={{ color: C.red }}
                      >
                        Usuń
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
