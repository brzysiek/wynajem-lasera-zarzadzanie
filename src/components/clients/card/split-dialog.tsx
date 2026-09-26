"use client";

import { useEffect, useState } from "react";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { ClientDetail } from "@/lib/clients/load";
import { formatPhone } from "@/lib/clients/labels";
import { api } from "../client-forms";

// „Wydziel do nowego klienta” (ADMIN/STAFF) — z klienta-zlepka wybrane osoby
// przechodzą do nowego klienta razem ze swoimi wynajmami, sygnałami,
// e-mailami i SMS-ami; opcjonalnie faktury po NIP-ie nabywcy. Grupy z
// kalendarzy przypiszesz potem w Klienci → Dopasowania (albo zrobi to agent).

type Preview = { rentals: number; leads: number; emails: number; sms: number; invoicesByNip: { nip: string; buyerName: string; count: number }[] };

const INPUT =
  "h-9 w-full rounded-lg border border-[var(--c-border)] bg-white px-3 text-sm outline-none focus:border-[var(--c-brand)] placeholder:text-[var(--c-faint)]";
const LABEL = "flex flex-col gap-1 text-xs font-medium text-[var(--c-muted)]";

const person = (c: ClientDetail["contacts"][number]) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "bez nazwy";

export function SplitDialog({ source, onClose, onDone }: { source: ClientDetail; onClose: () => void; onDone: (next: ClientDetail, newClientId: string) => void }) {
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [f, setF] = useState({ name: "", nip: "", street: "", zip: "", city: "", invoiceNip: "" });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    let alive = true;
    const ids = [...chosen];
    const t = setTimeout(() => {
      void api<Preview>(`/api/clients/${source.id}/split?osoby=${ids.join(",")}`, "GET").then(({ ok, data }) => alive && ok && setPreview(data));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [chosen, source.id]);

  async function split() {
    const names = source.contacts.filter((c) => chosen.has(c.id)).map(person);
    if (!window.confirm(`Wydzielić ${names.join(", ")} do nowego klienta „${f.name}”?`)) return;
    setBusy(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail; newClientId: string }>(`/api/clients/${source.id}/split`, "POST", { contactIds: [...chosen], ...f });
    setBusy(false);
    if (!ok) return setError(data.message ?? "Nie udało się wydzielić.");
    onDone(data.detail, data.newClientId);
  }

  const toggle = (id: string) =>
    setChosen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allChosen = chosen.size >= source.contacts.length;

  return (
    <div style={APP_CSS_VARS} className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-5 text-[var(--c-text)] shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Wydziel do nowego klienta">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">Wydziel do nowego klienta</h2>
        <p className="mt-1 text-[13px] text-[var(--c-muted)]">
          Z „{source.name}” wybrane osoby przejdą do nowego klienta razem ze swoimi wynajmami, sygnałami, e-mailami i SMS-ami. Wpis w dzienniku; HubSpot bez zmian.
        </p>

        <p className="mt-4 text-xs font-medium text-[var(--c-muted)]">Osoby do wydzielenia</p>
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-[var(--c-border)]">
          {source.contacts.map((c) => (
            <li key={c.id} className="border-b border-[var(--c-border)] last:border-0">
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px]">
                <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)} />
                <span className="font-medium">{person(c)}</span>
                <span className="truncate text-xs text-[var(--c-muted)]">
                  {[c.phone ? formatPhone(c.phone) : null, c.email].filter(Boolean).join(" · ")}
                  {c.rentalsCount ? ` · ${c.rentalsCount} wyn.` : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {allChosen && <p className="mt-1 text-xs text-[var(--c-red)]">Przy kliencie musi zostać co najmniej jedna osoba.</p>}

        <div className="mt-4 flex flex-col gap-2.5">
          <label className={LABEL}>
            Nazwa nowego klienta
            <input className={INPUT} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="np. Studio Urody „MiWiNi” Barbara Trzaska" />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL}>
              NIP
              <input className={INPUT} value={f.nip} onChange={(e) => set("nip", e.target.value)} />
            </label>
            <label className={LABEL}>
              Miasto
              <input className={INPUT} value={f.city} onChange={(e) => set("city", e.target.value)} />
            </label>
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
            <label className={LABEL}>
              Ulica i numer
              <input className={INPUT} value={f.street} onChange={(e) => set("street", e.target.value)} />
            </label>
            <label className={LABEL}>
              Kod
              <input className={INPUT} value={f.zip} onChange={(e) => set("zip", e.target.value)} />
            </label>
          </div>
          {preview && preview.invoicesByNip.length > 0 && (
            <label className={LABEL}>
              Faktury do przeniesienia (po NIP-ie nabywcy)
              <select className={INPUT} value={f.invoiceNip} onChange={(e) => {
                  const v = e.target.value;
                  const buyer = preview.invoicesByNip.find((i) => i.nip === v)?.buyerName ?? "";
                  // Puste pola podpowiadamy z faktury (NIP i nazwa nabywcy).
                  setF((p) => ({ ...p, invoiceNip: v, nip: p.nip || v, name: p.name || buyer }));
                }}>
                <option value="">— żadne —</option>
                {preview.invoicesByNip.map((i) => (
                  <option key={`${i.nip}-${i.buyerName}`} value={i.nip}>
                    {i.nip} · {i.buyerName} ({i.count})
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {preview && chosen.size > 0 && (
          <p className="mt-3 rounded-lg bg-[var(--c-bg)] px-3 py-2 text-[13px]">
            Przejdzie razem z osobami: wynajmy {preview.rentals} · sygnały {preview.leads} · e-maile {preview.emails} · SMS {preview.sms}
          </p>
        )}
        {error && <p className="mt-3 rounded-lg bg-[var(--c-red-soft)] px-3 py-2 text-[13px] text-[var(--c-red)]">{error}</p>}
        <p className="mt-3 text-xs text-[var(--c-muted)]">Wydarzenia z kalendarzy przypiszesz potem w Klienci → Dopasowania.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-9 rounded-lg px-3 text-sm text-[var(--c-muted)] hover:bg-[var(--c-bg)]" onClick={onClose}>
            Anuluj
          </button>
          <button
            type="button"
            className="h-9 rounded-lg bg-[var(--c-brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-50"
            disabled={busy || chosen.size === 0 || allChosen || !f.name.trim()}
            onClick={() => void split()}
          >
            {busy ? "Wydzielanie…" : "Wydziel"}
          </button>
        </div>
      </div>
    </div>
  );
}
