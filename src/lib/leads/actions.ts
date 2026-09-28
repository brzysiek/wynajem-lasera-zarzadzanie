import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { STAGE_LABEL, LOST_REASON_LABEL, POSTPONE_REASON_LABEL, type PostponeReasonKey } from "@/lib/leads/labels";
import { leadTitle, type LeadStageKey } from "@/lib/leads/parse-deal";
import { FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, addWorkHours, planOutcome, type NextStepType, type Outcome } from "@/lib/leads/funnel";
import { defaultLeadOwnerId } from "@/lib/leads/owner";
import { qualifyClient } from "@/lib/clients/qualify";
import { intakeRules } from "@/lib/leads/intake";
import type { LeadPatch, NewLeadInput } from "@/lib/leads/validate";

// Akcje na sygnałach z panelu (CRM, prompt 2A). Wszystko tylko w bazie
// panelu — odsyłanie do HubSpota to krok 2B (wtedy z tych samych miejsc
// trafi wpis do kolejki). Każda zmiana zostawia ślad na osi czasu.

type Lead = {
  id: string;
  title: string;
  stage: LeadStageKey;
  clientId: string | null;
  ownerId: string | null;
  firstContactAt: Date | null;
  rentalId: string | null;
  nextStepType: string | null;
  attempts: number;
  followUpNo: number;
};

async function getLead(id: string): Promise<Lead> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, title: true, stage: true, clientId: true, ownerId: true, firstContactAt: true, rentalId: true, nextStepType: true, attempts: true, followUpNo: true },
  });
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
    // Wyjście z przegranej czyści powód — nie zostaje nieaktualny; wyjście z
    // odłożonych — datę i powód powrotu.
    ...(stage !== "PRZEGRANA" ? { lostReason: null, lostNote: null } : {}),
    ...(stage !== "PRZEGRANA" && stage !== "ODLOZONE" ? { returnAt: null, postponeReason: null } : {}),
  };
}

export async function updateLead(id: string, patch: LeadPatch, userId: string) {
  const lead = await getLead(id);
  const data: Prisma.LeadUpdateInput = {};
  const notes: string[] = [];

  // Wygrana tylko z wynajmem w kalendarzu (lejek, decyzja 5) — także z tablicy.
  if (patch.stage === "WYGRANA" && !lead.rentalId && !patch.rentalId) {
    throw new LeadError("Wygrana tylko z powiązanym wynajmem — najpierw powiąż sygnał z wynajmem w kalendarzu.");
  }
  if (patch.stage === "ODLOZONE" && lead.stage !== "ODLOZONE") throw new LeadError("Odłóż przez „Odłóż do…” — z datą powrotu i powodem.");
  if (patch.stage && patch.stage !== lead.stage) {
    Object.assign(data, stageData(lead, patch.stage));
    if (patch.stage === "WYGRANA" || patch.stage === "PRZEGRANA") Object.assign(data, { nextActionAt: null, nextStepType: null, nextStepNote: null });
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
      await qualifyClient(lead.clientId, "RENTAL");
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
  // Ręcznie ustawiony termin bez rodzaju kroku = „kolejny krok”.
  if (patch.nextActionAt !== undefined && patch.nextActionAt && !lead.nextStepType) data.nextStepType = "INNE";
  if (patch.nextStepNote !== undefined) data.nextStepNote = patch.nextStepNote;
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

// „email” = „Odpowiedziałam mailem” (prompt 2 v2, 3.3) — kwalifikuje klienta
// tak jak rozmowa; SMS i nieodebrane połączenie nie kwalifikują.
// „offer_sent” = „Wysłałam ofertę” (lejek, etap L1).
export type CallOutcome = Outcome | "note";

const whenLabel = (d: Date) => d.toLocaleString("pl-PL", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

// Wynik kontaktu / notatka z karty sygnału. Następny krok, próby i
// follow-upy wg reguł lejka (src/lib/leads/funnel.ts — planOutcome).
export async function logLeadActivity(
  id: string,
  input: { outcome: CallOutcome; body: string | null; nextActionAt?: Date | null; stage?: LeadStageKey; postponeReason?: PostponeReasonKey | null },
  userId: string,
) {
  const lead = await getLead(id);
  const now = new Date();
  const type = input.outcome === "note" ? "NOTE" : input.outcome === "no_answer" ? "CALL_NO_ANSWER" : input.outcome === "email" ? "EMAIL" : "CALL";
  if (type === "NOTE" && !input.body) throw new LeadError("Notatka nie może być pusta.");
  if (input.outcome === "callback" && !input.nextActionAt) throw new LeadError("Wybierz termin, kiedy oddzwoni.");
  if (input.outcome === "postpone" && (!input.nextActionAt || input.nextActionAt <= now)) throw new LeadError("Odłóż do: wybierz datę powrotu (od jutra).");
  if (input.outcome === "postpone" && !input.postponeReason) throw new LeadError("Odłóż do: wybierz powód.");
  const data: Prisma.LeadUpdateInput = { ...claim(lead, userId) };
  let stageTo: LeadStageKey | null = input.stage && input.stage !== lead.stage ? input.stage : null;
  let body = input.body;

  if (input.outcome !== "note") {
    const reasonLabel = input.postponeReason ? POSTPONE_REASON_LABEL[input.postponeReason] : null;
    const plan = planOutcome(lead, input.outcome, now, { at: input.nextActionAt ?? null, note: input.outcome === "postpone" ? `wraca: ${reasonLabel}${input.body ? ` — ${input.body}` : ""}` : null });
    if (plan.contact) {
      if (!lead.firstContactAt) data.firstContactAt = now;
      data.lastContactAt = now;
    }
    Object.assign(data, { nextActionAt: plan.nextActionAt, nextStepType: plan.nextStepType, nextStepNote: plan.nextStepNote, attempts: plan.attempts, followUpNo: plan.followUpNo });
    stageTo = stageTo ?? (plan.stage && plan.stage !== lead.stage ? plan.stage : null);
    const next = plan.nextActionAt ? ` Następny krok: ${NEXT_STEP_LABEL[plan.nextStepType as NextStepType]}, ${whenLabel(plan.nextActionAt)}.` : "";
    if (input.outcome === "postpone") Object.assign(data, { returnAt: plan.nextActionAt, postponeReason: input.postponeReason });
    const head =
      input.outcome === "postpone"
        ? `Odłożone do ${input.nextActionAt!.toLocaleDateString("pl-PL")} (${reasonLabel})`
        : input.outcome === "callback"
        ? "Oddzwoni"
        : input.outcome === "email"
          ? "Odpowiedziałam mailem"
          : input.outcome === "offer_sent"
            ? "Wysłałam ofertę"
            : input.outcome === "no_answer"
              ? `Nie odebrała (${plan.attempts || lead.attempts}. próba)`
              : null;
    body = [[head, input.body].filter(Boolean).join(": "), next.trim()].filter(Boolean).join(" · ") || null;
  }
  if (stageTo) Object.assign(data, stageData(lead, stageTo));

  await prisma.$transaction([
    prisma.lead.update({ where: { id }, data }),
    prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type, body, userId } }),
    ...(stageTo ? [prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "STAGE_CHANGE", body: `${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[stageTo]}`, userId } })] : []),
  ]);
  if (input.outcome === "talked" || input.outcome === "callback" || input.outcome === "offer_sent") await qualifyClient(lead.clientId, "CALL");
  if (input.outcome === "email") await qualifyClient(lead.clientId, "EMAIL_REPLY");
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
    prisma.lead.update({ where: { id }, data: { ...claim(lead, userId), lastContactAt: new Date(), ...(lead.firstContactAt ? {} : { firstContactAt: new Date() }) } }),
    prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "SMS", body: message, userId, messageId: msg.id } }),
  ]);
}

