import { prisma } from "@/lib/prisma";
import { GmailDraftGone, saveGmailDraft } from "@/lib/integrations/gmail";
import { recordChanges } from "@/lib/changelog/record";
import { logError } from "@/lib/logger";
import { AUTO_MAIL_FROM, buildMimeMessage, renderDraftMail } from "@/lib/leads/auto-mail-render";
import { AUTO_MAIL_FROM_NAME_KEY, FOOTER_TEMPLATE_KEY } from "@/lib/leads/auto-mail";
import {
  DRAFT_ACTIVE,
  DRAFT_LIMITS,
  findSentDraft,
  gmailDraftUrl,
  isDraftStale,
  replySubject,
  validateDraft,
  type DraftStatus,
} from "@/lib/leads/mail-draft-rules";

// Szkic maila przy sygnale (wniosek 44, 08.10.2026): agent (MCP) albo biuro
// przygotowuje odpowiedź w panelu, biuro ją poprawia i zapisuje jako szkic w
// Gmailu (kontakt@). Panel NIE wysyła maila — wysyła człowiek w Gmailu; gdy
// wysłana wiadomość pojawi się w wątku (synchronizacja), szkic dostaje status
// „wysłany”. Jeden sygnał = jeden aktywny szkic. Treść maila nie trafia do
// dziennika zmian (tylko temat), zgodnie z zasadą „treści maili nie logujemy”.

export class DraftError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export type DraftActor = { kind: "AGENT" | "USER"; userId: string };

export type MailDraftDto = {
  id: string;
  status: DraftStatus;
  authorKind: "AGENT" | "USER";
  authorName: string | null;
  editedByUser: boolean;
  toAddress: string;
  subject: string;
  bodyText: string;
  note: string | null;
  replyTo: { id: string; subject: string | null; sentAt: string } | null;
  gmailUrl: string | null;
  // Treść zmieniona po ostatnim zapisie do Gmaila.
  stale: boolean;
  gmailSavedAt: string | null;
  sentAt: string | null;
  updatedAt: string;
};

export type DraftPatch = { to?: string; subject?: string; bodyText?: string; note?: string | null; replyToEmailId?: string | null };

async function toDto(d: NonNullable<Awaited<ReturnType<typeof findDraft>>>): Promise<MailDraftDto> {
  const [author, reply] = await Promise.all([
    d.authorId ? prisma.user.findUnique({ where: { id: d.authorId }, select: { name: true } }) : null,
    d.replyToEmailId ? prisma.emailMessage.findUnique({ where: { id: d.replyToEmailId }, select: { id: true, subject: true, sentAt: true } }) : null,
  ]);
  return {
    id: d.id,
    status: d.status as DraftStatus,
    authorKind: d.authorKind as "AGENT" | "USER",
    authorName: author?.name ?? null,
    editedByUser: d.editedByUser,
    toAddress: d.toAddress,
    subject: d.subject,
    bodyText: d.bodyText,
    note: d.note,
    replyTo: reply ? { id: reply.id, subject: reply.subject, sentAt: reply.sentAt.toISOString() } : null,
    gmailUrl: d.gmailMessageId ? gmailDraftUrl(AUTO_MAIL_FROM, d.gmailMessageId) : null,
    stale: d.status === "SZKIC_GMAIL" && isDraftStale(d.contentUpdatedAt, d.gmailSavedAt),
    gmailSavedAt: d.gmailSavedAt?.toISOString() ?? null,
    sentAt: d.sentAt?.toISOString() ?? null,
    updatedAt: d.updatedAt.toISOString(),
  };
}

// Aktywny szkic sygnału (propozycja albo zapisany w Gmailu).
async function findActive(leadId: string) {
  return prisma.leadEmailDraft.findFirst({ where: { leadId, status: { in: [...DRAFT_ACTIVE] } }, orderBy: { createdAt: "desc" } });
}
// Do karty: aktywny, a gdy go nie ma — ostatni wysłany (widać, że odpowiedź poszła).
async function findDraft(leadId: string) {
  return (await findActive(leadId)) ?? prisma.leadEmailDraft.findFirst({ where: { leadId, status: "WYSLANY" }, orderBy: { sentAt: "desc" } });
}

export async function loadMailDraft(leadId: string): Promise<MailDraftDto | null> {
  const d = await findDraft(leadId);
  return d ? toDto(d) : null;
}

async function activity(leadId: string, clientId: string | null, body: string, userId: string | null) {
  await prisma.leadActivity.create({ data: { leadId, clientId, type: "SYSTEM", body, ...(userId ? { userId } : {}) } });
}

const clip = (v: string | null | undefined, max: number) => (v == null ? v : v.slice(0, max));

