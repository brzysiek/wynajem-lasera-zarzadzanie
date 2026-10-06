"use client";

import { useMemo, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import { AUTO_MAIL_FROM, renderAutoMail, type SummaryRow } from "@/lib/leads/auto-mail-render";

// Maile automatyczne po formularzu WWW (04–05.10.2026): cennik i
// potwierdzenie rezerwacji — treść, wspólna stopka, załączniki,
// przełączniki, próbna wysyłka i ostatnie wysyłki.
type Attachment = { id: string; filename: string; mime: string; size: number };
type Config = {
  enabled: boolean;
  fromName: string;
  subject: string;
  body: string;
  attachments: Attachment[];
  rez: { enabled: boolean; subject: string; body: string };
  footer: string;
  alertEmail: string;
};

// Przykładowe zgłoszenie do podglądu i maila próbnego rezerwacji.
const SAMPLE_SUMMARY: SummaryRow[] = [
  { label: "Urządzenie", value: "LightSheer Desire" },
  { label: "Termin od", value: "2026-11-02" },
  { label: "Liczba dni", value: "2 dni" },
  { label: "Miejscowość gabinetu", value: "Kraków" },
];
type Recent = { id: string; kind: string; leadId: string | null; toAddress: string; status: string; attempts: number; error: string | null; createdAt: string; sentAt: string | null };

const API = `${BASE_PATH}/api/auto-mail/cennik`;
const CARD = "mb-6 rounded-lg border border-gray-200 bg-white p-6";
const INPUT = "w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-[#1B6FA8] focus:outline-none";
const BTN = "rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-800 hover:border-[#1B6FA8] disabled:opacity-50";
const BTN_PRIMARY = "rounded-md bg-[#1B6FA8] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#0C3450] disabled:opacity-50";
const STATUS: Record<string, string> = { SENT: "wysłany", PENDING: "w kolejce", FAILED: "nie wysłany" };
const KIND_LABEL: Record<string, string> = { www_cennik: "cennik", www_cennik_test: "cennik", www_rezerwacja: "rezerwacja", www_rezerwacja_test: "rezerwacja" };

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
const when = (iso: string) => new Date(iso).toLocaleString("pl-PL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function AutoMailPanel({ initialConfig, initialRecent, myEmail }: { initialConfig: Config; initialRecent: Recent[]; myEmail: string }) {
  const [cfg, setCfg] = useState(initialConfig);
  const [draft, setDraft] = useState({
    fromName: initialConfig.fromName,
    subject: initialConfig.subject,
    body: initialConfig.body,
    rezSubject: initialConfig.rez.subject,
    rezBody: initialConfig.rez.body,
    footer: initialConfig.footer,
    alertEmail: initialConfig.alertEmail,
  });
  const [testKind, setTestKind] = useState<"cennik" | "rezerwacja">("cennik");
  const [recent, setRecent] = useState(initialRecent);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [testTo, setTestTo] = useState(myEmail);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty =
    draft.fromName !== cfg.fromName ||
    draft.subject !== cfg.subject ||
    draft.body !== cfg.body ||
    draft.rezSubject !== cfg.rez.subject ||
    draft.rezBody !== cfg.rez.body ||
    draft.footer !== cfg.footer ||
    draft.alertEmail !== cfg.alertEmail;
  const preview = useMemo(() => renderAutoMail({ subject: draft.subject, body: draft.body }, { name: "Anna", footer: draft.footer }), [draft.subject, draft.body, draft.footer]);
  const rezPreview = useMemo(
    () => renderAutoMail({ subject: draft.rezSubject, body: draft.rezBody }, { name: "Anna", summary: SAMPLE_SUMMARY, footer: draft.footer }),
    [draft.rezSubject, draft.rezBody, draft.footer],
  );

  async function reload() {
    const r = await fetch(API, { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (r) {
      setCfg(r.config);
      setRecent(r.recent);
    }
  }

  async function save(extra: { enabled?: boolean; rezEnabled?: boolean } = {}) {
    setBusy("save");
    setMsg(null);
    const res = await fetch(API, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, ...extra }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ text: data.message ?? "Nie udało się zapisać.", error: true });
    setCfg(data.config);
    const toggled = extra.enabled !== undefined || extra.rezEnabled !== undefined;
    const on = extra.enabled ?? extra.rezEnabled;
    setMsg({ text: !toggled ? "Zapisano." : on ? "Wysyłka włączona." : "Wysyłka wyłączona." });
  }

  async function toggle() {
    if (!cfg.enabled) {
      const ok = window.confirm("Włączyć automatyczną wysyłkę cennika?\n\nZrób to dopiero, gdy autoresponder z cennikiem w WordPressie jest wyłączony — inaczej klient dostanie dwa maile.");
      if (!ok) return;
    }
    await save({ enabled: !cfg.enabled });
  }

  async function toggleRez() {
    if (!cfg.rez.enabled) {
      const ok = window.confirm(
        "Włączyć mail potwierdzający rezerwację?\n\nZrób to zaraz PO wyłączeniu Maila 2 w WordPressie (formularze 5795 i 327) — inaczej klientka dostanie dwa maile.",
      );
      if (!ok) return;
    }
    await save({ rezEnabled: !cfg.rez.enabled });
  }

  async function upload(file: File) {
    setBusy("upload");
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`${API}/attachments`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
    if (!res.ok) return setMsg({ text: data.message ?? "Nie udało się dodać pliku.", error: true });
    setCfg((c) => ({ ...c, attachments: [...c.attachments, data.attachment] }));
  }

  async function remove(a: Attachment) {
    if (!window.confirm(`Usunąć załącznik „${a.filename}”?`)) return;
    setBusy(a.id);
    const res = await fetch(`${API}/attachments/${a.id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) return setMsg({ text: data.message ?? "Nie udało się usunąć.", error: true });
    setCfg((c) => ({ ...c, attachments: c.attachments.filter((x) => x.id !== a.id) }));
  }

  async function sendTestAlarm() {
    if (dirty && !window.confirm("Masz niezapisane zmiany — próbny alarm pójdzie na ostatnio zapisany adres. Wysłać mimo to?")) return;
    setBusy("alarm");
    setMsg(null);
    const res = await fetch(`${API}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "alarm" }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? { text: `Próbny alarm wysłany na ${cfg.alertEmail}.` } : { text: data.message ?? "Nie udało się wysłać.", error: true });
  }

  async function sendTest() {
    if (dirty && !window.confirm("Masz niezapisane zmiany — próbny mail pójdzie z ostatnio zapisaną treścią. Wysłać mimo to?")) return;
    setBusy("test");
    setMsg(null);
    const res = await fetch(`${API}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: testTo, name: "Anna", kind: testKind }) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(res.ok ? { text: `Próbny mail (${testKind}) wysłany na ${testTo}.` } : { text: data.message ?? "Nie udało się wysłać.", error: true });
    void reload();
  }

  return (
    <div>
      {msg && <div className={`mb-4 rounded-md px-4 py-2 text-sm ${msg.error ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{msg.text}</div>}

      <section className={CARD}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="w-40 text-sm font-semibold text-gray-900">Mail z cennikiem</span>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${cfg.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
            {cfg.enabled ? "włączony" : "wyłączony"}
          </span>
          <button type="button" className={cfg.enabled ? BTN : BTN_PRIMARY} disabled={!!busy} onClick={() => void toggle()}>
            {cfg.enabled ? "Wyłącz" : "Włącz"}
          </button>
          <span className="text-sm text-gray-500">Po formularzu „cennik” panel wysyła cennik i katalog z kontakt@.</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="w-40 text-sm font-semibold text-gray-900">Potwierdzenie rezerwacji</span>
          <span className={`rounded-full px-3 py-1 text-sm font-semibold ${cfg.rez.enabled ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-700"}`}>
            {cfg.rez.enabled ? "włączone" : "wyłączone"}
          </span>
          <button type="button" className={cfg.rez.enabled ? BTN : BTN_PRIMARY} disabled={!!busy} onClick={() => void toggleRez()}>
            {cfg.rez.enabled ? "Wyłącz" : "Włącz"}
          </button>
          <span className="text-sm text-gray-500">
            {cfg.rez.enabled ? "Po formularzu rezerwacji panel wysyła potwierdzenie z podsumowaniem zgłoszenia." : "Potwierdzenie wysyła dziś WordPress (Mail 2). Włącz zaraz po jego wyłączeniu."}
          </span>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Mail z cennikiem — treść</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="text-sm text-gray-700">
              Nadawca
              <div className="mt-1 flex items-center gap-2">
                <input className={INPUT} value={draft.fromName} onChange={(e) => setDraft({ ...draft, fromName: e.target.value })} />
                <span className="whitespace-nowrap text-sm text-gray-500">&lt;{AUTO_MAIL_FROM}&gt;</span>
              </div>
            </label>
            <label className="text-sm text-gray-700">
              Temat
              <input className={`${INPUT} mt-1`} value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} />
            </label>
            <label className="text-sm text-gray-700">
              Treść
              <textarea className={`${INPUT} mt-1 font-mono text-[13px]`} rows={16} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            </label>
            <p className="text-xs text-gray-500">
              <code className="rounded bg-gray-100 px-1">{"{imie}"}</code> — imię z formularza (gdy klient go nie poda, znika). Pusta linia = nowy akapit, adresy stron i e-maile same stają się
              linkami. Treść zaczynająca się od <code className="rounded bg-gray-100 px-1">&lt;</code> jest traktowana jako HTML (np. wklejona stopka z logo).
            </p>
            <div className="flex items-center gap-3">
              <button type="button" className={BTN_PRIMARY} disabled={!dirty || !!busy} onClick={() => void save()}>
                {busy === "save" ? "Zapisywanie…" : "Zapisz (treści, stopka, adres alarmów)"}
              </button>
              {dirty && <span className="text-sm text-amber-700">Niezapisane zmiany</span>}
            </div>
          </div>
          <div>
            <div className="mb-1 text-sm text-gray-700">Podgląd (dla imienia „Anna”)</div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="mb-1 text-xs text-gray-500">
                Od: {draft.fromName} &lt;{AUTO_MAIL_FROM}&gt;
              </div>
              <div className="mb-3 text-sm font-semibold text-gray-900">{preview.subject || "(bez tematu)"}</div>
              <div className="rounded bg-white p-3 text-sm [&_a]:text-[#1B6FA8] [&_a]:underline" dangerouslySetInnerHTML={{ __html: preview.html }} />
              {cfg.attachments.length > 0 && <div className="mt-3 text-xs text-gray-600">📎 {cfg.attachments.map((a) => a.filename).join(", ")}</div>}
            </div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Mail potwierdzający rezerwację — treść</h2>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="text-sm text-gray-700">
              Temat
              <input className={`${INPUT} mt-1`} value={draft.rezSubject} onChange={(e) => setDraft({ ...draft, rezSubject: e.target.value })} />
            </label>
            <label className="text-sm text-gray-700">
              Treść
              <textarea className={`${INPUT} mt-1 font-mono text-[13px]`} rows={14} value={draft.rezBody} onChange={(e) => setDraft({ ...draft, rezBody: e.target.value })} />
            </label>
            <p className="text-xs text-gray-500">
              <code className="rounded bg-gray-100 px-1">{"{imie}"}</code> — imię z formularza; <code className="rounded bg-gray-100 px-1">{"{zgloszenie}"}</code> — podsumowanie zgłoszenia
              (urządzenie, termin, liczba dni, miejscowość, szczegóły — puste pola pomijane, wartości tak, jak wybrała klientka). Bez załączników; odpowiedź wraca na {AUTO_MAIL_FROM}.
            </p>
          </div>
          <div>
            <div className="mb-1 text-sm text-gray-700">Podgląd (imię „Anna”, przykładowe zgłoszenie)</div>
            <div className="rounded-md border border-gray-200 bg-gray-50 p-4">
              <div className="mb-1 text-xs text-gray-500">
                Od: {draft.fromName} &lt;{AUTO_MAIL_FROM}&gt;
              </div>
              <div className="mb-3 text-sm font-semibold text-gray-900">{rezPreview.subject || "(bez tematu)"}</div>
              <div className="rounded bg-white p-3 text-sm [&_a]:text-[#1B6FA8] [&_a]:underline" dangerouslySetInnerHTML={{ __html: rezPreview.html }} />
            </div>
          </div>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Stopka (wspólny podpis)</h2>
        <p className="mb-3 text-sm text-gray-500">Doklejana na końcu obu maili automatycznych. Podpis Ani trzymaj tutaj — zmiana w jednym miejscu zmienia oba maile (w treściach wyżej już go nie powtarzaj). Może to być zwykły tekst albo kod HTML (zaczynający się od <code className="rounded bg-gray-100 px-1">&lt;</code>), np. podpis z logo — grafika musi mieć publiczny adres https (np. plik w bibliotece mediów strony), a nie być wklejona „w środku” maila. Skrypty i ramki są usuwane.</p>
        <textarea className={`${INPUT} max-w-2xl font-mono text-[13px]`} rows={5} value={draft.footer} onChange={(e) => setDraft({ ...draft, footer: e.target.value })} />
      </section>

      <section className={CARD}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Załączniki</h2>
        <p className="mb-3 text-sm text-gray-500">Cennik i katalog (PDF). Do 10 MB na plik, razem do 17 MB. Nowy plik podmień przez dodanie i usunięcie starego.</p>
        {cfg.attachments.length === 0 ? (
          <p className="mb-3 text-sm text-amber-700">Brak załączników — bez nich wysyłki nie da się włączyć.</p>
        ) : (
          <ul className="mb-3 divide-y divide-gray-100 text-sm">
            {cfg.attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-3 py-2">
                <a className="text-[#1B6FA8] hover:underline" href={`${API}/attachments/${a.id}`} target="_blank" rel="noreferrer">
                  {a.filename}
                </a>
                <span className="text-gray-500">{kb(a.size)}</span>
                <button type="button" className="ml-auto text-sm text-gray-500 hover:text-red-600" disabled={!!busy} onClick={() => void remove(a)}>
                  Usuń
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
          disabled={!!busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
          className="text-sm text-gray-600 file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-gray-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-gray-800 hover:file:border-[#1B6FA8]"
        />
        {busy === "upload" && <span className="ml-2 text-sm text-gray-500">Wgrywanie…</span>}
      </section>

      <section className={CARD}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Alarmy</h2>
        <p className="mb-3 text-sm text-gray-500">
          Gdy mail do klienta nie wychodzi (2 nieudane próby z rzędu albo ostatecznie), formularz WWW zwróci błąd, wygaśnie dostęp do Gmail API albo stanie cron — panel wysyła alarm na ten adres
          (przez SMTP, więc dojdzie także przy awarii Gmaila). W alarmach nie ma danych klientów.
        </p>
        {!cfg.alertEmail && <p className="mb-3 text-sm font-semibold text-red-600">Adres alarmów nie jest ustawiony — alarmy nie będą wysyłane.</p>}
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${INPUT} max-w-sm`} type="email" value={draft.alertEmail} onChange={(e) => setDraft({ ...draft, alertEmail: e.target.value })} placeholder="adres e-mail do alarmów" />
          <button type="button" className={BTN} disabled={!!busy || !cfg.alertEmail} onClick={() => void sendTestAlarm()}>
            {busy === "alarm" ? "Wysyłanie…" : "Wyślij próbny alarm"}
          </button>
          <span className="text-xs text-gray-500">Adres zapisujesz przyciskiem „Zapisz treści” wyżej.</span>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Próbna wysyłka</h2>
        <p className="mb-3 text-sm text-gray-500">Wysyła zapisaną treść z załącznikami z kontakt@ na podany adres — działa także przy wyłączonej wysyłce.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select className={`${INPUT} w-auto`} value={testKind} onChange={(e) => setTestKind(e.target.value as "cennik" | "rezerwacja")} aria-label="Który mail">
            <option value="cennik">mail z cennikiem</option>
            <option value="rezerwacja">potwierdzenie rezerwacji</option>
          </select>
          <input className={`${INPUT} max-w-xs`} type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="adres e-mail" />
          <button type="button" className={BTN} disabled={!!busy || !testTo || (testKind === "cennik" && !cfg.attachments.length)} onClick={() => void sendTest()}>
            {busy === "test" ? "Wysyłanie…" : "Wyślij próbny"}
          </button>
        </div>
      </section>

      <section className={CARD}>
        <h2 className="mb-3 text-lg font-semibold text-gray-900">Ostatnie wysyłki</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500">Jeszcze nic nie wysłano.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500">
                <th className="py-1 pr-3 font-medium">Kiedy</th>
                <th className="py-1 pr-3 font-medium">Do</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {recent.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-gray-600">{when(r.sentAt ?? r.createdAt)}</td>
                  <td className="py-1.5 pr-3 [overflow-wrap:anywhere]">
                    {r.toAddress}
                    <span className="ml-1 text-xs text-gray-500">
                      ({KIND_LABEL[r.kind] ?? r.kind}
                      {r.kind.endsWith("_test") ? ", próbny" : ""})
                    </span>
                  </td>
                  <td className={`py-1.5 pr-3 whitespace-nowrap ${r.status === "FAILED" ? "text-red-600" : r.status === "PENDING" ? "text-amber-700" : "text-green-700"}`}>
                    {STATUS[r.status] ?? r.status}
                    {r.status !== "SENT" && r.attempts > 0 && <span className="text-xs text-gray-500"> · próby: {r.attempts}</span>}
                    {r.error && r.status !== "SENT" && <div className="text-xs text-red-600">{r.error}</div>}
                  </td>
                  <td className="py-1.5 text-right">
                    {r.leadId && (
                      <a className="text-[#1B6FA8] hover:underline" href={`${BASE_PATH}/sygnaly?id=${r.leadId}`}>
                        sygnał
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
