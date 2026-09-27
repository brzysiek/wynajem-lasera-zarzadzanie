"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import { APP } from "@/components/shell-tokens";
import type { FvWithoutInvoiceRow } from "@/lib/invoicing/fv-check-load";

// „FV bez faktury” (Finanse → Faktury VAT): zakończone wynajmy ze znacznikiem
// FV bez wystawionej / powiązanej faktury. ADMIN może powiązać podpowiedzianą
// fakturę z Fakturowni z wynajmem; AGENT tylko czyta (kontrola faktur).

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "numeric", month: "short", year: "numeric" });
}

function fmtPln(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? `${n.toLocaleString("pl-PL", { maximumFractionDigits: 2 })} zł` : v;
}

function daysLabel(n: number): string {
  if (n === 0) return "dziś";
  return n === 1 ? "1 dzień" : `${n} dni`;
}

export function FvWithoutInvoicePanel({ canLink }: { canLink: boolean }) {
  const [rows, setRows] = useState<FvWithoutInvoiceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function fetchRows(): Promise<{ rows: FvWithoutInvoiceRow[] } | { error: string }> {
    try {
      const res = await fetch(`${BASE_PATH}/api/rentals/fv-bez-faktury`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) return { error: data?.message || "Nie udało się wczytać listy." };
      return { rows: Array.isArray(data?.rentals) ? data.rentals : [] };
    } catch {
      return { error: "Nie udało się wczytać listy." };
    }
  }

  function apply(r: { rows: FvWithoutInvoiceRow[] } | { error: string }) {
    if ("rows" in r) {
      setRows(r.rows);
      setError(null);
    } else setError(r.error);
  }

  async function load() {
    apply(await fetchRows());
  }

  useEffect(() => {
    let alive = true;
    void fetchRows().then((r) => alive && apply(r));
    return () => {
      alive = false;
    };
  }, []);

  async function link(rentalId: string, clientInvoiceId: string, number: string) {
    if (!window.confirm(`Powiązać fakturę ${number} z tym wynajmem? Wynajem zniknie z listy „FV bez faktury”.`)) return;
    setBusy(clientInvoiceId);
    try {
      const res = await fetch(`${BASE_PATH}/api/rentals/${rentalId}/invoice-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientInvoiceId, action: "link" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || "Nie udało się powiązać faktury.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Błąd.");
    } finally {
      setBusy(null);
    }
  }

  const count = rows?.length ?? 0;
  return (
    <div className="overflow-hidden rounded-[14px] border shadow-[0_1px_3px_rgba(16,24,32,0.04)]" style={{ borderColor: APP.border, background: APP.surface }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-4 text-left transition-colors hover:bg-[#F6F9FB] sm:px-7"
      >
        <span>
          <span className="text-[15px] font-bold" style={{ color: APP.text }}>
            FV bez faktury
          </span>
          <span className="ml-2 text-[12.5px]" style={{ color: APP.textMuted }}>
            zakończone wynajmy z VAT, bez faktury z panelu ani powiązanej z Fakturowni
          </span>
        </span>
        <span className="flex items-center gap-2">
          {rows === null ? (
            <span className="text-[12px]" style={{ color: APP.textFaint }}>
              …
            </span>
          ) : (
            <span
              className="rounded-full px-2.5 py-0.5 text-[12px] font-semibold"
              style={count > 0 ? { background: APP.redSoft, color: APP.red } : { background: APP.greenSoft, color: APP.green }}
            >
              {count > 0 ? count : "brak"}
            </span>
          )}
          <span aria-hidden style={{ color: APP.textFaint }}>
            {open ? "▴" : "▾"}
          </span>
        </span>
      </button>

      {open && (
        <div className="border-t px-4 pb-5 pt-3 sm:px-7" style={{ borderColor: APP.border }}>
          {error && (
            <p className="mb-3 rounded-md px-3 py-2 text-[13px]" style={{ background: APP.redSoft, color: APP.red }}>
              {error}
            </p>
          )}
          {rows && rows.length === 0 && (
            <p className="py-4 text-center text-[13px]" style={{ color: APP.textFaint }}>
              Wszystkie zakończone wynajmy z VAT mają fakturę.
            </p>
          )}
          <ul className="flex flex-col">
            {rows?.map((r, i) => (
              <li key={r.rentalId} className="py-3 text-[13px]" style={i > 0 ? { borderTop: `1px solid ${APP.border}` } : undefined}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <div className="min-w-0">
                    {r.clientId ? (
                      <Link href={`/klienci/${r.clientId}`} className="font-bold hover:underline" style={{ color: APP.text }}>
                        {r.clientName}
                      </Link>
                    ) : (
                      <span className="font-bold" style={{ color: APP.text }}>
                        {r.clientName}
                      </span>
                    )}
                    <span className="ml-2" style={{ color: APP.textMuted }}>
                      {r.deviceName} · koniec {fmtDate(r.endsAt)}
                      {r.nip ? ` · NIP ${r.nip}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 whitespace-nowrap">
                    <span className="font-semibold" style={{ color: APP.text }}>
                      {fmtPln(r.totalGross)}
                    </span>
                    <span className="text-[12px] font-semibold" style={{ color: r.daysSinceEnd > 7 ? APP.red : APP.textMuted }}>
                      {daysLabel(r.daysSinceEnd)} od końca
                    </span>
                    <Link href={`/kalendarz/wynajem/${r.rentalId}`} className="text-[12px] font-medium hover:underline" style={{ color: APP.brand }}>
                      Wynajem →
                    </Link>
                  </div>
                </div>
                {r.suggestions.length > 0 ? (
                  <div className="mt-1.5 flex flex-col gap-1">
                    {r.suggestions.map((s) => (
                      <div key={s.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px]" style={{ color: APP.textMuted }}>
                        <span>
                          Prawdopodobnie: <b style={{ color: APP.text }}>{s.number}</b> z {fmtDate(s.sellDate)}, {fmtPln(s.totalGross)} ({s.reasons.join(", ")})
                        </span>
                        {canLink && (
                          <button
                            type="button"
                            onClick={() => void link(r.rentalId, s.id, s.number)}
                            disabled={busy !== null}
                            className="rounded-md border px-2 py-0.5 text-[12px] font-semibold transition-colors hover:bg-[#EAF4FB] disabled:opacity-50"
                            style={{ borderColor: APP.border, color: APP.brand }}
                          >
                            {busy === s.id ? "Wiązanie…" : "Powiąż"}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-[12.5px]" style={{ color: APP.textFaint }}>
                    Brak pasującej faktury w Fakturowni (ten sam klient/NIP, data ±7 dni).
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
