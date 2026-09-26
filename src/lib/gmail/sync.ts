import { prisma } from "@/lib/prisma";
import { logInfo, logWarn } from "@/lib/logger";
import { GmailError, getMessageMeta, getProfile, listHistoryAdded, listMessageIds } from "@/lib/integrations/gmail-read";
import { buildAddressIndex, classifyEmail, headerMap, historyQuery, isAutomated, isSkippedByLabels, parseAddresses, type AddressIndex } from "@/lib/gmail/parse";

// Synchronizacja historii e-maili z Gmaila (CRM, prompt 3C).
// - Import historii: dla każdego adresu osoby kontaktowej klienta wszystkie
//   wiadomości „od/do/DW” (bez limitu dat), partiami; nowe adresy (nowy
//   klient, zmieniony e-mail) doimportowują się same przy kolejnym przebiegu.
// - Bieżąca: users.history od zapisanego historyId (cron co 5 min).
// Zapisujemy wyłącznie metadane + skrót Gmaila; treść nie trafia do bazy ani
// logów (w logach tylko liczby). Wyłącznik: Setting `gmail_sync_enabled`.

const KEY_ENABLED = "gmail_sync_enabled";
const KEY_MAILBOXES = "gmail_mailboxes";
const stateKey = (mailbox: string) => `gmail_state:${mailbox}`;

type MailboxState = { historyId: string | null; importedAddresses: string[]; lastSyncAt: string | null; lastError: string | null };
const EMPTY_STATE: MailboxState = { historyId: null, importedAddresses: [], lastSyncAt: null, lastError: null };

async function getSetting(key: string): Promise<string | null> {
  return (await prisma.setting.findUnique({ where: { key } }))?.value ?? null;
}
async function putSetting(key: string, value: string) {
  await prisma.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export function defaultMailbox(): string | null {
  return process.env.GOOGLE_IMPERSONATED_USER?.trim().toLowerCase() || null;
}
export function workspaceDomain(): string | null {
  const m = defaultMailbox();
  return m ? m.slice(m.indexOf("@") + 1) : null;
}

export async function getMailboxes(): Promise<string[]> {
  const raw = await getSetting(KEY_MAILBOXES);
  const list = raw ? (JSON.parse(raw) as string[]) : [];
  const def = defaultMailbox();
  return list.length ? list : def ? [def] : [];
}

async function getState(mailbox: string): Promise<MailboxState> {
  const raw = await getSetting(stateKey(mailbox));
  return raw ? { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<MailboxState>) } : { ...EMPTY_STATE };
}
async function putState(mailbox: string, s: MailboxState) {
  await putSetting(stateKey(mailbox), JSON.stringify(s));
}

export async function isGmailSyncEnabled(): Promise<boolean> {
  return (await getSetting(KEY_ENABLED)) === "1";
}

async function loadIndex(): Promise<AddressIndex> {
  const contacts = await prisma.clientContact.findMany({ where: { email: { not: null } }, select: { id: true, clientId: true, email: true } });
  return buildAddressIndex(contacts.map((c) => ({ clientId: c.clientId, contactId: c.id, email: c.email })));
}

function ownMatcher(mailboxes: string[]) {
  const domain = workspaceDomain();
  const set = new Set(mailboxes);
  return (a: string) => set.has(a) || (domain != null && a.endsWith(`@${domain}`));
}

