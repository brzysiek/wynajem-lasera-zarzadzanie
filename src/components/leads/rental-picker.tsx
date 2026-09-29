"use client";

import { useEffect, useState } from "react";
import type { RentalCandidate } from "@/lib/leads/rental-candidates";
import { INPUT, api } from "@/components/clients/client-forms";

// „Powiąż z wynajmem” (wniosek 18 b): od razu lista kandydatów (urządzenie,
// data, tytuł, klient, kwota) — wybór jednym kliknięciem; pod listą
// wyszukiwarka po dacie („06.11”) i nazwie.

const d = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

export function RentalPicker({ leadId, initial, busy, onPick }: { leadId: string; initial: RentalCandidate[]; busy: boolean; onPick: (rentalId: string) => void }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<RentalCandidate[] | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (!t) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- pusta wyszukiwarka = lista startowa
      setFound(null);
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      void api<{ candidates: RentalCandidate[] }>(`/api/leads/${leadId}/rental-candidates?q=${encodeURIComponent(t)}`, "GET").then(({ ok, data }) => {
        if (!alive) return;
        setLoading(false);
        setFound(ok ? (data.candidates ?? []) : []);
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q, leadId]);
  const list = found ?? initial;
  return (
    <div className="flex flex-col gap-1.5">
      {list.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {list.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                disabled={busy || !!r.linkedLeadTitle}
                onClick={() => onPick(r.id)}
                title={r.linkedLeadTitle ? `Powiązany z innym sygnałem: ${r.linkedLeadTitle}` : "Powiąż ten wynajem z sygnałem"}
                className="flex w-full flex-wrap items-baseline gap-x-2 rounded-[8px] border border-[var(--c-border)] px-2.5 py-1.5 text-left text-[13px] hover:border-[var(--c-brand)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <b className="font-semibold text-[var(--c-ink)]">
                  {r.deviceName} · {d(r.startsAt)}
                </b>
                <span className="min-w-0 flex-1 truncate text-[var(--c-muted)]">{r.title}</span>
                {r.totalNet != null && <span className="tabular-nums text-[var(--c-muted)]">{r.totalNet.toLocaleString("pl-PL")} zł</span>}
                {r.sameClient && <span className="text-[11px] font-semibold text-[#2F7A68]">ten klient</span>}
                {!r.sameClient && r.clientName && <span className="text-[11px] text-[var(--c-muted)]">{r.clientName}</span>}
                {r.linkedLeadTitle && <span className="text-[11px] text-[var(--c-muted)]">powiązany z innym sygnałem</span>}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-[var(--c-faint)]">{found ? "Nic nie znaleziono." : "Brak kandydatów — wyszukaj po dacie albo nazwie."}</p>
      )}
      <input className={INPUT} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj wynajmu: data (06.11) albo nazwa" aria-label="Szukaj wynajmu" />
      {loading && <span className="text-[12px] text-[var(--c-muted)]">Szukam…</span>}
    </div>
  );
}
