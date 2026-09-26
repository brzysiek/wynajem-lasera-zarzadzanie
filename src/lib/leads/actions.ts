import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { STAGE_LABEL, LOST_REASON_LABEL } from "@/lib/leads/labels";
import { leadTitle, type LeadStageKey } from "@/lib/leads/parse-deal";
import { nextWorkday } from "@/lib/leads/work-time";
import type { LeadPatch, NewLeadInput } from "@/lib/leads/validate";

// Akcje na sygnałach z panelu (CRM, prompt 2A). Wszystko tylko w bazie
// panelu — odsyłanie do HubSpota to krok 2B (wtedy z tych samych miejsc
// trafi wpis do kolejki). Każda zmiana zostawia ślad na osi czasu.

type Lead = { id: string; title: string; stage: LeadStageKey; clientId: string | null; ownerId: string | null; firstContactAt: Date | null };

async function getLead(id: string): Promise<Lead> {
  const lead = await prisma.lead.findUnique({ where: { id }, select: { id: true, title: true, stage: true, clientId: true, ownerId: true, firstContactAt: true } });
  if (!lead) throw new LeadError("Sygnał nie istnieje.", 404);
  return lead;
}

export class LeadError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

// Kto pierwszy zajmie się sygnałem, zostaje jego prowadzącą osobą.
const claim = (lead: Lead, userId: string): Prisma.LeadUpdateInput => (lead.ownerId ? {} : { owner: { connect: { id: userId } } });

function stageData(lead: Lead, stage: LeadStageKey): Prisma.LeadUpdateInput {
  if (stage === lead.stage) return {};
  return {
    stage,
    stageChangedAt: new Date(),
    // Wyjście z przegranej czyści powód — nie zostaje nieaktualny.
    ...(stage !== "PRZEGRANA" ? { lostReason: null, lostNote: null, returnAt: null } : {}),
  };
}

export async function updateLead(id: string, patch: LeadPatch, userId: string) {
  const lead = await getLead(id);
  const data: Prisma.LeadUpdateInput = {};
  const notes: string[] = [];

  if (patch.stage && patch.stage !== lead.stage) {
    Object.assign(data, stageData(lead, patch.stage));
    notes.push(`${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[patch.stage]}`);
    if (patch.stage === "PRZEGRANA") {
      data.lostReason = patch.lostReason;
      data.lostNote = patch.lostNote ?? null;
      data.returnAt = patch.returnAt ?? null;
      data.nextActionAt = null;
      notes[notes.length - 1] += ` · powód: ${LOST_REASON_LABEL[patch.lostReason!]}${patch.lostNote ? ` — ${patch.lostNote}` : ""}`;
    }
  }
  if (patch.rentalId !== undefined) {
    if (patch.rentalId) {
      const rental = await prisma.rental.findUnique({ where: { id: patch.rentalId }, select: { id: true, startsAt: true, lead: { select: { id: true } }, device: { select: { name: true } } } });
      if (!rental) throw new LeadError("Wynajem nie istnieje.");
      if (rental.lead && rental.lead.id !== id) throw new LeadError("Ten wynajem jest już powiązany z innym sygnałem.");
      data.rental = { connect: { id: rental.id } };
      if (["SYGNAL", "WYWIAD", "OFERTA"].includes(lead.stage) && !patch.stage) Object.assign(data, stageData(lead, "REZERWACJA"));
      notes.push(`Powiązano z rezerwacją: ${rental.device.name}, ${rental.startsAt.toLocaleDateString("pl-PL")}`);
    } else {
      data.rental = { disconnect: true };
      notes.push("Odpięto rezerwację");
    }
  }
  if (patch.clientId !== undefined) {
    data.client = patch.clientId ? { connect: { id: patch.clientId } } : { disconnect: true };
    data.clientContact = { disconnect: true };
  }
  if (patch.ownerId !== undefined) data.owner = patch.ownerId ? { connect: { id: patch.ownerId } } : { disconnect: true };
  for (const key of ["nextActionAt", "requestedFrom", "requestedDays", "location", "message", "title", "contactName", "contactPhone", "contactEmail"] as const) {
    if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.deviceInterest !== undefined) data.deviceInterest = patch.deviceInterest;

  await prisma.$transaction(async (tx) => {
    await tx.lead.update({ where: { id }, data: { ...data, ...(patch.ownerId === undefined ? claim(lead, userId) : {}) } });
    if (notes.length) {
      await tx.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "STAGE_CHANGE", body: notes.join(" · "), userId } });
    }
    // „Wróć do kontaktu” przy przegranej = zadanie w istniejącym panelu Zadań.
    if (patch.stage === "PRZEGRANA" && patch.returnAt) {
      await tx.task.create({
        data: {
          title: `Wróć do kontaktu: ${lead.title}`.slice(0, 191),
          dueDate: patch.returnAt,
          authorId: userId,
          assigneeId: lead.ownerId ?? userId,
          leadId: id,
          clientId: lead.clientId,
        },
      });
    }
  });
}

export type CallOutcome = "talked" | "no_answer" | "callback" | "note";

