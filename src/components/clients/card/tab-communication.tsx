"use client";

import { useContext, useEffect, useMemo, useState } from "react";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import { AgentModeContext, INPUT, api } from "../client-forms";
import { gmailThreadUrl, isCommunication, itemText, itemTone, syncAgo } from "./shared";

// Zakładka „Komunikacja” (prompt 3B-karta, 2.3): e-maile z Gmaila (wątki),
// SMS-y, rozmowy i notatki — z filtrami, pogrupowane po miesiącach, z
// podglądem po prawej. Treść e-maila pobierana z Gmaila przy otwarciu.

type Filter = "all" | "email" | "sms" | "call" | "note";
type Comm = Extract<ClientHistoryItem, { kind: "email" | "message" | "activity" }>;

function kindOf(h: Comm): Exclude<Filter, "all"> {
  if (h.kind === "email") return "email";
  if (h.kind === "message") return h.channel === "SMS" ? "sms" : "email";
  return h.type === "NOTE" ? "note" : "call";
}

const FILTER_LABEL: Record<Filter, string> = { all: "Wszystko", email: "E-mail", sms: "SMS", call: "Rozmowy", note: "Notatki" };

function monthLabel(iso: string) {
  return new Date(iso).toLocaleDateString("pl-PL", { month: "long", year: "numeric" }).toUpperCase();
}

function whenShort(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pl-PL", { day: "2-digit", month: "2-digit" })}, ${d.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}`;
}

type FullEmail = { text: string; from: string; gmailUrl: string; attachments: { filename: string; size: number }[] } | { error: string };

