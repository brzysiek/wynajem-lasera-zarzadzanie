import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendSms } from "@/lib/integrations/szybkisms";
import { STAGE_LABEL, LOST_REASON_LABEL, POSTPONE_REASON_LABEL, type PostponeReasonKey } from "@/lib/leads/labels";
import { leadTitle, type LeadStageKey } from "@/lib/leads/parse-deal";
import { stepForStage, FIRST_CONTACT_SLA_HOURS, NEXT_STEP_LABEL, addWorkHours, planOutcome, type NextStepType, type Outcome } from "@/lib/leads/funnel";
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
  lastContactAt: Date | null;
  rentalId: string | null;
  nextStepType: string | null;
  attempts: number;
  followUpNo: number;
};

async function getLead(id: string): Promise<Lead> {
  const lead = await prisma.lead.findUnique({
    where: { id },
    select: { id: true, title: true, stage: true, clientId: true, ownerId: true, firstContactAt: true, lastContactAt: true, rentalId: true, nextStepType: true, attempts: true, followUpNo: true },
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
    // Krok „pierwszy kontakt / ponowna próba” nie zostaje po wyjściu z Nowe.
    else if (stepForStage(patch.stage, lead.nextStepType) !== lead.nextStepType) {
      Object.assign(data, {
        nextStepType: stepForStage(patch.stage, lead.nextStepType),
        nextStepNote: patch.stage === "REZERWACJA" && !lead.rentalId && !patch.rentalId ? "połącz z wynajmem w kalendarzu" : null,
        attempts: 0,
      });
    }
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
  // Przegląd 29.09, pkt 4: sygnał dalej niż „Nowe” (albo przegrana po rozmowie)
  // = była interakcja → klient Potencjalny.
  if (patch.stage && patch.stage !== lead.stage && (["WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA", "ODLOZONE"].includes(patch.stage) || (patch.stage === "PRZEGRANA" && lead.firstContactAt))) {
    await qualifyClient(lead.clientId, "MANUAL");
  }
  if (patch.nextActionAt !== undefined || patch.stage !== undefined) await syncLeadTasksFromStep(id);
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
  // Wniosek 24: kanał kontaktu (telefon / SMS / mail) i rodzaj kroku
  // („Oddzwoni / przemyśli” → ODDZWONI albo DOPYTAC).
  input: { outcome: CallOutcome; body: string | null; nextActionAt?: Date | null; stage?: LeadStageKey; postponeReason?: PostponeReasonKey | null; channel?: "telefon" | "sms" | "mail"; stepType?: "ODDZWONI" | "DOPYTAC" | "UMOW_TERMIN" | "INNE" },
  userId: string,
) {
  const lead = await getLead(id);
  const now = new Date();
  const type =
    input.outcome === "note" ? "NOTE" : input.outcome === "no_answer" ? "CALL_NO_ANSWER" : input.outcome === "email" || input.channel === "mail" ? "EMAIL" : input.channel === "sms" ? "SMS" : "CALL";
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
    const stepType = input.stepType && (input.outcome === "talked" || input.outcome === "callback") ? input.stepType : plan.nextStepType;
    Object.assign(data, { nextActionAt: plan.nextActionAt, nextStepType: stepType, nextStepNote: plan.nextStepNote ?? (input.stepType && input.body ? input.body.slice(0, 500) : null), attempts: plan.attempts, followUpNo: plan.followUpNo });
    stageTo = stageTo ?? (plan.stage && plan.stage !== lead.stage ? plan.stage : null);
    const next = plan.nextActionAt ? ` Następny krok: ${NEXT_STEP_LABEL[stepType as NextStepType]}, ${whenLabel(plan.nextActionAt)}.` : "";
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
  if (input.outcome !== "note") await syncLeadTasksFromStep(id);
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

// Wniosek 24: kontakt odnotowany wstecz (propozycja agenta „kontakt” z
// notatek / maili, np. rozmowy Ani z 28.09) — wpis na osi czasu z datą
// kontaktu, ostatni / pierwszy kontakt sygnału, kwalifikacja klienta.
export async function recordPastContact(id: string, input: { at: Date; channel: "telefon" | "sms" | "mail"; result: "rozmowa" | "nie_odebrala"; note: string | null }, userId: string) {
  const lead = await getLead(id);
  const talked = input.result === "rozmowa";
  const type = !talked ? "CALL_NO_ANSWER" : input.channel === "sms" ? "SMS" : input.channel === "mail" ? "EMAIL" : "CALL";
  const head = talked ? `Kontakt (${input.channel})` : "Nie odebrała";
  const later = (a: Date | null, b: Date) => (a && a > b ? a : b);
  await prisma.$transaction([
    prisma.lead.update({
      where: { id },
      data: talked
        ? { lastContactAt: later(lead.lastContactAt, input.at), ...(!lead.firstContactAt || lead.firstContactAt > input.at ? { firstContactAt: input.at } : {}) }
        : { attempts: { increment: 1 } },
    }),
    prisma.leadActivity.create({ data: { leadId: id, clientId: lead.clientId, type, body: [head, input.note].filter(Boolean).join(": "), userId, createdAt: input.at } }),
  ]);
  if (talked) await qualifyClient(lead.clientId, input.channel === "mail" ? "EMAIL_REPLY" : "CALL");
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

// Wniosek 26: sygnał ma jeden następny krok. Zadanie przy sygnale nie tworzy
// drugiej, rozbieżnej daty — termin kroku i termin otwartych zadań sygnału
// są zawsze te same (zmiana w jednym miejscu zmienia drugie).
const OPEN_LEAD_STAGES = ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "ODLOZONE"];
// Termin zadania to dzień (RRRR-MM-DD w UTC) — z lokalnego dnia kroku.
export function taskDayOf(at: Date): Date {
  return new Date(Date.UTC(at.getFullYear(), at.getMonth(), at.getDate(), 7));
}

// Krok sygnału → otwarte zadania przy nim (po każdej zmianie kroku).
export async function syncLeadTasksFromStep(leadId: string): Promise<void> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nextActionAt: true, stage: true } });
  if (!lead?.nextActionAt || !OPEN_LEAD_STAGES.includes(lead.stage)) return;
  const day = taskDayOf(lead.nextActionAt);
  await prisma.task.updateMany({ where: { leadId, status: "OPEN", NOT: { dueDate: day } }, data: { dueDate: day } });
}

