"use client";

import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { daysPastDue } from "@/lib/invoicing/email-template";

type InvoiceRow = {
  id: number;
  number: string;
  buyerName: string;
  sellDate: string;
  paymentTo: string;
  priceGross: string;
  currency: string;
  govStatus: string | null;
  govId: string | null;
  paidAt: string | null;
};

type StatementCandidate = { date: string; description: string; amount: number };
type StatementResultRow = {
  invoiceId: number;
  number: string;
  buyerName: string;
  priceGross: string;
  status: "matched" | "ambiguous" | "unmatched";
  candidates: StatementCandidate[];
};

type UploadHistoryRow = {
  id: string;
  fileName: string;
  uploadedAt: string;
  transactionsParsed: number;
  autoMatched: number;
  ambiguous: number;
  noMatch: number;
};

// Paleta premium — ten sam zestaw co fuel-invoices-manager.tsx / cost-entries-manager.tsx.
// Hover-y (kolejność 5-10% ciemniejsza) idą przez Tailwind className, nie
// przez ten obiekt — inline style ma wyższy priorytet niż :hover z klasy,
// więc kolor bazowy + hover muszą być w tym samym miejscu (className).
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
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pl-PL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function UploadIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 15V4M12 4l-4 4M12 4l4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [statementResults, setStatementResults] = useState<StatementResultRow[] | null>(null);
  const [uploadHistory, setUploadHistory] = useState<UploadHistoryRow[]>([]);
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

  async function loadUploadHistory() {
    const res = await fetch(`${BASE_PATH}/api/fakturownia/bank-statement`, { cache: "no-store" });
    const data = await res.json().catch(() => null);
    if (res.ok) setUploadHistory(Array.isArray(data?.uploads) ? data.uploads : []);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  useEffect(() => {
    void loadUploadHistory();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

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

  // Szkic w Gmailu, NIE wysyłka — biuro przegląda i wysyła ręcznie (ustalone
  // z użytkownikiem: wysyłka ma iść z ich skrzynki Workspace, nie przez
  // Fakturownię). Bez potwierdzenia przed kliknięciem — tworzenie szkicu
  // jest w pełni odwracalne (można go usunąć w Gmailu), w odróżnieniu od
  // wysyłki do KSeF.
  async function handleCreateDraft(row: InvoiceRow) {
    setBusyId(row.id);
    setError(null);
    setToast(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.id}/create-draft`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się utworzyć szkicu.");
      setToast(data?.message || "Szkic utworzony.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusyId(null);
    }
  }

  // Ten sam mechanizm szkicu co handleCreateDraft, tylko z inną treścią
  // (przypomnienie zamiast pierwszej wysyłki) — patrz remind-draft/route.ts.
  // Backend i tak odrzuci, jeśli faktura w międzyczasie została oznaczona
  // jako zapłacona; przycisk dodatkowo w ogóle się nie pokazuje dla
  // zapłaconych (patrz render niżej).
  async function handleRemindDraft(row: InvoiceRow) {
    setBusyId(row.id);
    setError(null);
    setToast(null);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.id}/remind-draft`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się utworzyć przypomnienia.");
      setToast(data?.message || "Szkic przypomnienia utworzony.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleUploadStatement(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setStatementResults(null);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", files[0]);
      const res = await fetch(`${BASE_PATH}/api/fakturownia/bank-statement`, { method: "POST", body: formData });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się przetworzyć wyciągu.");
      setStatementResults(Array.isArray(data.results) ? data.results : []);
      await Promise.all([load(), loadUploadHistory()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // Ambiguous/unmatched wiersz z tabeli wyników wgrania — admin sam ocenia
  // (np. widzi 2 kandydatów i wie który to naprawdę), więc to ten sam
  // przełącznik co "Zapłacona" w głównej tabeli, tylko wywołany stąd.
  async function confirmStatementRow(row: StatementResultRow) {
    setBusyId(row.invoiceId);
    try {
      const res = await fetch(`${BASE_PATH}/api/fakturownia/invoices/${row.invoiceId}/paid`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paid: true }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.message || "Nie udało się oznaczyć jako zapłaconej.");
        return;
      }
      setStatementResults((rows) =>
        rows ? rows.map((r) => (r.invoiceId === row.invoiceId ? { ...r, status: "matched" as const } : r)) : rows,
      );
      await load();
    } finally {
      setBusyId(null);
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
    <div className="flex flex-col gap-4">
      <div
        className="overflow-hidden rounded-[14px] border shadow-[0_1px_3px_rgba(16,24,32,0.04)]"
        style={{ borderColor: C.border, background: C.surface }}
      >
        <div className="px-4 pt-[22px] sm:px-7">
          <h1 className="m-0 text-[21px] font-normal italic" style={{ color: C.accent }}>
            Faktury VAT
          </h1>
          <p className="mt-1 text-[13px]" style={{ color: C.muted }}>
            Dane na żywo z Fakturowni. „Zapłacona” to jedyna kolumna z naszej bazy — Fakturownia nie zna statusu
            płatności bez połączenia z bankiem.
          </p>
        </div>

        {/* ---- karta wgrywania wyciągu ---- */}
        <div className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border p-4 sm:mx-7" style={{ borderColor: C.border }}>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-[10px]" style={{ background: C.brandSoft, color: C.brand }}>
              <UploadIcon />
            </div>
            <div>
              <p className="text-[14.5px] font-bold" style={{ color: C.text }}>
                Wyciąg bankowy
              </p>
              <p className="text-[12.5px]" style={{ color: C.muted }}>
                Wgraj CSV z mBanku, żeby dopasować wpłaty do faktur
              </p>
            </div>
          </div>
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
            title={
              uploadHistory.length > 0
                ? [
                    "Ostatnio wgrywane pliki:",
                    ...uploadHistory.slice(0, 3).map((u) => `${fmtDateTime(u.uploadedAt)} — ${u.fileName}`),
                  ].join("\n")
                : "Jeszcze nie wgrano żadnego wyciągu."
            }
            className="flex-none rounded-lg bg-[#1B6FA8] px-4 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#14567F] disabled:opacity-50 disabled:hover:bg-[#1B6FA8]"
          >
            {uploading ? "Przetwarzanie…" : "Wgraj plik"}
          </button>
        </div>

        {statementResults && <StatementResultsTable results={statementResults} busyId={busyId} onConfirm={confirmStatementRow} />}
        {uploadHistory.length > 0 && <UploadHistoryList uploads={uploadHistory} />}
        {error && (
          <div className="mx-4 mt-3 rounded-md px-3 py-2 text-[13px] sm:mx-7" style={{ background: C.redSoft, color: C.red }}>
            {error}
          </div>
        )}
        {toast && (
          <div className="mx-4 mt-3 rounded-md px-3 py-2 text-[13px] sm:mx-7" style={{ background: C.greenSoft, color: C.green }}>
            {toast}
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3 px-4 sm:px-7" style={{ color: C.muted }}>
          <label className="flex items-center gap-1.5 text-[13px]">
            Od
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-[#E9EDF1] px-2 py-1 text-[13px] text-[#4A4A4A] transition-colors hover:border-[#D3DAE1] focus:border-[#1B6FA8] focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[13px]">
            Do
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-[#E9EDF1] px-2 py-1 text-[13px] text-[#4A4A4A] transition-colors hover:border-[#D3DAE1] focus:border-[#1B6FA8] focus:outline-none"
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
                  const ksefProcessing = r.govStatus != null && r.govStatus.startsWith("processing");
                  const ksefError = r.govStatus != null && r.govStatus !== "ok" && !ksefProcessing;
                  return (
                    <tr key={r.id} className="align-top transition-colors hover:bg-[#F6F9FB]">
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
                          <span className="rounded-full bg-[#E7F6EF] px-2 py-0.5 text-[11px] font-semibold text-[#1E9E6B]" title={r.govId ?? undefined}>
                            wysłana
                          </span>
                        ) : ksefProcessing ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                            style={{ background: C.brandSoft, color: C.brand }}
                            title="Fakturownia przetwarza wysyłkę do KSeF — odśwież stronę za chwilę."
                          >
                            wysyłanie…
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleSendKsef(r)}
                            disabled={busyId === r.id}
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors disabled:opacity-50 ${
                              ksefError
                                ? "bg-[#FCE8E6] text-[#D93025] hover:bg-[#F9D2CE]"
                                : "bg-[#FEF7E0] text-[#B06000] hover:bg-[#FCEEC7]"
                            }`}
                          >
                            {ksefError ? "błąd — spróbuj ponownie" : "wyślij do KSeF"}
                          </button>
                        )}
                      </td>
                      <td className="border-b px-2 py-2" style={{ borderColor: C.border }}>
                        <button
                          type="button"
                          onClick={() => void togglePaid(r)}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold transition-colors ${
                            r.paidAt
                              ? "bg-[#E7F6EF] text-[#1E9E6B] hover:bg-[#D2EFE2]"
                              : "bg-[#E9EDF1] text-[#6F7378] hover:bg-[#D3DAE1]"
                          }`}
                        >
                          {r.paidAt ? "zapłacona" : "niezapłacona"}
                        </button>
                        {!r.paidAt &&
                          r.paymentTo &&
                          (() => {
                            const overdue = daysPastDue(r.paymentTo);
                            if (overdue <= 0) return null;
                            return (
                              <p className="mt-1 text-[11px] font-semibold" style={{ color: C.red }}>
                                {overdue === 1 ? "1 dzień" : `${overdue} dni`} po terminie
                              </p>
                            );
                          })()}
                      </td>
                      <td className="border-b px-2 py-2 text-right whitespace-nowrap" style={{ borderColor: C.border }}>
                        <a
                          href={`${BASE_PATH}/api/fakturownia/invoices/${r.id}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors hover:bg-[#EAF4FB]"
                          style={{ color: C.brand }}
                        >
                          PDF
                        </a>
                        <button
                          type="button"
                          onClick={() => void handleCreateDraft(r)}
                          disabled={busyId === r.id}
                          className="rounded-md px-2 py-1 text-[12px] font-medium text-[#1B6FA8] transition-colors hover:bg-[#EAF4FB] disabled:opacity-50"
                        >
                          Utwórz szkic maila
                        </button>
                        {!r.paidAt && (
                          <button
                            type="button"
                            onClick={() => void handleRemindDraft(r)}
                            disabled={busyId === r.id}
                            className="rounded-md px-2 py-1 text-[12px] font-medium transition-colors hover:bg-[#FCE8E6] disabled:opacity-50"
                            style={{ color: C.red }}
                          >
                            Przypomnienie
                          </button>
                        )}
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

// Tabela wyników wgrania wyciągu — CELOWO osobna od głównej tabeli wyżej
// (i niezależna od jej filtra "Od"/"Do"): dopasowanie sprawdza faktury z
// dowolnego okresu wystawienia, więc dopasowana faktura może w ogóle nie
// być widoczna w głównej tabeli, dopóki ktoś nie zmieni zakresu dat. Trzy
// stany na wiersz — zielony (dopasowano pewnie), żółty (kilka kandydatów,
// wybiera człowiek), szary (nic nie pasuje) — pokazuje WSZYSTKIE niezapłacone
// faktury sprawdzone przy tym wgraniu, nie tylko trafienia.
function StatementResultsTable({
  results,
  busyId,
  onConfirm,
}: {
  results: StatementResultRow[];
  busyId: number | null;
  onConfirm: (row: StatementResultRow) => void;
}) {
  if (results.length === 0) {
    return (
      <div className="mx-4 mt-4 rounded-md px-3 py-2 text-[13px] sm:mx-7" style={{ background: C.amberSoft, color: C.amber }}>
        Rozpoznano operacje z wyciągu, ale nie ma żadnych niezapłaconych faktur do dopasowania.
      </div>
    );
  }

  return (
    <div className="mx-4 mt-5 sm:mx-7">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12.5px]" style={{ color: C.muted }}>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: C.green }} />
          Dopasowano automatycznie
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: C.amber }} />
          Kilka pasujących wpłat
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: C.faint }} />
          Brak dopasowania
        </span>
      </div>

      <div className="overflow-hidden rounded-[12px] border" style={{ borderColor: C.border }}>
        {results.map((r, i) => {
          const first = r.candidates[0];
          const actionLabel = r.status === "ambiguous" ? "Wybierz" : r.status === "unmatched" ? "Oznacz ręcznie" : null;
          const dotColor = r.status === "matched" ? C.green : r.status === "ambiguous" ? C.amber : C.faint;
          return (
            <div
              key={r.invoiceId}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 text-[13px] transition-colors hover:bg-[#F6F9FB]"
              style={i > 0 ? { borderTop: `1px solid ${C.border}` } : undefined}
            >
              <div className="min-w-0" style={{ flex: "1 1 220px" }}>
                <p className="truncate font-bold" style={{ color: C.text }}>
                  {r.buyerName}
                </p>
                <p className="text-[12px]" style={{ color: C.muted }}>
                  {r.number} · {fmtPln(r.priceGross, "zł")}
                </p>
              </div>
              <div className="min-w-0" style={{ flex: "1 1 220px" }}>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 flex-none rounded-full" style={{ background: dotColor }} />
                  <div className="min-w-0">
                    <p className="truncate" style={{ color: C.text }}>
                      {r.status === "matched" && "Dopasowano"}
                      {r.status === "ambiguous" && `${r.candidates.length} pasujące wpłaty tej kwoty`}
                      {r.status === "unmatched" && "Brak dopasowania w wyciągu"}
                    </p>
                    <p className="text-[12px]" style={{ color: C.muted }}>
                      {r.status === "matched" && first && `${fmtDate(first.date)} · ${fmtPln(String(first.amount), "zł")}`}
                      {r.status === "ambiguous" &&
                        r.candidates.map((c) => fmtDate(c.date)).join(" i ") + ` · ${fmtPln(r.priceGross, "zł")}`}
                    </p>
                  </div>
                </div>
              </div>
              <div className="flex-none">
                {actionLabel ? (
                  <button
                    type="button"
                    onClick={() => onConfirm(r)}
                    disabled={busyId === r.invoiceId}
                    className="rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50"
                    style={{ borderColor: C.border, color: C.text }}
                  >
                    {actionLabel}
                  </button>
                ) : (
                  <span className="rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold" style={{ borderColor: C.greenSoft, background: C.greenSoft, color: C.green }}>
                    Potwierdzono
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Historia wgrań — bez tego wynik wgrania znikał po odświeżeniu strony, nie
// było śladu KIEDY i JAKI plik wgrano (zgłoszony brak). Zawsze widoczna,
// niezależnie od tego czy właśnie coś wgrano w tej sesji przeglądarki.
function UploadHistoryList({ uploads }: { uploads: UploadHistoryRow[] }) {
  return (
    <div className="mx-4 mt-5 sm:mx-7">
      <p className="mb-2 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.faint }}>
        Historia wgrań
      </p>
      <div className="overflow-hidden rounded-[12px] border" style={{ borderColor: C.border }}>
        {uploads.map((u, i) => (
          <div
            key={u.id}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[12.5px] transition-colors hover:bg-[#F6F9FB]"
            style={i > 0 ? { borderTop: `1px solid ${C.border}` } : undefined}
          >
            <div className="flex min-w-0 items-center gap-2" style={{ color: C.text }}>
              <span className="flex-none font-semibold tabular-nums" style={{ color: C.muted }}>
                {fmtDateTime(u.uploadedAt)}
              </span>
              <span className="truncate">{u.fileName}</span>
            </div>
            <span style={{ color: C.muted }}>
              {u.transactionsParsed} operacji
              {u.autoMatched > 0 && <span style={{ color: C.green }}> · {u.autoMatched} dopasowano</span>}
              {u.ambiguous > 0 && <span style={{ color: C.amber }}> · {u.ambiguous} niejednoznacznych</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
