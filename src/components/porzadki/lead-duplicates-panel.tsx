"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/components/clients/client-forms";
import type { LeadDuplicate } from "@/lib/leads/cleanup";

// Zdublowane otwarte sygnały u jednego klienta (lejek) — lista do sprawdzenia;
// duplikat zamykasz na karcie sygnału (archiwum, powód „Duplikat”) albo agent
// zgłasza propozycję „archiwizacja” z sygnal_id.
export function LeadDuplicatesPanel() {
  const [dups, setDups] = useState<LeadDuplicate[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<{ duplicates: LeadDuplicate[] }>("/api/porzadki/duplikaty-sygnalow", "GET").then(({ ok, data }) => alive && setDups(ok ? data.duplicates : []));
    return () => {
      alive = false;
    };
  }, []);

  if (!dups || dups.length === 0) return null;
  return (
    <section className="rounded-xl border border-[var(--c-gold)] bg-[var(--c-gold-soft)] px-4 py-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <b className="text-[14px] font-semibold text-[var(--c-gold-deep)]">Zdublowane sygnały: {dups.length} klientów</b>
        <span className="text-xs text-[var(--c-gold-deep)]">— kilka otwartych sygnałów u jednego klienta</span>
        <span className="ml-auto text-xs text-[var(--c-gold-deep)]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {dups.map((d) => (
            <li key={d.clientId} className="rounded-lg bg-white px-3 py-2 text-[13px]">
              <Link href={`/klienci/${d.clientId}`} className="font-semibold text-[var(--c-navy)] hover:underline">
                {d.clientName}
              </Link>
              <ul className="mt-1 flex flex-col gap-0.5">
                {d.leads.map((l) => (
                  <li key={l.id} className="text-xs text-[var(--c-sidebar-text)]">
                    <Link href={`/sygnaly?id=${l.id}`} className="text-[var(--c-brand)] hover:underline">
                      {l.title}
                    </Link>{" "}
                    · {l.stage} · {new Date(l.createdAt).toLocaleDateString("pl-PL")}
                    {l.ownerName ? ` · ${l.ownerName}` : ""}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
