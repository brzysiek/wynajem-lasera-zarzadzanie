"use client";

import { useCallback, useEffect, useState } from "react";
import type { IntakeItem } from "@/lib/leads/mail-intake";

// „Do sprawdzenia” (wniosek 43): maile na kontakt@ od nowych osób i od klientek
// z bazy z prośbą o wynajem, które filtr wstępnie ocenił, ale decyzję podejmuje
// człowiek. Wspólna kolejka — później także propozycje scalania (wniosek 42).
// Poniżej zwinięte „Odrzucone automatycznie” (14 dni) z „To jednak sygnał”.

const BTN = "inline-flex h-8 items-center rounded-[6px] border border-[#C9D3DC] bg-white px-3 text-[12.5px] text-[#0C3450] hover:border-[#1B6FA8] disabled:opacity-40";
const BTN_PRIMARY = "inline-flex h-8 items-center rounded-[6px] bg-[#1B6FA8] px-3 text-[12.5px] font-semibold text-white hover:bg-[#0C3450] disabled:opacity-40";

type Data = { queue: IntakeItem[]; rejected: IntakeItem[]; mode: "CAUTIOUS" | "AUTO" };

const when = (iso: string) => new Date(iso).toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Row({ item, readOnly, busy, onDecide, rejected }: { item: IntakeItem; readOnly: boolean; busy: boolean; onDecide: (id: string, action: "signal" | "reject") => void; rejected?: boolean }) {
  const known = item.kind === "KNOWN_CLIENT";
  return (
    <li className="flex flex-col gap-1.5 border border-[#DCE3EA] bg-white px-3.5 py-3">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <b className="text-[14px] font-semibold text-[#0C3450]">{item.fromName ?? item.fromAddress}</b>
        {item.fromName && <span className="text-[12.5px] text-[#5C6166]">{item.fromAddress}</span>}
        <span className={`rounded-sm px-1.5 py-px text-[11px] ${known ? "bg-[#EAF4FB] text-[#1B6FA8]" : "bg-[#F4EFE3] text-[#6B5B3E]"}`}>
          {known ? `klientka z bazy${item.clientName ? `: ${item.clientName}` : ""}` : "nowa osoba"}
        </span>
        <span className="ml-auto text-[11.5px] text-[#5C6166]">{when(item.receivedAt)}</span>
      </div>
      <div className="text-[13.5px] text-[#0C3450]">{item.subject || "(bez tematu)"}</div>
      {item.snippet && <div className="text-[12.5px] text-[#5C6166]">{item.snippet}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#5C6166]">
        {item.devices.length > 0 && <span>urządzenia: <b className="font-semibold text-[#0C3450]">{item.devices.join(", ")}</b></span>}
        {item.phone && <span>tel. z treści: <b className="font-semibold text-[#0C3450]">{item.phone}</b></span>}
        {item.nip && <span>NIP: <b className="font-semibold text-[#0C3450]">{item.nip}</b></span>}
        {item.freeDates.length > 0 && <span>wolne: {item.freeDates.join(", ")}</span>}
      </div>
      <div className="text-[11.5px] text-[#5C6166]">
        punkty: <b className="font-semibold">{item.score}</b>
        {item.matched.length > 0 && <> · słowa: {item.matched.join(", ")}</>}
        {item.reason && <> · {item.reason}</>}
      </div>
      {item.recommendation && (
        <div className={`border-l-[3px] px-2.5 py-1.5 text-[12.5px] ${item.recommendation === "SYGNAL" ? "border-[#3E8E6B] bg-[#EEF7F2]" : "border-[#B8612F] bg-[#FBF1EA]"}`}>
          <b className="font-semibold">Klaudiusz: {item.recommendation === "SYGNAL" ? "zakładać sygnał" : "raczej nie"}</b>
          {item.recommendationNote && <span className="block text-[#2A3540]">{item.recommendationNote}</span>}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        {!readOnly && (
          <button type="button" className={BTN_PRIMARY} disabled={busy} onClick={() => onDecide(item.id, "signal")}>
            {rejected ? "To jednak sygnał" : "Sygnał"}
          </button>
        )}
        {!readOnly && !rejected && (
          <button type="button" className={BTN} disabled={busy} onClick={() => onDecide(item.id, "reject")}>
            Nie
          </button>
        )}
        <a className={BTN} href={item.gmailUrl} target="_blank" rel="noreferrer">
          Otwórz w Gmailu ↗
        </a>
      </div>
    </li>
  );
}

export function ReviewView({ readOnly, onChanged, onOpenLead }: { readOnly: boolean; onChanged: () => void; onOpenLead: (id: string) => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showRejected, setShowRejected] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mail-intake", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setData((await res.json()) as Data);
      setError(null);
    } catch {
      setError("Nie udało się wczytać kolejki.");
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(load);
  }, [load]);

  async function decide(id: string, action: "signal" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/mail-intake/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const body = (await res.json().catch(() => ({}))) as { message?: string; leadId?: string };
      if (!res.ok) {
        setError(body.message ?? "Nie udało się zapisać decyzji.");
        await load();
        return;
      }
      setError(null);
      await load();
      onChanged();
      if (action === "signal" && body.leadId) onOpenLead(body.leadId);
    } finally {
      setBusyId(null);
    }
  }

  if (!data) return <p className="text-[13px] text-[#5C6166]">{error ?? "Wczytuję…"}</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] text-[#5C6166]">
        Maile na kontakt@ od nowych osób i od klientek z bazy, które piszą o wynajmie — wstępnie ocenione regułami (tryb: <b>{data.mode === "AUTO" ? "automatyczny" : "ostrożny"}</b>). „Sygnał” zakłada sygnał z tego maila, „Nie” odkłada go bez śladu w Sygnałach. Panel nie zmienia niczego w Gmailu.
      </p>
      {error && <p className="m-0 text-[13px] text-[#B8612F]">{error}</p>}
      {data.queue.length === 0 ? (
        <p className="m-0 border border-dashed border-[#C9D3DC] px-4 py-6 text-center text-[13px] text-[#5C6166]">Nic nie czeka na sprawdzenie.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {data.queue.map((i) => (
            <Row key={i.id} item={i} readOnly={readOnly} busy={busyId === i.id} onDecide={(id, a) => void decide(id, a)} />
          ))}
        </ul>
      )}
      <div className="border-t border-[#DCE3EA] pt-2">
        <button type="button" className="text-[13px] font-semibold text-[#1B6FA8] hover:text-[#0C3450]" aria-expanded={showRejected} onClick={() => setShowRejected((v) => !v)}>
          {showRejected ? "▾" : "▸"} Odrzucone automatycznie (14 dni) · {data.rejected.length}
        </button>
        {showRejected && (
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {data.rejected.length === 0 && <li className="text-[13px] text-[#5C6166]">Nic nie odrzucono w ostatnich 14 dniach.</li>}
            {data.rejected.map((i) => (
              <Row key={i.id} item={i} rejected readOnly={readOnly} busy={busyId === i.id} onDecide={(id, a) => void decide(id, a)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
