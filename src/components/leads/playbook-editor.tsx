"use client";

import { useState } from "react";
import { REWARD_STEP, type Playbook } from "@/lib/leads/playbook";
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

  const target = Math.max(1, pb.season.returningTarget + pb.season.newTarget);
  const rewardSlots = Array.from({ length: Math.ceil(target / REWARD_STEP) }, (_, i) => Math.min((i + 1) * REWARD_STEP, target));
  const setSeason = (x: Partial<Playbook["season"]>) => setPb((p) => ({ ...p, season: { ...p.season, ...x } }));
  const setReward = (i: number, text: string) =>
    setPb((p) => {
      const rewards = rewardSlots.map((_, k) => p.season.rewards[k] ?? p.season.rewards.at(-1) ?? "");
      rewards[i] = text;
      return { ...p, season: { ...p.season, rewards, reward: rewards[0] } };
    });
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
        <h2 className="m-0 text-base font-semibold text-gray-900">Cel sezonu (pasek w Planie dnia)</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <label className={LABEL}>
            Wracają z wiosny
            <input className={INPUT} type="number" min={0} value={pb.season.returningTarget} onChange={(e) => setSeason({ returningTarget: Number(e.target.value) })} />
          </label>
          <label className={LABEL}>
            Nowe gabinety
            <input className={INPUT} type="number" min={0} value={pb.season.newTarget} onChange={(e) => setSeason({ newTarget: Number(e.target.value) })} />
          </label>
          <label className={LABEL}>
            Sezon od
            <input className={INPUT} type="date" value={pb.season.from} onChange={(e) => setSeason({ from: e.target.value })} />
          </label>
          <label className={LABEL}>
            Sezon do
            <input className={INPUT} type="date" value={pb.season.to} onChange={(e) => setSeason({ to: e.target.value })} />
          </label>
          <label className={LABEL}>
            Wracający do (kamień milowy)
            <input className={INPUT} type="date" value={pb.season.milestone} onChange={(e) => setSeason({ milestone: e.target.value })} />
          </label>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rewardSlots.map((at, i) => (
            <label key={at} className={LABEL}>
              Nagroda za {at} z {target}
              <input className={INPUT} value={pb.season.rewards[i] ?? pb.season.rewards.at(-1) ?? ""} onChange={(e) => setReward(i, e.target.value)} />
            </label>
          ))}
        </div>
        <p className="m-0 text-xs text-gray-500">
          Liczymy gabinety, nie wynajmy. Wracające — z listy „przed sezonem” zamrożonej 29.09 (raz, przy pierwszej rezerwacji w sezonie). Nowe — pierwszy przyjazd w historii (bez powracających i szkoleń). Nagroda co {REWARD_STEP}.
        </p>
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
