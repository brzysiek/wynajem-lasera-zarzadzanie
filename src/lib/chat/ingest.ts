import { prisma } from "@/lib/prisma";
import { createLead } from "@/lib/leads/actions";
import { stageSet, stepSet } from "@/lib/leads/set-source";
import { interestsFromText } from "@/lib/history/invoices";
import type { DeviceInterestKey } from "@/lib/clients/labels";
import { logError, logInfo } from "@/lib/logger";
import { extractContactKeys, fallbackChatName, type MetaEvent } from "./meta-rules";
import { planInbound, planOutbound, type ChatPlan } from "./chat-plan";
import { suggestMergesForLead } from "./merge";

// Messenger i Instagram Direct → panel (wniosek 42, faza 1: bez wysyłania).
// Zapis wiadomości jest idempotentny (mid). Nowa rozmowa bez otwartego sygnału
// zakłada sygnał „Nowe”; nasza odpowiedź (echo) przesuwa go do „W kontakcie”.
// Łączenie z klientem: telefon / e-mail z rozmowy = twardy klucz (automat);
// samo imię i nazwisko = tylko propozycja (merge.ts).

const OPEN = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"] as const;
const GRAPH = "https://graph.facebook.com/v21.0";

// Imię klientki z Graph API (opcjonalne: wymaga META_PAGE_ACCESS_TOKEN). Błąd
// albo brak tokenu → null, rozmowa i tak się zapisze.
async function fetchProfileName(channel: MetaEvent["channel"], userId: string): Promise<string | null> {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  try {
    const fields = channel === "INSTAGRAM" ? "name,username" : "name";
    const res = await fetch(`${GRAPH}/${encodeURIComponent(userId)}?fields=${fields}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: string; username?: string };
    return j.name?.trim() || j.username?.trim() || null;
  } catch {
    return null;
  }
}

const noTraining = (d: DeviceInterestKey[]) => d.filter((x) => x !== "SZKOLENIE");

async function applyPlan(leadId: string, clientId: string | null, plan: NonNullable<ChatPlan>) {
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      ...(plan.firstContactAt ? { firstContactAt: plan.firstContactAt } : {}),
      ...(plan.lastContactAt ? { lastContactAt: plan.lastContactAt } : {}),
      ...(plan.stage ? { stage: plan.stage, stageChangedAt: new Date(), ...stageSet("AUTO_CHAT", null) } : {}),
      ...(plan.clearReturn ? { returnAt: null, postponeReason: null } : {}),
      ...(plan.nextActionAt ? { nextActionAt: plan.nextActionAt, nextStepType: plan.nextStepType, nextStepNote: plan.nextStepNote, attempts: 0, ...stepSet("AUTO_CHAT", null) } : {}),
    },
  });
  if (plan.activity) {
    await prisma.leadActivity.create({ data: { leadId, clientId, type: plan.stage ? "STAGE_CHANGE" : "SYSTEM", body: plan.activity } });
  }
}

// Telefon / e-mail podany w rozmowie: uzupełnia dane sygnału, a gdy pasuje do
// klientki z bazy (inne konto niż założone automatycznie) — dopina sygnał do niej.
async function applyHardKeys(thread: { id: string }, lead: { id: string; clientId: string | null; contactPhone: string | null; contactEmail: string | null }, keys: { phone: string | null; email: string | null }) {
  if (!keys.phone && !keys.email) return;
  const found = await prisma.clientContact.findFirst({
    where: { OR: [...(keys.phone ? [{ phone: keys.phone }, { phone2: keys.phone }] : []), ...(keys.email ? [{ email: keys.email }] : [])] },
    select: { id: true, clientId: true },
  });
  const data: Record<string, unknown> = {};
  if (keys.phone && !lead.contactPhone) data.contactPhone = keys.phone;
  if (keys.email && !lead.contactEmail) data.contactEmail = keys.email;
  let note: string | null = null;
  if (found && found.clientId !== lead.clientId) {
    data.client = { connect: { id: found.clientId } };
    data.clientContact = { connect: { id: found.id } };
    note = `Dopięto do klienta z bazy po ${keys.phone ? "telefonie" : "e-mailu"} podanym w rozmowie`;
  }
  if (!Object.keys(data).length) return;
  await prisma.lead.update({ where: { id: lead.id }, data });
  if (found && found.clientId !== lead.clientId) await prisma.chatThread.update({ where: { id: thread.id }, data: { clientId: found.clientId } });
  await prisma.leadActivity.create({ data: { leadId: lead.id, clientId: found?.clientId ?? lead.clientId, type: "SYSTEM", body: note ?? `Z rozmowy: ${[keys.phone, keys.email].filter(Boolean).join(", ")}` } });
}

export async function ingestMetaEvents(events: MetaEvent[]): Promise<{ stored: number; duplicates: number; leads: number }> {
  const out = { stored: 0, duplicates: 0, leads: 0 };
  for (const ev of [...events].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (await prisma.chatMessage.findUnique({ where: { mid: ev.mid }, select: { id: true } })) {
      out.duplicates++;
      continue;
    }
    let thread = await prisma.chatThread.findUnique({ where: { channel_externalUserId: { channel: ev.channel, externalUserId: ev.userId } } });
    if (!thread) {
      const name = await fetchProfileName(ev.channel, ev.userId);
      thread = await prisma.chatThread.create({ data: { channel: ev.channel, externalUserId: ev.userId, pageId: ev.pageId || null, displayName: name } });
    } else if (!thread.displayName) {
      const name = await fetchProfileName(ev.channel, ev.userId);
      if (name) thread = await prisma.chatThread.update({ where: { id: thread.id }, data: { displayName: name } });
    }
    try {
      await prisma.chatMessage.create({
        data: { threadId: thread.id, mid: ev.mid, direction: ev.outbound ? "OUT" : "IN", text: ev.text, attachments: ev.attachments.length ? ev.attachments : undefined, sentAt: ev.at },
      });
    } catch (err) {
      // Równoległe ponowienie tej samej wiadomości (unikalny mid) — pomijamy.
      logInfo("chat_message_duplicate", { mid: ev.mid, err: err instanceof Error ? err.message : String(err) });
      out.duplicates++;
      continue;
    }
    out.stored++;
    const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
    await prisma.chatThread.update({
      where: { id: thread.id },
      data: ev.outbound ? { lastOutboundAt: later(thread.lastOutboundAt, ev.at) } : { lastInboundAt: later(thread.lastInboundAt, ev.at) },
    });

    const open = thread.leadId
      ? await prisma.lead.findFirst({
          where: { id: thread.leadId, archivedAt: null, stage: { in: [...OPEN] } },
          select: { id: true, clientId: true, stage: true, firstContactAt: true, lastContactAt: true, nextActionAt: true, contactPhone: true, contactEmail: true },
        })
      : null;

    if (ev.outbound) {
      if (open) {
        const plan = planOutbound(open, ev.at, ev.channel);
        if (plan) await applyPlan(open.id, open.clientId, plan);
      }
      continue;
    }

    const keys = extractContactKeys(ev.text);
    if (open) {
      await applyHardKeys(thread, open, keys);
      const plan = planInbound(open, new Date(), ev.channel);
      if (plan) await applyPlan(open.id, open.clientId, plan);
      continue;
    }

    // Nowa rozmowa (albo poprzedni sygnał zamknięty / zarchiwizowany) → nowy sygnał „Nowe”.
    const name = thread.displayName ?? fallbackChatName(ev.channel, ev.userId);
    try {
      const leadId = await createLead(
        {
          type: ev.channel,
          clientId: thread.clientId,
          contactName: name,
          contactPhone: keys.phone,
          contactEmail: keys.email,
          deviceInterest: noTraining(interestsFromText(ev.text)),
          requestedFrom: null,
          requestedDays: null,
          message: (ev.text ?? "(załącznik)").slice(0, 1500),
          location: null,
          sourceRef: `meta:${ev.channel}:${ev.userId}#${ev.mid}`,
        },
        null,
        { source: "AUTO_CHAT", createdAt: ev.at },
      );
      const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true } });
      await prisma.chatThread.update({ where: { id: thread.id }, data: { leadId, clientId: lead?.clientId ?? thread.clientId } });
      await prisma.leadActivity.create({
        data: { leadId, clientId: lead?.clientId ?? null, type: "SYSTEM", body: `Sygnał z ${ev.channel === "INSTAGRAM" ? "Instagrama" : "Messengera"}${ev.text ? `: „${ev.text.slice(0, 120)}”` : ""}` },
      });
      out.leads++;
      // Samo imię i nazwisko → tylko propozycja połączenia (nigdy automat).
      await suggestMergesForLead(leadId).catch((err) => logError("chat_merge_suggest_failed", err, { leadId }));
    } catch (err) {
      logError("chat_lead_create_failed", err, { mid: ev.mid });
      throw err;
    }
  }
  return out;
}
