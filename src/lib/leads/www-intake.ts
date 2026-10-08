import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { isLocked, readFieldMeta } from "@/lib/clients/profile-fields";
import { isPlaceholderEmail } from "@/lib/clients/placeholder";
import { loadExclusionMatcher } from "@/lib/porzadki/exclusion-load";
import { FIRST_CONTACT_SLA_HOURS, addWorkHours, reservationFirstStep } from "@/lib/leads/funnel";
import { defaultLeadOwnerId } from "@/lib/leads/owner";
import { intakeRules, mergeRepeatInquiry, DUPLICATE_WINDOW_MIN } from "@/lib/leads/intake";
import { leadTitle } from "@/lib/leads/parse-deal";
import { TYPE_LABEL } from "@/lib/leads/labels";
import { contentKey, type WwwForm } from "@/lib/leads/www-form";
import { logError } from "@/lib/logger";

// Formularz WWW → sygnał (03.10.2026). Te same zasady co import z HubSpota
// (hubspot-sync.ts: createLeadFromDeal): klient po e-mailu, potem telefonie;
// brak → nowy klient (Potencjalny, źródło „Formularz WWW”); prowadząca i
// pierwszy krok (PIERWSZY_KONTAKT w SLA 4 h rob.); stała klientka → „W
// kontakcie” z krokiem „umówić termin”; ponowne zapytanie → aktywność w
// otwartym sygnale. Bez HubSpota i n8n.

// mergedInto — otwarty sygnał, do którego dopisano ponowne zapytanie (nowy
// rekord trafił wtedy do archiwum jako duplikat): tam ma też trafić wpis o
// wysłanym mailu, żeby Ania widziała go na żywym sygnale.
export type WwwIntakeResult = { result: "CREATED" | "DUPLICATE" | "EXCLUDED"; leadId?: string; mergedInto?: string };

