"use client";

import { useState } from "react";
import type { ChatThreadDto } from "@/lib/chat/load";

// Zakładka „Czat” (wniosek 42): rozmowa z Messengera / Instagrama — dymki
// klientki i nasze odpowiedzi, godziny, ikona kanału oraz licznik czekania
// klientki. Faza 1: tylko podgląd (odpowiadamy w aplikacji Meta).

const fmt = (iso: string) => new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function waitingText(iso: string, now = Date.now()): string {
  const h = Math.floor((now - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "mniej niż godzinę";
  if (h < 24) return `${h} godz.`;
  const d = Math.floor(h / 24);
  return `${d} ${d === 1 ? "dzień" : "dni"}`;
}

export function LeadChat({ threads }: { threads: ChatThreadDto[] }) {
  const [open, setOpen] = useState(true);
  if (!threads.length) return null;
  return (
    <section className="flex flex-col gap-2 rounded-[10px] border border-[var(--c-border)] p-3" data-lead-chat>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-2 text-left">
        <h3 className="m-0 text-[13px] font-semibold text-[var(--c-navy)]">💬 Czat</h3>
        <span className="text-[12px] text-[var(--c-muted)]">{threads.map((t) => (t.channel === "INSTAGRAM" ? "Instagram" : "Messenger")).join(" · ")}</span>
        {threads.some((t) => t.waitingSince) && <span className="rounded bg-[#FBF0E7] px-1.5 py-px text-[11px] font-semibold text-[#B8612F]">czeka na odpowiedź</span>}
        <span className="ml-auto text-[12px] text-[var(--c-muted)]">{open ? "▴" : "▾"}</span>
      </button>
      {open &&
        threads.map((t) => (
          <div key={t.id} className="flex flex-col gap-1.5">
            <div className="text-[11.5px] text-[var(--c-muted)]">
              {t.channel === "INSTAGRAM" ? "Instagram Direct" : "Messenger"}
              {t.displayName ? ` · ${t.displayName}` : ""}
              {t.waitingSince && <b className="ml-1 font-semibold text-[#B8612F]">· klientka czeka {waitingText(t.waitingSince)}</b>}
            </div>
            <ul className="m-0 flex max-h-[360px] list-none flex-col gap-1.5 overflow-y-auto p-0">
              {t.messages.map((m) => (
                <li key={m.id} className={`flex ${m.direction === "OUT" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-[10px] px-2.5 py-1.5 text-[13px] ${m.direction === "OUT" ? "bg-[#1B6FA8] text-white" : "bg-[#EEF1F4] text-[#0C3450]"}`}>
                    <span className="whitespace-pre-line [overflow-wrap:anywhere]">{m.text ?? ""}</span>
                    {m.attachments.map((a, i) => (
                      <span key={i} className="mt-0.5 block text-[12px] underline">
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noreferrer">
                            📎 {a.type}
                          </a>
                        ) : (
                          `📎 ${a.type}`
                        )}
                      </span>
                    ))}
                    <span className={`mt-0.5 block text-[10.5px] ${m.direction === "OUT" ? "text-white/70" : "text-[#8A939B]"}`}>
                      {m.direction === "OUT" ? "My" : "Klientka"} · {fmt(m.at)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      <p className="m-0 text-[11px] text-[var(--c-muted)]">Odpowiadasz w aplikacji Meta (Messenger / Instagram) — panel na razie tylko pokazuje rozmowę.</p>
    </section>
  );
}
