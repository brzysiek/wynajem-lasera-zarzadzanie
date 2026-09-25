"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { APP_CSS_VARS } from "@/components/shell-tokens";
import type { ReviewClient, ReviewData, ReviewGroup } from "@/lib/history/review-load";
import { SearchIcon } from "./ui";
import { NewClientDialog, api } from "./client-forms";

// /klienci/dopasowania — jednorazowy przegląd historii z kalendarzy (prompt
// 3, 2.4). Zaprojektowany na minimum klikania: jedna decyzja = cała grupa
// (wszystkie wydarzenia o tym samym znormalizowanym tytule), najlepsza
// propozycja zaznaczona domyślnie, zbiorcze potwierdzanie, „Cofnij” w
// komunikacie po każdej decyzji.

type Tab = "SUGGESTED" | "UNMATCHED" | "AUTO" | "CONFIRMED" | "IGNORED";
const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "SUGGESTED", label: "Do potwierdzenia", hint: "Panel ma propozycję klienta — potwierdź albo wybierz innego." },
  { key: "UNMATCHED", label: "Bez dopasowania", hint: "Brak pewnej propozycji — wybierz klienta, dodaj nowego albo pomiń." },
  { key: "AUTO", label: "Automatyczne", hint: "Przypisane automatycznie (telefon, e-mail, NIP albo bardzo zgodna nazwa) — do wyrywkowej kontroli." },
  { key: "CONFIRMED", label: "Potwierdzone", hint: "Przypisane przez biuro. Nowe wydarzenia z tym samym tytułem przypiszą się same." },
  { key: "IGNORED", label: "Pominięte", hint: "Serwis, blokady, faktury i wpisy oznaczone jako „nie klient” — nie liczą się do historii." },
];

type SortKey = "count" | "recent" | "name";
const METHOD_LABEL: Record<string, string> = {
  PHONE: "telefon z opisu",
  EMAIL: "e-mail z opisu",
  NIP: "NIP z opisu",
  NAME_AUTO: "zgodna nazwa",
  MANUAL: "decyzja biura",
};

