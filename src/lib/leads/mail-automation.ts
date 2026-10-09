import { prisma } from "@/lib/prisma";
import { logError, logInfo } from "@/lib/logger";
import { FUNNEL_FROM, OFFER_FOLLOW_UP_DAYS } from "@/lib/leads/funnel";
import { addWorkdays } from "@/lib/leads/work-time";
import { defaultLeadOwnerId } from "@/lib/leads/owner";
import { qualifyClient } from "@/lib/clients/qualify";
import { MAIL_AUTOMATION_MAX_AGE_DAYS, isOfferMail, planMailForLead } from "@/lib/leads/mail-rules";
import { autoMailGmailIds } from "@/lib/leads/auto-mail";
import { stageSet, stepSet, type SourceCode } from "@/lib/leads/set-source";

// Lejek v2, etap V3 — automaty z Gmaila (wołane po zapisie nowych maili w
// src/lib/gmail/sync.ts): mail z kontakt@ / od klientki przesuwa jej otwarty
// sygnał (tylko do przodu), mail z ofertą bez sygnału zakłada sygnał „Oferta
// wysłana”, odbity mail → zadanie „potwierdź adres”. Treści maili nie
// zapisujemy — tylko temat.

// Źródło zmiany z treści wpisu planu (planMailForLead): oferta / od klientki / wysłany.
const mailSource = (activity: string): SourceCode => (activity.startsWith("auto · mail z ofertą") ? "AUTO_MAIL_OFFER" : activity.startsWith("auto · mail od klientki") ? "AUTO_MAIL_IN" : "AUTO_MAIL_OUT");

const LIVE = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"] as const;

type MailRow = { gmailMessageId: string; clientId: string; direction: "IN" | "OUT"; subject: string | null; sentAt: Date };

export async function applyMailToLeads(rows: MailRow[], now = new Date()): Promise<{ moved: number; created: number }> {
  let moved = 0;
  let created = 0;
  // Mail automatyczny z cennikiem wysłany przez panel (auto_mails) — nie jest
  // kontaktem biura, niezależnie od tematu ustawionego w szablonie.
  const auto = await autoMailGmailIds(rows.map((r) => r.gmailMessageId));
  const fresh = rows.filter((r) => !auto.has(r.gmailMessageId) && now.getTime() - r.sentAt.getTime() <= MAIL_AUTOMATION_MAX_AGE_DAYS * 86_400_000);
  const byClient = new Map<string, MailRow[]>();
  for (const r of fresh) byClient.set(r.clientId, [...(byClient.get(r.clientId) ?? []), r]);

  for (const [clientId, mails] of byClient) {
    mails.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime());
    const lead = await prisma.lead.findFirst({
      where: { clientId, archivedAt: null, stage: { in: [...LIVE] }, createdAt: { gte: FUNNEL_FROM } },
      orderBy: { createdAt: "desc" },
      select: { id: true, stage: true, firstContactAt: true, lastContactAt: true, createdAt: true },
    });

    if (!lead) {
      // Siatka bezpieczeństwa: oferta z kontakt@ do klientki bez sygnału.
      const offer = mails.find((m) => m.direction === "OUT" && isOfferMail(m.subject));
      if (!offer) continue;
      const sourceRef = `gmail:${offer.gmailMessageId}`;
      const [dup, recentRental, client] = await Promise.all([
        prisma.lead.count({ where: { sourceRef } }),
        prisma.rental.count({ where: { clientId, deletedInGoogle: false, startsAt: { gte: new Date(now.getTime() - 365 * 86_400_000) } } }),
        prisma.client.findUnique({ where: { id: clientId }, select: { name: true, shortName: true } }),
      ]);
      // Stała klientka (wynajem w 12 mies.) nie przechodzi przez lejek.
      if (dup || recentRental || !client) continue;
      const followUp = new Date(addWorkdays(offer.sentAt, OFFER_FOLLOW_UP_DAYS[0]).setHours(10));
      await prisma.lead.create({
        data: {
          clientId,
          title: `Oferta mailem — ${client.shortName ?? client.name}`,
          type: "EMAIL",
          stage: "OFERTA",
          stageChangedAt: offer.sentAt,
          createdAt: offer.sentAt,
          ownerId: await defaultLeadOwnerId(),
          firstContactAt: offer.sentAt,
          lastContactAt: offer.sentAt,
          nextActionAt: followUp,
          nextStepType: "FOLLOW_UP_OFERTY",
          nextStepNote: "follow-up 1 z 2",
          followUpNo: 1,
          sourceRef,
          ...stageSet("AUTO_MAIL_OFFER", null, offer.sentAt),
          ...stepSet("AUTO_MAIL_OFFER", null, offer.sentAt),
          activities: { create: { clientId, type: "SYSTEM", body: `auto · mail z ofertą z kontakt@ („${offer.subject ?? ""}”) bez sygnału → Oferta wysłana` } },
        },
      });
      created++;
      continue;
    }

    let state = { stage: lead.stage, firstContactAt: lead.firstContactAt, lastContactAt: lead.lastContactAt, createdAt: lead.createdAt };
    for (const m of mails) {
      const plan = planMailForLead(state, m, now);
      if (!plan) continue;
      const stageChange = plan.stage && plan.stage !== state.stage ? plan.stage : null;
      await prisma.$transaction([
        prisma.lead.update({
          where: { id: lead.id },
          data: {
            lastContactAt: plan.lastContactAt,
            ...(plan.firstContactAt ? { firstContactAt: plan.firstContactAt } : {}),
            ...(stageChange ? { stage: stageChange, stageChangedAt: m.sentAt, attempts: 0, ...stageSet(mailSource(plan.activity), null, m.sentAt) } : {}),
            ...(plan.nextActionAt ? { nextActionAt: plan.nextActionAt, nextStepType: plan.nextStepType, nextStepNote: plan.nextStepNote, ...stepSet(mailSource(plan.activity), null, m.sentAt) } : {}),
            ...(plan.followUpNo ? { followUpNo: plan.followUpNo } : {}),
          },
        }),
        prisma.leadActivity.create({ data: { leadId: lead.id, clientId, type: stageChange ? "STAGE_CHANGE" : "EMAIL", body: plan.activity, createdAt: m.sentAt } }),
      ]);
      if (stageChange) moved++;
      // Interakcja mailowa (osobisty mail z kontakt@ albo odpowiedź klientki) → klient Potencjalny.
      await qualifyClient(clientId, "EMAIL_REPLY");
      state = { ...state, stage: stageChange ?? state.stage, firstContactAt: state.firstContactAt ?? plan.firstContactAt ?? null, lastContactAt: plan.lastContactAt };
    }
  }
  if (moved || created) logInfo("leads_mail_automation", { moved, created });
  return { moved, created };
}

