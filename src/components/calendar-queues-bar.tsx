"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import { TodayBar } from "@/components/today-bar";
import type { CalendarQueue } from "@/lib/calendar/queues";

// Kalendarz → „Do dopięcia” (wniosek 26): rezerwacje bez klienta, braki kwoty
// / wariantu, wydania na jutro bez adresu lub godziny, FV do wystawienia —
// liczone na bieżąco z danych. Klik w kafel → lista z linkami do rezerwacji.

const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

type TitleItem = { rentalId: string; startsAt: string; device: string; title: string; newTitle: string; hasShortName: boolean };

export function CalendarQueuesBar() {
  const [queues, setQueues] = useState<CalendarQueue[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Poprawka wniosku 29 (jednorazowo): tytuł ≠ nazwa robocza — lista z „Zamień tytuły”.
  const [titles, setTitles] = useState<TitleItem[] | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch(`${BASE_PATH}/api/calendar/queues`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d?.queues && setQueues(d.queues))
      .catch(() => {});
    fetch(`${BASE_PATH}/api/rentals/titles`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        const items: TitleItem[] | null = d?.items ?? null;
        setTitles(items);
        // Bez nazwy roboczej tytuł stałby się pełną nazwą rejestrową — domyślnie odznaczone.
        setSkip(new Set((items ?? []).filter((t) => !t.hasShortName).map((t) => t.rentalId)));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [reload]);
  async function replace() {
    const ids = (titles ?? []).map((t) => t.rentalId).filter((id) => !skip.has(id));
    if (!ids.length) return;
    setBusy(true);
    const res = await fetch(`${BASE_PATH}/api/rentals/titles`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
    const d = (await res.json().catch(() => ({}))) as { renamed?: number; failed?: number; message?: string };
    setBusy(false);
    setNote(res.ok ? `Zamieniono ${d.renamed ?? 0} ${d.failed ? `· błąd Google: ${d.failed}` : ""}` : (d.message ?? "Nie udało się."));
    setReload((x) => x + 1);
  }
  if (!queues) return null;
  const total = queues.reduce((s, q) => s + q.items.length, 0);
  const sub = (q: CalendarQueue) => (q.items[0] ? `najbliższa ${d2(q.items[0].startsAt)}` : "wszystko dopięte");
  const current = queues.find((q) => q.key === open);
  return (
    <TodayBar
      className="mb-4"
      title="Do dopięcia"
      dateLabel={total ? `${total} ${total === 1 ? "sprawa" : "spraw"} przy rezerwacjach` : "wszystko dopięte"}
      tiles={[
        ...queues.map((q) => ({ key: q.key, label: q.label, n: q.items.length, sub: sub(q) })),
        ...(titles && titles.length ? [{ key: "titles", label: "Tytuł ≠ nazwa robocza", n: titles.length, sub: "zamień jednym kliknięciem" }] : []),
      ]}
      active={open}
      onToggle={setOpen}
    >
      {open === "titles" && titles && (
        <div className="mt-2 border-t border-white/20 pt-2 text-[13px] text-white">
          <div className="mb-1.5 flex flex-wrap items-center gap-3">
            <span className="text-[#DCE8F2]">Przyszłe rezerwacje z klientem, których tytuł różni się od nazwy roboczej. Zaznaczone są rezerwacje klientów z nazwą roboczą; bez niej tytuł byłby pełną nazwą — uzupełnij nazwę roboczą w karcie albo zaznacz ręcznie.</span>
            <button type="button" disabled={busy} onClick={() => void replace()} className="ml-auto rounded-[6px] bg-white px-3 py-1 text-[12.5px] font-semibold text-[#2B5B82] hover:bg-[#EAF4FB] disabled:opacity-50">
              {busy ? "Zamieniam…" : `Zamień tytuły (${titles.length - skip.size})`}
            </button>
            {note && <span className="text-[#BFE5D6]">{note}</span>}
          </div>
          <ul className="m-0 flex max-h-[320px] list-none flex-col gap-1 overflow-y-auto p-0">
            {titles.map((t) => (
              <li key={t.rentalId} className="flex flex-wrap items-baseline gap-x-2">
                <input
                  type="checkbox"
                  checked={!skip.has(t.rentalId)}
                  onChange={(e) => setSkip((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.delete(t.rentalId);
                    else n.add(t.rentalId);
                    return n;
                  })}
                  aria-label={`Zamień tytuł ${t.title}`}
                />
                <span className="tabular-nums text-[#BFD6EA]">{d2(t.startsAt)}</span>
                <Link href={`/kalendarz?wynajem=${t.rentalId}`} className="hover:underline">
                  {t.title}
                </Link>
                <span className="text-[#DCE8F2]">→ {t.newTitle}</span>
                {!t.hasShortName && <span className="text-[#F3C9AE]">bez nazwy roboczej</span>}
                <span className="text-[#BFD6EA]">{t.device}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {current && (
        <ul className="m-0 mt-2 flex max-h-[320px] list-none flex-col gap-1 overflow-y-auto border-t border-white/20 p-0 pt-2 text-[13px] text-white">
          {current.items.map((i) => (
            <li key={i.rentalId}>
              <Link href={`/kalendarz?wynajem=${i.rentalId}`} className="flex flex-wrap items-baseline gap-x-2 hover:underline">
                <span className="tabular-nums text-[#BFD6EA]">{d2(i.startsAt)}</span>
                <span className="font-semibold">{i.title}</span>
                {i.device && <span className="text-[#DCE8F2]">{i.device}</span>}
                <span className="text-[#F3C9AE]">{i.note}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </TodayBar>
  );
}
