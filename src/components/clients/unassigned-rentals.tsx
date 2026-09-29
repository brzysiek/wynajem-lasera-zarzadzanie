"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ReviewClient } from "@/lib/history/review-load";
import type { UnassignedRental } from "@/lib/clients/rental-match";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { ClientPicker } from "./history-review";
import { NewClientDialog, api } from "./client-forms";
import { isGenericTitleKey } from "@/lib/clients/rental-match-rules";

// Rezerwacje z kalendarza bez klienta (wniosek 13 i 23) — na górze
// /klienci/dopasowania. Same przypisują się tylko przy twardym kluczu
// (klient zapisany w wydarzeniu, alias, ta sama seria, telefon / e-mail w
// opisie); tu zostają te do decyzji — kandydaci z uzasadnieniem. Jedna
// decyzja obejmuje wszystkie rezerwacje o tym samym tytule i (domyślnie)
// zapamiętuje tytuł jako alias — poza ogólnymi tytułami („NOWA PaNI”).

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
  // „Dodaj klienta” — nowy klient od razu dostaje rezerwacje z tej grupy.
  const [adding, setAdding] = useState<Group | null>(null);
  // Grupy, dla których „nie zapamiętuj tytułu jako aliasu”.
  const [noAlias, setNoAlias] = useState<Set<string>>(new Set());

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
    const alias = !noAlias.has(g.key) && !isGenericTitleKey(g.key);
    const { ok, data } = await api<{ assigned: number; autoAssigned: number }>("/api/rentals/assign-client", "POST", { rentalIds: g.rentals.map((r) => r.id), clientId, alias });
    setBusy(null);
    if (!ok) {
      setMsg({ text: data.message ?? "Nie udało się przypisać.", error: true });
      return;
    }
    const name = clients.find((c) => c.id === clientId)?.name ?? "nowego klienta";
    setMsg({ text: `Przypisano ${data.assigned} do: ${name}${data.autoAssigned ? ` · przypisano też ${data.autoAssigned} kolejne terminy (alias / seria)` : ""}.` });
    router.refresh();
  }

  if (rentals.length === 0) return null;

  return (
    <section id="rezerwacje" style={APP_CSS_VARS} className="scroll-mt-6 rounded-xl border border-[#E08A5C] bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">
          Rezerwacje bez klienta <span className="tabular-nums text-[#B8612F]">{rentals.length}</span>
        </h2>
        <span className="text-xs text-[var(--c-muted)]">Same przypisują się tylko: klient zapisany w wydarzeniu, alias, ta sama seria, telefon / e-mail w opisie. Podobna nazwa i HubSpot to tylko propozycje.</span>
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
                  {top && <span className={top.reason.includes("sprawdź") || top.reason === "HubSpot" ? " text-[#B8612F]" : " text-[var(--c-green)]"}> · {top.reason}</span>}
                </div>
                {isGenericTitleKey(g.key) ? (
                  <div className="text-[11px] text-[var(--c-muted)]">ogólny tytuł — bez aliasu</div>
                ) : (
                  <label className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--c-muted)]">
                    <input
                      type="checkbox"
                      checked={!noAlias.has(g.key)}
                      onChange={(e) => setNoAlias((prev) => { const n = new Set(prev); if (e.target.checked) n.delete(g.key); else n.add(g.key); return n; })}
                    />
                    zapamiętaj „{g.title}” jako alias klientki
                  </label>
                )}
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
                  <span className="flex items-center gap-2 text-xs text-[#B8612F]">
                    brak klienta w bazie
                    <button
                      type="button"
                      disabled={busy === g.key}
                      onClick={() => setAdding(g)}
                      className="h-8 whitespace-nowrap rounded-lg bg-[var(--c-brand)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-40"
                    >
                      Dodaj klienta
                    </button>
                  </span>
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
      {adding && (
        <NewClientDialog
          initialName={adding.title.replace(/^\d{1,2}[:.]\d{2}\s*/, "")}
          hint={`Rezerwacje ${adding.rentals.map((r) => dm(r.startsAt)).join(", ")} zostaną przypisane do nowego klienta.`}
          onClose={() => setAdding(null)}
          onCreated={(id) => {
            const g = adding;
            setAdding(null);
            void assign(g, id);
          }}
        />
      )}
    </section>
  );
}