function EmailThread({ item, clientId, onTask }: { item: Extract<Comm, { kind: "email" }>; clientId: string; onTask: (next: ClientDetail) => void }) {
  const last = item.thread[item.thread.length - 1];
  const [openId, setOpenId] = useState(last?.id ?? item.id);
  const [cache, setCache] = useState<Record<string, FullEmail>>({});
  const [taskState, setTaskState] = useState<"idle" | "saving" | "done">("idle");
  const full = cache[openId];
  // Agent nie odpisuje klientom; zadania tworzy w panelu Zadań (z odpowiedzialnym).
  const agent = useContext(AgentModeContext);

  useEffect(() => {
    if (cache[openId]) return;
    let alive = true;
    void api<FullEmail>(`/api/emails/${openId}`, "GET").then(({ ok, data }) => {
      if (alive) setCache((c) => ({ ...c, [openId]: ok ? data : { error: (data as { message?: string }).message ?? "Nie udało się pobrać wiadomości." } }));
    });
    return () => {
      alive = false;
    };
  }, [openId, cache]);

  const threadUrl = gmailThreadUrl(openId, item.mailbox);
  async function task() {
    setTaskState("saving");
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${clientId}/tasks`, "POST", {
      title: item.subject ?? "E-mail od klienta",
      notes: `Wątek w Gmailu: ${full && "gmailUrl" in full ? full.gmailUrl : threadUrl}`,
    });
    setTaskState(ok ? "done" : "idle");
    if (ok) onTask(data.detail);
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-xs text-[var(--c-muted)]">
          Wątek · {item.count} {item.count === 1 ? "wiadomość" : "wiadomości"}
        </div>
        <h3 className="m-0 mt-0.5 text-[16px] font-semibold text-[var(--c-navy)]">{item.subject ?? "(bez tematu)"}</h3>
      </div>
      {item.thread.map((m) => {
        const isOpen = m.id === openId;
        const f = cache[m.id];
        return (
          <button
            key={m.id}
            type="button"
            onClick={() => setOpenId(m.id)}
            className={`rounded-[10px] border px-3.5 py-3 text-left transition-colors ${isOpen ? "border-[var(--c-brand)]" : "border-[var(--c-border)] hover:border-[var(--c-brand)]"}`}
          >
            <div className="flex items-baseline gap-2 text-[13px]">
              <b className="min-w-0 flex-grow truncate font-semibold text-[var(--c-navy)]">
                {m.direction === "IN" ? "↓" : "↑"} {m.from}
              </b>
              <span className="flex-none text-xs text-[var(--c-muted)]">{whenShort(m.at)}</span>
            </div>
            {isOpen ? (
              <div className="mt-1.5">
                {!f && <p className="text-[13px] text-[var(--c-muted)]">Pobieranie z Gmaila…</p>}
                {f && "error" in f && <p className="text-[13px] text-[var(--c-red)]">{f.error}</p>}
                {f && "text" in f && (
                  <>
                    <p className="whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[var(--c-text)]">{f.text || "(pusta treść)"}</p>
                    {f.attachments.length > 0 && (
                      <p className="mt-2 text-xs text-[var(--c-sidebar-text)]">📎 {f.attachments.map((a) => a.filename).join(", ")}</p>
                    )}
                    <p className="mt-2 text-[11px] text-[var(--c-faint)]">Treść pobrana z Gmaila przy otwarciu — nie jest zapisywana w panelu.</p>
                  </>
                )}
              </div>
            ) : (
              m.snippet && <p className="mt-0.5 line-clamp-2 text-[13px] text-[var(--c-muted)]">{m.snippet}</p>
            )}
          </button>
        );
      })}
      {!agent && (
        <div className="flex flex-wrap gap-2">
          <a
            href={full && "gmailUrl" in full ? full.gmailUrl : threadUrl}
            target="_blank"
            rel="noreferrer"
            className="flex h-9 items-center rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)]"
          >
            Odpowiedz w Gmailu
          </a>
          <button
            type="button"
            disabled={taskState !== "idle"}
            onClick={() => void task()}
            className="h-9 rounded-lg bg-[var(--c-brand-soft)] px-4 text-[13px] font-semibold text-[var(--c-brand-deep)] transition-colors hover:bg-[var(--c-navy-soft)] disabled:opacity-60"
          >
            {taskState === "done" ? "Dodano zadanie ✓" : taskState === "saving" ? "Dodawanie…" : "Zadanie z tego maila"}
          </button>
        </div>
      )}
    </div>
  );
}

function Preview({ item, clientId, onChanged }: { item: Comm | null; clientId: string; onChanged: (next: ClientDetail) => void }) {
  if (!item) return <p className="text-sm text-[var(--c-muted)]">Wybierz pozycję z listy, żeby zobaczyć szczegóły.</p>;
  if (item.kind === "email") return <EmailThread key={item.id} item={item} clientId={clientId} onTask={onChanged} />;
  const { title } = itemText(item);
  const body = item.body;
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-[var(--c-muted)]">
        {whenShort(item.at)}
        {item.kind === "activity" && item.userName && ` · ${item.userName}`}
        {item.kind === "activity" && item.leadTitle && ` · sygnał: ${item.leadTitle}`}
        {item.kind === "message" && item.failed && " · nie wysłano"}
      </div>
      <h3 className="m-0 text-[16px] font-semibold text-[var(--c-navy)]">{title}</h3>
      <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[var(--c-text)]">{body || "—"}</p>
    </div>
  );
}

export function TabCommunication({
  d,
  onChanged,
  focusNote,
}: {
  d: ClientDetail;
  onChanged: (next: ClientDetail) => void;
  focusNote: number; // zmiana wartości = ustaw kursor w pasku notatki
}) {
  const items = useMemo(() => d.history.filter(isCommunication) as Comm[], [d.history]);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(items[0] ? `${items[0].kind}-${items[0].id}` : null);
  const [note, setNote] = useState("");
  const agent = useContext(AgentModeContext);
  const [noteType, setNoteType] = useState<"NOTE" | "CALL">("NOTE");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (focusNote) document.getElementById("client-note-input")?.focus();
  }, [focusNote]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: items.length, email: 0, sms: 0, call: 0, note: 0 };
    for (const h of items) c[kindOf(h)]++;
    return c;
  }, [items]);
  const visible = filter === "all" ? items : items.filter((h) => kindOf(h) === filter);
  const selected = items.find((h) => `${h.kind}-${h.id}` === selectedId) ?? null;

  const groups: { month: string; list: Comm[] }[] = [];
  for (const h of visible) {
    const m = monthLabel(h.at);
    if (groups.at(-1)?.month === m) groups.at(-1)!.list.push(h);
    else groups.push({ month: m, list: [h] });
  }

  async function saveNote() {
    setSaving(true);
    setError(null);
    const { ok, data } = await api<{ detail: ClientDetail }>(`/api/clients/${d.id}/activity`, "POST", { type: noteType, body: note });
    setSaving(false);
    if (!ok) return setError(data.message ?? "Nie udało się zapisać.");
    setNote("");
    onChanged(data.detail);
  }

  const chip = (on: boolean) =>
    `h-8 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${
      on ? "border-[var(--c-brand)] bg-[var(--c-brand-soft)] font-semibold text-[var(--c-brand-deep)]" : "border-[var(--c-border)] bg-white hover:border-[var(--c-brand)]"
    }`;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="overflow-hidden rounded-xl border border-[var(--c-border)] bg-white">
        <div className="border-b border-[var(--c-border)] px-4 pb-3 pt-4">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
              <button key={f} type="button" className={chip(filter === f)} onClick={() => setFilter(f)}>
                {FILTER_LABEL[f]} ({counts[f]})
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-[var(--c-muted)]">
            {d.gmail.enabled
              ? `Skrzynka ${d.gmail.mailboxes.map((m) => m.split("@")[0] + "@").join(", ")} · synchronizacja ${syncAgo(d.gmail.lastSyncAt)}`
              : "Skrzynka Gmail nie jest jeszcze podłączona — widać e-maile zaimportowane wcześniej i wysłane z panelu."}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-b border-[var(--c-border)] px-4 py-3">
          <div className="flex gap-2">
            <input
              id="client-note-input"
              className={`${INPUT} h-10`}
              placeholder={noteType === "CALL" ? "Zapisz rozmowę: co ustaliłaś?" : "Dodaj notatkę albo zapisz rozmowę…"}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && note.trim() && void saveNote()}
            />
            <button
              type="button"
              disabled={saving || !note.trim()}
              onClick={() => void saveNote()}
              className="h-10 flex-none rounded-lg bg-[var(--c-brand)] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[var(--c-brand-deep)] disabled:opacity-40"
            >
              Zapisz
            </button>
          </div>
          <div className="flex gap-3 text-xs">
            {(agent ? (["NOTE"] as const) : (["NOTE", "CALL"] as const)).map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1 text-[var(--c-muted)]">
                <input type="radio" name="note-type" checked={noteType === t} onChange={() => setNoteType(t)} className="accent-[var(--c-brand)]" />
                {t === "NOTE" ? "notatka" : "rozmowa"}
              </label>
            ))}
            {error && <span className="text-[var(--c-red)]">{error}</span>}
          </div>
        </div>

        {visible.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--c-muted)]">Brak pozycji.</p>
        ) : (
          groups.map((g) => (
            <div key={g.month}>
              <div className="bg-[var(--c-bg)]/60 px-4 py-2 text-[11px] font-semibold tracking-wide text-[var(--c-muted)]">{g.month}</div>
              {g.list.map((h) => {
                const key = `${h.kind}-${h.id}`;
                const on = key === selectedId;
                const tone = itemTone(h);
                const { title, sub } = itemText(h);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedId(key)}
                    className={`flex w-full gap-3 border-t border-[var(--c-border)] px-4 py-3 text-left transition-colors ${
                      on ? "bg-[var(--c-brand-soft)]/70 shadow-[inset_3px_0_0_var(--c-brand)]" : "hover:bg-[var(--c-bg)]/60"
                    }`}
                  >
                    <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
                      {tone.mark}
                    </span>
                    <span className="min-w-0 flex-grow">
                      <span className="flex items-baseline gap-2">
                        <b className="min-w-0 truncate text-[14px] font-semibold text-[var(--c-navy)]">
                          {h.kind === "email" ? h.subject ?? "(bez tematu)" : title}
                        </b>
                        {h.kind === "email" && h.count > 1 && <span className="flex-none rounded-full bg-[var(--c-bg)] px-1.5 text-[11px] text-[var(--c-muted)]">{h.count} wiad.</span>}
                        {h.kind === "activity" && h.fromHubspot && (
                          <span className="flex-none rounded bg-[var(--c-accent-soft)] px-1 text-[10px] font-semibold text-[var(--c-accent-deep)]">HubSpot</span>
                        )}
                        <span className="ml-auto flex-none text-xs text-[var(--c-muted)]">
                          {whenShort(h.at)}
                          {h.kind === "activity" && h.userName && ` · ${h.userName}`}
                        </span>
                      </span>
                      {sub && <span className="mt-0.5 block truncate text-[13px] text-[var(--c-muted)]">{sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </section>

      <section className="h-fit rounded-xl border border-[var(--c-border)] bg-white p-5 lg:sticky lg:top-4">
        <Preview item={selected} clientId={d.id} onChanged={onChanged} />
      </section>
    </div>
  );
}
