"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BASE_PATH } from "@/lib/base-path";
import type { ClientDetail } from "@/lib/clients/load";
import { api } from "../client-forms";
import { DownloadIcon, fmtDate, fmtMoney } from "../ui";
import { PaymentChip, SourceTag, Tile, type Tx } from "./shared";

// Zakładka „Wynajmy i faktury” (prompt 3B-karta, 2.2). Jeden wiersz na
// wynajem z dołączoną fakturą; faktura bez wynajmu osobno. PDF i
// „Przypomnij” korzystają z istniejących tras modułu Faktury — tak jak
// tam, dostępne dla ADMINA.

type Filter = "all" | "unpaid" | number;

function csvCell(v: string | number | null): string {
  const s = v == null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCsv(name: string, rows: Tx[]) {
  const header = ["Termin", "Wynajem", "Szczegóły", "Źródło", "Netto", "Faktura", "Płatność"];
  const lines = rows.map((r) =>
    [fmtDate(r.date), r.title, r.details, r.source, r.net != null ? r.net.toFixed(2).replace(".", ",") : "", r.invoice?.number ?? "", r.status.label].map(csvCell).join(";"),
  );
  const blob = new Blob(["﻿" + [header.join(";"), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-wynajmy-i-faktury.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function TabTransactions({ d, isAdmin }: { d: ClientDetail; isAdmin: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [reminding, setReminding] = useState<number | null>(null);
  const t = d.txTotals;
  const rows = d.transactions;
  const years = useMemo(() => [...new Set(rows.map((r) => new Date(r.date).getFullYear()))].sort((a, b) => b - a), [rows]);
  const unpaid = rows.filter((r) => r.status.kind === "PO_TERMINIE" || r.status.kind === "OCZEKUJE");
  const visible = filter === "all" ? rows : filter === "unpaid" ? unpaid : rows.filter((r) => new Date(r.date).getFullYear() === filter);

  async function remind(fakturowniaInvoiceId: number) {
    setReminding(fakturowniaInvoiceId);
    const { ok, data } = await api(`/api/fakturownia/invoices/${fakturowniaInvoiceId}/remind-draft`, "POST");
    setReminding(null);
    setNotice(ok ? { text: "Szkic przypomnienia jest w Gmailu (Wersje robocze) — przejrzyj i wyślij." } : { text: data.message ?? "Nie udało się utworzyć szkicu.", error: true });
  }

  const chip = (on: boolean) =>
    `h-8 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${
      on ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] font-semibold text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white hover:border-[var(--c-brand)]"
    }`;
  const pdfHref = (id: number) => `${BASE_PATH}/api/fakturownia/invoices/${id}/pdf`;

  const Actions = ({ r }: { r: Tx }) =>
    isAdmin && r.invoice ? (
      <span className="flex justify-end gap-3" onClick={(e) => e.stopPropagation()}>
        <a href={pdfHref(r.invoice.fakturowniaInvoiceId)} target="_blank" rel="noreferrer" className="text-[13px] font-semibold text-[var(--c-brand)] hover:text-[var(--c-brand-deep)]">
          PDF
        </a>
        {r.status.kind === "PO_TERMINIE" && (
          <button
            type="button"
            disabled={reminding !== null}
            onClick={() => void remind(r.invoice!.fakturowniaInvoiceId)}
            className="text-[13px] font-semibold text-[var(--c-red)] hover:opacity-80 disabled:opacity-40"
          >
            {reminding === r.invoice.fakturowniaInvoiceId ? "Tworzenie…" : "Przypomnij"}
          </button>
        )}
      </span>
    ) : null;

  const open = (r: Tx) => r.rentalId && router.push(`/kalendarz/wynajem/${r.rentalId}?from=/klienci/${d.id}`);

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Zafakturowano ${t.year}`} value={fmtMoney(t.invoicedNet)} sub={`${t.invoicedCount} ${t.invoicedCount === 1 ? "faktura" : "faktur"} netto`} />
        <Tile label="Zapłacono" value={fmtMoney(t.paidNet)} tone={t.paidNet > 0 ? "green" : "default"} sub={`${t.paidCount} ${t.paidCount === 1 ? "faktura" : "faktur"}`} />
        <Tile
          label="Po terminie"
          value={fmtMoney(t.overdueNet)}
          tone={t.overdueCount > 0 ? "red" : "default"}
          sub={t.oldestOverdue ? `${t.oldestOverdue.number} · ${t.oldestOverdue.days} dni` : "brak zaległości"}
        />
        <Tile
          label="Wynajmy bez faktury"
          value={String(t.withoutInvoice)}
          sub={t.withoutInvoice ? (t.withoutInvoiceAllCalendar ? "sprzed 2026 (z kalendarza)" : "bez faktury w systemie") : null}
        />
      </div>

      {notice && (
        <p role="status" className={`rounded-lg px-3 py-2 text-[13px] ${notice.error ? "bg-[var(--c-red-soft)] text-[var(--c-red)]" : "bg-[var(--c-green-soft)] text-[var(--c-green-deep)]"}`}>
          {notice.text}
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--c-border)] px-4 py-3">
          <h3 className="m-0 mr-2 text-[15px] font-semibold text-[var(--c-navy)]">Wynajmy i faktury</h3>
          <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
            Wszystko ({rows.length})
          </button>
          <button type="button" className={chip(filter === "unpaid")} onClick={() => setFilter("unpaid")}>
            Niezapłacone ({unpaid.length})
          </button>
          {years.map((y) => (
            <button key={y} type="button" className={chip(filter === y)} onClick={() => setFilter(y)}>
              {y}
            </button>
          ))}
          <button
            type="button"
            onClick={() => exportCsv(d.name, visible)}
            disabled={visible.length === 0}
            className="ml-auto flex h-8 items-center gap-1.5 rounded-lg border border-[var(--c-border)] px-3 text-[13px] transition-colors hover:border-[var(--c-brand)] disabled:opacity-40"
          >
            <DownloadIcon />
            Eksport CSV
          </button>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--c-muted)]">Brak pozycji.</p>
        ) : (
          <>
            {/* Tabela (≥ 768 px) */}
            <table className="hidden w-full text-[14px] md:table">
              <thead className="text-left text-[11px] uppercase tracking-wide text-[var(--c-muted)]">
                <tr className="border-b border-[var(--c-border)]">
                  <th className="px-4 py-2.5 font-semibold">Termin</th>
                  <th className="px-3 py-2.5 font-semibold">Wynajem</th>
                  <th className="px-3 py-2.5 font-semibold">Źródło</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Netto</th>
                  <th className="px-3 py-2.5 font-semibold">Faktura</th>
                  <th className="px-3 py-2.5 font-semibold">Płatność</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr
                    key={r.key}
                    onClick={() => open(r)}
                    className={`border-b border-[var(--c-border)] last:border-0 ${r.rentalId ? "cursor-pointer hover:bg-[var(--c-bg)]" : ""} ${
                      r.status.kind === "PO_TERMINIE" ? "bg-[var(--c-red-soft)]/50" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{fmtDate(r.date)}</td>
                    <td className="px-3 py-3">
                      <b className="font-semibold text-[var(--c-navy)]">{r.title}</b>
                      {r.details && <span className="text-[var(--c-muted)]"> · {r.details}</span>}
                    </td>
                    <td className="px-3 py-3">
                      <SourceTag source={r.source} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-right font-medium tabular-nums">{r.net != null ? fmtMoney(r.net) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 tabular-nums">{r.invoice?.number ?? "—"}</td>
                    <td className="px-3 py-3">
                      <PaymentChip status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      <Actions r={r} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Karty (telefon) */}
            <ul className="divide-y divide-[var(--c-border)] md:hidden">
              {visible.map((r) => (
                <li key={r.key} onClick={() => open(r)} className={`px-4 py-3 ${r.status.kind === "PO_TERMINIE" ? "bg-[var(--c-red-soft)]/50" : ""}`}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-grow">
                      <b className="font-semibold text-[var(--c-navy)]">{r.title}</b>
                      <div className="text-[12px] text-[var(--c-muted)]">
                        {fmtDate(r.date)}
                        {r.details && ` · ${r.details}`}
                      </div>
                    </div>
                    <span className="flex-none font-medium tabular-nums">{r.net != null ? fmtMoney(r.net) : "—"}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <PaymentChip status={r.status} />
                    <SourceTag source={r.source} />
                    {r.invoice && <span className="text-[12px] text-[var(--c-muted)]">{r.invoice.number}</span>}
                    <span className="ml-auto">
                      <Actions r={r} />
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="border-t border-[var(--c-border)] px-4 py-3 text-[12px] text-[var(--c-muted)]">
          Wynajmy sprzed 2026 pochodzą z kalendarzy urządzeń. Faktury sprzed KSeF dołączymy później.
          {!isAdmin && " PDF i przypomnienia o płatności są dostępne dla administratora."}
        </p>
      </section>
    </div>
  );
}
