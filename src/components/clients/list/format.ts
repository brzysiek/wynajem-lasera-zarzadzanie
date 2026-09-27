// Formaty dat i etykiety listy klientów (lista-klientow-wzor.html).
import type { ClientStatus } from "@/lib/clients/status";

const WD = ["nd", "pn", "wt", "śr", "czw", "pt", "sob"];
const WD_LONG = ["niedziela", "poniedziałek", "wtorek", "środa", "czwartek", "piątek", "sobota"];

export const pad = (n: number) => String(n).padStart(2, "0");
export const dm = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
};
export const dmy = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
// Bieżący rok bez roku, inne z rokiem.
export const dmSmart = (iso: string, today: Date) => (new Date(iso).getFullYear() === today.getFullYear() ? dm(iso) : dmy(iso));
export const mY = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
};
export const wd = (iso: string) => WD[new Date(iso).getDay()];
export const wdLong = (d: Date) => WD_LONG[d.getDay()];

export const daysBetween = (a: Date, b: Date) =>
  Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime() - new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()) / 86_400_000);

export const TAB_STATUSES: ClientStatus[] = ["STALY", "NOWY", "USPIONY", "BYLY", "NIE_KONTAKTOWAC"];

export const STATUS_TILE: Record<ClientStatus, { title: string; hint: string; marker: string }> = {
  STALY: { title: "Stali", hint: "2+ wynajmy w 12 mies.", marker: "bg-[#2F7A68]" },
  NOWY: { title: "Nowi", hint: "pierwszy wynajem w ostatnich 12 mies.", marker: "bg-[#1B6FA8]" },
  USPIONY: { title: "Uśpieni", hint: "6–12 mies. bez wynajmu", marker: "border-[1.5px] border-[#E08A5C]" },
  BYLY: { title: "Byli", hint: "ponad 12 mies.", marker: "border-[1.5px] border-[#9AA1A8]" },
  NIE_KONTAKTOWAC: { title: "Nie kontaktować", hint: "decyzja Tomka", marker: "bg-[#5C6166]" },
  POTENCJALNY: { title: "Potencjalni", hint: "bez wynajmu", marker: "border-[1.5px] border-[#A9D2EC]" },
};

// Badge statusu: 11 px, wersaliki, 0.14em (pkt 6 promptu).
export const STATUS_BADGE: Record<ClientStatus, { label: string; cls: string }> = {
  STALY: { label: "Stały", cls: "bg-[#2F7A68] text-white" },
  NOWY: { label: "Nowy", cls: "bg-[#1B6FA8] text-white" },
  USPIONY: { label: "Uśpiony", cls: "border-[1.5px] border-[#E08A5C] bg-white text-[#B8612F]" },
  BYLY: { label: "Były", cls: "border border-[#B9BEC3] bg-white text-[#767C82]" },
  POTENCJALNY: { label: "Potencjalny", cls: "border border-[#A9D2EC] bg-white text-[#1B6FA8]" },
  NIE_KONTAKTOWAC: { label: "Nie kontaktować", cls: "bg-[#5C6166] text-white" },
};

export const csvCell = (v: string | number | null | undefined): string => {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function downloadCsv(name: string, header: string[], lines: (string | number | null | undefined)[][]) {
  // Średnik + BOM: polski Excel otwiera to bez importu i z poprawnymi ogonkami.
  const body = [header.map(csvCell).join(";"), ...lines.map((l) => l.map(csvCell).join(";"))].join("\n");
  const blob = new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
