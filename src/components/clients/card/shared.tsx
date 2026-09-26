// Wspólne klocki karty klienta (pełna karta z zakładkami i skrócona karta
// na liście) — wygląd wg docs/crm/mockup-karta-klienta.html i zrzutów w
// docs/crm/zrzuty/, kolory wyłącznie ze zmiennych APP (shell-tokens.ts).
import Link from "next/link";
import type { ClientDetail, ClientHistoryItem } from "@/lib/clients/load";
import type { PaymentKind } from "@/lib/clients/payment-status";
import { fmtDate, fmtMoney } from "../ui";

export type Tx = ClientDetail["transactions"][number];

// Nowa wiadomość w Gmailu z właściwej skrzynki (panel niczego nie wysyła sam).
export function gmailComposeUrl(to: string, mailbox: string | null): string {
  const params = new URLSearchParams({ view: "cm", fs: "1", to });
  if (mailbox) params.set("authuser", mailbox);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

export function gmailThreadUrl(threadOrMessageId: string, mailbox: string): string {
  return `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(mailbox)}#all/${threadOrMessageId}`;
}

export function Tile({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string | null; tone?: "default" | "red" | "green" }) {
  const red = tone === "red";
  return (
    <div className={`rounded-xl border bg-white px-4 py-3.5 ${red ? "border-[var(--c-red)]/40" : "border-[var(--c-border)]"}`}>
      <div className="text-[13px] text-[var(--c-muted)]">{label}</div>
      <div
        className="mt-1 text-[24px] font-semibold leading-tight tabular-nums"
        style={{ color: red ? "var(--c-red)" : tone === "green" ? "var(--c-green-deep)" : "var(--c-navy)" }}
      >
        {value}
      </div>
      {sub && <div className={`mt-1 text-xs ${red ? "text-[var(--c-red)]" : "text-[var(--c-muted)]"}`}>{sub}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-[var(--c-border)] bg-white p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center gap-2">
          {title && <h3 className="m-0 flex-grow text-[15px] font-semibold text-[var(--c-navy)]">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const PAYMENT_TONE: Record<PaymentKind, { bg: string; fg: string }> = {
  ZAPLACONA: { bg: "var(--c-green-soft)", fg: "var(--c-green-deep)" },
  GOTOWKA: { bg: "var(--c-brand-soft)", fg: "var(--c-brand-deep)" },
  PO_TERMINIE: { bg: "var(--c-red-soft)", fg: "var(--c-red)" },
  OCZEKUJE: { bg: "var(--c-gold-soft)", fg: "var(--c-gold-deep)" },
  ZAPLANOWANY: { bg: "var(--c-purple-soft)", fg: "var(--c-purple-deep)" },
  BEZ_FAKTURY: { bg: "var(--c-bg)", fg: "var(--c-sidebar-text)" },
};

export function PaymentChip({ status }: { status: Tx["status"] }) {
  const t = PAYMENT_TONE[status.kind];
  return (
    <span className="inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-semibold" style={{ background: t.bg, color: t.fg }}>
      {status.label}
    </span>
  );
}

export function SourceTag({ source }: { source: Tx["source"] }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${
        source === "panel" ? "bg-[var(--c-brand-soft)] text-[var(--c-brand-deep)]" : "bg-[var(--c-bg)] text-[var(--c-muted)]"
      }`}
    >
      {source}
    </span>
  );
}

type Tone = { bg: string; fg: string; mark: string };
const TONE = {
  rental: { bg: "var(--c-green-soft)", fg: "var(--c-green-deep)", mark: "R" },
  calendar: { bg: "var(--c-bg)", fg: "var(--c-muted)", mark: "R" },
  invoice: { bg: "var(--c-red-soft)", fg: "var(--c-red)", mark: "F" },
  sms: { bg: "var(--c-accent-soft)", fg: "var(--c-accent-deep)", mark: "S" },
  emailIn: { bg: "var(--c-brand-soft)", fg: "var(--c-brand-deep)", mark: "↓" },
  emailOut: { bg: "var(--c-brand-soft)", fg: "var(--c-brand-deep)", mark: "↑" },
  call: { bg: "var(--c-purple-soft)", fg: "var(--c-purple-deep)", mark: "T" },
  note: { bg: "var(--c-bg)", fg: "var(--c-navy)", mark: "N" },
} satisfies Record<string, Tone>;

export function itemTone(h: ClientHistoryItem): Tone {
  switch (h.kind) {
    case "rental":
      return TONE.rental;
    case "history":
      return TONE.calendar;
    case "invoice":
      return TONE.invoice;
    case "message":
      return h.channel === "SMS" ? TONE.sms : TONE.emailOut;
    case "email":
      return h.direction === "IN" ? TONE.emailIn : TONE.emailOut;
    case "activity":
      return h.type === "NOTE" ? TONE.note : TONE.call;
  }
}

// Tytuł i jedna linia opisu pozycji — wspólne dla „Ostatnich zdarzeń”,
// skróconej karty i listy „Komunikacja”.
export function itemText(h: ClientHistoryItem): { title: string; sub: string | null } {
  switch (h.kind) {
    case "rental": {
      const state = h.deleted ? "usunięty w Google" : h.upcoming ? "zaplanowany" : h.settled ? "rozliczony" : "do rozliczenia";
      return { title: `${h.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"} ${h.deviceName} — ${state}`, sub: h.totalNet != null ? `${fmtMoney(h.totalNet)} netto` : null };
    }
    case "history":
      return { title: `${h.eventType === "SZKOLENIE" ? "Szkolenie" : "Wynajem"} ${h.deviceName}`, sub: "z kalendarza" };
    case "invoice":
      return { title: `Faktura ${h.number} — ${fmtMoney(h.totalNet)} netto`, sub: h.positions };
    case "message":
      return { title: h.channel === "SMS" ? "SMS" : "E-mail z panelu", sub: h.body };
    case "email":
      return { title: `${h.direction === "IN" ? "E-mail od klienta" : "E-mail do klienta"}: ${h.subject ?? "(bez tematu)"}`, sub: h.snippet };
    case "activity":
      return {
        title: h.type === "NOTE" ? "Notatka" : h.type === "CALL_NO_ANSWER" ? "Rozmowa — nie odebrała" : "Rozmowa",
        sub: h.body,
      };
  }
}

export function EventRow({ item, onOpen, compact = false }: { item: ClientHistoryItem; onOpen?: (h: ClientHistoryItem) => void; compact?: boolean }) {
  const tone = itemTone(item);
  const { title, sub } = itemText(item);
  const author = item.kind === "activity" ? item.userName : null;
  const body = (
    <>
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-[12px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
        {tone.mark}
      </span>
      <span className="min-w-0 flex-grow">
        <span className={`block text-[13.5px] text-[var(--c-text)] ${item.kind === "rental" && item.deleted ? "text-[var(--c-faint)] line-through" : ""}`}>
          {compact && sub && (item.kind === "message" || item.kind === "activity") ? `${title}: ${sub.length > 70 ? `${sub.slice(0, 70)}…` : sub}` : title}
          {item.kind === "email" && item.count > 1 && <span className="ml-1 rounded-full bg-[var(--c-bg)] px-1.5 text-[11px] text-[var(--c-muted)]">{item.count}</span>}
          {item.kind === "email" && item.hasAttachments && <span className="ml-1">📎</span>}
          {item.kind === "activity" && item.fromHubspot && (
            <span className="ml-1 rounded bg-[var(--c-accent-soft)] px-1 text-[10px] font-semibold text-[var(--c-accent-deep)]">HubSpot</span>
          )}
        </span>
        {!compact && sub && <span className="block truncate text-xs text-[var(--c-muted)]">{sub}</span>}
        <span className="block text-[11px] text-[var(--c-muted)]">
          {fmtDate(item.at)}
          {author && ` · ${author}`}
        </span>
      </span>
    </>
  );
  if (item.kind === "rental") {
    return (
      <Link href={`/kalendarz/wynajem/${item.id}?from=/klienci`} className="-m-1 flex gap-3 rounded-lg p-1 hover:bg-[var(--c-bg)]">
        {body}
      </Link>
    );
  }
  if (onOpen && (item.kind === "email" || item.kind === "message" || item.kind === "activity")) {
    return (
      <button type="button" onClick={() => onOpen(item)} className="-m-1 flex gap-3 rounded-lg p-1 text-left hover:bg-[var(--c-bg)]">
        {body}
      </button>
    );
  }
  return <div className="flex gap-3">{body}</div>;
}

export function isCommunication(h: ClientHistoryItem) {
  return h.kind === "email" || h.kind === "message" || h.kind === "activity";
}

export function syncAgo(iso: string | null): string {
  if (!iso) return "jeszcze nie";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "przed chwilą";
  if (min < 60) return `${min} min temu`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h temu`;
  return fmtDate(iso);
}
