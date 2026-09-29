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

export function CalendarQueuesBar() {
  const [queues, setQueues] = useState<CalendarQueue[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${BASE_PATH}/api/calendar/queues`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d?.queues && setQueues(d.queues))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  if (!queues) return null;
  const total = queues.reduce((s, q) => s + q.items.length, 0);
  const sub = (q: CalendarQueue) => (q.items[0] ? `najbliższa ${d2(q.items[0].startsAt)}` : "wszystko dopięte");
  const current = queues.find((q) => q.key === open);
  return (
    <TodayBar
      className="mb-4"
      title="Do dopięcia"
      dateLabel={total ? `${total} ${total === 1 ? "sprawa" : "spraw"} przy rezerwacjach` : "wszystko dopięte"}
      tiles={queues.map((q) => ({ key: q.key, label: q.label, n: q.items.length, sub: sub(q) }))}
      active={open}
      onToggle={setOpen}
    >
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