// Pobiera metadane nowych (nieznanych) wiadomości i zapisuje te, które
// dotyczą klientów. Zwraca liczbę zapisanych.
async function processIds(mailbox: string, ids: string[], index: AddressIndex, isOwn: (a: string) => boolean, deadline: number): Promise<{ stored: number; done: boolean }> {
  const known = new Set(
    (await prisma.emailMessage.findMany({ where: { mailbox, gmailMessageId: { in: ids } }, select: { gmailMessageId: true } })).map((m) => m.gmailMessageId),
  );
  const todo = ids.filter((id) => !known.has(id));
  let stored = 0;
  for (let i = 0; i < todo.length; i += 5) {
    if (Date.now() > deadline) return { stored, done: false };
    const metas = await Promise.all(todo.slice(i, i + 5).map((id) => getMessageMeta(mailbox, id)));
    const rows = [];
    for (const m of metas) {
      if (isSkippedByLabels(m.labelIds)) continue;
      const h = headerMap(m.headers);
      if (isAutomated(h)) continue;
      const from = parseAddresses(h["from"]);
      const to = parseAddresses(h["to"]);
      const cc = parseAddresses(h["cc"]);
      const c = classifyEmail({ from, to, cc }, index, isOwn);
      if (!c) continue;
      const sentAt = new Date(m.internalDate);
      const subject = h["subject"]?.slice(0, 1000) ?? null;
      const rfcMessageId = h["message-id"]?.slice(0, 500) ?? null;
      // Ta sama wiadomość z innej podłączonej skrzynki — już jest.
      if (rfcMessageId && (await prisma.emailMessage.count({ where: { rfcMessageId, mailbox: { not: mailbox } } }))) continue;
      // Wiadomość wysłana przez panel (Message) — nie dublujemy (±2 min).
      if (c.direction === "OUT" && subject) {
        const dup = await prisma.message.count({
          where: { channel: "EMAIL", recipient: c.counterpart, subject, sentAt: { gte: new Date(sentAt.getTime() - 120_000), lte: new Date(sentAt.getTime() + 120_000) } },
        });
        if (dup) continue;
      }
      rows.push({
        mailbox,
        gmailMessageId: m.id,
        gmailThreadId: m.threadId,
        rfcMessageId,
        direction: c.direction,
        fromAddress: from[0] ?? "",
        toAddresses: to,
        ccAddresses: cc.length ? cc : undefined,
        subject,
        snippet: m.snippet.slice(0, 300),
        hasAttachments: m.hasAttachments,
        sentAt,
        clientId: c.clientId,
        clientContactId: c.clientContactId,
        matchMethod: c.matchMethod,
      });
    }
    if (rows.length) stored += (await prisma.emailMessage.createMany({ data: rows, skipDuplicates: true })).count;
  }
  return { stored, done: true };
}

async function incremental(mailbox: string, state: MailboxState, index: AddressIndex, isOwn: (a: string) => boolean, deadline: number) {
  if (!state.historyId) {
    // Pierwszy przebieg: bieżąca synchronizacja startuje „od teraz”, a
    // przeszłość nadrabia import historii po adresach.
    state.historyId = (await getProfile(mailbox)).historyId;
    return 0;
  }
  let stored = 0;
  try {
    let pageToken: string | undefined;
    let latest = state.historyId;
    do {
      const r = await listHistoryAdded(mailbox, state.historyId, pageToken);
      const res = await processIds(mailbox, r.ids, index, isOwn, deadline);
      stored += res.stored;
      if (!res.done) return stored; // dokończy następny przebieg od tego samego historyId
      if (r.historyId) latest = r.historyId;
      pageToken = r.nextPageToken ?? undefined;
    } while (pageToken);
    state.historyId = latest;
  } catch (err) {
    if (!(err instanceof GmailError && err.status === 404)) throw err;
    // historyId za stary (dłuższa przerwa) — nadrabiamy ostatni tydzień.
    logWarn("gmail_history_expired", { mailbox });
    const { ids } = await listMessageIds(mailbox, "newer_than:8d -in:chats -in:drafts");
    stored += (await processIds(mailbox, ids, index, isOwn, deadline)).stored;
    state.historyId = (await getProfile(mailbox)).historyId;
  }
  return stored;
}

const ADDRESSES_PER_QUERY = 10;

async function importHistory(mailbox: string, state: MailboxState, index: AddressIndex, isOwn: (a: string) => boolean, deadline: number) {
  const imported = new Set(state.importedAddresses);
  const pending = [...index.byEmail.keys()].filter((a) => !imported.has(a) && !isOwn(a)).sort();
  let stored = 0;
  for (let i = 0; i < pending.length; i += ADDRESSES_PER_QUERY) {
    if (Date.now() > deadline) break;
    const chunk = pending.slice(i, i + ADDRESSES_PER_QUERY);
    let pageToken: string | undefined;
    let complete = true;
    do {
      const r = await listMessageIds(mailbox, historyQuery(chunk), pageToken);
      const res = await processIds(mailbox, r.ids, index, isOwn, deadline);
      stored += res.stored;
      if (!res.done) {
        complete = false;
        break;
      }
      pageToken = r.nextPageToken ?? undefined;
    } while (pageToken);
    if (!complete) break;
    for (const a of chunk) imported.add(a);
    state.importedAddresses = [...imported];
    await putState(mailbox, state);
  }
  const left = [...index.byEmail.keys()].filter((a) => !imported.has(a) && !isOwn(a)).length;
  return { stored, pendingAddresses: left };
}

export type GmailSyncResult = { mailbox: string; newMessages: number; historyStored: number; pendingAddresses: number; error: string | null }[];

