"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/components/clients/client-forms";
import type { SuspectedBlob } from "@/lib/clients/blob-load";

// Podejrzane zlepki klientów (kilka gabinetów pod jedną kartą) — lista do
// sprawdzenia; rozdzielasz „Wydziel osoby” na karcie klienta albo agent
// zgłasza propozycję „wydzielenie”.
export function BlobsPanel() {
  const [blobs, setBlobs] = useState<SuspectedBlob[] | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    void api<{ blobs: SuspectedBlob[] }>("/api/porzadki/zlepki", "GET").then(({ ok, data }) => alive && setBlobs(ok ? data.blobs : []));
    return () => {
      alive = false;
    };
  }, []);

  if (!blobs || blobs.length === 0) return null;
  return (
    <section className="rounded-xl border border-[var(--c-gold)] bg-[var(--c-gold-soft)] px-4 py-3">
      <button type="button" className="flex w-full items-center gap-2 text-left" onClick={() => setOpen((v) => !v)}>
        <b className="text-[14px] font-semibold text-[var(--c-gold-deep)]">Podejrzane zlepki klientów: {blobs.length}</b>
        <span className="text-xs text-[var(--c-gold-deep)]">— pod jedną kartą prawdopodobnie kilka gabinetów</span>
        <span className="ml-auto text-xs text-[var(--c-gold-deep)]">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <ul className="mt-2 flex flex-col gap-1.5">
          {blobs.map((b) => (
            <li key={b.clientId} className="rounded-lg bg-white px-3 py-2 text-[13px]">
              <Link href={`/klienci/${b.clientId}?tab=dane`} className="font-semibold text-[var(--c-navy)] hover:underline">
                {b.name}
              </Link>
              <span className="ml-2 text-xs text-[var(--c-muted)]">
                {b.city ?? ""} · {b.contacts} osób · {b.rentals} wyn. · punkty {b.score}
              </span>
              <p className="text-xs text-[var(--c-sidebar-text)]">{b.reasons.join(" · ")}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
