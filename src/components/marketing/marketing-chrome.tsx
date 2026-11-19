"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { PRESETS, periodFromParams, periodQuery, type Preset } from "@/lib/marketing/period";

// Marketing: pasek podzakładek, selektor okresu (wspólny dla wszystkich podzakładek,
// parametr w adresie) i przycisk „Ustawienia pomiaru” (wniosek 54, etap 1c).

const TABS = [
  { href: "/marketing/przeglad", label: "Przegląd", key: "przeglad" },
  { href: "/marketing/kampanie", label: "Kampanie", key: "kampanie" },
  { href: "/marketing/slowa", label: "Słowa kluczowe", key: "slowa" },
  { href: "/marketing/ruch", label: "Ruch na stronie", key: "ruch" },
  { href: "/marketing/analiza", label: "Analiza", key: "analiza" },
] as const;

const PRESET_LABEL: Record<Preset, string> = { "7": "7 dni", "28": "28 dni", "90": "90 dni", sezon: "Cały sezon", wlasny: "Własny zakres…" };

export function MarketingChrome({ today, waiting }: { today: string; waiting: number }) {
  const pathname = usePathname();
  const router = useRouter();
  const sp = useSearchParams();
  const section = TABS.find((t) => pathname.includes(`/marketing/${t.key}`))?.key ?? (pathname.includes("/marketing/ustawienia") ? "ustawienia" : "przeglad");
  const defaultPreset: Preset = section === "slowa" ? "sezon" : "28";
  const period = periodFromParams({ okres: sp.get("okres"), od: sp.get("od"), do: sp.get("do") }, defaultPreset, today);
  const q = periodQuery(period);
  const [custom, setCustom] = useState(period.preset === "wlasny");
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);
  const showPeriod = section !== "analiza" && section !== "ustawienia";

  function go(query: string) {
    // Zachowaj pozostałe parametry (np. filtr kampanii), podmień okres.
    const next = new URLSearchParams(sp.toString());
    for (const k of ["okres", "od", "do"]) next.delete(k);
    const merged = [query, next.toString()].filter(Boolean).join("&");
    router.push(`${pathname}?${merged}`);
  }

  return (
    <div className="mb-6 border-b border-gray-200">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        {showPeriod && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Okres"
              value={custom ? "wlasny" : period.preset}
              onChange={(e) => {
                const v = e.target.value as Preset;
                if (v === "wlasny") return setCustom(true);
                setCustom(false);
                go(`okres=${v}`);
              }}
              className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm"
              title={period.label}
            >
              {PRESETS.map((p) => (
                <option key={p} value={p}>
                  {p === period.preset && p !== "wlasny" ? period.label : PRESET_LABEL[p]}
                </option>
              ))}
            </select>
            {custom && (
              <span className="flex items-center gap-1 text-xs text-gray-500">
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Od" className="h-9 rounded-lg border border-gray-300 px-2 text-sm text-gray-900" />
                –
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Do" className="h-9 rounded-lg border border-gray-300 px-2 text-sm text-gray-900" />
                <button type="button" disabled={!from || !to} onClick={() => go(`od=${from}&do=${to}`)} className="h-9 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-700 hover:border-[#1B6FA8]">
                  Pokaż
                </button>
              </span>
            )}
          </div>
        )}
        <Link
          href="/marketing/ustawienia"
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg border bg-white px-3 text-sm ${section === "ustawienia" ? "border-[#1B6FA8] text-[#1B6FA8]" : "border-gray-300 text-gray-800 hover:border-[#1B6FA8]"}`}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="2.6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Ustawienia pomiaru
        </Link>
      </div>
      <nav className="-mb-px flex flex-wrap gap-1" aria-label="Podzakładki Marketingu">
        {TABS.map((t) => {
          const active = section === t.key;
          return (
            <Link
              key={t.key}
              href={`${t.href}?${q}`}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm ${active ? "border-[#1B6FA8] font-semibold text-[#1B6FA8]" : "border-transparent text-gray-700 hover:text-[#1B6FA8]"}`}
            >
              {t.label}
              {t.key === "analiza" && waiting > 0 && <span className="rounded-full bg-[#B8530F] px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white">{waiting}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
