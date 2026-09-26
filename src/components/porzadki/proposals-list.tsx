"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { BASE_PATH } from "@/lib/base-path";
import type { ProposalRow } from "@/lib/porzadki/proposals";
import {
  AREA_KEYS,
  AREA_LABEL,
  OPEN_STATUSES,
  PRIORITY_KEYS,
  PRIORITY_LABEL,
  PRIORITY_RANK,
  STATUS_KEYS,
  STATUS_LABEL,
  TYPE_KEYS,
  TYPE_LABEL,
  proposalNumber,
  type ProposalStatusKey,
} from "@/lib/porzadki/labels";
import { BTN, BTN_PRIMARY, INPUT, PorzadkiLayout, PriorityBadge, SELECT_PILL, StatusBadge, fmtDate } from "./shared";

// Lista wniosków: domyślnie otwarte, wg priorytetu i daty. Liczniki statusów
// (klik = filtr), filtry, wyszukiwanie, sortowanie, eksport MD/CSV z tymi
// samymi filtrami.

type Sort = "priority" | "newest" | "oldest" | "number";

export function ProposalsList({ rows, counts, authors }: { rows: ProposalRow[]; counts: Record<string, number>; authors: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<"open" | "" | ProposalStatusKey>("open");
  const [area, setArea] = useState("");
  const [type, setType] = useState("");
  const [priority, setPriority] = useState("");
  const [blocks, setBlocks] = useState(false);
  const [author, setAuthor] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("priority");

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (status === "" || (status === "open" ? OPEN_STATUSES.includes(r.status) : r.status === status)) &&
        (!area || r.area === area) &&
        (!type || r.type === type) &&
        (!priority || r.priority === priority) &&
        (!blocks || r.blocksCleanup) &&
        (!author || r.authorId === author) &&
        (!s || `${proposalNumber(r.number)} ${r.title} ${r.scale ?? ""}`.toLowerCase().includes(s)),
    );
    const by: Record<Sort, (a: ProposalRow, b: ProposalRow) => number> = {
      priority: (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.createdAt.localeCompare(a.createdAt),
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      oldest: (a, b) => a.createdAt.localeCompare(b.createdAt),
      number: (a, b) => a.number - b.number,
    };
    return [...list].sort(by[sort]);
  }, [rows, status, area, type, priority, blocks, author, q, sort]);

  const exportQuery = new URLSearchParams({
    ...(status ? { status } : {}),
    ...(area ? { obszar: area } : {}),
    ...(type ? { typ: type } : {}),
    ...(priority ? { priorytet: priority } : {}),
    ...(blocks ? { blokuje: "1" } : {}),
    ...(author ? { autor: author } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const openCount = OPEN_STATUSES.reduce((n, s) => n + (counts[s] ?? 0), 0);

  return (
    <PorzadkiLayout
      title="Wnioski"
      description="Zmiany w panelu, integracjach i procesie — od zgłoszenia do realizacji."
      actions={
        <>
          <a href={`${BASE_PATH}/api/porzadki/wnioski/export?format=md&${exportQuery}`} className={`${BTN} flex items-center`}>
            Markdown
          </a>
          <a href={`${BASE_PATH}/api/porzadki/wnioski/export?format=csv&${exportQuery}`} className={`${BTN} flex items-center`}>
            CSV
          </a>
          <Link href="/wnioski/nowy" className={`${BTN_PRIMARY} flex items-center`}>
            + Nowy wniosek
          </Link>
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button type="button" className={SELECT_PILL(status === "open")} onClick={() => setStatus("open")}>
          otwarte · {openCount}
        </button>
        {STATUS_KEYS.map((s) => (
          <button key={s} type="button" className={SELECT_PILL(status === s)} onClick={() => setStatus(status === s ? "open" : s)}>
            {STATUS_LABEL[s]} · {counts[s] ?? 0}
          </button>
        ))}
        <button type="button" className={SELECT_PILL(status === "")} onClick={() => setStatus("")}>
          wszystkie · {rows.length}
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className={`${INPUT} h-8 max-w-[260px] text-[13px]`} placeholder="Szukaj: tytuł, W-0012…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className={SELECT_PILL(!!area)} value={area} onChange={(e) => setArea(e.target.value)}>
          <option value="">Obszar: wszystkie</option>
          {AREA_KEYS.map((k) => (
            <option key={k} value={k}>
              {AREA_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={SELECT_PILL(!!type)} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">Typ: wszystkie</option>
          {TYPE_KEYS.map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={SELECT_PILL(!!priority)} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">Priorytet: każdy</option>
          {PRIORITY_KEYS.map((k) => (
            <option key={k} value={k}>
              {PRIORITY_LABEL[k]}
            </option>
          ))}
        </select>
        <select className={SELECT_PILL(!!author)} value={author} onChange={(e) => setAuthor(e.target.value)}>
          <option value="">Autor: każdy</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button type="button" className={SELECT_PILL(blocks)} onClick={() => setBlocks((v) => !v)}>
          blokuje porządki
        </button>
        <select className={`${SELECT_PILL(false)} ml-auto`} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Kolejność">
          <option value="priority">Kolejność: priorytet, potem najnowsze</option>
          <option value="newest">najnowsze</option>
          <option value="oldest">najstarsze</option>
          <option value="number">numer</option>
        </select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]">
          {rows.length === 0 ? "Nie ma jeszcze wniosków." : "Żaden wniosek nie pasuje do filtrów."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
          {visible.map((r, i) => (
            <Link
              key={r.id}
              href={`/wnioski/${r.id}`}
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-[var(--c-bg)] ${i > 0 ? "border-t border-[var(--c-border)]" : ""}`}
            >
              <span className="w-[58px] flex-none text-xs font-semibold tabular-nums text-[var(--c-muted)]">{proposalNumber(r.number)}</span>
              <span className="min-w-0 flex-[1_1_320px]">
                <span className="block truncate text-[14px] font-semibold text-[var(--c-navy)]">{r.title}</span>
                <span className="block truncate text-xs text-[var(--c-muted)]">
                  {AREA_LABEL[r.area]} · {TYPE_LABEL[r.type]}
                  {r.scale ? ` · ${r.scale}` : ""}
                  {r.clientCount ? ` · klientów: ${r.clientCount}` : ""}
                  {r.commentCount ? ` · 💬 ${r.commentCount}` : ""}
                </span>
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {r.blocksCleanup && <span className="rounded-md bg-[var(--c-red-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-red)]">blokuje</span>}
                <PriorityBadge priority={r.priority} />
                <StatusBadge status={r.status} />
                <span className="whitespace-nowrap text-xs text-[var(--c-faint)] sm:min-w-[150px] sm:text-right">
                  {r.authorName ?? "—"} · {fmtDate(r.createdAt)}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </PorzadkiLayout>
  );
}
