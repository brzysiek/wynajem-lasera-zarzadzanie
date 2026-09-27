"use client";

import { useState } from "react";
import Link from "next/link";
import type { BackfillRow, LegacyTermsRow, MismatchRow } from "@/lib/clients/terms-backfill";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import { api } from "./client-forms";

// Klienci → Kwoty wg warunków (etap D). Góra: przyszłe rezerwacje bez kwoty u
// klientów z tabelą cen — plan (pozycje, razem, FV, płatność) i uzupełnienie
// zaznaczonych. Dół: rezerwacje z kwotą inną niż w warunkach (dla Ani).

type Review = { backfill: BackfillRow[]; mismatches: MismatchRow[]; clientsWithTerms: number; legacy: LegacyTermsRow[] };

const zl = (n: number) => new Intl.NumberFormat("pl-PL", { maximumFractionDigits: 2, useGrouping: "always" }).format(n);
const dmy = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
const TH = "border-b border-[var(--c-border)] px-2 py-1.5 text-left text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--c-muted)]";
const TD = "border-b border-[var(--c-border)] px-2 py-1.5 align-top";

export function TermsReview({ initial, canApply }: { initial: Review; canApply: boolean }) {
  const [review, setReview] = useState(initial);
  const readyIds = review.backfill.filter((r) => r.plan.ready).map((r) => r.rentalId);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(readyIds));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [onlyBig, setOnlyBig] = useState(false);

  async function apply() {
    setBusy(true);
    setMsg(null);
    const ids = [...picked].filter((id) => readyIds.includes(id));
    const { ok, data } = await api<{ done: number; skipped: { rentalId: string; reason: string }[]; review: Review }>("/api/clients/terms-backfill", "POST", { rentalIds: ids });
    setBusy(false);
    if (!ok) return setMsg({ text: data.message ?? "Nie udało się uzupełnić.", error: true });
    setReview(data.review);
    setPicked(new Set(data.review.backfill.filter((r) => r.plan.ready).map((r) => r.rentalId)));
    setMsg({ text: `Uzupełniono ${data.done} ${data.done === 1 ? "rezerwację" : "rezerwacji"}${data.skipped.length ? `, pominięto ${data.skipped.length} (${data.skipped[0].reason}${data.skipped.length > 1 ? "…" : ""})` : ""}.` });
  }

  const mismatches = onlyBig ? review.mismatches.filter((m) => m.big) : review.mismatches;
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  return (
    <div style={APP_CSS_VARS} className="flex flex-col gap-5 text-[var(--c-text)]">
      <div>
        <Link href="/klienci" className="text-[13px] text-[var(--c-muted)] hover:text-[var(--c-brand)]">
          ← Klienci
        </Link>
        <h1 className="m-0 mt-1 text-[26px] font-semibold leading-tight text-[var(--c-navy)]">Kwoty wg warunków</h1>
        <p className="mt-1 text-[13px] text-[var(--c-muted)]">
          {review.clientsWithTerms} klientów z tabelą cen (Warunki handlowe na karcie). Brak ceny dla urządzenia / liczby dni = cennik ogólny. Transport: 2 urządzenia jednego dnia = 1 kurs.
        </p>
      </div>

      <section className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">
            Przyszłe rezerwacje bez kwoty <span className="tabular-nums text-[#B8612F]">{review.backfill.length}</span>
          </h2>
          {canApply && readyIds.length > 0 && (
            <button
              type="button"
              disabled={busy || picked.size === 0}
              onClick={() => void apply()}
              className="h-8 whitespace-nowrap rounded-lg bg-[var(--c-brand)] px-3 text-[13px] font-semibold text-white hover:bg-[var(--c-brand-deep)] disabled:opacity-40"
            >
              {busy ? "Uzupełnianie…" : `Uzupełnij zaznaczone (${[...picked].filter((id) => readyIds.includes(id)).length})`}
            </button>
          )}
        </div>
        <p className="mt-1 text-[12.5px] text-[var(--c-muted)]">Kwoty trafiają do rozliczenia rezerwacji jak z formularza; każdą można potem zmienić ręcznie.</p>
        {msg && <p className={`mt-2 text-[13px] ${msg.error ? "text-[#B8612F]" : "text-[var(--c-green)]"}`}>{msg.text}</p>}
        {review.backfill.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--c-muted)]">Brak — wszystkie przyszłe rezerwacje klientów z warunkami mają kwoty.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]">
              <thead>
                <tr>
                  {canApply && <th className={TH} />}
                  <th className={TH}>Data</th>
                  <th className={TH}>Klient</th>
                  <th className={TH}>Urządzenie</th>
                  <th className={TH}>Pozycje</th>
                  <th className={`${TH} text-right`}>Razem</th>
                  <th className={TH}>FV · płatność</th>
                </tr>
              </thead>
              <tbody>
                {review.backfill.map((r) => (
                  <tr key={r.rentalId} className={r.plan.ready ? "" : "bg-[#FBF7F2]"}>
                    {canApply && (
                      <td className={TD}>
                        {r.plan.ready && <input type="checkbox" checked={picked.has(r.rentalId)} onChange={() => toggle(r.rentalId)} aria-label={`Uzupełnij ${r.title}`} />}
                      </td>
                    )}
                    <td className={`${TD} tabular-nums`}>{dmy(r.startsAt)}</td>
                    <td className={TD}>
                      <Link href={`/klienci/${r.clientId}`} className="font-medium text-[var(--c-navy)] hover:text-[var(--c-brand)]">
                        {r.clientName}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Link href={`/kalendarz/wynajem/${r.rentalId}?from=/kalendarz`} className="hover:text-[var(--c-brand)]">
                        {r.deviceName}
                      </Link>
                      <span className="text-[var(--c-muted)]"> · {r.days} {r.days === 1 ? "dzień" : "dni"}</span>
                    </td>
                    {r.plan.ready ? (
                      <>
                        <td className={`${TD} text-[12.5px] text-[var(--c-muted)]`}>
                          {r.positions}
                          {r.plan.baseSource === "PRICE_LIST" && <span className="text-[#8A939B]"> (cennik*)</span>}
                        </td>
                        <td className={`${TD} text-right font-semibold tabular-nums`}>{zl(r.plan.totalNet)}</td>
                        <td className={`${TD} text-[12.5px]`}>
                          {r.plan.vatApplicable ? (r.plan.invoicePart != null ? `część ${zl(r.plan.invoicePart)} na FV` : "FV całość") : "bez FV"} · {r.plan.paymentMethod === "CASH" ? "gotówka" : "przelew"}
                        </td>
                      </>
                    ) : (
                      <td className={`${TD} text-[12.5px] text-[#B8612F]`} colSpan={3}>
                        {r.plan.reason}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">
            Kwota inna niż w warunkach <span className="tabular-nums text-[#B8612F]">{review.mismatches.length}</span>
          </h2>
          <label className="flex items-center gap-2 text-[13px] text-[var(--c-muted)]">
            <input type="checkbox" checked={onlyBig} onChange={(e) => setOnlyBig(e.target.checked)} /> tylko różnica ceny &gt; 10% (≠ w kalendarzu)
          </label>
        </div>
        <p className="mt-1 text-[12.5px] text-[var(--c-muted)]">Przyszłe rezerwacje z wpisaną kwotą — do sprawdzenia (Ania): popraw w rezerwacji albo zaktualizuj warunki na karcie klienta.</p>
        {mismatches.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--c-muted)]">Brak rozbieżności.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={TH}>Data</th>
                  <th className={TH}>Klient</th>
                  <th className={TH}>Urządzenie</th>
                  <th className={`${TH} text-right`}>Wynajem: wpisane / warunki</th>
                  <th className={`${TH} text-right`}>Transport: wpisany / warunki</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.map((m) => (
                  <tr key={m.rentalId}>
                    <td className={`${TD} tabular-nums`}>{dmy(m.startsAt)}</td>
                    <td className={TD}>
                      <Link href={`/klienci/${m.clientId}`} className="font-medium text-[var(--c-navy)] hover:text-[var(--c-brand)]">
                        {m.clientName}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Link href={`/kalendarz/wynajem/${m.rentalId}?from=/kalendarz`} className="hover:text-[var(--c-brand)]">
                        {m.deviceName}
                      </Link>
                      <span className="text-[var(--c-muted)]"> · {m.days} {m.days === 1 ? "dzień" : "dni"}</span>
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {m.expectedBase != null ? (
                        <span className={m.big ? "font-semibold text-[#B8612F]" : ""}>
                          {zl(m.baseNet)} / {zl(m.expectedBase)}
                          {m.pct != null && ` (${m.pct > 0 ? "+" : ""}${Math.round(m.pct * 100)}%)`}
                        </span>
                      ) : (
                        <span className="text-[var(--c-muted)]">{zl(m.baseNet)} · zgodne</span>
                      )}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {m.expectedTransport != null ? (
                        <span className="text-[#B8612F]">
                          {zl(m.transportNet ?? 0)} / {zl(m.expectedTransport)}
                        </span>
                      ) : (
                        <span className="text-[var(--c-muted)]">zgodny</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {review.legacy.length > 0 && (
        <section className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-4">
          <h2 className="m-0 text-[17px] font-semibold text-[var(--c-navy)]">
            Dawna „cena ustalona” do rozpisania <span className="tabular-nums text-[#B8612F]">{review.legacy.length}</span>
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--c-muted)]">
            Klienci bez tabeli cen — ich rezerwacje liczą się z cennika ogólnego. Przypisz cenę do urządzenia na karcie (Warunki handlowe → Edytuj) albo przez propozycje agenta
            (cennik_klienta).
          </p>
          <ul className="mt-2 divide-y divide-[var(--c-border)] text-[13px]">
            {review.legacy.map((c) => (
              <li key={c.clientId} className="flex flex-wrap items-baseline gap-x-3 py-1.5">
                <Link href={`/klienci/${c.clientId}`} className="font-medium text-[var(--c-navy)] hover:text-[var(--c-brand)]">
                  {c.clientName}
                </Link>
                <span className="tabular-nums">
                  {zl(c.agreedPrice)} zł{c.transportNet != null ? ` + transport ${zl(c.transportNet)}` : ""}
                </span>
                {c.notes && <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--c-muted)]" title={c.notes}>{c.notes}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
