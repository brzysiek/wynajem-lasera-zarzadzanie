"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewClient } from "@/lib/history/review-load";
import type { UnassignedRental } from "@/lib/clients/rental-match";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { ClientPicker } from "./history-review";
import { api } from "./client-forms";

// Rezerwacje z kalendarza bez klienta (wniosek 13) — na górze
// /klienci/dopasowania. Pewne dopasowania (alias, seria, HubSpot) przypisują
// się same przy synchronizacji; tu zostają te do potwierdzenia. Jedna
// decyzja obejmuje wszystkie rezerwacje o tym samym tytule i uczy alias.

type Group = { key: string; title: string; rentals: UnassignedRental[]; candidates: UnassignedRental["candidates"] };

function dm(iso: string) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function UnassignedRentals({ rentals, clients }: { rentals: UnassignedRental[]; clients: ReviewClient[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const r of rentals) {
      const k = r.titleKey || r.id;
      const g = m.get(k) ?? { key: k, title: r.title, rentals: [], candidates: r.candidates };
      g.rentals.push(r);
      m.set(k, g);
    }
    return [...m.values()];
  }, [rentals]);

  async function assign(g: Group, clientId: string) {
    setBusy(g.key);
    setPicker(null);
    const { ok, data } = await api<{ assigned: number; autoAssigned: number }>("/api/rentals/assign-client", "POST", { rentalIds: g.rentals.map((r) => r.id), clientId });
    setBusy(null);
    if (!ok) {
      setMsg({ text: data.message ?? "Nie udało się przypisać.", error: true });
      return;
    }
    const name = clients.find((c) => c.id === clientId)?.name ?? "klienta";
    setMsg({ text: `Przypisano ${data.assigned} do: ${name}${data.autoAssigned ? ` · i ${data.autoAssigned} kolejnych przypisało się samo` : ""}.` });
    router.refresh();
  }

  if (rentals.length === 0) return null;

  return (
    <section id="rezerwacje" style={APP_CSS_VARS} className="scroll-mt-6 rounded-xl border border-[#E08A5C] bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">
          Rezerwacje bez klienta <span className="tabular-nums text-[#B8612F]">{rentals.length}</span>
        </h2>
        <span className="text-xs text-[var(--c-muted)]">Pewne dopasowania (alias, ta sama seria, kontakt HubSpot) przypisują się same przy synchronizacji kalendarzy.</span>
      </div>
      <p className="mt-1 text-[13px] text-[var(--c-muted)]">
        Bez klienta rezerwacja nie liczy się jako „następny wynajem”, a klientka może trafić do przypomnień. Potwierdzenie zapamiętuje tytuł — kolejne
        rezerwacje z nim przypiszą się same. Klienta nie ma w bazie? Dodaj go na liście klientów i wróć tutaj.
      </p>
      {msg && <p className={`mt-2 text-[13px] ${msg.error ? "text-[#B8612F]" : "text-[var(--c-green)]"}`}>{msg.text}</p>}
      <ul className="mt-3 divide-y divide-[var(--c-border)]">
        {groups.map((g) => {
          const top = g.candidates[0];
          return (
            <li key={g.key} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-[240px] flex-1">
                <div className="text-sm font-semibold text-[var(--c-text)]">{g.title}</div>
                <div className="text-xs text-[var(--c-muted)]">
                  <span className="tabular-nums">{g.rentals.map((r) => dm(r.startsAt)).join(", ")}</span> · {[...new Set(g.rentals.map((r) => r.deviceName))].join(", ")}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {top ? (
                  <button
                    type="button"
                    disabled={busy === g.key}
                    onClick={() => void assign(g, top.clientId)}
                    className="h-8 whitespace-nowrap rounded-lg bg-[var(--c-brand)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-40"
                    title={`Pewność ${Math.round(top.score * 100)}%`}
                  >
                    Przypisz: {top.name}
                    {top.city ? ` (${top.city})` : ""}
                  </button>
                ) : (
                  <span className="text-xs text-[var(--c-muted)]">brak propozycji</span>
                )}
                <div className="relative">
                  <button
                    type="button"
                    disabled={busy === g.key}
                    onClick={() => setPicker(picker === g.key ? null : g.key)}
                    className="h-8 whitespace-nowrap rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] text-[var(--c-text)] hover:border-[var(--c-brand)] disabled:opacity-40"
                  >
                    {top ? "Inny klient…" : "Wybierz klienta…"}
                  </button>
                  {picker === g.key && <ClientPicker clients={clients} onPick={(id) => void assign(g, id)} onClose={() => setPicker(null)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