function monthYear(iso: string) {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function range(g: ReviewGroup) {
  const a = monthYear(g.firstAt);
  const b = monthYear(g.lastAt);
  return a === b ? a : `${a} – ${b}`;
}

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function eventsWord(n: number) {
  if (n === 1) return "wydarzenie";
  const l = n % 10;
  const t = n % 100;
  return l >= 2 && l <= 4 && (t < 12 || t > 14) ? "wydarzenia" : "wydarzeń";
}

function pct(score: number | null) {
  return score == null ? "" : `${Math.round(score * 100)}%`;
}

// Wyszukiwarka klienta w popoverze — lokalnie, strzałki + Enter.
function ClientPicker({
  clients,
  onPick,
  onClose,
}: {
  clients: ReviewClient[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    return clients.filter((c) => [c.name, c.city, c.person].filter(Boolean).join(" ").toLowerCase().includes(s)).slice(0, 8);
  }, [q, clients]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-30 mt-1 w-[320px] max-w-[calc(100vw-32px)] rounded-xl border border-[var(--c-border)] bg-white p-2 shadow-[0_8px_28px_rgba(0,0,0,0.14)]"
    >
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, results.length - 1));
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          }
          if (e.key === "Enter" && results[active]) onPick(results[active].id);
        }}
        placeholder="Szukaj klienta: nazwa, osoba, miasto…"
        className="h-9 w-full rounded-lg border border-[var(--c-border)] px-3 text-sm outline-none focus:border-[var(--c-brand)]"
      />
      <ul className="mt-1 max-h-72 overflow-y-auto">
        {q.trim().length < 2 && <li className="px-2 py-2 text-xs text-[var(--c-muted)]">Wpisz min. 2 znaki.</li>}
        {q.trim().length >= 2 && results.length === 0 && <li className="px-2 py-2 text-xs text-[var(--c-muted)]">Brak klientów.</li>}
        {results.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c.id)}
              className={`flex w-full flex-col rounded-lg px-2 py-1.5 text-left ${i === active ? "bg-[var(--c-brand-soft)]" : ""}`}
            >
              <span className="text-sm font-medium text-[var(--c-text)]">{c.name}</span>
              <span className="text-xs text-[var(--c-muted)]">{[c.person, c.city].filter(Boolean).join(" · ") || "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BTN =
  "h-8 whitespace-nowrap rounded-lg border border-[var(--c-border)] bg-white px-3 text-[13px] text-[var(--c-text)] transition-colors hover:border-[var(--c-brand)] hover:text-[var(--c-brand-deep)] disabled:opacity-40";
const BTN_PRIMARY =
  "h-8 whitespace-nowrap rounded-lg bg-[var(--c-brand)] px-3 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)] disabled:opacity-40";

function GroupRow({
  g,
  tab,
  clientsById,
  clients,
  selected,
  onSelect,
  chosen,
  onChoose,
  busy,
  onAssign,
  onIgnore,
  onReset,
  onNewClient,
}: {
  g: ReviewGroup;
  tab: Tab;
  clientsById: Map<string, ReviewClient>;
  clients: ReviewClient[];
  selected: boolean;
  onSelect: (v: boolean) => void;
  chosen: string | null;
  onChoose: (id: string) => void;
  busy: boolean;
  onAssign: (clientId: string) => void;
  onIgnore: () => void;
  onReset: () => void;
  onNewClient: () => void;
}) {
  const [picker, setPicker] = useState(false);
  const [open, setOpen] = useState(false);
  const selectable = tab === "SUGGESTED" || tab === "UNMATCHED";
  const assigned = g.clientId ? clientsById.get(g.clientId) : null;
  const canAssign = g.key.trim().length > 0;

  return (
    <li className={`border-b border-[var(--c-border)] px-4 py-3 last:border-0 ${busy ? "opacity-50" : ""} ${selected ? "bg-[var(--c-brand-soft)]/40" : ""}`}>
      <div className="flex flex-wrap items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`Zaznacz ${g.titles[0]?.title}`}
            className="mt-1 h-4 w-4 flex-none cursor-pointer accent-[var(--c-brand)]"
          />
        )}

        <div className="min-w-0 flex-grow basis-[260px]">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-[15px] font-semibold text-[var(--c-navy)]">{g.titles[0]?.title || "(bez tytułu)"}</span>
            {g.titles.length > 1 && (
              <span
                className="cursor-help text-xs text-[var(--c-muted)] underline decoration-dotted"
                title={g.titles.map((t) => `${t.title} (${t.count})`).join("\n")}
              >
                +{g.titles.length - 1} {g.titles.length - 1 === 1 ? "inny zapis" : "inne zapisy"}
              </span>
            )}
            {g.trainings > 0 && (
              <span className="rounded-md bg-[var(--c-purple-soft)] px-1.5 py-0.5 text-[11px] text-[var(--c-purple-deep)]">
                {g.trainings === g.count ? "szkolenie" : `w tym ${g.trainings} szkol.`}
              </span>
            )}
            {g.other && tab !== "IGNORED" && (
              <span className="rounded-md bg-[var(--c-bg)] px-1.5 py-0.5 text-[11px] text-[var(--c-muted)]">serwis / inne</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-0.5 flex items-center gap-1 text-left text-xs text-[var(--c-muted)] hover:text-[var(--c-brand-deep)]"
            aria-expanded={open}
          >
            <span className={`inline-block text-[9px] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            <b className="font-semibold text-[var(--c-text)] tabular-nums">{g.count}</b> {eventsWord(g.count)} · {range(g)} ·{" "}
            {g.devices.join(", ")}
          </button>
        </div>

        {/* Kandydaci / przypisany klient */}
        <div className="flex min-w-0 flex-grow basis-[240px] flex-wrap items-center gap-1.5">
          {tab === "SUGGESTED" &&
            g.candidates.map((c) => {
              const cl = clientsById.get(c.clientId);
              if (!cl) return null;
              const on = (chosen ?? g.candidates[0]?.clientId) === c.clientId;
              return (
                <button
                  key={c.clientId}
                  type="button"
                  onClick={() => onChoose(c.clientId)}
                  aria-pressed={on}
                  title={[cl.person, cl.city].filter(Boolean).join(" · ")}
                  className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                    on
                      ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]"
                      : "border-[var(--c-border)] bg-white text-[var(--c-text)] hover:border-[var(--c-brand)]"
                  }`}
                >
                  <span className="truncate font-medium">{cl.name}</span>
                  {cl.city && <span className="hidden text-[var(--c-muted)] sm:inline">{cl.city}</span>}
                  <span className="font-semibold tabular-nums">{pct(c.score)}</span>
                </button>
              );
            })}
          {(tab === "AUTO" || tab === "CONFIRMED") && assigned && (
            <span className="flex min-w-0 items-center gap-2 text-sm">
              <span className="text-[var(--c-muted)]">→</span>
              <Link href={`/klienci/${assigned.id}`} className="truncate font-semibold text-[var(--c-brand-deep)] hover:underline">
                {assigned.name}
              </Link>
              <span className="whitespace-nowrap rounded-md bg-[var(--c-green-soft)] px-1.5 py-0.5 text-[11px] text-[var(--c-green-deep)]">
                {METHOD_LABEL[g.method ?? ""] ?? "przypisane"}
                {g.method === "NAME_AUTO" && ` ${pct(g.score)}`}
              </span>
            </span>
          )}
        </div>

        {/* Akcje */}
        <div className="relative flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1.5">
          {tab === "SUGGESTED" && (
            <button type="button" disabled={busy} className={BTN_PRIMARY} onClick={() => onAssign(chosen ?? g.candidates[0].clientId)}>
              Potwierdź
            </button>
          )}
          {canAssign && (
            <button type="button" disabled={busy} className={BTN} onClick={() => setPicker((v) => !v)}>
              {tab === "AUTO" || tab === "CONFIRMED" ? "Zmień…" : tab === "SUGGESTED" ? "Inny klient…" : "Wybierz klienta…"}
            </button>
          )}
          {(tab === "UNMATCHED" || tab === "SUGGESTED") && canAssign && (
            <button type="button" disabled={busy} className={BTN} onClick={onNewClient}>
              + Nowy klient
            </button>
          )}
          {tab !== "IGNORED" && (
            <button
              type="button"
              disabled={busy}
              onClick={onIgnore}
              className="h-8 whitespace-nowrap rounded-lg px-2 text-[13px] text-[var(--c-muted)] transition-colors hover:bg-[var(--c-bg)] hover:text-[var(--c-text)] disabled:opacity-40"
              title="To nie jest wynajem u klienta (serwis, blokada, prywatne…)"
            >
              Pomiń
            </button>
          )}
          {(tab === "CONFIRMED" || (tab === "IGNORED" && g.manual)) && (
            <button type="button" disabled={busy} className={BTN} onClick={onReset} title="Wraca do dopasowania automatycznego">
              {tab === "IGNORED" ? "Przywróć" : "Cofnij"}
            </button>
          )}
          {picker && (
            <ClientPicker
              clients={clients}
              onClose={() => setPicker(false)}
              onPick={(id) => {
                setPicker(false);
                onAssign(id);
              }}
            />
          )}
        </div>
      </div>

      {open && (
        <ul className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-[var(--c-bg)] px-3 py-2 text-xs sm:ml-7">
          {g.events.map((e) => (
            <li key={e.id} className="flex gap-3 py-0.5">
              <span className="w-[74px] flex-none tabular-nums text-[var(--c-muted)]">{fmtDay(e.at)}</span>
              <span className="w-[120px] flex-none truncate text-[var(--c-muted)]">{e.deviceName}</span>
              <span className="min-w-0 truncate text-[var(--c-text)]">{e.title}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

type Toast = { text: string; undoKeys?: string[]; error?: boolean };

export function HistoryReview({ data }: { data: ReviewData }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("SUGGESTED");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("count");
  const [limit, setLimit] = useState(40);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<Toast | null>(null);
  const [newFor, setNewFor] = useState<ReviewGroup | null>(null);
  const [rematching, setRematching] = useState(false);

  const clientsById = useMemo(() => new Map(data.clients.map((c) => [c.id, c])), [data.clients]);

  useEffect(() => {
    if (!toast || toast.error) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  const byTab = useMemo(() => {
    const m: Record<Tab, ReviewGroup[]> = { SUGGESTED: [], UNMATCHED: [], AUTO: [], CONFIRMED: [], IGNORED: [] };
    for (const g of data.groups) if (!hidden.has(g.id)) m[g.state as Tab].push(g);
    return m;
  }, [data.groups, hidden]);

  const visible = useMemo(() => {
    const s = query.trim().toLowerCase();
    const list = byTab[tab].filter((g) => {
      if (s.length < 2) return true;
      const assigned = g.clientId ? clientsById.get(g.clientId)?.name ?? "" : "";
      return [g.key, assigned, ...g.titles.map((t) => t.title)].join(" ").toLowerCase().includes(s);
    });
    return list.sort((a, b) =>
      sort === "count"
        ? b.count - a.count || b.lastAt.localeCompare(a.lastAt)
        : sort === "recent"
          ? b.lastAt.localeCompare(a.lastAt)
          : (a.titles[0]?.title ?? "").localeCompare(b.titles[0]?.title ?? "", "pl"),
    );
  }, [byTab, tab, query, sort, clientsById]);

  const done = data.totals.assigned;
  const total = data.totals.relevant;
  const percent = total ? Math.round((done / total) * 100) : 0;

  function switchTab(t: Tab) {
    setTab(t);
    setSelected(new Set());
    setLimit(40);
  }

  async function decide(groups: ReviewGroup[], body: { action: "assign"; clientId: string } | { action: "ignore" } | { action: "reset" }) {
    const ids = groups.map((g) => g.id);
    const keys = [...new Set(groups.map((g) => g.key))];
    setBusy((b) => new Set([...b, ...ids]));
    const { ok, data: res } = await api<{ events: number }>("/api/history/decide", "POST", { ...body, keys });
    setBusy((b) => new Set([...b].filter((id) => !ids.includes(id))));
    if (!ok) {
      setToast({ text: res.message ?? "Nie udało się zapisać decyzji.", error: true });
      return;
    }
    setHidden((h) => new Set([...h, ...ids]));
    setSelected((s) => new Set([...s].filter((id) => !ids.includes(id))));
    const n = res.events;
    const text =
      body.action === "assign"
        ? `Przypisano ${n} ${eventsWord(n)} do: ${clientsById.get(body.clientId)?.name ?? "klienta"}.`
        : body.action === "ignore"
          ? `Pominięto ${n} ${eventsWord(n)}.`
          : `Przywrócono ${n} ${eventsWord(n)} do dopasowania automatycznego.`;
    setToast({ text, undoKeys: body.action === "reset" ? undefined : keys });
    router.refresh();
  }

  async function undo(keys: string[]) {
    setToast(null);
    const { ok, data: res } = await api("/api/history/decide", "POST", { action: "reset", keys });
    if (!ok) return setToast({ text: res.message ?? "Nie udało się cofnąć.", error: true });
    setHidden(new Set());
    setToast({ text: "Cofnięto." });
    router.refresh();
  }

  async function confirmSelected() {
    const groups = visible.filter((g) => selected.has(g.id) && g.candidates.length > 0);
    const byClient = new Map<string, ReviewGroup[]>();
    for (const g of groups) {
      const id = chosen.get(g.id) ?? g.candidates[0].clientId;
      byClient.set(id, [...(byClient.get(id) ?? []), g]);
    }
    for (const [clientId, list] of byClient) await decide(list, { action: "assign", clientId });
    if (byClient.size > 1) {
      const n = groups.reduce((s, g) => s + g.count, 0);
      setToast({ text: `Potwierdzono ${groups.length} grup (${n} ${eventsWord(n)}).` });
    }
  }

  async function rematch() {
    setRematching(true);
    const { ok, data: res } = await api<{ changed: number }>("/api/history/rematch", "POST");
    setRematching(false);
    if (!ok) return setToast({ text: res.message ?? "Nie udało się przeliczyć.", error: true });
    setHidden(new Set());
    setToast({ text: res.changed ? `Zaktualizowano ${res.changed} ${eventsWord(res.changed)}.` : "Bez zmian — dopasowania są aktualne." });
    router.refresh();
  }

  const pageItems = visible.slice(0, limit);
  const selectable = tab === "SUGGESTED" || tab === "UNMATCHED";
  const allSelected = selectable && pageItems.length > 0 && pageItems.every((g) => selected.has(g.id));
  const selectedGroups = visible.filter((g) => selected.has(g.id));
  const tabInfo = TABS.find((t) => t.key === tab)!;

  return (
    <div style={APP_CSS_VARS} className="flex flex-col gap-[18px] text-[var(--c-text)]">
      {/* Nagłówek */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-grow">
          <Link href="/klienci" className="text-[13px] text-[var(--c-muted)] hover:text-[var(--c-brand-deep)]">
            ← Klienci
          </Link>
          <h1 className="m-0 text-[26px] font-semibold text-[var(--c-navy)]">Dopasowania historii</h1>
          <p className="mt-0.5 text-[13px] text-[var(--c-muted)]">
            Wydarzenia z kalendarzy urządzeń sprzed synchronizacji. Przypisz je do klientów — wtedy liczą się do statusu,
            liczby wynajmów i „klient od”.
          </p>
        </div>
        <button type="button" onClick={() => void rematch()} disabled={rematching} className={BTN} title="Np. po dodaniu nowych klientów lub osób kontaktowych">
          {rematching ? "Przeliczanie…" : "Przelicz automatycznie"}
        </button>
      </div>

      {data.totals.events === 0 ? (
        <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-10 text-center">
          <p className="text-[15px] font-semibold text-[var(--c-navy)]">Historia nie została jeszcze zaimportowana</p>
          <p className="mt-1 text-sm text-[var(--c-muted)]">
            Administrator uruchamia import w{" "}
            <Link href="/ustawienia/integracje/google" className="text-[var(--c-brand-deep)] underline">
              Ustawienia → Integracje → Google
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          {/* Postęp */}
          <div className="rounded-xl border border-[var(--c-border)] bg-white px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span>
                Przypisano <b className="font-semibold tabular-nums">{done}</b> z <b className="font-semibold tabular-nums">{total}</b>{" "}
                wydarzeń <span className="text-[var(--c-muted)]">({percent}%)</span>
              </span>
              <span className="text-xs text-[var(--c-muted)]">
                {byTab.SUGGESTED.length} grup do potwierdzenia · {byTab.UNMATCHED.length} bez dopasowania
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--c-bg)]">
              <div className="h-full rounded-full bg-[var(--c-green)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
            </div>
          </div>

          {/* Zakładki */}
          <div className="flex gap-1 overflow-x-auto border-b border-[var(--c-border)]" role="tablist">
            {TABS.map((t) => {
              const n = byTab[t.key].length;
              const on = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => switchTab(t.key)}
                  className={`-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                    on
                      ? "border-[var(--c-brand)] font-semibold text-[var(--c-brand-deep)]"
                      : "border-transparent text-[var(--c-muted)] hover:text-[var(--c-text)]"
                  }`}
                >
                  {t.label}
                  <span
                    className={`rounded-full px-1.5 text-[11px] tabular-nums ${
                      on ? "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "bg-[var(--c-bg)] text-[var(--c-muted)]"
                    }`}
                  >
                    {n}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="-mt-2 text-[13px] text-[var(--c-muted)]">{tabInfo.hint}</p>

          {/* Pasek narzędzi */}
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[220px] flex-grow items-center gap-2 rounded-[10px] border border-[var(--c-border)] bg-white px-3 transition-colors focus-within:border-[var(--c-brand)] sm:max-w-[360px]">
              <SearchIcon size={15} className="flex-none text-[var(--c-muted)]" />
              <span className="sr-only">Szukaj w tytułach</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Szukaj w tytułach…"
                className="min-w-0 flex-grow bg-transparent text-sm outline-none placeholder:text-[var(--c-faint)]"
              />
            </label>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sortowanie"
              className="h-9 cursor-pointer rounded-[10px] border border-[var(--c-border)] bg-white px-2.5 text-[13px] outline-none focus:border-[var(--c-brand)]"
            >
              <option value="count">Najwięcej wydarzeń</option>
              <option value="recent">Najnowsze</option>
              <option value="name">A–Z</option>
            </select>
            {selectable && (
              <label className="ml-1 flex cursor-pointer items-center gap-1.5 text-[13px] text-[var(--c-muted)]">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    setSelected(e.target.checked ? new Set([...selected, ...pageItems.map((g) => g.id)]) : new Set())
                  }
                  className="h-4 w-4 accent-[var(--c-brand)]"
                />
                zaznacz widoczne
              </label>
            )}
            {selectedGroups.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="text-[13px] text-[var(--c-muted)]">Zaznaczono {selectedGroups.length}:</span>
                {tab === "SUGGESTED" && (
                  <button type="button" className={BTN_PRIMARY} onClick={() => void confirmSelected()}>
                    Potwierdź zaznaczone
                  </button>
                )}
                <button type="button" className={BTN} onClick={() => void decide(selectedGroups, { action: "ignore" })}>
                  Pomiń zaznaczone
                </button>
              </div>
            )}
          </div>

          {/* Lista grup */}
          {visible.length === 0 ? (
            <div className="rounded-xl border border-[var(--c-border)] bg-white px-6 py-8 text-center text-sm text-[var(--c-muted)]">
              {query.trim().length >= 2
                ? "Brak grup pasujących do wyszukiwania."
                : tab === "SUGGESTED" || tab === "UNMATCHED"
                  ? "Wszystko przejrzane w tej zakładce. 🎉"
                  : "Brak wpisów."}
            </div>
          ) : (
            <ul className="rounded-xl border border-[var(--c-border)] bg-white">
              {pageItems.map((g) => (
                <GroupRow
                  key={g.id}
                  g={g}
                  tab={tab}
                  clientsById={clientsById}
                  clients={data.clients}
                  selected={selected.has(g.id)}
                  onSelect={(v) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (v) n.add(g.id);
                      else n.delete(g.id);
                      return n;
                    })
                  }
                  chosen={chosen.get(g.id) ?? null}
                  onChoose={(id) => setChosen((m) => new Map(m).set(g.id, id))}
                  busy={busy.has(g.id)}
                  onAssign={(clientId) => void decide([g], { action: "assign", clientId })}
                  onIgnore={() => void decide([g], { action: "ignore" })}
                  onReset={() => void decide([g], { action: "reset" })}
                  onNewClient={() => setNewFor(g)}
                />
              ))}
            </ul>
          )}
          {visible.length > limit && (
            <button type="button" onClick={() => setLimit((l) => l + 40)} className={`${BTN} self-center`}>
              Pokaż więcej ({visible.length - limit})
            </button>
          )}
        </>
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-5 left-1/2 z-40 flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white shadow-[0_8px_28px_rgba(0,0,0,0.25)] ${
            toast.error ? "bg-[var(--c-red)]" : "bg-[var(--c-navy)]"
          }`}
        >
          <span>{toast.text}</span>
          {toast.undoKeys && (
            <button type="button" onClick={() => void undo(toast.undoKeys!)} className="font-semibold underline underline-offset-2">
              Cofnij
            </button>
          )}
          <button type="button" onClick={() => setToast(null)} aria-label="Zamknij" className="opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {newFor && (
        <NewClientDialog
          initialName={newFor.titles[0]?.title.replace(/\s+/g, " ").trim() ?? ""}
          hint={`Po zapisaniu ${newFor.count} ${eventsWord(newFor.count)} z tej grupy zostanie przypisanych do nowego klienta. Popraw nazwę i dodaj osobę kontaktową.`}
          onClose={() => setNewFor(null)}
          onCreated={(id) => {
            const g = newFor;
            setNewFor(null);
            void decide([g], { action: "assign", clientId: id });
          }}
        />
      )}
    </div>
  );
}
