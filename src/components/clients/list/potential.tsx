"use client";

import Link from "next/link";
import type { ClientListRow } from "@/lib/clients/list-load";
import { DEVICE_INTEREST_LABEL } from "@/lib/clients/labels";
import { LOST_REASON_LABEL, type LostReasonKey } from "@/lib/leads/labels";
import { BASE_PATH } from "@/lib/base-path";
import { dmSmart } from "./format";

// Zakładka „Potencjalni” (pkt 5): kontakty z zapytań — lejek zamiast statusu.
// Kontakt przechodzi do „Klientów” sam, po pierwszym wynajmie (status
// liczony z historii).

export type Stage = "NOWE" | "OFERTA" | "OBDZWONIENIE" | "REZERWACJA" | "PRZEGRANE";
export const STAGES: { key: Stage; label: string }[] = [
  { key: "NOWE", label: "Nowe" },
  { key: "OFERTA", label: "Oferta wysłana" },
  { key: "OBDZWONIENIE", label: "Do obdzwonienia" },
  { key: "REZERWACJA", label: "Rezerwacja" },
  { key: "PRZEGRANE", label: "Przegrane" },
];
const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.key, s.label])) as Record<Stage, string>;

export function stageOf(r: ClientListRow): Stage {
  const l = r.lead;
  if (!l) return "NOWE";
  if (l.stage === "PRZEGRANA") return "PRZEGRANE";
  if (l.stage === "REZERWACJA" || l.stage === "WYGRANA") return "REZERWACJA";
  if (l.stage === "OFERTA") return "OFERTA";
  if (l.callList) return "OBDZWONIENIE";
  return "NOWE";
}

const isEmailName = (r: ClientListRow) => r.name.includes("@");

export function dataGaps(r: ClientListRow): string[] {
  const out: string[] = [];
  if (isEmailName(r)) out.push("nazwa = e-mail");
  if (r.primaryName && !r.primaryLastName && !isEmailName(r)) out.push("brak nazwiska");
  if (!r.hasPhone) out.push("brak telefonu");
  if (!r.city) out.push("brak miasta");
  if (!r.nip && r.lead?.stage === "OFERTA") out.push("brak NIP");
  return out;
}

const GRID = "grid grid-cols-[minmax(200px,330px)_150px_150px_170px_minmax(160px,1fr)_170px] gap-x-4";

export function PotentialTable({ rows, total, onMore, today }: { rows: ClientListRow[]; total: number; onMore: () => void; today: Date }) {
  return (
    <div className="mx-4 overflow-x-auto border border-[#E4E7EA] bg-white md:mx-12">
      <div className="min-w-[1080px]">
        <div className={`${GRID} border-b border-[#E4E7EA] px-[18px] pb-2.5 pt-3.5 text-[12px] uppercase tracking-[0.14em] text-[#5C6166]`}>
          <span>Kontakt</span>
          <span>Pyta o</span>
          <span>Etap</span>
          <span>Ostatni kontakt</span>
          <span>Dane</span>
          <span className="text-right">Akcja</span>
        </div>
        {rows.length === 0 && <div className="px-[18px] py-10 text-center text-[15px] text-[#5C6166]">Nikt nie pasuje do tych filtrów.</div>}
        {rows.map((r) => {
          const stage = stageOf(r);
          const gaps = dataGaps(r);
          const sub = isEmailName(r)
            ? "nazwa do ustalenia"
            : [r.primaryName && r.primaryName !== r.name ? r.primaryName.split(" ")[0] : null, r.city].filter(Boolean).join(" · ") || (r.lead ? "formularz WWW" : "—");
          const asks = r.lead?.interests.length ? r.lead.interests.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : r.devices.length ? r.devices.map((k) => DEVICE_INTEREST_LABEL[k]).join(", ") : "—";
          const last = r.lastContactAt ?? r.lead?.at ?? null;
          const channel = r.lastContactAt ? r.lastContactChannel : r.lead ? "formularz" : null;
          const old = last ? (today.getTime() - new Date(last).getTime()) / 86_400_000 > 180 : false;
          const action =
            isEmailName(r) || (!r.hasPhone && !r.primaryEmail)
              ? { label: "Uzupełnij →", href: `/klienci/${r.id}` }
              : old
                ? { label: "Przypomnij →", href: `/klienci/${r.id}` }
                : r.primaryPhone
                  ? { label: "Zadzwoń →", href: `tel:${r.primaryPhone}` }
                  : { label: "Szkic maila →", href: `mailto:${r.primaryEmail}` };
          return (
            <div key={r.id} className={`${GRID} items-center border-b border-[#EEF0F2] px-[18px] py-3.5`}>
              <div className="flex min-w-0 flex-col gap-0.5">
                <Link href={`/klienci/${r.id}`} className="truncate text-[16px] font-semibold text-[#2B2B2B] hover:text-[#1B6FA8]">
                  {r.shortName ?? r.name}
                </Link>
                <span className="truncate text-[14px] text-[#5C6166]">{sub}</span>
              </div>
              <span className="truncate text-[14px] text-[#3A3A3A]" title={asks}>
                {asks}
              </span>
              <span className="justify-self-start border border-[#A9D2EC] px-[9px] py-[3px] text-[13px] text-[#1B6FA8]" title={stage === "PRZEGRANE" && r.lead?.lostReason ? `powód: ${LOST_REASON_LABEL[r.lead.lostReason as LostReasonKey] ?? r.lead.lostReason}` : undefined}>
                {STAGE_LABEL[stage]}
              </span>
              <span className="text-[14px] tabular-nums text-[#3A3A3A]">{last ? `${dmSmart(last, today)}${channel ? ` · ${channel}` : ""}` : "—"}</span>
              <div className="flex flex-wrap gap-1">
                {gaps.map((g) => (
                  <span key={g} className="bg-[#FBF0E7] px-2 py-0.5 text-[12px] text-[#B8612F]">
                    {g}
                  </span>
                ))}
              </div>
              <a href={action.href.startsWith("/") ? `${BASE_PATH}${action.href}` : action.href} className="text-right text-[14px] text-[#1B6FA8] hover:text-[#0C3450]">
                {action.label}
              </a>
            </div>
          );
        })}
        <div className="flex items-center justify-between px-[18px] py-4 text-[14px] text-[#5C6166]">
          <span>
            Pokazano {rows.length} z {total}
            {rows.length < total && (
              <>
                {" "}
                <span className="text-[#C3C4C7]">·</span>{" "}
                <button type="button" onClick={onMore} className="text-[#1B6FA8] hover:text-[#0C3450]">
                  Załaduj kolejne 50
                </button>
              </>
            )}
          </span>
          <span>Kontakt przechodzi do „Klientów” po pierwszym wynajmie. „Przegrane” wymaga powodu (ustawiany w Sygnałach).</span>
        </div>
      </div>
    </div>
  );
}