// Tworzy szkic albo aktualizuje aktywny. Agent nie nadpisze szkicu, który biuro
// już poprawiło (editedByUser), bez opts.overwrite.
export async function upsertMailDraft(leadId: string, actor: DraftActor, patch: DraftPatch, opts: { overwrite?: boolean; complete?: boolean } = {}): Promise<MailDraftDto> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, clientId: true, contactEmail: true, client: { select: { contacts: { where: { isPrimary: true }, take: 1, select: { email: true } } } } },
  });
  if (!lead) throw new DraftError("Sygnał nie istnieje.", 404);
  const existing = await findActive(leadId);
  const to = patch.to?.trim();
  const subject = patch.subject !== undefined ? clip(patch.subject.trim(), DRAFT_LIMITS.subject)! : undefined;
  const bodyText = patch.bodyText !== undefined ? clip(patch.bodyText.replace(/\r\n/g, "\n"), DRAFT_LIMITS.body)! : undefined;
  const note = patch.note !== undefined ? clip(patch.note?.trim() || null, DRAFT_LIMITS.note) : undefined;

  if (existing) {
    if (actor.kind === "AGENT" && existing.editedByUser && !opts.overwrite) {
      throw new DraftError("Biuro już poprawiło ten szkic. Podaj nadpisz=true, jeśli ma go zastąpić nowa propozycja.", 409);
    }
    const contentChanged =
      (to !== undefined && to !== existing.toAddress) ||
      (subject !== undefined && subject !== existing.subject) ||
      (bodyText !== undefined && bodyText !== existing.bodyText) ||
      (patch.replyToEmailId !== undefined && patch.replyToEmailId !== existing.replyToEmailId);
    await prisma.leadEmailDraft.update({
      where: { id: existing.id },
      data: {
        ...(to !== undefined ? { toAddress: to } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(bodyText !== undefined ? { bodyText } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(patch.replyToEmailId !== undefined ? { replyToEmailId: patch.replyToEmailId } : {}),
        ...(contentChanged ? { contentUpdatedAt: new Date() } : {}),
        // Agent zastępujący szkic nie jest „poprawką biura”; edycja człowieka tak.
        editedByUser: actor.kind === "USER" ? (contentChanged ? true : existing.editedByUser) : opts.overwrite ? false : existing.editedByUser,
        ...(actor.kind === "AGENT" ? { authorKind: "AGENT", authorId: actor.userId } : {}),
      },
    });
    if (actor.kind === "AGENT" && contentChanged) await activity(leadId, lead.clientId, "Szkic odpowiedzi zaktualizowany przez agenta", actor.userId);
  } else {
    // Domyślnie odpowiadamy w wątku ostatniej wiadomości od klientki (30 dni).
    let replyToEmailId = patch.replyToEmailId;
    if (replyToEmailId === undefined && lead.clientId) {
      const last = await prisma.emailMessage.findFirst({
        where: { clientId: lead.clientId, direction: "IN", hiddenReason: null, sentAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        orderBy: { sentAt: "desc" },
        select: { id: true, subject: true },
      });
      replyToEmailId = last?.id ?? null;
      if (last && subject === undefined) patch = { ...patch, subject: replySubject(last.subject) };
    }
    const finalTo = to ?? lead.contactEmail ?? lead.client?.contacts[0]?.email ?? "";
    const finalSubject = subject ?? clip((patch.subject ?? "").trim(), DRAFT_LIMITS.subject) ?? "";
    const finalBody = bodyText ?? "";
    if (opts.complete) {
      const err = validateDraft({ to: finalTo, subject: finalSubject, bodyText: finalBody });
      if (err) throw new DraftError(err);
    }
    await prisma.leadEmailDraft.create({
      data: {
        leadId,
        clientId: lead.clientId,
        status: "PROPOZYCJA",
        authorKind: actor.kind,
        authorId: actor.userId,
        editedByUser: false,
        toAddress: finalTo,
        subject: finalSubject,
        bodyText: finalBody,
        note: note ?? null,
        replyToEmailId: replyToEmailId ?? null,
      },
    });
    await activity(leadId, lead.clientId, actor.kind === "AGENT" ? "Szkic odpowiedzi przygotowany przez agenta" : "Szkic odpowiedzi rozpoczęty", actor.userId);
    await recordChanges(prisma, { userId: actor.userId }, [{ entity: "LEAD", entityId: leadId, clientId: lead.clientId, operation: "CREATE", field: "szkic_maila", after: finalSubject || "(bez tematu)" }]);
  }
  const fresh = await findActive(leadId);
  return toDto(fresh!);
}

export async function discardMailDraft(leadId: string, actor: DraftActor): Promise<void> {
  const d = await findActive(leadId);
  if (!d) throw new DraftError("Brak aktywnego szkicu.", 404);
  await prisma.leadEmailDraft.update({ where: { id: d.id }, data: { status: "ODRZUCONY" } });
  await activity(leadId, d.clientId, `Szkic odpowiedzi odrzucony${d.gmailDraftId ? " (w Gmailu może zostać szkic — usuń go ręcznie)" : ""}`, actor.userId);
  await recordChanges(prisma, { userId: actor.userId }, [{ entity: "LEAD", entityId: leadId, clientId: d.clientId, operation: "STATUS_CHANGE", field: "szkic_maila", before: d.status, after: "ODRZUCONY" }]);
}

// Zapis (albo aktualizacja) szkicu w Gmailu, jako odpowiedź w wątku, gdy
// wskazano wiadomość klientki. Ponowne kliknięcie aktualizuje ten sam szkic.
export async function saveMailDraftToGmail(leadId: string, actor: DraftActor): Promise<MailDraftDto> {
  const d = await findActive(leadId);
  if (!d) throw new DraftError("Brak szkicu do zapisania.", 404);
  const err = validateDraft({ to: d.toAddress, subject: d.subject, bodyText: d.bodyText });
  if (err) throw new DraftError(err);
  const [footerRow, fromRow, reply] = await Promise.all([
    prisma.messageTemplate.findUnique({ where: { key: FOOTER_TEMPLATE_KEY } }),
    prisma.setting.findUnique({ where: { key: AUTO_MAIL_FROM_NAME_KEY } }),
    d.replyToEmailId ? prisma.emailMessage.findUnique({ where: { id: d.replyToEmailId }, select: { rfcMessageId: true, gmailThreadId: true } }) : null,
  ]);
  const { html, text } = renderDraftMail(d.bodyText, footerRow?.body);
  const raw = buildMimeMessage({
    from: AUTO_MAIL_FROM,
    fromName: fromRow?.value || "wynajemlasera.pl",
    to: d.toAddress.trim(),
    subject: d.subject.trim(),
    html,
    text,
    attachments: [],
    inReplyTo: reply?.rfcMessageId ?? null,
  });
  let saved;
  try {
    saved = await saveGmailDraft({ mailbox: AUTO_MAIL_FROM, draftId: d.gmailDraftId, threadId: reply?.gmailThreadId ?? d.gmailThreadId, raw });
  } catch (e) {
    if (e instanceof GmailDraftGone) {
      await prisma.leadEmailDraft.update({ where: { id: d.id }, data: { gmailDraftId: null } });
      throw new DraftError("Szkic zniknął z Gmaila (wysłany albo usunięty). Jeśli go wysłano, status zmieni się po synchronizacji poczty; w przeciwnym razie kliknij „Zapisz szkic w Gmailu” jeszcze raz, żeby utworzyć nowy.", 409);
    }
    logError("mail_draft_gmail_failed", e, { leadId });
    throw new DraftError(`Nie udało się zapisać szkicu w Gmailu: ${e instanceof Error ? e.message : "błąd"}`, 502);
  }
  const first = !d.gmailDraftId;
  await prisma.leadEmailDraft.update({
    where: { id: d.id },
    data: { status: "SZKIC_GMAIL", gmailDraftId: saved.draftId, gmailThreadId: saved.threadId || d.gmailThreadId, gmailMessageId: saved.messageId, gmailSavedAt: new Date() },
  });
  await activity(leadId, d.clientId, `Szkic odpowiedzi ${first ? "zapisany" : "zaktualizowany"} w Gmailu: ${d.subject}`, actor.userId);
  return (await loadMailDraft(leadId))!;
}

// Synchronizacja Gmaila: wysłana przez nas wiadomość w wątku szkicu zapisanego
// w Gmailu → szkic „wysłany” (wpis w osi czasu). Nie rzuca wyjątków.
export async function markDraftsSent(rows: { direction: string; gmailThreadId: string; gmailMessageId: string; sentAt: Date; subject?: string | null }[]): Promise<number> {
  try {
    const out = rows.filter((r) => r.direction === "OUT" && r.gmailThreadId);
    if (!out.length) return 0;
    const drafts = await prisma.leadEmailDraft.findMany({ where: { status: "SZKIC_GMAIL", gmailThreadId: { in: [...new Set(out.map((r) => r.gmailThreadId))] } } });
    let n = 0;
    for (const m of out.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())) {
      const d = findSentDraft(drafts.filter((x) => x.status === "SZKIC_GMAIL"), { threadId: m.gmailThreadId, sentAt: m.sentAt });
      if (!d) continue;
      d.status = "WYSLANY";
      await prisma.leadEmailDraft.update({ where: { id: d.id }, data: { status: "WYSLANY", sentAt: m.sentAt, gmailMessageId: m.gmailMessageId } });
      await activity(d.leadId, d.clientId, `Wysłano odpowiedź ze szkicu: ${d.subject}`, null);
      n++;
    }
    return n;
  } catch (err) {
    logError("mail_draft_sent_scan_failed", err);
    return 0;
  }
}

// Sygnały z aktywnym szkicem (ikona na Tablicy): id → status.
export async function activeDraftStatuses(leadIds: string[]): Promise<Map<string, "PROPOZYCJA" | "SZKIC_GMAIL">> {
  if (!leadIds.length) return new Map();
  const rows = await prisma.leadEmailDraft.findMany({ where: { leadId: { in: leadIds }, status: { in: [...DRAFT_ACTIVE] } }, select: { leadId: true, status: true } });
  return new Map(rows.map((r) => [r.leadId, r.status as "PROPOZYCJA" | "SZKIC_GMAIL"]));
}
