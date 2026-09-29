"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
// samymi filtrami. Wniosek 30: jak kolejka Propozycji — zaznaczanie, pasek
// hurtowy, przycisk z najczęstszą akcją w wierszu, „Cofnij” przez 10 s,
// „wdrożono w …” z tytułu commita (status zatwierdza ADMIN).

type Sort = "priority" | "newest" | "oldest" | "number";
type Tab = "open" | "decide" | "doing" | "deployed" | "done" | "" | ProposalStatusKey;
type Change = { id: string; from: ProposalStatusKey; to: ProposalStatusKey };

const TAB_TEST: Record<"open" | "decide" | "doing" | "deployed" | "done", (r: ProposalRow) => boolean> = {
  open: (r) => OPEN_STATUSES.includes(r.status),
  decide: (r) => r.status === "NOWY" || r.status === "DO_DECYZJI",
  doing: (r) => r.status === "PRZYJETY" || r.status === "W_REALIZACJI",
  deployed: (r) => OPEN_STATUSES.includes(r.status) && r.deployed != null,
  done: (r) => r.status === "ZROBIONY",
};
const BULK: ProposalStatusKey[] = ["PRZYJETY", "W_REALIZACJI", "ZROBIONY", "ODRZUCONY", "DUPLIKAT"];
const BULK_LABEL: Partial<Record<ProposalStatusKey, string>> = { PRZYJETY: "Przyjęty", W_REALIZACJI: "W realizacji", ZROBIONY: "Zrobiony", ODRZUCONY: "Odrzucony", DUPLIKAT: "Duplikat" };
const d2 = (iso: string) => new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" });

// Najczęstsza kolejna akcja: wdrożony → „✓ Zrobione”, nowy / do decyzji →
// „Przyjmij”, przyjęty / w realizacji → „✓ Zrobione”.
function nextAction(r: ProposalRow): { to: ProposalStatusKey; label: string } | null {
  if (!OPEN_STATUSES.includes(r.status)) return null;
  if (r.deployed || r.status === "PRZYJETY" || r.status === "W_REALIZACJI") return { to: "ZROBIONY", label: "✓ Zrobione" };
  return { to: "PRZYJETY", label: "Przyjmij" };
}