// Wynik rozmowy / notatka z karty sygnału (prompt 2, 3.3 „Zadzwoń”).
export async function logLeadActivity(
  id: string,
  input: { outcome: CallOutcome; body: string | null; nextActionAt?: Date | null; stage?: LeadStageKey },
  userId: string,
) {
  const lead = await getLead(id);
  const now = new Date();
  const type = input.outcome === "note" ? "NOTE" : input.outcome === "no_answer" ? "CALL_NO_ANSWER" : "CALL";
  const data: Prisma.LeadUpdateInput = { ...claim(lead, userId) };
  if (type !== "NOTE" && !lead.firstContactAt) data.firstContactAt = now;
  if (input.outcome === "no_answer") data.nextActionAt = input.nextActionAt ?? nextWorkday(now);
  else if (input.nextActionAt !== undefined) data.nextActionAt = input.nextActionAt;
  if (input.stage && input.stage !== lead.stage) Object.assign(data, stageData(lead, input.stage));

  const body =
    input.outcome === "callback"
      ? [`Oddzwoni${input.nextActionAt ? ` — ${input.nextActionAt.toLocaleDateString("pl-PL")}` : ""}`, input.body].filter(Boolean).join(": ")
      : input.body;
  if (type === "NOTE" && !body) throw new LeadError("Notatka nie może być pusta.");

  await prisma.$transaction([
    prisma.lead.update({ where: { id }, data }),
    prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type, body, userId } }),
    ...(input.stage && input.stage !== lead.stage
      ? [prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "STAGE_CHANGE", body: `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[input.stage]}`, userId } })]
      : []),
  ]);
}

// SMS z karty sygnału — ta sama bramka co reszta panelu (szybkisms), zapis
// w Message (z clientId, bez wynajmu) i na osi czasu.
export async function sendLeadSms(id: string, phone: string, message: string, userId: string) {
  const lead = await getLead(id);
  const result = await sendSms(phone, message);
  const msg = await prisma.message.create({
    data: {
      userId,
      clientId: lead.clientId,
      channel: "SMS",
      recipient: phone,
      body: message,
      status: result.ok ? "SENT" : "FAILED",
      providerMessageId: result.providerMessageId,
      errorMessage: result.ok ? null : result.message,
    },
    select: { id: true },
  });
  if (!result.ok) throw new LeadError(result.message, 502);
  await prisma.$transaction([
    prisma.lead.update({ where: { id }, data: { ...claim(lead, userId), ...(lead.firstContactAt ? {} : { firstContactAt: new Date() }) } }),
    prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "SMS", body: message, userId, messageId: msg.id } }),
  ]);
}

export async function createLeadTask(id: string, input: { title: string; dueDate: Date | null; assigneeId: string | null }, userId: string) {
  const lead = await getLead(id);
  await prisma.$transaction([
    prisma.task.create({
      data: {
        title: input.title.slice(0, 191),
        dueDate: input.dueDate,
        authorId: userId,
        assigneeId: input.assigneeId ?? lead.ownerId ?? userId,
        leadId: id,
        clientId: lead.clientId,
      },
    }),
    prisma.leadActivity.create({
      data: { leadId: id, clientId: lead.clientId, type: "SYSTEM", body: `Zadanie: ${input.title}${input.dueDate ? ` (${input.dueDate.toLocaleDateString("pl-PL")})` : ""}`, userId },
    }),
  ]);
}

function splitName(full: string | null) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

// Nowy sygnał z panelu (np. telefon od klientki). Bez wybranego klienta —
// klient tworzony automatycznie z podanych danych, jak przy formularzach
// (chyba że e-mail / telefon już jest w bazie — wtedy podpinamy istniejącego).
export async function createLead(input: NewLeadInput, userId: string): Promise<string> {
  let clientId = input.clientId;
  let contactId: string | null = null;
  if (clientId) {
    const c = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, contacts: { where: { isPrimary: true }, select: { id: true }, take: 1 } } });
    if (!c) throw new LeadError("Klient nie istnieje.");
    contactId = c.contacts[0]?.id ?? null;
  } else {
    const existing = await prisma.clientContact.findFirst({
      where: {
        OR: [...(input.contactEmail ? [{ email: input.contactEmail }] : []), ...(input.contactPhone ? [{ phone: input.contactPhone }] : [])],
      },
      select: { id: true, clientId: true },
    });
    if (existing) {
      clientId = existing.clientId;
      contactId = existing.id;
    } else {
      const person = splitName(input.contactName);
      const created = await prisma.client.create({
        data: {
          name: input.contactName || input.contactEmail || input.contactPhone || "Nowy klient",
          source: input.type === "TELEFON" ? "TELEFON" : null,
          contacts: { create: { ...person, email: input.contactEmail, phone: input.contactPhone, isPrimary: true } },
        },
        select: { id: true, contacts: { select: { id: true } } },
      });
      clientId = created.id;
      contactId = created.contacts[0].id;
    }
  }
  const client = clientId ? await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }) : null;
  const lead = await prisma.lead.create({
    data: {
      clientId,
      clientContactId: contactId,
      title: leadTitle({ who: client?.name ?? input.contactName, devices: input.deviceInterest, days: input.requestedDays, fallback: "Nowy sygnał" }),
      type: input.type,
      ownerId: userId,
      deviceInterest: input.deviceInterest.length ? input.deviceInterest : undefined,
      requestedFrom: input.requestedFrom,
      requestedDays: input.requestedDays,
      message: input.message,
      location: input.location,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      contactEmail: input.contactEmail,
      activities: { create: { type: "SYSTEM", body: "Dodano w panelu", userId, clientId } },
    },
    select: { id: true },
  });
  return lead.id;
}
