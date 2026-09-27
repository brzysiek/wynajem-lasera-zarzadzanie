"use client";

import { useState } from "react";
import Link from "next/link";
import type { Archive2025Candidate } from "@/lib/leads/cleanup";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { api } from "@/components/clients/client-forms";

// Sygnały → Archiwum 2025 (lejek, jednorazowo): lista otwartych sygnałów
// sprzed 2026. Domyślnie zaznaczone te bez kontaktu; z kontaktem — do
// decyzji. Archiwizacja nic nie usuwa: sygnały trafiają do „Archiwum 2025”
// (Tablica, Potencjalni) i można je przywrócić.
export function Archive2025Review({ initial }: { initial: Archive2025Candidate[] }) {
  const [rows, setRows] = useState(initial);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(initial.filter((r) => !r.contacted).map((r) => r.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set(s).add(id)));

  async function archive() {
    if (!window.confirm(`Przenieść ${picked.size} sygnałów do archiwum „2025 – bez kontaktu”? Można je potem przywrócić.`)) return;
    setBusy(true);
    const { ok, data } = await api<{ archived: number; candidates: Archive2025Candidate[] }>("/api/leads/archive-2025", "POST", { ids: [...picked] });
    setBusy(false);
    if (!ok) return setMsg({ text: data.message ?? "Nie udało się.", error: true });
    setRows(data.candidates);
    setPicked(new Set(data.candidates.filter((r) => !r.contacted).map((r) => r.id)));
    setMsg({ text: `Przeniesiono do archiwum 2025: ${data.archived}. Widać je w Tablicy (Archiwum 2025) i w Potencjalnych.` });
  }

  const TD = "border-b border-[#F0F1F2] px-2 py-1.5 align-top";
  return (
    <div style={APP_CSS_VARS} className="flex flex-col gap-4 text-[13px] text-[var(--c-text)]">
      <div>
        <Link href="/sygnaly" className="text-[13px] text-[var(--c-muted)] hover:text-[var(--c-brand)]">
          ← Sygnały
        </Link>
        <h1 className="m-0 mt-1 text-[26px] font-semibold text-[var(--c-navy)]">Archiwum 2025 – bez kontaktu</h1>
        <p className="mt-1 text-[13px] text-[var(--c-muted)]">
          Otwarte sygnały sprzed 2026: {rows.length} ({rows.filter((r) => !r.contacted).length} bez kontaktu — zaznaczone). Po przeniesieniu nie ma ich w „Na dziś” ani na Tablicy 2026; wracają przyciskiem „Przywróć”.
        </p>
      </div>
      {msg && <p className={`px-3 py-2 ${msg.error ? "bg-[#FBF0E7] text-[#B8612F]" : "bg-[#EEF6F2] text-[#2F7A68]"}`}>{msg.text}</p>}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || picked.size === 0}
          onClick={() => void archive()}
          className="h-[34px] rounded-[6px] bg-[#1B6FA8] px-4 font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40"
        >
          {busy ? "Przenoszenie…" : `Przenieś do archiwum 2025 (${picked.size})`}
        </button>
        <button type="button" className="text-[#1B6FA8] hover:underline" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>
          zaznacz wszystkie
        </button>
        <button type="button" className="text-[#1B6FA8] hover:underline" onClick={() => setPicked(new Set(rows.filter((r) => !r.contacted).map((r) => r.id)))}>
          tylko bez kontaktu
        </button>
      </div>
      <div className="overflow-x-auto border border-[#E3E6E9] bg-white">
        <table className="w-full min-w-[820px] border-collapse">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[#5C6166]">
              <th className="border-b border-[#E3E6E9] px-2 py-1.5" />
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Sygnał</th>
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Kto</th>
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Źródło</th>
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Etap</th>
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Wpłynęło</th>
              <th className="border-b border-[#E3E6E9] px-2 py-1.5">Kontakt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={r.contacted ? "bg-[#FBF7F2]" : ""}>
                <td className={TD}>
                  <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Archiwizuj ${r.title}`} />
                </td>
                <td className={TD}>
                  <Link href={`/sygnaly?id=${r.id}`} className="font-medium text-[#0C3450] hover:underline">
                    {r.title}
                  </Link>
                </td>
                <td className={TD}>{[r.who, r.phone, r.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className={TD}>{r.type}</td>
                <td className={TD}>{r.stage}</td>
                <td className={`${TD} tabular-nums`}>{new Date(r.createdAt).toLocaleDateString("pl-PL")}</td>
                <td className={TD}>{r.contacted ? <span className="text-[#B8612F]">był kontakt — do decyzji</span> : "brak"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
