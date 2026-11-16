"use client";

import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { QueueCancelBadge } from "@/components/queue-cancel-badge";
import { highlightSegments, matchesQuery } from "@/lib/sms/history-rules";
import type { SmsHistoryItem, SmsHistoryResult } from "@/lib/sms/history";

// Historia SMS (wniosek 53): kliknięcie wiersza rozwija pełną treść i szczegóły,
// dymek z pełną treścią po najechaniu, oznaczenie „ręczny” przy SMS-ach spoza
// szablonów i wyszukiwarka po treści (cała historia, bez względu na wielkość liter
// i polskie znaki, razem z filtrem klienta i zakresem dat).

export type QueuedSms = { id: string; at: string; recipient: string; rentalLabel: string; body: string; daysBefore: 1 | 3 | 7 };

const fmt = (iso: string) => new Date(iso).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "short" });
const fmtFull = (iso: string) => new Date(iso).toLocaleString("pl-PL", { dateStyle: "full", timeStyle: "medium" });

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightSegments(text, query).map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded bg-yellow-200 px-0.5 text-gray-900">
            {s.text}
          </mark>
        ) : (
          <Fragment key={i}>{s.text}</Fragment>
        ),
      )}
    </>
  );
}

function Detail({ item, query }: { item: SmsHistoryItem; query: string }) {
  const source = item.source === "szablon" ? `szablon: ${item.template}` : "ręczny / zmieniony szablon";
  return (
    <div className="grid gap-4 bg-gray-50 px-4 py-4 text-sm md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div>
        <div className="mb-1 text-xs font-medium uppercase text-gray-500">Pełna treść</div>
        <p className="m-0 whitespace-pre-wrap break-words rounded-md border border-gray-200 bg-white p-3 text-gray-900">
          <Highlighted text={item.body} query={query} />
        </p>
      </div>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-gray-700">
        <dt className="text-gray-500">Odbiorca</dt>
        <dd className="m-0">
          {item.clientId ? (
            <Link href={`/klienci/${item.clientId}`} className="font-medium text-[#1B6FA8] hover:underline">
              {item.clientName}
            </Link>
          ) : (
            <span className="text-gray-400">bez klienta</span>
          )}{" "}
          · {item.recipient}
        </dd>
        <dt className="text-gray-500">Wysłano</dt>
        <dd className="m-0">{fmtFull(item.at)}</dd>
        <dt className="text-gray-500">Status</dt>
        <dd className="m-0">
          {item.status === "SENT" ? "wysłany" : "błąd"}
          {item.errorMessage ? ` — ${item.errorMessage}` : ""}
        </dd>
        <dt className="text-gray-500">Źródło</dt>
        <dd className="m-0">{source}</dd>
        <dt className="text-gray-500">Autor</dt>
        <dd className="m-0">{item.author ?? "automat (przypomnienie / potwierdzenie)"}</dd>
        <dt className="text-gray-500">Rezerwacja</dt>
        <dd className="m-0">
          {item.rentalId ? (
            <Link href={`/kalendarz/wynajem/${item.rentalId}?from=/wysylka-sms`} className="text-[#1B6FA8] hover:underline">
              {item.rentalLabel}
            </Link>
          ) : (
            <span className="text-gray-400">—</span>
          )}
        </dd>
      </dl>
    </div>
  );
}

