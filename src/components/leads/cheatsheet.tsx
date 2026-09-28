"use client";

import { useState } from "react";
import Link from "next/link";
import type { Playbook } from "@/lib/leads/playbook";

// Sygnały → „Ściąga” (zasady-wzor.html, ekran 3): kolejność dnia, 10 zasad,
// linki do szablonów i źródła. Treść edytuje Tomek (Ustawienia → Ściąga).

const H2 = "m-0 inline-block border-b-2 border-[#E08A5C] pb-[2px] text-[16px] font-semibold text-[#0C3450]";
const BTN_SM = "inline-flex h-[26px] items-center whitespace-nowrap rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]";

export function Cheatsheet({ playbook, onClose, onStartTour }: { playbook: Playbook; onClose: () => void; onStartTour?: () => void }) {
  const [sources, setSources] = useState(false);
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-white px-[18px] py-4 text-[13px] text-[#2A3540]">
      <div className="flex items-center">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Ściąga · złote zasady obsługi</span>
        <button type="button" onClick={onClose} className="ml-auto text-[16px] text-[#5C6166] hover:text-[#0C3450]" aria-label="Zamknij ściągę">
          ✕
        </button>
      </div>
      <h2 className={`${H2} mt-2 self-start`}>Kolejność dnia</h2>
      <p className="mt-1 text-[12px] text-[#5C6166]">{playbook.dayOrder.map((s, i) => (i < playbook.dayOrder.length - 1 ? `${i + 1} ${s.toLowerCase()}` : s.toLowerCase())).join(" · ")}</p>
      <h2 className={`${H2} mt-4 self-start`}>{playbook.rules.length} zasad</h2>
      <ol className="m-0 mt-1 list-none p-0">
        {playbook.rules.map((r, i) => (
          <li key={i} className="grid grid-cols-[26px_1fr] gap-2 border-b border-[#F0F1F2] py-[7px] text-[12.5px] last:border-0">
            <span className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#0C3450] text-[11px] font-semibold text-white">{i + 1}</span>
            <div>
              <b className="font-semibold text-[#0C3450]">{r.title}</b>
              {r.text && <div className="text-[12px] text-[#5C6166]">{r.text}</div>}
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[12.5px] font-semibold text-[#0C3450]">Reguła nadrzędna: jeśli nie wiesz, co zrobić z sygnałem – zadzwoń.</p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Link href="/ustawienia/szablony-sms" className={BTN_SM}>
          Szablony SMS
        </Link>
        <Link href="/ustawienia/sciaga" className={BTN_SM}>
          Skrypty rozmów
        </Link>
        <button type="button" className={BTN_SM} onClick={() => setSources((v) => !v)}>
          Skąd te zasady (źródła)
        </button>
        {onStartTour && (
          <button type="button" className={BTN_SM} onClick={onStartTour}>
            Pokaż przewodnik po Sygnałach
          </button>
        )}
        <span className="ml-auto text-[12px] text-[#5C6166]">edytuje: Tomek · Ustawienia → Ściąga</span>
      </div>
      {sources && (
        <ul className="mt-2 flex flex-col gap-1 text-[12px]">
          {playbook.sources.map((s) => (
            <li key={s.url}>
              <a href={s.url} target="_blank" rel="noreferrer" className="text-[#1B6FA8] hover:underline">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