// Sama notatka przy sygnale — bez przejmowania sygnału, zmiany etapu i
// terminu (rola AGENT: dopisuje obserwacje, nie prowadzi sygnałów).
export async function addLeadNote(id: string, body: string, userId: string): Promise<{ activityId: string; clientId: string | null }> {
  const lead = await getLead(id);
  const text = body.trim();
  if (!text) throw new LeadError("Notatka nie może być pusta.");
  const activity = await prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type: "NOTE", body: text, userId } });
  return { activityId: activity.id, clientId: lead.clientId };
}

export async function createLeadTask(id: string, input: { title: string; dueDate: Date | null; assigneeId: string | null }, userId: string): Promise<string> {
  const lead = await getLead(id);
  const [task] = await prisma.$transaction([
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
  return task.id;
}

function splitName(full: string | null) {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? null, lastName: parts.length > 1 ? parts.slice(1).join(" ") : null };
}

// Nowy sygnał z panelu (np. telefon od klientki). Bez wybranego klienta —
// klient tworzony automatycznie z podanych danych, jak przy formularzach
// (chyba że e-mail / telefon już jest w bazie — wtedy podpinamy istniejącego).
export async function createLead(input: NewLeadInput, userId: string): Promise<string> {
  // Ten sam mail / numer nie zakłada drugiego sygnału.
  if (input.sourceRef) {
    const dup = await prisma.lead.findFirst({ where: { sourceRef: input.sourceRef, archivedAt: null }, select: { id: true, title: true } });
    if (dup) throw new LeadError(`Sygnał z tego źródła już jest: „${dup.title}”.`);
  }
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
  const now = new Date();
  // Telefon wpisany po rozmowie = kontakt już był; inaczej pierwszy kontakt w SLA 4 h rob.
  const talkedAlready = input.type === "TELEFON";
  // Lejek v2: stała klientka (wynajem w 12 mies.) — od razu „umówić termin”.
  const { returning } = await intakeRules(clientId, now, input.deviceInterest);
  const lead = await prisma.lead.create({
    data: {
      clientId,
      clientContactId: contactId,
      title: leadTitle({ who: client?.name ?? input.contactName, devices: input.deviceInterest, days: input.requestedDays, fallback: "Nowy sygnał" }),
      type: input.type,
      ownerId: await defaultLeadOwnerId(userId),
      sourceRef: input.sourceRef ?? null,
      ...(talkedAlready
        ? { stage: "WYWIAD", firstContactAt: now, lastContactAt: now, nextActionAt: addWorkHours(now, 16), nextStepType: "INNE", nextStepNote: "po rozmowie telefonicznej" }
        : { nextActionAt: addWorkHours(now, FIRST_CONTACT_SLA_HOURS), nextStepType: "PIERWSZY_KONTAKT" }),
      ...(returning ? { stage: "WYWIAD", returningClient: true, nextActionAt: now, nextStepType: "UMOW_TERMIN", nextStepNote: "stała klientka — umówić termin" } : {}),
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
  // Sygnał z telefonu wpisany po rozmowie = kontakt już był.
  if (input.type === "TELEFON") await qualifyClient(clientId, "CALL");
  return lead.id;
}
