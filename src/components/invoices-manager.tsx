"use client";

import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";

type InvoiceRow = {
  id: number;
  number: string;
  buyerName: string;
  sellDate: string;
  priceGross: string;
  currency: string;
  govStatus: string | null;
  govId: string | null;
  paidAt: string | null;
};

// Paleta premium — ten sam zestaw co fuel-invoices-manager.tsx / cost-entries-manager.tsx.
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

function fmtPln(amount: string, currency: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `${new Intl.NumberFormat("pl-PL", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${currency}`;
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return y && m && d ? `${d}.${m}.${y}` : "—";
}

// Faktury VAT — dane NA ŻYWO z Fakturowni (nie z naszej bazy, żeby nie
// duplikować stanu który może się zmienić po ich stronie), dział ustalony w
// Ustawieniach → Integracje. "Zapłacona" to jedyna kolumna z naszej bazy —
// Fakturownia jej nie zna (brak płatnego połączenia z bankiem), ustalamy
// sami: ręcznym przełącznikiem tutaj albo wgrywając wyciąg bankowy.
export function InvoicesManager({ initialFrom, initialTo }: { initialFrom: string; initialTo: string }) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadSummary, setUploadSummary] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices?from=${from}&to=${to}`, { cache: "no-store" });
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

  async function handleSendKsef(row: InvoiceRow) {
    if (!window.confirm(`Wysłać fakturę ${row.number} do KSeF? Tej operacji nie da się cofnąć.`)) return;
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.id}/send-ksef`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wysłać do KSeF.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSendEmail(row: InvoiceRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.id}/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się wysłać maila.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUploadStatement(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadSummary(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      const res = await fetch(`${BASE_PATH}/api/fakturownia/bank-statement`, { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się przetworzyć wyciągu.");

      const bits: string[] = [`rozpoznano ${data.transactionsParsed} operacji`];
      const numbers: string[] = Array.isArray(data.matchedNumbers) ? data.matchedNumbers : [];
      if (data.autoMatched > 0) {
        bits.push(`${data.autoMatched} faktur oznaczono jako zapłacone (${numbers.join(", ")})`);
      }
      if (data.ambiguous > 0) bits.push(`${data.ambiguous} niejednoznacznych — oznacz ręcznie`);
      if (data.autoMatched === 0 && data.ambiguous === 0) bits.push("brak dopasowań do niezapłaconych faktur");
      // Dopasowanie sprawdza faktury z DOWOLNEGO okresu wystawienia (mogła
      // być wystawiona wcześniej niż zapłacona) — jeśli oznaczona faktura ma
      // datę sprzedaży spoza obecnie wybranego zakresu, nie pojawi się w
      // tabeli poniżej, dopóki nie zmienisz "Od"/"Do".
      if (data.autoMatched > 0) bits.push("jeśli nie widzisz zmiany w tabeli, sprawdź inny zakres dat");
      setUploadSummary(bits.join(" · "));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function togglePaid(row: InvoiceRow) {
    const nextPaid = !row.paidAt;
    setInvoices((rows) => rows.map((r) => (r.id === row.id ? { ...r, paidAt: nextPaid ? new Date().toISOString() : null } : r)));
    const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.id}/paid`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paid: nextPaid }),
    });
    if (!res.ok) {
      await load();
      const data = await res.json().catch(() => null);
      alert(data?.message || "Nie udało się zmienić statusu płatności.");
    }
  }

  const totalGross = invoices.reduce((s, r) => s + (Number(r.priceGross) || 0), 0);
  const unpaidCount = invoices.filter((r) => !r.paidAt).length;

  return (
    <div>
      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: C.border, background: C.surface }}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-[22px] sm:px-7">
          <div>
            <h1 className="m-0 text-[21px] font-normal italic" style={{ color: C.accent }}>
              Faktury VAT
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
              Dane na żywo z Fakturowni. „Zapłacona” to jedyna kolumna z naszej bazy — Fakturownia nie zna statusu
              płatności bez połączenia z bankiem.
            </p>
          </div>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => void handleUploadStatement(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="rounded-lg px-4 py-2.5 text-[13px] font-bold text-white disabled:opacity-50"
              style={{ background: C.accent }}
            >
              {uploading ? "Przetwarzanie…" : "+ Wgraj wyciąg bankowy (CSV)"}
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
            {invoices.length} {invoices.length === 1 ? "faktura" : "faktur"} · razem {fmtPln(String(totalGross), "PLN")}
            {unpaidCount > 0 && (
              <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.amberSoft, color: C.amber }}>
                {unpaidCount} niezapłaconych
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
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr style={{ color: C.faint }}>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Numer
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Klient
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Data sprzedaży
                  </th>
                  <th className="border-b px-2 py-2 text-right font-semibold" style={{ borderColor: C.border }}>
                    Kwota brutto
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    KSeF
                  </th>
                  <th className="border-b px-2 py-2 text-left font-semibold" style={{ borderColor: C.border }}>
                    Zapłacona
                  </th>
                  <th className="border-b px-2 py-2" style={{ borderColor: C.border }} />
                </tr>
              </thead>
              <tbody>
                {invoices.map((r) => {
                  const sentToKsef = r.govStatus === "ok";
                  const ksefError = r.govStatus != null && r.govStatus !== "ok" && !r.govStatus.startsWith("processing");
                  return (
                    <tr key={r.id} className="align-top">
                      <td className="border-b px-2 py-2 font-medium" style={{ borderColor: C.border, color: C.text }}>
                        {r.number}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: C.border, color: C.text }}>
                        {r.buyerName}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: C.border, color: C.text }}>
                        {fmtDate(r.sellDate)}
                      </td>
                      <td className="border-b px-2 py-2 text-right font-semibold" style={{ borderColor: C.border, color: C.text }}>
                        {fmtPln(r.priceGross, r.currency)}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: C.border }}>
                        {sentToKsef ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: C.greenSoft, color: C.green }} title={r.govId ?? undefined}>
                            wysłana
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSendKsef(r)}
                            disabled={busyId === r.id}
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
                            style={{ background: ksefError ? C.redSoft : C.amberSoft, color: ksefError ? C.red : C.amber }}
                          >
                            {ksefError ? "błąd — spróbuj ponownie" : "wyślij do KSeF"}
                          </button>
                        )}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: C.border }}>
                        <button
                          type="button"
                          onClick={() => void togglePaid(r)}
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: r.paidAt ? C.greenSoft : C.border, color: r.paidAt ? C.green : C.muted }}
                        >
                          {r.paidAt ? "zapłacona" : "niezapłacona"}
                        </button>
                      </td>
                      <td className="border-b px-2 py-2 text-right" style={{ borderColor: C.border }}>
                        <button
                          type="button"
                          onClick={() => void handleSendEmail(r)}
                          disabled={busyId === r.id}
                          className="rounded-md px-2 py-1 text-[12px] font-medium disabled:opacity-50"
                          style={{ color: C.brand }}
                        >
                          Wyślij mailem
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
