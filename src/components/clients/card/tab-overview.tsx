"use client";

import Link from "next/link";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { StageChip } from "@/components/leads/lead-ui";
import { rhythmLabel } from "@/lib/clients/transactions";
import { fmtDate, fmtMoney } from "../ui";
import { EventRow, Panel, Tile } from "./shared";

export type CardTab = "przeglad" | "transakcje" | "komunikacja" | "dane";

const OPEN_STAGES = new Set(["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA"]);

// Kafelki Przeglądu — wspólne dla pełnej karty i skróconej karty na liście.
export function OverviewTiles({ d, cols = 4 }: { d: ClientDetail; cols?: 2 | 4 }) {
  const s = d.summary;
  const o = d.overview;
  const t = d.txTotals;
  return (
    <div className={`grid gap-3 ${cols === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
      <Tile label="Wynajmy (12 mies. / łącznie)" value={`${s.rentals12m} / ${s.rentalsTotal}`} />
      <Tile
        label="Przychód netto (12 mies.)"
        value={o.revenue12m > 0 ? fmtMoney(o.revenue12m) : "—"}
        sub={o.avg12m ? `śr. ${fmtMoney(o.avg12m)} / wynajem` : null}
      />
      <Tile
        label="Ostatni wynajem"
        value={s.lastRentalAt ? fmtDate(s.lastRentalAt) : "—"}
        sub={o.nextRental ? `następny: ${fmtDate(o.nextRental.startsAt)}` : null}
      />
      <Tile
        label="Do zapłaty"
        value={t.dueNet > 0 ? fmtMoney(t.dueNet) : "0 zł"}
        tone={t.overdueCount > 0 ? "red" : "default"}
        sub={
          t.dueCount === 0
            ? "wszystko rozliczone"
            : `${t.dueCount} ${t.dueCount === 1 ? "faktura" : "faktury"}${t.oldestOverdue ? `, ${t.oldestOverdue.days} dni po terminie` : ""}`
        }
      />
    </div>
  );
}

export function NextStep({ d }: { d: ClientDetail }) {
  const n = d.overview.nextStep;
  if (!n) return null;
  const body = (
    <>
      <div className="text-[14px] font-semibold text-[var(--c-accent-deep)]">Następny krok</div>
      <p className="mt-1 text-[14px] leading-snug text-[var(--c-text)]">
        {n.text}
        {n.at && (
          <span className={n.overdue ? "font-semibold text-[var(--c-red)]" : "text-[var(--c-muted)]"}>
            {" "}
            · {n.overdue ? "zaległe od " : ""}
            {fmtDate(n.at)}
          </span>
        )}
      </p>
    </>
  );
  const cls = "block rounded-xl border border-[var(--c-accent)]/30 bg-[var(--c-accent-soft)] px-4 py-3.5";
  return n.href ? (
    <Link href={n.href} className={`${cls} transition-colors hover:border-[var(--c-accent)]`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function OpenLeads({ d }: { d: ClientDetail }) {
  const open = d.leads.filter((l) => OPEN_STAGES.has(l.stage));
  if (open.length === 0) return null;
  return (
    <Panel title="Otwarte sygnały">
      <div className="flex flex-col gap-2">
        {open.map((l) => (
          <Link key={l.id} href={`/sygnaly?id=${l.id}`} className="flex items-center gap-2 text-[14px] hover:text-[var(--c-brand-deep)]">
            <StageChip stage={l.stage} />
            <span className="min-w-0 truncate">{l.title}</span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export function TabOverview({ d, onTab, onOpenItem }: { d: ClientDetail; onTab: (t: CardTab) => void; onOpenItem: (h: ClientHistoryItem) => void }) {
  const o = d.overview;
  const recent = d.history.filter((h) => !(h.kind === "rental" && h.deleted)).slice(0, 5);
  return (
    <div className="flex flex-col gap-5">
      <OverviewTiles d={d} />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Ostatnie zdarzenia">
          {recent.length === 0 ? (
            <p className="text-[13px] text-[var(--c-faint)]">Brak wynajmów, faktur i wiadomości.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {recent.map((h) => (
                <EventRow key={`${h.kind}-${h.id}`} item={h} onOpen={onOpenItem} compact />
              ))}
            </div>
          )}
          <div className="mt-4 flex gap-2 text-[13px]">
            <button type="button" onClick={() => onTab("komunikacja")} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              Cała komunikacja →
            </button>
            <span className="text-[var(--c-faint)]">·</span>
            <button type="button" onClick={() => onTab("transakcje")} className="font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
              Wynajmy i faktury →
            </button>
          </div>
        </Panel>
        <div className="flex flex-col gap-4">
          <NextStep d={d} />
          <OpenLeads d={d} />
          <Panel title="W skrócie">
            <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-y-1.5 text-[14px]">
              <dt className="text-[var(--c-muted)]">Ulubione urządzenie</dt>
              <dd>{o.favoriteDeviceName ? `${o.favoriteDeviceName} (${o.favoriteDeviceCount} z ${o.realizedCount})` : "—"}</dd>
              <dt className="text-[var(--c-muted)]">Rytm wynajmów</dt>
              <dd>{o.rhythmDays ? rhythmLabel(o.rhythmDays) : "—"}</dd>
              <dt className="text-[var(--c-muted)]">Ostatni kontakt</dt>
              <dd>{o.lastContact ? `${o.lastContact.label}, ${fmtDate(o.lastContact.at)}` : "—"}</dd>
              <dt className="text-[var(--c-muted)]">Płatność</dt>
              <dd>{o.typicalPayment ?? "—"}</dd>
            </dl>
          </Panel>
        </div>
      </div>
    </div>
  );
}
