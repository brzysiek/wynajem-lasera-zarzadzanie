import { prisma } from "@/lib/prisma";
import { classifySms, matchesQuery } from "./history-rules";

// Historia SMS (wniosek 53): wyszukiwanie po CAŁEJ historii (nie tylko po bieżącej
// stronie listy) — treść, numer, klient, wynajem; filtr klienta i zakresu dat.
// Dopasowanie bez względu na wielkość liter i polskie znaki robi aplikacja
// (history-rules.ts), żeby nie zależeć od collation bazy.

export type SmsHistoryItem = {
  id: string;
  at: string;
  recipient: string;
  status: "SENT" | "FAILED";
  errorMessage: string | null;
  body: string;
  clientId: string | null;
  clientName: string | null;
  rentalId: string | null;
  rentalLabel: string | null;
  author: string | null; // kto wysłał; null = automat (przypomnienia, potwierdzenia)
  source: "szablon" | "reczny";
  template: string | null;
};

export type SmsHistoryFilter = { q?: string; clientId?: string; from?: string; to?: string; limit?: number; offset?: number };
export type SmsHistoryResult = { total: number; items: SmsHistoryItem[]; clients: { id: string; name: string }[] };

const MAX_ROWS = 20_000;
const dayStart = (iso: string) => new Date(`${iso}T00:00:00`);
const dayEnd = (iso: string) => new Date(new Date(`${iso}T00:00:00`).getTime() + 86_400_000);
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function searchSmsHistory(f: SmsHistoryFilter = {}): Promise<SmsHistoryResult> {
  const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
  const offset = Math.max(f.offset ?? 0, 0);
  const [rows, templates, clientRows] = await Promise.all([
    prisma.message.findMany({
      where: {
        channel: "SMS",
        ...(isDay(f.from) || isDay(f.to) ? { sentAt: { ...(isDay(f.from) ? { gte: dayStart(f.from) } : {}), ...(isDay(f.to) ? { lt: dayEnd(f.to) } : {}) } } : {}),
        ...(f.clientId ? { OR: [{ clientId: f.clientId }, { rental: { clientId: f.clientId } }] } : {}),
      },
      orderBy: { sentAt: "desc" },
      take: MAX_ROWS,
      select: {
        id: true, sentAt: true, recipient: true, status: true, errorMessage: true, body: true, userId: true, rentalId: true,
        user: { select: { name: true } },
        client: { select: { id: true, name: true } },
        rental: { select: { id: true, title: true, device: { select: { name: true } }, client: { select: { id: true, name: true } } } },
      },
    }),
    prisma.messageTemplate.findMany({ where: { channel: "SMS" }, select: { label: true, body: true } }),
    prisma.message.findMany({ where: { channel: "SMS" }, take: MAX_ROWS, select: { client: { select: { id: true, name: true } }, rental: { select: { client: { select: { id: true, name: true } } } } } }),
  ]);

  const all: SmsHistoryItem[] = rows.map((m) => {
    const client = m.client ?? m.rental?.client ?? null;
    const cls = classifySms(m.body, templates);
    return {
      id: m.id,
      at: m.sentAt.toISOString(),
      recipient: m.recipient,
      status: m.status as "SENT" | "FAILED",
      errorMessage: m.errorMessage,
      body: m.body,
      clientId: client?.id ?? null,
      clientName: client?.name ?? null,
      rentalId: m.rentalId,
      rentalLabel: m.rental ? `${m.rental.title} (${m.rental.device.name})` : null,
      author: m.userId ? (m.user?.name ?? "użytkownik") : null,
      source: cls.kind,
      template: cls.template,
    };
  });
  const q = f.q?.trim() ?? "";
  const hits = q ? all.filter((r) => matchesQuery({ body: r.body, recipient: r.recipient, clientName: r.clientName, rentalLabel: r.rentalLabel }, q)) : all;

  const clients = new Map<string, string>();
  for (const c of clientRows) {
    const cl = c.client ?? c.rental?.client;
    if (cl) clients.set(cl.id, cl.name);
  }
  return {
    total: hits.length,
    items: hits.slice(offset, offset + limit),
    clients: [...clients].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "pl")),
  };
}