export function ProposalsList({
  rows: initialRows,
  counts: _counts,
  authors,
  isAdmin = false,
}: {
  rows: ProposalRow[];
  counts: Record<string, number>;
  authors: { id: string; name: string }[];
  isAdmin?: boolean;
}) {
  void _counts;
  const router = useRouter();
  // Świeże dane po router.refresh() podmieniają lokalną kopię (wzorzec
  // „poprzednia wartość propsa” zamiast efektu).
  const [rows, setRows] = useState(initialRows);
  const [seen, setSeen] = useState(initialRows);
  if (seen !== initialRows) {
    setSeen(initialRows);
    setRows(initialRows);
  }
  const counts = useMemo(() => rows.reduce<Record<string, number>>((m, r) => ((m[r.status] = (m[r.status] ?? 0) + 1), m), {}), [rows]);
  const [status, setStatus] = useState<Tab>("open");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo?: Change[]; error?: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 6000 : 10000);
    return () => clearTimeout(t);
  }, [toast]);

  async function apply(items: { id: string; status: ProposalStatusKey }[], opts: { comment?: string; duplicateOfId?: string; undo?: boolean } = {}) {
    if (!items.length) return;
    setBusy(true);
    const res = await fetch(`${BASE_PATH}/api/porzadki/wnioski/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, comment: opts.undo ? "cofnięte z listy" : opts.comment || null, duplicateOfId: opts.duplicateOfId ?? null }),
    });
    const data = (await res.json().catch(() => ({}))) as { changed?: Change[]; message?: string };
    setBusy(false);
    setMenu(null);
    if (!res.ok) return setToast({ text: data.message ?? "Nie udało się zmienić statusu.", error: true });
    const changed = data.changed ?? [];
    const to = new Map(changed.map((c) => [c.id, c.to]));
    setRows((list) => list.map((r) => (to.has(r.id) ? { ...r, status: to.get(r.id)! } : r)));
    setSelected(new Set());
    if (!opts.undo) setComment("");
    const label = (k: ProposalStatusKey) => STATUS_LABEL[k];
    setToast(
      opts.undo
        ? { text: `Cofnięto (${changed.length}).` }
        : changed.length === 1
          ? { text: `${proposalNumber(rows.find((r) => r.id === changed[0].id)?.number ?? 0)} → ${label(changed[0].to)}`, undo: changed }
          : { text: changed.length ? `Zmieniono ${changed.length} wniosków → ${label(changed[0].to)}` : "Bez zmian — wnioski już miały ten status.", undo: changed.length ? changed : undefined },
    );
    router.refresh();
  }

  function duplicateTarget(): string | null {
    const raw = window.prompt("Duplikat którego wniosku? Podaj numer (np. 24).");
    if (!raw) return null;
    const n = Number(raw.replace(/^W-0*/i, "").trim());
    const main = rows.find((r) => r.number === n);
    if (!main) {
      setToast({ text: `Nie ma wniosku nr ${raw}.`, error: true });
      return null;
    }
    return main.id;
  }
  function applyTo(ids: string[], to: ProposalStatusKey, withComment?: string) {
    if (to === "DUPLIKAT") {
      const main = duplicateTarget();
      if (!main) return;
      return void apply(
        ids.filter((id) => id !== main).map((id) => ({ id, status: to })),
        { comment: withComment, duplicateOfId: main },
      );
    }
    void apply(ids.map((id) => ({ id, status: to })), { comment: withComment });
  }
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
        (status === "" || (status in TAB_TEST ? TAB_TEST[status as keyof typeof TAB_TEST](r) : r.status === status)) &&
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
    ...(status && !(status in TAB_TEST && status !== "open") ? { status } : {}),
    ...(area ? { obszar: area } : {}),
    ...(type ? { typ: type } : {}),
    ...(priority ? { priorytet: priority } : {}),
    ...(blocks ? { blokuje: "1" } : {}),
    ...(author ? { autor: author } : {}),
    ...(q.trim() ? { q: q.trim() } : {}),
  }).toString();
  const tabCount = (t: keyof typeof TAB_TEST) => rows.filter(TAB_TEST[t]).length;
  const visibleIds = visible.map((r) => r.id);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (on) n.add(id);
        else n.delete(id);
      }
      return n;
    });

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
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {(
          [
            ["open", "Otwarte"],
            ["decide", "Do decyzji"],
            ["doing", "W realizacji"],
            ["deployed", "Wdrożone — do odhaczenia"],
            ["done", "Zrobione"],
          ] as [keyof typeof TAB_TEST, string][]
        ).map(([k, label]) => (
          <button key={k} type="button" className={SELECT_PILL(status === k)} onClick={() => setStatus(k)}>
            {label} · {tabCount(k)}
          </button>
        ))}
        <select
          className={SELECT_PILL(status === "" || STATUS_KEYS.includes(status as ProposalStatusKey))}
          value={status === "" || STATUS_KEYS.includes(status as ProposalStatusKey) ? status : "_"}
          onChange={(e) => e.target.value !== "_" && setStatus(e.target.value as Tab)}
          aria-label="Inny status"
        >
          <option value="_">inny status…</option>
          {STATUS_KEYS.map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]} · {counts[k] ?? 0}
            </option>
          ))}
          <option value="">wszystkie · {rows.length}</option>
        </select>
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

      {isAdmin && visible.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--c-bg)] px-3 py-2 text-[13px]">
          <label className="flex items-center gap-1.5 text-[var(--c-muted)]">
            <input type="checkbox" checked={allVisible} onChange={(e) => toggle(visibleIds, e.target.checked)} />
            zaznacz wszystkie widoczne ({visibleIds.length})
          </label>
          <span className="text-[var(--c-muted)]">· zaznaczone: {selected.size}</span>
          {selected.size > 0 && (
            <>
              <input className={`${INPUT} h-8 min-w-[200px] max-w-[320px] flex-1 text-[13px]`} placeholder="Komentarz dla wszystkich (opcjonalnie)" value={comment} onChange={(e) => setComment(e.target.value)} />
              <span className="ml-auto flex flex-wrap gap-1.5">
                {BULK.map((k) => (
                  <button key={k} type="button" disabled={busy} className={`${k === "ZROBIONY" ? BTN_PRIMARY : BTN} h-8 px-3 text-[13px]`} onClick={() => applyTo([...selected], k, comment)}>
                    {BULK_LABEL[k]}
                  </button>
                ))}
              </span>
            </>
          )}
        </div>
      )}

      {toast && (
        <div role="status" className={`fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg px-4 py-2.5 text-[13px] shadow-lg ${toast.error ? "bg-[var(--c-red)] text-white" : "bg-[var(--c-navy)] text-white"}`}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button type="button" disabled={busy} className="font-semibold underline underline-offset-2" onClick={() => void apply(toast.undo!.map((c) => ({ id: c.id, status: c.from })), { undo: true })}>
              Cofnij
            </button>
          )}
        </div>
      )}

      {visible.length === 0 ? (
        <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center text-sm text-[var(--c-muted)]">
          {rows.length === 0 ? "Nie ma jeszcze wniosków." : "Żaden wniosek nie pasuje do filtrów."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
          {visible.map((r, i) => {
            const next = isAdmin ? nextAction(r) : null;
            return (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--c-bg)] ${i > 0 ? "border-t border-[var(--c-border)]" : ""} ${selected.has(r.id) ? "bg-[var(--c-brand-soft)]" : ""}`}>
                {isAdmin && <input type="checkbox" checked={selected.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} aria-label={`Zaznacz ${proposalNumber(r.number)}`} />}
                <Link href={`/wnioski/${r.id}`} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
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
                    {r.deployed && OPEN_STATUSES.includes(r.status) && (
                      <span className="rounded-md bg-[var(--c-green-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-green-deep)]" title="Tytuł commita wymienia ten wniosek — sprawdź i odhacz „✓ Zrobione”">
                        wdrożono w {r.deployed.commit} · {d2(r.deployed.at)}
                      </span>
                    )}
                    {r.blocksCleanup && <span className="rounded-md bg-[var(--c-red-soft)] px-1.5 py-0.5 text-[11px] font-semibold text-[var(--c-red)]">blokuje</span>}
                    <PriorityBadge priority={r.priority} />
                    <StatusBadge status={r.status} />
                    <span className="whitespace-nowrap text-xs text-[var(--c-faint)] sm:min-w-[150px] sm:text-right">
                      {r.authorName ?? "—"} · {fmtDate(r.createdAt)}
                    </span>
                  </span>
                </Link>
                {isAdmin && (
                  <span className="relative flex flex-none items-center gap-1">
                    {next && (
                      <button type="button" disabled={busy} className={`${next.to === "ZROBIONY" ? BTN_PRIMARY : BTN} h-8 whitespace-nowrap px-3 text-[13px]`} onClick={() => applyTo([r.id], next.to)}>
                        {next.label}
                      </button>
                    )}
                    <button type="button" className={`${BTN} h-8 px-2 text-[13px]`} aria-label="Inne statusy" aria-expanded={menu === r.id} onClick={() => setMenu(menu === r.id ? null : r.id)}>
                      …
                    </button>
                    {menu === r.id && (
                      <span className="absolute right-0 top-full z-20 mt-1 flex w-[170px] flex-col rounded-lg border border-[var(--c-border)] bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(null)}>
                        {STATUS_KEYS.filter((k) => k !== r.status).map((k) => (
                          <button key={k} type="button" disabled={busy} className="px-3 py-1.5 text-left text-[13px] hover:bg-[var(--c-bg)]" onClick={() => applyTo([r.id], k)}>
                            {STATUS_LABEL[k]}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </PorzadkiLayout>
  );
}
