"use client";

import Link from "next/link";
import { STAGE_LABEL, TYPE_LABEL } from "@/lib/leads/labels";
import type { LeadStageKey, LeadTypeKey } from "@/lib/leads/parse-deal";
import type { Report } from "@/lib/marketing/report";

// Klikalne liczby w zakładce Marketing: liczba otwiera listę sygnałów, z których się składa.

export type Pick = { title: string; ids: string[] };

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });

export function Num({ value, ids, title, onPick, dim }: { value: number; ids: string[] | undefined; title: string; onPick: (p: Pick) => void; dim?: boolean }) {
  if (!value || !ids?.length) return <span className="text-gray-300">{value || "—"}</span>;
  return (
    <button type="button" onClick={() => onPick({ title, ids })} className={`font-medium underline decoration-dotted underline-offset-2 hover:text-[#1B6FA8] ${dim ? "text-gray-500" : "text-gray-900"}`}>
      {value}
    </button>
  );
}

export function SignalList({ pick, leads, onClose }: { pick: Pick; leads: Report["leads"]; onClose: () => void }) {
  const unique = [...new Set(pick.ids)];
  return (
    <section className="rounded-lg border border-[#1B6FA8] bg-white" aria-label="Sygnały za liczbą">
      <div className="flex items-center gap-3 border-b border-gray-200 px-4 py-2">
        <h2 className="m-0 text-sm font-semibold text-gray-900">
          {pick.title} — {unique.length}
        </h2>
        <button type="button" onClick={onClose} className="ml-auto text-xs font-semibold text-[#1B6FA8] hover:underline">
          zamknij
        </button>
      </div>
      <ul className="m-0 flex max-h-80 list-none flex-col overflow-y-auto p-0 text-sm">
        {unique.map((id) => {
          const l = leads[id];
          return (
            <li key={id} className="flex flex-wrap items-baseline gap-2 border-t border-gray-100 px-4 py-1.5 first:border-t-0">
              <Link href={`/sygnaly?id=${id}`} className="font-medium text-[#1B6FA8] hover:underline">
                {l?.title ?? id}
              </Link>
              {l && (
                <span className="text-xs text-gray-500">
                  {TYPE_LABEL[l.type as LeadTypeKey] ?? l.type} · {STAGE_LABEL[l.stage as LeadStageKey] ?? l.stage} · {fmtDay(l.createdAt)}
                </span>
              )}
              {l?.termFromFirst && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800" title="Ostatnie wejście miało tę samą kampanię, ale bez utm_term / utm_content — grupa i słowo z pierwszego wejścia">
                  hasło z pierwszego wejścia
                </span>
              )}
              {l && <span className="ml-auto text-xs text-gray-400">{l.channel}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