// Termin zadania → krok sygnału (zmiana terminu w zadaniu), godzina kroku zostaje.
export async function syncLeadStepFromTask(leadId: string, due: Date | null, userId: string | null): Promise<void> {
  if (!due) return;
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { nextActionAt: true, nextStepType: true, stage: true, clientId: true } });
  if (!lead || !OPEN_LEAD_STAGES.includes(lead.stage) || lead.stage === "ODLOZONE") return;
  const prev = lead.nextActionAt;
  const at = new Date(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate(), prev ? prev.getHours() : 9, prev ? prev.getMinutes() : 0);
  if (prev && prev.getTime() === at.getTime()) return;
  await prisma.$transaction([
    prisma.lead.update({ where: { id: leadId }, data: { nextActionAt: at, ...(lead.nextStepType ? {} : { nextStepType: "INNE" }) } }),
    prisma.leadActivity.create({ data: { leadId, clientId: lead.clientId, type: "SYSTEM", body: `Termin kroku z zadania: ${at.toLocaleDateString("pl-PL")}`, userId } }),
  ]);
  await syncLeadTasksFromStep(leadId);
}

export async function createLeadTask(id: string, input: { title: string; dueDate: Date | null; assigneeId: string | null }, userId: string): Promise<string> {
  const lead = await getLead(id);
  const [task] = await prisma.$transaction([
    prisma.task.create({
      data: {
        title: input.title.slice(0, 191),
        dueDate: input.dueDate ? taskDayOf(input.dueDate) : null,
        authorId: userId,
        assigneeId: input.assigneeId ?? lead.ownerId ?? userId,
        leadId: id,
        clientId: lead.clientId,
        links: { create: { kind: "LEAD", refId: id } },
      },
    }),
    prisma.leadActivity.create({
      data: { leadId: id, clientId: lead.clientId, type: "SYSTEM", body: `Zadanie: ${input.title}${input.dueDate ? ` (${input.dueDate.toLocaleDateString("pl-PL")})` : ""}`, userId },
    }),
  ]);
  // Termin zadania = termin kroku sygnału (jedna data).
  if (input.dueDate) await syncLeadStepFromTask(id, taskDayOf(input.dueDate), userId);
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