export function SmsHistory({ queued, initial, canCancel }: { queued: QueuedSms[]; initial: SmsHistoryResult; canCancel: boolean }) {
  const [q, setQ] = useState("");
  const [clientId, setClientId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const first = useRef(true);
  const filtering = Boolean(q.trim() || clientId || from || to);

  const params = (offset = 0) => {
    const p = new URLSearchParams();
    if (q.trim()) p.set("q", q.trim());
    if (clientId) p.set("clientId", clientId);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (offset) p.set("offset", String(offset));
    return p.toString();
  };

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => {
      setLoading(true);
      void fetch(`${BASE_PATH}/api/sms/history?${params()}`, { cache: "no-store" })
        .then((r) => (r.ok ? (r.json() as Promise<SmsHistoryResult>) : null))
        .then((d) => d && setData(d))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- params() czyta te same pola
  }, [q, clientId, from, to]);

  async function more() {
    setLoading(true);
    const r = await fetch(`${BASE_PATH}/api/sms/history?${params(data.items.length)}`, { cache: "no-store" });
    if (r.ok) {
      const d = (await r.json()) as SmsHistoryResult;
      setData((cur) => ({ ...d, items: [...cur.items, ...d.items] }));
    }
    setLoading(false);
  }

  // Zaplanowane (kolejka) — tylko bez filtra klienta i dat; fraza działa jak przy wysłanych.
  const queuedShown = clientId || from || to ? [] : queued.filter((r) => matchesQuery({ body: r.body, recipient: r.recipient, clientName: null, rentalLabel: r.rentalLabel }, q));
  const empty = queuedShown.length === 0 && data.items.length === 0;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-3">
        <h2 className="m-0 mr-2 text-sm font-semibold text-gray-900">Historia SMS</h2>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Szukaj w treści, numerze, kliencie…"
          aria-label="Szukaj w historii SMS"
          className="h-9 min-w-[240px] flex-1 rounded-md border border-gray-300 px-3 text-sm"
        />
        <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Klient" className="h-9 max-w-[220px] rounded-md border border-gray-300 px-2 text-sm">
          <option value="">Wszyscy klienci</option>
          {data.clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          od
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 rounded-md border border-gray-300 px-2 text-sm text-gray-900" />
        </label>
        <label className="flex items-center gap-1 text-xs text-gray-500">
          do
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 rounded-md border border-gray-300 px-2 text-sm text-gray-900" />
        </label>
        {filtering && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              setClientId("");
              setFrom("");
              setTo("");
            }}
            className="text-xs font-semibold text-[#1B6FA8] hover:underline"
          >
            wyczyść
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500" aria-live="polite">
          {loading ? "szukam…" : `${data.total} ${data.total === 1 ? "SMS" : "SMS-ów"}${filtering ? " pasuje" : ""}`}
        </span>
      </div>

      {empty ? (
        <p className="m-0 p-10 text-center text-sm text-gray-400">{filtering ? "Nic nie pasuje do wyszukiwania." : "Brak SMS-ów."}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[110px]" />
              <col className="w-[190px]" />
              <col className="w-[200px]" />
              <col />
              <col className="w-[130px]" />
            </colgroup>
            <thead className="border-b border-gray-200 bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 font-medium">Data</th>
                <th className="px-4 py-2 font-medium">Odbiorca</th>
                <th className="px-4 py-2 font-medium">Wynajem</th>
                <th className="px-4 py-2 font-medium">Treść</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {queuedShown.map((row) => (
                <tr key={`q-${row.id}`}>
                  <td className="px-4 py-2 align-top text-gray-500">{fmt(row.at)}</td>
                  <td className="break-words px-4 py-2 align-top text-gray-900">
                    {row.recipient}
                  </td>
                  <td className="truncate px-4 py-2 align-top text-gray-500" title={row.rentalLabel}>
                    {row.rentalLabel}
                  </td>
                  <td className="truncate px-4 py-2 align-top text-gray-600" title={row.body}>
                    {row.body}
                  </td>
                  <td className="px-4 py-2 align-top">{canCancel ? <QueueCancelBadge ruleId={row.id} daysBefore={row.daysBefore} initialMessageBody={row.body} /> : <span className="text-xs text-gray-500">zaplanowany</span>}</td>
                </tr>
              ))}
              {data.items.map((m) => {
                const open = expanded === m.id;
                return (
                  <Fragment key={m.id}>
                    <tr
                      tabIndex={0}
                      role="button"
                      aria-expanded={open}
                      onClick={() => setExpanded(open ? null : m.id)}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setExpanded(open ? null : m.id))}
                      className={`cursor-pointer hover:bg-gray-50 ${open ? "bg-gray-50" : ""}`}
                    >
                      <td className="px-4 py-2 align-top text-gray-500">{fmt(m.at)}</td>
                      <td className="px-4 py-2 align-top text-gray-900" title={m.clientName ? `${m.clientName} · ${m.recipient}` : m.recipient}>
                        {m.clientName ? <span className="block break-words font-medium">{m.clientName}</span> : null}
                        <span className={`block ${m.clientName ? "text-xs text-gray-500" : ""}`}>{m.recipient}</span>
                      </td>
                      <td className="px-4 py-2 align-top text-gray-500" title={m.rentalLabel ?? undefined}>
                        <span className="block truncate">{m.rentalLabel ?? "—"}</span>
                      </td>
                      <td className="px-4 py-2 align-top text-gray-600" title={m.body}>
                        <span className="block truncate">
                          <Highlighted text={m.body} query={q} />
                        </span>
                      </td>
                      <td className="px-4 py-2 align-top">
                        <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${m.status === "SENT" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`} title={m.errorMessage || undefined}>
                          {m.status === "SENT" ? "wysłano" : "błąd"}
                        </span>
                        {m.source === "reczny" && (
                          <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800" title="Treść napisana ręcznie albo zmieniona względem szablonu">
                            ręczny
                          </span>
                        )}
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={5} className="p-0">
                          <Detail item={m} query={q} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.items.length < data.total && (
        <div className="border-t border-gray-100 px-4 py-3 text-center">
          <button type="button" disabled={loading} onClick={() => void more()} className="h-9 rounded-md border border-gray-300 px-4 text-sm hover:border-[#1B6FA8] disabled:opacity-40">
            Pokaż więcej ({data.total - data.items.length})
          </button>
        </div>
      )}
    </div>
  );
}
