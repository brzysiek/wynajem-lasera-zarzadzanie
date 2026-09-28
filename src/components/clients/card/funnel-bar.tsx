"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ClientDetail } from "@/lib/clients/load";
import { TYPE_LABEL } from "@/lib/leads/labels";
import { LEAD_DEVICE_LABEL, type LeadStageKey, type LeadTypeKey } from "@/lib/leads/parse-deal";
import type { DeviceInterestKey } from "@/lib/clients/labels";
import { NEXT_STEP_LABEL, OPEN_STAGES, rotInfo, type NextStepType } from "@/lib/leads/funnel";
import { StageChip } from "@/components/leads/lead-ui";
import { api } from "../client-forms";

// Karta klienta — pasek „W lejku” pod nagłówkiem (lejek v2, ekran 6): etap
// otwartego sygnału, urządzenie, wiek w etapie, następny krok, oś etapów i
// link do sygnału. Bez otwartego sygnału: „Poza lejkiem · + Sygnał”.

const FLOW: LeadStageKey[] = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"];
const NEW_TYPES: LeadTypeKey[] = ["TELEFON", "EMAIL", "OLX", "POLECENIE", "INNE"];
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

export function FunnelBar({ d, isAgent }: { d: ClientDetail; isAgent: boolean }) {
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lead = d.leads.find((l) => !l.archived && (OPEN_STAGES.includes(l.stage) || l.stage === "ODLOZONE"));
  const now = new Date();

  async function create(type: LeadTypeKey) {
    setBusy(true);
    const { ok, data } = await api<{ id: string }>("/api/leads", "POST", { type, clientId: d.id });
    setBusy(false);
    setMenu(false);
    if (!ok) return setError(data.message ?? "Nie udało się założyć sygnału.");
    router.refresh();
  }

  if (!lead) {
    return (
      <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 border border-l-[3px] border-[#E3E6E9] border-l-[#C9D3DC] bg-white px-3.5 py-2 text-[13px] md:mx-7">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Poza lejkiem</span>
        <span className="text-[#5C6166]">brak otwartego sygnału</span>
        {error && <span className="text-[12px] text-[#B8612F]">{error}</span>}
        {!isAgent && (
          <span className="relative ml-auto">
            <button type="button" disabled={busy} onClick={() => setMenu((v) => !v)} className="h-[26px] rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]">
              + Sygnał
            </button>
            {menu && (
              <span className="absolute right-0 top-7 z-10 flex w-[150px] flex-col border border-[#C9D3DC] bg-white py-1 text-left shadow-[0_4px_12px_rgba(12,52,80,0.12)]">
                <span className="px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Źródło</span>
                {NEW_TYPES.map((t) => (
                  <button key={t} type="button" disabled={busy} onClick={() => void create(t)} className="px-2.5 py-1 text-left text-[12.5px] hover:bg-[#EAF4FB]">
                    {TYPE_LABEL[t]}
                  </button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
    );
  }

  const devices = lead.devices.map((x) => LEAD_DEVICE_LABEL[x as DeviceInterestKey] ?? x).join(", ");
  const days = Math.floor((now.getTime() - new Date(lead.stageChangedAt).getTime()) / 86_400_000);
  const rot =
    lead.stage === "ODLOZONE"
      ? null
      : rotInfo(
          {
            id: lead.id,
            stage: lead.stage,
            type: "INNE",
            createdAt: new Date(lead.createdAt),
            firstContactAt: lead.firstContactAt ? new Date(lead.firstContactAt) : null,
            lastContactAt: lead.lastContactAt ? new Date(lead.lastContactAt) : null,
            stageChangedAt: new Date(lead.stageChangedAt),
            nextActionAt: lead.nextActionAt ? new Date(lead.nextActionAt) : null,
            nextStepType: lead.nextStepType,
            attempts: 0,
            ownerId: null,
            rentalId: null,
            phone: null,
          },
          now,
        );
  const step =
    lead.stage === "ODLOZONE"
      ? `wraca ${lead.returnAt ? d2(lead.returnAt) : "—"}`
      : rot?.rotting
        ? `${lead.nextStepType === "FOLLOW_UP_OFERTY" ? "follow-up zaległy" : rot.label} (${days} ${days === 1 ? "dzień" : "dni"} w etapie)`
        : lead.nextActionAt
          ? `${lead.nextStepNote ?? NEXT_STEP_LABEL[(lead.nextStepType as NextStepType) ?? "INNE"]} · ${d2(lead.nextActionAt)}`
          : "bez kroku";
  const at = FLOW.indexOf(lead.stage === "ODLOZONE" ? "WYWIAD" : lead.stage);

  return (
    <div className="mx-4 mb-3 flex flex-wrap items-center gap-3 border border-l-[3px] border-[#E3E6E9] border-l-[#1B6FA8] bg-white px-3.5 py-2 text-[13px] md:mx-7">
      <span className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">W lejku</span>
      <StageChip stage={lead.stage} />
      <span className="min-w-0">
        {[devices || null, lead.stage === "OFERTA" ? `oferta ${d2(lead.stageChangedAt)}` : `od ${d2(lead.stageChangedAt)}`].filter(Boolean).join(" · ")}
        {" · "}
        <span className={rot?.rotting ? "font-semibold text-[#B8612F]" : ""}>{step}</span>
        {lead.stage === "ODLOZONE" && lead.nextStepNote && <span className="text-[#5C6166]"> · {lead.nextStepNote.replace(/^wraca: /, "")}</span>}
      </span>
      <span className="ml-auto flex flex-wrap items-center gap-1 text-[#5C6166]">
        {FLOW.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            {i > 0 && <i className="not-italic">›</i>}
            {i <= at ? <StageChip stage={s} /> : <span className="bg-[#EEF0F2] px-[7px] py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#9AA3AB]">{s === "OFERTA" ? "Oferta" : s === "REZERWACJA" ? "Rezerwacja" : s === "WYWIAD" ? "W kontakcie" : "Nowe"}</span>}
          </span>
        ))}
      </span>
      <Link href={`/sygnaly?id=${lead.id}`} className="h-[26px] rounded-[6px] border border-[#C9D3DC] bg-white px-[9px] py-[3px] text-[12px] text-[#0C3450] hover:border-[#1B6FA8]">
        Otwórz sygnał
      </Link>
    </div>
  );
}