function splitName(full: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  const cap = (s: string) => (s === s.toLowerCase() || s === s.toUpperCase() ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
  return { firstName: cap(parts[0]), lastName: parts.length > 1 ? parts.slice(1).map(cap).join(" ") : null };
}

export async function intakeWwwForm(form: WwwForm, now = new Date()): Promise<WwwIntakeResult> {
  const email = form.email && !isPlaceholderEmail(form.email) ? form.email : null;
  const phone = form.phone ? normalizePolishPhone(form.phone) : null;

  // Osoby z listy wykluczeń (wniosek 7) nie tworzą sygnałów ani klientów.
  if (email && (await loadExclusionMatcher())(email) === "EXCLUDE") return { result: "EXCLUDED" };

  // Duplikat (wniosek 39): ten sam e-mail (albo telefon), typ i IDENTYCZNA
  // treść (sprzęt, termin, dni, wiadomość) w ciągu 10 min — wtyczka wysłała
  // drugi raz. Inna treść to nowe zgłoszenie: dopisze się do otwartego sygnału.
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MIN * 60_000);
  const key = contentKey({ devices: form.devices, from: form.requestedFrom, days: form.requestedDays, message: form.message });
  const recent = email || phone
    ? await prisma.lead.findMany({
        where: { origin: "WWW", type: form.type, createdAt: { gte: since }, ...(email ? { contactEmail: email } : { contactPhone: phone }) },
        select: { id: true, clientId: true, archivedAt: true, archiveNote: true, deviceInterest: true, requestedFrom: true, requestedDays: true, message: true },
      })
    : [];
  const same = recent.find(
    (l) =>
      contentKey({
        devices: Array.isArray(l.deviceInterest) ? (l.deviceInterest as unknown[]).filter((x): x is string => typeof x === "string") : [],
        from: l.requestedFrom ? l.requestedFrom.toISOString().slice(0, 10) : null,
        days: l.requestedDays,
        message: l.message,
      }) === key,
  );
  if (same) {
    // Wpis o pominiętym duplikacie na żywym sygnale (zarchiwizowany duplikat
    // wskazuje sygnał, z którym go scalono) — widać, że formularz zadziałał.
    const live = same.archivedAt ? same.archiveNote?.match(/sygnałem (\S+)/)?.[1] ?? same.id : same.id;
    const hhmm = now.toLocaleTimeString("pl-PL", { timeZone: "Europe/Warsaw", hour: "2-digit", minute: "2-digit" });
    await prisma.leadActivity
      .create({ data: { leadId: live, clientId: same.clientId, type: "SYSTEM", body: `Pominięto duplikat formularza WWW (${TYPE_LABEL[form.type]}) — identyczna treść, ${hhmm}`, createdAt: now } })
      .catch((err) => logError("www_duplicate_note_failed", err, { leadId: live }));
    return { result: "DUPLICATE", leadId: live };
  }

  // Klient: e-mail → telefon → nowy (test+www-… bez klienta, żeby nie śmiecić bazy).
  let ref: { id: string; clientId: string; phone: string | null } | null = null;
  if (!form.test) {
    const byEmail = email ? await prisma.clientContact.findFirst({ where: { email }, select: { id: true, clientId: true, phone: true } }) : null;
    const byPhone = !byEmail && phone ? await prisma.clientContact.findFirst({ where: { OR: [{ phone }, { phone2: phone }] }, select: { id: true, clientId: true, phone: true } }) : null;
    ref = byEmail ?? byPhone;
    if (!ref && (email || phone)) {
      const person = splitName(form.name);
      const created = await prisma.client.create({
        data: {
          name: form.company || [person.firstName, person.lastName].filter(Boolean).join(" ") || email || phone || "Nowy klient",
          source: "FORMULARZ_WWW",
          deviceInterests: form.devices.length ? form.devices : undefined,
          contacts: { create: { ...person, email, phone, isPrimary: true } },
        },
        select: { id: true, contacts: { select: { id: true } } },
      });
      ref = { id: created.contacts[0].id, clientId: created.id, phone };
    } else if (ref && phone && !ref.phone) {
      // Telefon z formularza, którego brakuje osobie — uzupełniamy (bez pól zmienionych ręcznie).
      const meta = await prisma.clientContact.findUnique({ where: { id: ref.id }, select: { fieldMeta: true } });
      if (!isLocked(readFieldMeta(meta?.fieldMeta), "phone")) await prisma.clientContact.update({ where: { id: ref.id }, data: { phone } });
    }
  }

  const client = ref ? await prisma.client.findUnique({ where: { id: ref.clientId }, select: { name: true } }) : null;
  const title = `${form.test ? "TEST — " : ""}${leadTitle({ who: client?.name ?? form.name, devices: form.devices, days: form.requestedDays, fallback: email ?? phone ?? "Zapytanie WWW" })}`.slice(0, 191);
  const intake = await intakeRules(ref?.clientId ?? null, now, form.devices);
  const owner = await defaultLeadOwnerId();
  // Rezerwacja WWW: krok „pierwszy telefon” z notatką (wniosek 38); pilny, gdy
  // termin rezerwacji wypada w ciągu 3 dni.
  const resStep = form.type === "REZERWACJA_WWW" ? reservationFirstStep(now, { requestedFrom: form.requestedFrom, hasCity: !!form.city }) : null;
  const funnel = intake.duplicateOf
    ? { archivedAt: now, archiveReason: "DUPLIKAT", archiveNote: `ponowne zapytanie — scalone z otwartym sygnałem ${intake.duplicateOf.id}` }
    : intake.returning
      ? { ownerId: owner, returningClient: true, stage: "WYWIAD" as const, nextActionAt: now, nextStepType: "UMOW_TERMIN", nextStepNote: "stała klientka — umówić termin" }
      : resStep
        ? { ownerId: owner, nextActionAt: resStep.nextActionAt, nextStepType: resStep.nextStepType, nextStepNote: resStep.nextStepNote }
        : { ownerId: owner, nextActionAt: addWorkHours(now, FIRST_CONTACT_SLA_HOURS), nextStepType: "PIERWSZY_KONTAKT" };

  const lead = await prisma.$transaction(async (tx) => {
    const l = await tx.lead.create({
      data: {
        origin: "WWW",
        attribution: form.attribution,
        sourceRef: `www:${form.rawType || "inne"}:${now.getTime()}`,
        clientId: ref?.clientId ?? null,
        clientContactId: ref?.id ?? null,
        title,
        type: form.type,
        stage: "SYGNAL",
        stageChangedAt: now,
        deviceInterest: form.devices.length ? form.devices : undefined,
        requestedFrom: form.requestedFrom ? new Date(`${form.requestedFrom}T12:00:00.000Z`) : null,
        requestedDays: form.requestedDays,
        message: form.message,
        location: form.city,
        contactName: form.name,
        contactPhone: phone,
        contactEmail: email,
        createdAt: now,
        ...funnel,
      },
      select: { id: true },
    });
    await tx.leadActivity.createMany({
      data: [
        { leadId: l.id, clientId: ref?.clientId ?? null, type: "SYSTEM", body: `Sygnał z formularza WWW (${form.rawType || "inny"}) — bezpośrednio ze strony, bez HubSpota`, createdAt: now },
        ...(resStep?.urgentInDays != null && !intake.duplicateOf
          ? [{ leadId: l.id, clientId: ref?.clientId ?? null, type: "SYSTEM" as const, body: `PILNE: termin rezerwacji ${resStep.urgentInDays === 0 ? "dziś" : resStep.urgentInDays === 1 ? "jutro" : `za ${resStep.urgentInDays} dni`} — zadzwonić od razu`, createdAt: now }]
          : []),
        ...(form.test ? [{ leadId: l.id, clientId: null, type: "SYSTEM" as const, body: "TEST — sprawdzenie formularza po wdrożeniu, do usunięcia (Porządki → Archiwum)", createdAt: now }] : []),
      ],
    });
    return l;
  });
  if (intake.duplicateOf) {
    // Pełna nowa treść w wpisie + uzupełnienie sprzętu, terminu i dni (wniosek 39).
    const lines = [
      form.devicesText ? `Urządzenie: ${form.devicesText}` : null,
      form.dateFromRaw ? `Termin od: ${form.dateFromRaw}` : null,
      form.daysRaw ? `Liczba dni: ${form.daysRaw}` : null,
      form.city ? `Miejscowość: ${form.city}` : null,
    ].filter((x): x is string => !!x);
    await mergeRepeatInquiry(intake.duplicateOf, {
      type: form.type,
      createdAt: now,
      message: form.message,
      details: {
        devices: form.devices,
        requestedFrom: form.requestedFrom ? new Date(`${form.requestedFrom}T12:00:00.000Z`) : null,
        requestedDays: form.requestedDays,
        location: form.city,
        lines,
      },
    });
    return { result: "CREATED", leadId: lead.id, mergedInto: intake.duplicateOf.id };
  }
  return { result: "CREATED", leadId: lead.id };
}