// Odbity mail: zadanie „potwierdź adres” dla prowadzącej i krok na dziś.
export async function handleBounces(addresses: string[], now = new Date()): Promise<number> {
  let tasks = 0;
  for (const email of [...new Set(addresses)]) {
    const lead = await prisma.lead.findFirst({
      where: {
        archivedAt: null,
        stage: { in: [...LIVE] },
        OR: [{ contactEmail: email }, { clientContact: { email } }, { client: { contacts: { some: { email } } } }],
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, clientId: true, ownerId: true, title: true },
    });
    if (!lead) continue;
    const title = `Potwierdź adres e-mail: ${email} (mail nie doszedł)`;
    if (await prisma.task.count({ where: { leadId: lead.id, title, status: "OPEN" } })) continue;
    await prisma.$transaction([
      prisma.task.create({ data: { title, notes: `Sygnał: ${lead.title}. Mail na ten adres wrócił jako niedoręczony — zadzwoń i potwierdź adres.`, dueDate: now, assigneeId: lead.ownerId ?? (await defaultLeadOwnerId()), leadId: lead.id, clientId: lead.clientId } }),
      prisma.lead.update({ where: { id: lead.id }, data: { nextActionAt: now, nextStepType: "DOPYTAC", nextStepNote: "mail nie doszedł — potwierdź adres e-mail", ...stepSet("AUTO_MAIL_BOUNCE", null, now) } }),
      prisma.leadActivity.create({ data: { leadId: lead.id, clientId: lead.clientId, type: "SYSTEM", body: `auto · mail na ${email} nie doszedł — zadanie „potwierdź adres”` } }),
    ]);
    tasks++;
  }
  if (tasks) logInfo("leads_mail_bounces", { tasks });
  return tasks;
}

export async function applyMailAutomationSafe(rows: MailRow[], bounces: string[]): Promise<void> {
  try {
    if (rows.length) await applyMailToLeads(rows);
    if (bounces.length) await handleBounces(bounces);
  } catch (err) {
    logError("leads_mail_automation_failed", err);
  }
}
