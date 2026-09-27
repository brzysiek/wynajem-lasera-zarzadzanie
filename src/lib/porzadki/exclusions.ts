import { prisma } from "@/lib/prisma";
import { parseAddresses, FREE_EMAIL_DOMAINS } from "@/lib/gmail/parse";
import { getMailboxes, workspaceDomain } from "@/lib/gmail/sync";
import { emailHideReason, parseExclusionList, suggestExclusionDomains, type ExclusionKind } from "@/lib/porzadki/exclusion-rules";
import { HIDE_KEYWORDS_KEY, getHideKeywords, invalidateExclusions, loadExclusionMatcher } from "@/lib/porzadki/exclusion-load";

// Lista wykluczeń domen i adresów (wniosek 7): zapis, dopasowanie
// i ponowne zastosowanie reguł do zapisanych maili.

export async function listExclusions() {
  const rows = await prisma.emailExclusion.findMany({ orderBy: [{ kind: "asc" }, { value: "asc" }] });
  return rows.map((r) => ({ id: r.id, kind: r.kind as ExclusionKind, value: r.value, note: r.note, createdAt: r.createdAt.toISOString() }));
}

export async function addExclusions(text: string, kind: ExclusionKind, note: string | null, userId: string | null) {
  const { values, errors } = parseExclusionList(text);
  let added = 0;
  for (const value of values) {
    const r = await prisma.emailExclusion.upsert({ where: { value }, create: { value, kind, note, createdById: userId }, update: {} });
    if (r.createdById === userId && r.kind === kind) added++;
  }
  invalidateExclusions();
  const applied = await reapplyEmailRules();
  return { added, values, errors, applied };
}

export async function removeExclusion(id: string) {
  await prisma.emailExclusion.deleteMany({ where: { id } });
  invalidateExclusions();
  return reapplyEmailRules();
}

export async function setHideKeywords(text: string) {
  await prisma.setting.upsert({ where: { key: HIDE_KEYWORDS_KEY }, create: { key: HIDE_KEYWORDS_KEY, value: text }, update: { value: text } });
  return reapplyEmailRules();
}

export async function ownAddressMatcher(): Promise<(a: string) => boolean> {
  const mailboxes = new Set(await getMailboxes());
  const domain = workspaceDomain();
  return (a) => mailboxes.has(a) || (domain != null && a.endsWith(`@${domain}`));
}

// Po zmianie listy albo słów kluczowych: przelicza ukrycie zapisanych maili
// (bez ręcznych decyzji MANUAL / SHOWN). Niczego nie usuwa.
export async function reapplyEmailRules(): Promise<{ hidden: number; shown: number }> {
  const [match, keywords, isOwn] = await Promise.all([loadExclusionMatcher(), getHideKeywords(), ownAddressMatcher()]);
  let hidden = 0;
  let shown = 0;
  let cursor: string | undefined;
  for (;;) {
    const rows = await prisma.emailMessage.findMany({
      where: { OR: [{ hiddenReason: null }, { hiddenReason: { in: ["EXCLUDED", "ENGINEERING"] } }] },
      orderBy: { id: "asc" },
      take: 500,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, fromAddress: true, toAddresses: true, ccAddresses: true, subject: true, snippet: true, hiddenReason: true },
    });
    if (!rows.length) break;
    cursor = rows[rows.length - 1].id;
    for (const r of rows) {
      const reason = emailHideReason(
        {
          from: parseAddresses(r.fromAddress),
          to: Array.isArray(r.toAddresses) ? (r.toAddresses as string[]) : [],
          cc: Array.isArray(r.ccAddresses) ? (r.ccAddresses as string[]) : [],
          subject: r.subject,
          snippet: r.snippet,
        },
        match,
        isOwn,
        keywords,
      );
      if (reason === r.hiddenReason) continue;
      await prisma.emailMessage.update({ where: { id: r.id }, data: { hiddenReason: reason } });
      if (reason) hidden++;
      else shown++;
    }
    if (rows.length < 500) break;
  }
  return { hidden, shown };
}

// Ręczne „ukryj wątek w historii klienta” / „pokaż” (cały wątek).
export async function setThreadHidden(messageId: string, hidden: boolean, userId: string): Promise<number> {
  const m = await prisma.emailMessage.findUnique({ where: { id: messageId }, select: { mailbox: true, gmailThreadId: true } });
  if (!m) return 0;
  const r = await prisma.emailMessage.updateMany({
    where: { mailbox: m.mailbox, gmailThreadId: m.gmailThreadId },
    data: { hiddenReason: hidden ? "MANUAL" : "SHOWN", hiddenById: userId },
  });
  return r.count;
}

// Po archiwizacji z powodem „spoza branży”: domeny osób do dodania na listę.
export async function suggestDomainsForClients(clientIds: string[]): Promise<string[]> {
  const contacts = await prisma.clientContact.findMany({ where: { clientId: { in: clientIds } }, select: { email: true } });
  return suggestExclusionDomains(
    contacts.map((c) => c.email),
    FREE_EMAIL_DOMAINS,
    await loadExclusionMatcher(),
  );
}