// Jeden przebieg dla wszystkich skrzynek, w limicie czasu (hosting ma limity
// czasu zapytania) — nieskończony import dokończą kolejne przebiegi.
export async function runGmailSync(opts: { budgetMs?: number; force?: boolean } = {}): Promise<GmailSyncResult | null> {
  if (!opts.force && !(await isGmailSyncEnabled())) return null;
  const deadline = Date.now() + (opts.budgetMs ?? 25_000);
  const mailboxes = await getMailboxes();
  const isOwn = ownMatcher(mailboxes);
  const index = await loadIndex();
  const out: GmailSyncResult = [];
  for (const mailbox of mailboxes) {
    const state = await getState(mailbox);
    try {
      const newMessages = await incremental(mailbox, state, index, isOwn, deadline);
      const h = await importHistory(mailbox, state, index, isOwn, deadline);
      state.lastSyncAt = new Date().toISOString();
      state.lastError = null;
      await putState(mailbox, state);
      out.push({ mailbox, newMessages, historyStored: h.stored, pendingAddresses: h.pendingAddresses, error: null });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.lastError = message;
      await putState(mailbox, state);
      out.push({ mailbox, newMessages: 0, historyStored: 0, pendingAddresses: -1, error: message });
    }
  }
  const total = out.reduce((s, r) => s + r.newMessages + r.historyStored, 0);
  if (total) logInfo("gmail_sync_stored", { messages: total, mailboxes: out.length });
  return out;
}

export type GmailStatus = {
  enabled: boolean;
  defaultMailbox: string | null;
  domain: string | null;
  totalAddresses: number;
  mailboxes: { mailbox: string; importedAddresses: number; stored: number; lastSyncAt: string | null; lastError: string | null }[];
};

export async function getGmailStatus(): Promise<GmailStatus> {
  const [enabled, mailboxes, index] = await Promise.all([isGmailSyncEnabled(), getMailboxes(), loadIndex()]);
  const isOwn = ownMatcher(mailboxes);
  const addresses = [...index.byEmail.keys()].filter((a) => !isOwn(a));
  const rows = await Promise.all(
    mailboxes.map(async (mailbox) => {
      const s = await getState(mailbox);
      const imported = new Set(s.importedAddresses);
      return {
        mailbox,
        importedAddresses: addresses.filter((a) => imported.has(a)).length,
        stored: await prisma.emailMessage.count({ where: { mailbox } }),
        lastSyncAt: s.lastSyncAt,
        lastError: s.lastError,
      };
    }),
  );
  return { enabled, defaultMailbox: defaultMailbox(), domain: workspaceDomain(), totalAddresses: addresses.length, mailboxes: rows };
}

export async function setGmailSyncEnabled(on: boolean) {
  await putSetting(KEY_ENABLED, on ? "1" : "0");
}

// Dodanie skrzynki = świadoma decyzja ADMINA (prompt 3, 4.2): tylko z domeny
// Workspace; wywołujący wymaga potwierdzenia w UI.
export async function addMailbox(email: string): Promise<string | null> {
  const m = email.trim().toLowerCase();
  const domain = workspaceDomain();
  if (!domain || !m.endsWith(`@${domain}`)) return `Można dodać tylko skrzynkę z domeny ${domain ?? "firmy"}.`;
  const list = await getMailboxes();
  if (list.includes(m)) return "Ta skrzynka jest już podłączona.";
  try {
    await getProfile(m);
  } catch (err) {
    return `Nie udało się otworzyć skrzynki: ${err instanceof Error ? err.message : String(err)}`;
  }
  await putSetting(KEY_MAILBOXES, JSON.stringify([...list, m]));
  return null;
}

// Odłączenie skrzynki usuwa też zapisane z niej metadane — biuro przestaje je widzieć.
export async function removeMailbox(email: string): Promise<string | null> {
  const m = email.trim().toLowerCase();
  const list = await getMailboxes();
  if (!list.includes(m)) return "Ta skrzynka nie jest podłączona.";
  if (list.length === 1) return "Musi zostać co najmniej jedna skrzynka — wyłącz synchronizację zamiast odłączać ostatnią.";
  await putSetting(KEY_MAILBOXES, JSON.stringify(list.filter((x) => x !== m)));
  await prisma.emailMessage.deleteMany({ where: { mailbox: m } });
  await prisma.setting.deleteMany({ where: { key: stateKey(m) } });
  return null;
}
