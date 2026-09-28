"use client";

import { useState } from "react";
import type { Playbook } from "@/lib/leads/playbook";
import { api } from "@/components/clients/client-forms";

// Ustawienia → Ściąga (zasady-wzor.html): edycja złotych zasad, skryptów rozmów
// (podpowiedzi w karcie sygnału) i celu sezonu. {termin} w skryptach = wolny
// termin z kalendarza.

const INPUT = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-[#1B6FA8] focus:outline-none";
const LABEL = "flex flex-col gap-1 text-sm text-gray-700";
const SCRIPT_LABEL: Record<keyof Playbook["scripts"], string> = {
  newOpening: "Nowe — otwarcie pierwszego telefonu",
  newClosing: "Nowe — koniec rozmowy terminem",
  contactOffer: "W kontakcie — oferta",
  offerFollowUp1: "Oferta — follow-up 1 (+3 dni rob.)",
  offerFollowUp2: "Oferta — follow-up 2 (+7 dni rob.)",
  postponedReturn: "Odłożone — co powiedzieć, gdy wracamy",
};

export function PlaybookEditor({ initial }: { initial: Playbook }) {
  const [pb, setPb] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function save() {
    setBusy(true);
    setMsg(null);
    const { ok, data } = await api<{ playbook: Playbook }>("/api/playbook", "PUT", { playbook: pb });
    setBusy(false);
    if (!ok) return setMsg({ text: data.message ?? "Nie udało się zapisać.", error: true });
    setPb(data.playbook);
    setMsg({ text: "Zapisano ściągę." });
  }

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="m-0 text-base font-semibold text-gray-900">Cel sezonu (pasek w Skrzynce)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className={LABEL}>
            Cel (rezerwacje z nowych)
            <input className={INPUT} type="number" min={1} value={pb.season.target} onChange={(e) => setPb({ ...pb, season: { ...pb.season, target: Number(e.target.value) } })} />
          </label>
          <label className={LABEL}>
            Sezon od
            <input className={INPUT} type="date" value={pb.season.from} onChange={(e) => setPb({ ...pb, season: { ...pb.season, from: e.target.value } })} />
          </label>
          <label className={LABEL}>
            Sezon do
            <input className={INPUT} type="date" value={pb.season.to} onChange={(e) => setPb({ ...pb, season: { ...pb.season, to: e.target.value } })} />
          </label>
          <label className={LABEL}>
            Nagroda
            <input className={INPUT} value={pb.season.reward} onChange={(e) => setPb({ ...pb, season: { ...pb.season, reward: e.target.value } })} />
          </label>
        </div>
        <p className="m-0 text-xs text-gray-500">Licznik = sygnały nowych klientów (bez stałych klientek), które wpłynęły w sezonie i doszły do rezerwacji.</p>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="m-0 text-base font-semibold text-gray-900">Zasady</h2>
        {pb.rules.map((r, i) => (
          <div key={i} className="grid grid-cols-[28px_1fr_1.4fr_auto] items-start gap-2">
            <span className="pt-2 text-sm text-gray-500">{i + 1}.</span>
            <input className={INPUT} value={r.title} onChange={(e) => setPb({ ...pb, rules: pb.rules.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} aria-label={`Zasada ${i + 1}`} />
            <input className={INPUT} value={r.text} onChange={(e) => setPb({ ...pb, rules: pb.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} aria-label={`Opis zasady ${i + 1}`} />
            <button type="button" className="pt-2 text-sm text-gray-400 hover:text-red-600" onClick={() => setPb({ ...pb, rules: pb.rules.filter((_, j) => j !== i) })} aria-label="Usuń zasadę">
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="self-start text-sm text-[#1B6FA8] hover:underline" onClick={() => setPb({ ...pb, rules: [...pb.rules, { title: "", text: "" }] })}>
          + dodaj zasadę
        </button>
        <label className={LABEL}>
          Kolejność dnia (jedna pozycja w linii)
          <textarea className={INPUT} rows={6} value={pb.dayOrder.join("\n")} onChange={(e) => setPb({ ...pb, dayOrder: lines(e.target.value) })} />
        </label>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="m-0 text-base font-semibold text-gray-900">Skrypty i wywiad (podpowiedź w karcie sygnału)</h2>
        <label className={LABEL}>
          Pytania wywiadu (jedno w linii)
          <textarea className={INPUT} rows={6} value={pb.questions.join("\n")} onChange={(e) => setPb({ ...pb, questions: lines(e.target.value) })} />
        </label>
        {(Object.keys(SCRIPT_LABEL) as (keyof Playbook["scripts"])[]).map((k) => (
          <label key={k} className={LABEL}>
            {SCRIPT_LABEL[k]}
            <textarea className={INPUT} rows={2} value={pb.scripts[k]} onChange={(e) => setPb({ ...pb, scripts: { ...pb.scripts, [k]: e.target.value } })} />
          </label>
        ))}
        <p className="m-0 text-xs text-gray-500">{"{termin}"} zostanie zastąpiony wolnym terminem z kalendarza. SMS po nieodebranym: Ustawienia → Szablony SMS („lead_no_answer”).</p>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" disabled={busy} onClick={() => void save()} className="rounded-md bg-[#1B6FA8] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0C3450] disabled:opacity-50">
          {busy ? "Zapisywanie…" : "Zapisz ściągę"}
        </button>
        {msg && <span className={`text-sm ${msg.error ? "text-red-600" : "text-green-700"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
