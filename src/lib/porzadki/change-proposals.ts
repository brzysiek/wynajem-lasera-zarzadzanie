import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import { parseClientPatch, parseContactInput } from "@/lib/clients/validate";
import { patchClient, patchContact } from "@/lib/clients/update";
import { mergeClients } from "@/lib/clients/merge";
import { splitClient } from "@/lib/clients/split";
import type { SplitInput } from "@/lib/clients/split-rules";
import { toLogValue } from "@/lib/changelog/diff";
import { sameLogValue } from "@/lib/changelog/undo-rules";
import { archiveRecords } from "@/lib/porzadki/archive";
import type { ArchiveInput } from "@/lib/porzadki/archive-rules";
import { PorzadkiError, type Actor } from "@/lib/porzadki/proposals";
import { addExclusions } from "@/lib/porzadki/exclusions";
import { applyPaymentMatch, describePaymentMatch, type PaymentMatchInput } from "@/lib/invoicing/bank-transfers";
import {
  parseProposalItem,
  silentClearMessage,
  type ChangeProposalStatus,
  type ClientAliasProposal,
  type ClientNewProposal,
  type ClientPriceProposal,
  type RentalClientProposal,
  type DeliveryAddressProposal,
  type LeadStepProposal,
  type LostReasonProposal,
  type ParsedProposal,
  type ProposalKind,
  type RentalLinkProposal,
  type SignalNewProposal,
} from "@/lib/porzadki/proposal-rules";
import { createLead, updateLead } from "@/lib/leads/actions";
import { LOST_REASON_LABEL } from "@/lib/leads/labels";
import { stageForStep, stepForStage, NEXT_STEP_LABEL, type NextStepType } from "@/lib/leads/funnel";
import { upsertClientPrice } from "@/lib/clients/terms";
import { findClientDuplicates } from "@/lib/clients/search";
import { quickCreateClient } from "@/lib/clients/quick-create";
import { changeRentalClient, linkUnassignedRentals } from "@/lib/clients/rental-match";
import { rematchHistory } from "@/lib/history/calendar-import";
import { normalizeTitle } from "@/lib/history/normalize-title";
import { isGenericTitleKey } from "@/lib/clients/rental-match-rules";
import { recordChanges } from "@/lib/changelog/record";
import { createAddress, updateAddress } from "@/lib/clients/delivery";
import { formatAddressLine, parseAddressInput } from "@/lib/clients/delivery-rules";

// Kolejka propozycji zmian (Porządki, etap D). Agent zgłasza (hurtem),
// ADMIN akceptuje / odrzuca / poprawia wartość. Akceptacja od razu wykonuje
// zmianę tymi samymi funkcjami co panel (dziennik: wykonał = autor
// propozycji, zatwierdził = ADMIN). Klasy zatwierdzone na stałe wykonują się
// przy zgłoszeniu (tylko zmiany pól). Odrzucona propozycja blokuje ponowne
// zgłoszenie tej samej zmiany — agent dostaje komentarz odrzucenia.

export type ChangeProposalRow = {
  id: string;
  kind: ProposalKind;
  clientId: string | null;
  clientName: string | null;
  contactId: string | null;
  contactName: string | null;
  leadId: string | null;
  leadTitle: string | null;
  duplicateName: string | null; // MERGE: nazwa scalanego duplikatu
  field: string | null;
  currentValue: string | null;
  proposedValue: string | null;
  source: string;
  confidence: string;
  batch: string | null;
  changeClass: string | null;
  status: ChangeProposalStatus;
  autoApproved: boolean;
  authorName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  executedAt: string | null;
  executionError: string | null;
  edited: boolean;
  createdAt: string;
};

// --- zgłaszanie ---

// Wartość w panelu teraz (JSON, jak w dzienniku) — do porównań i widoku.
async function currentFor(p: { kind: string; clientId: string | null; contactId: string | null; field: string | null; leadId?: string | null }): Promise<string | null> {
  if (p.kind === "FIELD" && p.clientId && p.field) {
    const c = await prisma.client.findUnique({ where: { id: p.clientId } });
    if (!c) throw new PorzadkiError("Nie znaleziono klienta.", 404);
    return toLogValue((c as unknown as Record<string, unknown>)[p.field]);
  }
  if ((p.kind === "LOST_REASON" || p.kind === "LEAD_STEP" || p.kind === "RENTAL_LINK") && p.leadId) {
    const l = await prisma.lead.findUnique({ where: { id: p.leadId }, select: { stage: true, lostReason: true, lostNote: true, nextActionAt: true, nextStepType: true, rentalId: true } });
    if (!l) throw new PorzadkiError("Sygnał nie istnieje.", 404);
    if (p.kind === "LOST_REASON") return l.stage === "PRZEGRANA" ? toLogValue({ lostReason: l.lostReason, lostNote: l.lostNote }) : toLogValue(`etap: ${l.stage}`);
    if (p.kind === "LEAD_STEP") return l.nextActionAt ? toLogValue(`${l.nextActionAt.toISOString().slice(0, 16)} ${l.nextStepType ?? ""}`.trim()) : null;
    return l.rentalId ? toLogValue(l.rentalId) : null;
  }
  if (p.kind === "RENTAL_CLIENT" && p.field) {
    const r = await prisma.rental.findUnique({ where: { id: p.field }, select: { clientId: true, client: { select: { name: true } } } });
    if (!r) throw new PorzadkiError("Wynajem nie istnieje (wynajem_id z rezerwacje_bez_klienta).", 404);
    return r.clientId ? toLogValue(r.client?.name ?? r.clientId) : null;
  }
  if (p.kind === "CLIENT_ALIAS" && p.field) {
    const key = normalizeTitle(p.field).key;
    const a = key ? await prisma.clientAlias.findUnique({ where: { alias: key }, select: { client: { select: { name: true } } } }) : null;
    return a ? toLogValue(a.client.name) : null;
  }
  if (p.kind === "CLIENT_PRICE" && p.clientId && p.field) {
    const [device, days] = p.field.split("|");
    const row = await prisma.clientPrice.findUnique({ where: { clientId_device_days: { clientId: p.clientId, device, days: Number(days) } } });
    return row ? toLogValue(row.priceNet.toFixed(2)) : null;
  }
  if (p.kind === "DELIVERY_ADDRESS" && p.clientId && p.field && p.field !== "nowy") {
    const a = await prisma.clientDeliveryAddress.findFirst({ where: { id: p.field, clientId: p.clientId } });
    if (!a) throw new PorzadkiError("Nie znaleziono adresu dostawy tego klienta (adres_id z narzędzia klient).", 404);
    return toLogValue(`${a.label}: ${formatAddressLine(a)}`);
  }
  if (p.kind === "CONTACT_FIELD" && p.contactId && p.field) {
    const c = await prisma.clientContact.findFirst({ where: { id: p.contactId, clientId: p.clientId ?? undefined } });
    if (!c) throw new PorzadkiError("Nie znaleziono osoby kontaktowej tego klienta.", 404);
    return toLogValue((c as unknown as Record<string, unknown>)[p.field]);
  }
  return null;
}

// Proponowana wartość po normalizacji panelu (NIP same cyfry, telefon +48…),
// żeby ADMIN widział to, co faktycznie się zapisze.
async function normalizeProposedAsync(p: ParsedProposal): Promise<unknown> {
  if (p.kind === "PAYMENT_MATCH") {
    // Przelew → faktura: oba muszą istnieć; opis do podglądu w kolejce.
    const input = p.proposed as PaymentMatchInput;
    const { transfer, invoice } = await describePaymentMatch(input);
    if (!transfer) throw new PorzadkiError("Przelew nie istnieje (przelew_id z narzędzia platnosci).", 404);
    if (!invoice) throw new PorzadkiError("Faktura nie istnieje w panelu (faktura_id z narzędzia platnosci).", 404);
    if (transfer.matchState === "AUTO" || transfer.matchState === "MANUAL") throw new PorzadkiError("Ten przelew jest już dopasowany.");
    if (await prisma.fakturowniaPayment.findUnique({ where: { fakturowniaInvoiceId: input.fakturowniaInvoiceId } })) throw new PorzadkiError("Faktura jest już oznaczona jako zapłacona.");
    if (!p.clientId && invoice.clientId) p.clientId = invoice.clientId;
    return {
      ...input,
      invoiceNumber: invoice.number,
      invoiceGross: invoice.totalGross.toString(),
      buyerName: invoice.buyerName,
      transfer: { date: transfer.bookedAt.toISOString().slice(0, 10), amount: transfer.amount.toString(), description: transfer.description.slice(0, 160) },
    };
  }
  if (p.kind === "LOST_REASON" || p.kind === "LEAD_STEP" || p.kind === "RENTAL_LINK") {
    // Sygnał — w kolejce przy kliencie sygnału.
    const l = await prisma.lead.findUnique({ where: { id: p.leadId! }, select: { clientId: true, stage: true } });
    if (!l) throw new PorzadkiError("Sygnał nie istnieje.", 404);
    if (!p.clientId) p.clientId = l.clientId;
    if (p.kind === "LEAD_STEP" && (l.stage === "WYGRANA" || l.stage === "PRZEGRANA")) throw new PorzadkiError("Sygnał jest zamknięty — następny krok tylko dla otwartych.");
    // Przegląd 29.09, pkt 3: pierwszy kontakt / ponowna próba tylko w etapie Nowe.
    if (p.kind === "LEAD_STEP" && l.stage !== "SYGNAL" && ["PIERWSZY_KONTAKT", "PONOWNA_PROBA"].includes((p.proposed as LeadStepProposal).stepType)) {
      throw new PorzadkiError(`rodzaj_kroku ${(p.proposed as LeadStepProposal).stepType} tylko w etapie Nowe — ten sygnał jest dalej (użyj DOPYTAC, ODDZWONI, FOLLOW_UP_OFERTY albo INNE).`);
    }
    if (p.kind === "RENTAL_LINK") {
      const r = await prisma.rental.findUnique({ where: { id: (p.proposed as RentalLinkProposal).rentalId }, select: { id: true, lead: { select: { id: true } } } });
      if (!r) throw new PorzadkiError("Wynajem nie istnieje (wynajem_id z kalendarz_wynajmy).", 404);
      if (r.lead && r.lead.id !== p.leadId) throw new PorzadkiError("Ten wynajem jest już powiązany z innym sygnałem.");
    }
    return p.proposed;
  }
  if (p.kind === "CLIENT_NEW") {
    // Wniosek 23: kontrola duplikatów jak przy „+ Nowy klient” w formularzu.
    const v = p.proposed as ClientNewProposal;
    const phone = v.phone ? normalizePolishPhone(v.phone) : null;
    if (v.phone && !phone) throw new PorzadkiError("Nieprawidłowy numer telefonu.");
    const dups = await findClientDuplicates({ phone, email: v.email });
    if (dups.length) throw new PorzadkiError(`Ten telefon / e-mail jest już w panelu: ${dups.map((d) => `${d.name} (${d.id})`).join(", ")} — użyj przypisanie_klienta z tym klient_id.`);
    return { ...v, phone };
  }
  if (p.kind === "RENTAL_CLIENT") {
    const v = p.proposed as RentalClientProposal;
    const r = await prisma.rental.findUnique({ where: { id: v.rentalId }, select: { title: true, startsAt: true, deletedInGoogle: true, device: { select: { name: true } } } });
    if (!r) throw new PorzadkiError("Wynajem nie istnieje (wynajem_id z rezerwacje_bez_klienta).", 404);
    if (r.deletedInGoogle) throw new PorzadkiError("Ten wynajem usunięto w kalendarzu Google.");
    const c = await prisma.client.findUnique({ where: { id: p.clientId! }, select: { archivedAt: true } });
    if (c?.archivedAt) throw new PorzadkiError("Klient jest w archiwum.");
    return { ...v, title: r.title, startsAt: r.startsAt.toISOString().slice(0, 10), device: r.device.name };
  }
  if (p.kind === "CLIENT_ALIAS") {
    const v = p.proposed as ClientAliasProposal;
    const key = normalizeTitle(v.title).key;
    if (!key || isGenericTitleKey(key)) throw new PorzadkiError("Ogólny tytuł („NOWA PaNI”, „klientka”, „rezerwacja”) nie może być aliasem.");
    const a = await prisma.clientAlias.findUnique({ where: { alias: key }, select: { clientId: true } });
    if (a && a.clientId !== p.clientId) throw new PorzadkiError("Ten tytuł jest już aliasem innego klienta.");
    return { title: v.title, key };
  }
  if (p.kind === "SIGNAL_NEW") {
    const v = p.proposed as SignalNewProposal;
    const phone = v.contactPhone ? normalizePolishPhone(v.contactPhone) : null;
    if (v.contactPhone && !phone) throw new PorzadkiError("Nieprawidłowy numer telefonu.");
    if (v.sourceRef) {
      const dup = await prisma.lead.findFirst({ where: { sourceRef: v.sourceRef }, select: { id: true } });
      if (dup) throw new PorzadkiError(`Sygnał z tego źródła już jest (${dup.id}).`);
    }
    return { ...v, contactPhone: phone };
  }
  if (p.kind === "CLIENT_PRICE") {
    const v = p.proposed as ClientPriceProposal;
    return { ...v, priceNet: v.priceNet != null ? v.priceNet.toFixed(2) : null };
  }
  if (p.kind === "DELIVERY_ADDRESS") {
    // Walidacja jak przy zapisie z karty (kod NN-NNN, miejscowość…).
    const v = p.proposed as DeliveryAddressProposal;
    const cur = v.addressId ? await prisma.clientDeliveryAddress.findFirst({ where: { id: v.addressId, clientId: p.clientId! } }) : null;
    if (v.addressId && !cur) throw new PorzadkiError("Nie znaleziono adresu dostawy tego klienta (adres_id z narzędzia klient).", 404);
    const { addressId, isDefault, ...fields } = v;
    const r = parseAddressInput(fields, cur ? { label: cur.label, street: cur.street, zip: cur.zip, city: cur.city, usualStartTime: cur.usualStartTime, entrance: cur.entrance, floor: cur.floor, parking: cur.parking, power: cur.power, receiver: cur.receiver, openingHours: cur.openingHours, officeNotes: cur.officeNotes } : null);
    if (!r.ok) throw new PorzadkiError(r.message);
    const out: Record<string, unknown> = { addressId, label: r.value.label };
    for (const k of Object.keys(fields)) out[k] = (r.value as Record<string, unknown>)[k] ?? null;
    if (!addressId) Object.assign(out, { street: r.value.street, zip: r.value.zip, city: r.value.city });
    if (isDefault) out.isDefault = true;
    return out;
  }
  if (p.kind !== "SPLIT") return normalizeProposed(p);
  // Wydzielenie: osoby muszą należeć do klienta; imiona do podglądu w kolejce.
  const input = p.proposed as SplitInput;
  const people = await prisma.clientContact.findMany({ where: { id: { in: input.contactIds }, clientId: p.clientId! }, select: { id: true, firstName: true, lastName: true, email: true } });
  if (people.length !== input.contactIds.length) throw new PorzadkiError("Część wskazanych osób nie należy do tego klienta.");
  return { ...input, contactNames: people.map((c) => [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || c.id) };
}

function notSilentlyCleared(field: string, proposed: unknown, normalized: unknown): unknown {
  const msg = silentClearMessage(field, proposed, normalized);
  if (msg) throw new PorzadkiError(msg);
  return normalized;
}

function normalizeProposed(p: ParsedProposal): unknown {
  if (p.kind === "FIELD") {
    const r = parseClientPatch({ [p.field!]: p.proposed });
    if (!r.ok) throw new PorzadkiError(r.message);
    return notSilentlyCleared(p.field!, p.proposed, (r.data as Record<string, unknown>)[p.field!] ?? null);
  }
  if (p.kind === "CONTACT_FIELD") {
    const r = parseContactInput({ [p.field!]: p.proposed }, { normalizePhone: normalizePolishPhone });
    if (!r.ok) throw new PorzadkiError(r.message);
    return notSilentlyCleared(p.field!, p.proposed, (r.data as Record<string, unknown>)[p.field!] ?? null);
  }
  return p.proposed;
}

async function targetsExist(p: ParsedProposal) {
  if (p.clientId && !(await prisma.client.findUnique({ where: { id: p.clientId }, select: { id: true } }))) throw new PorzadkiError("Nie znaleziono klienta.", 404);
  if (p.leadId && !(await prisma.lead.findUnique({ where: { id: p.leadId }, select: { id: true } }))) throw new PorzadkiError("Sygnał nie istnieje.", 404);
  if (p.kind === "MERGE") {
    const dup = (p.proposed as { duplicateId: string }).duplicateId;
    if (!(await prisma.client.findUnique({ where: { id: dup }, select: { id: true } }))) throw new PorzadkiError("Duplikat nie istnieje.", 404);
  }
}

export type SubmitResult = { index: number; ok: boolean; id?: string; status?: ChangeProposalStatus; message?: string };

export async function submitProposals(items: unknown[], author: Actor): Promise<SubmitResult[]> {
  if (!Array.isArray(items) || items.length === 0) throw new PorzadkiError("Podaj listę propozycji.");
  if (items.length > 500) throw new PorzadkiError("Maks. 500 propozycji w jednym zgłoszeniu.");
  const autoClasses = new Set((await prisma.autoApprovedClass.findMany({ select: { key: true } })).map((c) => c.key));
  const out: SubmitResult[] = [];

  for (const [index, raw] of items.entries()) {
    try {
      if (!raw || typeof raw !== "object") throw new PorzadkiError("Propozycja musi być obiektem.");
      const parsed = parseProposalItem(raw as Record<string, unknown>);
      if (!parsed.ok) throw new PorzadkiError(parsed.message);
      const p = parsed.value;
      await targetsExist(p);
      const proposedValue = toLogValue(await normalizeProposedAsync(p));
      const currentValue = await currentFor(p);
      if (currentValue !== null && sameLogValue(currentValue, proposedValue)) throw new PorzadkiError("Bez zmiany — w panelu jest już ta wartość.");

      const same = { kind: p.kind, clientId: p.clientId, contactId: p.contactId, leadId: p.leadId, field: p.field, proposedValue };
      const pending = await prisma.changeProposal.findFirst({ where: { ...same, status: "PENDING" }, select: { id: true } });
      if (pending) throw new PorzadkiError(`Ta sama propozycja już czeka (${pending.id}).`);
      const rejected = await prisma.changeProposal.findFirst({ where: { ...same, status: "REJECTED" }, orderBy: { decidedAt: "desc" }, select: { decisionComment: true } });
      if (rejected) throw new PorzadkiError(`Ta zmiana została już odrzucona${rejected.decisionComment ? `: „${rejected.decisionComment}”` : ""} — nie proponuj jej ponownie.`);

      const row = await prisma.changeProposal.create({
        data: {
          ...same,
          currentValue,
          source: p.provenance.source ?? "",
          confidence: p.provenance.confidence ?? "MEDIUM",
          batch: p.provenance.batch,
          changeClass: p.changeClass,
          authorId: author.userId,
        },
      });

      // Klasa zatwierdzona na stałe — tylko zmiany pól, wykonanie od razu.
      // Klasy na stałe: zmiany pól i nowe sygnały z maili (np. „sygnał z maila formularza w kontakt@”).
      if (p.changeClass && autoClasses.has(p.changeClass) && (p.kind === "FIELD" || p.kind === "CONTACT_FIELD" || p.kind === "SIGNAL_NEW")) {
        const res = await execute(row.id, null);
        await prisma.changeProposal.update({
          where: { id: row.id },
          data: res.ok
            ? { status: "ACCEPTED", autoApproved: true, decidedAt: new Date(), executedAt: new Date(), decisionComment: `automatycznie: klasa ${p.changeClass}` }
            : { executionError: res.message },
        });
        out.push({ index, ok: true, id: row.id, status: res.ok ? "ACCEPTED" : "PENDING", ...(res.ok ? {} : { message: `Nie wykonano automatycznie: ${res.message}` }) });
      } else {
        out.push({ index, ok: true, id: row.id, status: "PENDING" });
      }
    } catch (err) {
      if (err instanceof PorzadkiError) out.push({ index, ok: false, message: err.message });
      else throw err;
    }
  }
  return out;
}

// --- wykonanie ---

async function execute(id: string, approvedById: string | null): Promise<{ ok: true } | { ok: false; message: string }> {
  const p = await prisma.changeProposal.findUnique({ where: { id } });
  if (!p) return { ok: false, message: "Propozycja nie istnieje." };
  const author = p.authorId ? await prisma.user.findUnique({ where: { id: p.authorId }, select: { id: true, role: true } }) : null;
  // Wykonał = autor propozycji (z jego uprawnieniami); bez autora — zatwierdzający.
  const actor = author ? { userId: author.id, role: author.role } : { userId: approvedById ?? "", role: "ADMIN" };
  const provenance = { changeSource: p.source, changeConfidence: p.confidence, changeBatch: p.batch ?? "" };
  const value = p.proposedValue == null ? null : JSON.parse(p.proposedValue);

  if (p.kind === "FIELD") {
    const r = await patchClient(p.clientId!, { [p.field!]: value, ...provenance }, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "CONTACT_FIELD") {
    const r = await patchContact(p.clientId!, p.contactId!, { [p.field!]: value, ...provenance }, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "SIGNAL_NEW") {
    const v = value as SignalNewProposal;
    const day = v.requestedFrom ? new Date(`${v.requestedFrom}T09:00:00`) : null;
    try {
      const id = await createLead(
        { type: v.type, clientId: v.clientId, contactName: v.contactName, contactPhone: v.contactPhone, contactEmail: v.contactEmail, deviceInterest: v.deviceInterest, requestedFrom: day, requestedDays: v.requestedDays, message: v.message, location: null, sourceRef: v.sourceRef },
        actor.userId,
      );
      await prisma.leadActivity.create({ data: { leadId: id, type: "SYSTEM", body: `Sygnał z propozycji agenta (źródło: ${p.source})`, userId: actor.userId || null } });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (p.kind === "LOST_REASON") {
    const v = value as LostReasonProposal;
    const l = await prisma.lead.findUnique({ where: { id: p.leadId! }, select: { stage: true, clientId: true } });
    if (!l) return { ok: false, message: "Sygnał nie istnieje." };
    try {
      if (l.stage === "PRZEGRANA") {
        await prisma.$transaction([
          prisma.lead.update({ where: { id: p.leadId! }, data: { lostReason: v.lostReason, lostNote: v.lostNote } }),
          prisma.leadActivity.create({ data: { leadId: p.leadId!, clientId: l.clientId, type: "STAGE_CHANGE", body: `Powód przegranej: ${LOST_REASON_LABEL[v.lostReason]}${v.lostNote ? ` — ${v.lostNote}` : ""} (propozycja agenta)`, userId: actor.userId || null } }),
        ]);
      } else {
        await updateLead(p.leadId!, { stage: "PRZEGRANA", lostReason: v.lostReason, lostNote: v.lostNote }, actor.userId);
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (p.kind === "LEAD_STEP") {
    const v = value as LeadStepProposal;
    const at = v.at.length > 10 ? new Date(v.at) : new Date(`${v.at}T10:00:00`);
    if (Number.isNaN(at.getTime())) return { ok: false, message: "Nieprawidłowy termin." };
    const l = await prisma.lead.findUnique({ where: { id: p.leadId! }, select: { clientId: true, stage: true } });
    // Follow-up oferty przed „Oferta wysłana” → sygnał przechodzi do „Oferta wysłana”.
    const moveTo = l ? stageForStep(l.stage, v.stepType) : null;
    if (moveTo) {
      try {
        await updateLead(p.leadId!, { stage: moveTo }, actor.userId);
      } catch (err) {
        return { ok: false, message: err instanceof Error ? err.message : String(err) };
      }
    }
    // Krok niezgodny z etapem (np. „pierwszy kontakt” w „W kontakcie”) — wg etapu.
    const stepType = l ? (stepForStage(moveTo ?? l.stage, v.stepType) ?? v.stepType) : v.stepType;
    await prisma.$transaction([
      prisma.lead.update({ where: { id: p.leadId! }, data: { nextActionAt: at, nextStepType: stepType, nextStepNote: v.note } }),
      prisma.leadActivity.create({
        data: { leadId: p.leadId!, clientId: l?.clientId ?? null, type: "SYSTEM", body: `Następny krok (propozycja agenta): ${NEXT_STEP_LABEL[stepType as NextStepType] ?? stepType}, ${at.toLocaleString("pl-PL")}${v.note ? ` — ${v.note}` : ""}`, userId: actor.userId || null },
      }),
    ]);
    return { ok: true };
  }
  if (p.kind === "RENTAL_LINK") {
    try {
      await updateLead(p.leadId!, { rentalId: (value as RentalLinkProposal).rentalId }, actor.userId);
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (p.kind === "CLIENT_NEW") {
    const v = value as ClientNewProposal;
    const r = await quickCreateClient({ ...v, force: true }, { userId: actor.userId, source: `propozycja agenta (${p.source})` });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "RENTAL_CLIENT") {
    // Po akceptacji: klient w rezerwacji, zapis w wydarzeniu Google i (opcjonalnie) alias z tytułu.
    const v = value as RentalClientProposal;
    try {
      await changeRentalClient({ rentalId: v.rentalId, clientId: p.clientId!, userId: actor.userId, alias: v.alias });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (p.kind === "CLIENT_ALIAS") {
    const v = value as { title: string; key: string };
    await prisma.clientAlias.upsert({ where: { alias: v.key }, create: { alias: v.key, clientId: p.clientId!, createdByUserId: actor.userId || null }, update: {} });
    await recordChanges(prisma, { userId: actor.userId, provenance: { source: p.source, confidence: p.confidence as "HIGH" | "MEDIUM" | "LOW", batch: p.batch }, approvedById }, [
      { entity: "CLIENT", entityId: p.clientId!, clientId: p.clientId, operation: "CREATE", field: "alias", before: null, after: toLogValue(v.key) },
    ]);
    // Alias uczy dopasowanie: rezerwacje i historia z tym tytułem.
    await linkUnassignedRentals({ userId: actor.userId });
    await rematchHistory();
    return { ok: true };
  }
  if (p.kind === "CLIENT_PRICE") {
    const v = value as { device: string; days: number; priceNet: string | null; source: string; sourceRef: string | null };
    return upsertClientPrice(p.clientId!, { ...v, priceNet: v.priceNet != null ? Number(v.priceNet) : null }, { userId: actor.userId, provenance: { source: p.source, confidence: p.confidence as "HIGH" | "MEDIUM" | "LOW", batch: p.batch }, approvedById });
  }
  if (p.kind === "DELIVERY_ADDRESS") {
    const { addressId, ...fields } = value as { addressId: string | null } & Record<string, unknown>;
    const who = { userId: actor.userId, provenance: { source: p.source, confidence: p.confidence as "HIGH" | "MEDIUM" | "LOW", batch: p.batch }, approvedById };
    const r = addressId ? await updateAddress(p.clientId!, addressId, fields, who) : await createAddress(p.clientId!, fields, who);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "SPLIT") {
    const input = value as SplitInput;
    const r = await splitClient(p.clientId!, { ...input, historyKeys: input.historyKeys ?? [] }, provenance, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "EXCLUSION") {
    const v = value as { values: string[]; kind: "EXCLUDE" | "HIDE"; note: string | null };
    await addExclusions(v.values.join("\n"), v.kind, [v.note, `propozycja agenta, źródło: ${p.source}`].filter(Boolean).join(" · "), approvedById);
    return { ok: true };
  }
  if (p.kind === "PAYMENT_MATCH") {
    const r = await applyPaymentMatch(value as PaymentMatchInput, { userId: actor.userId, provenance: { source: p.source, confidence: p.confidence as "HIGH" | "MEDIUM" | "LOW", batch: p.batch }, approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  if (p.kind === "MERGE") {
    const r = await mergeClients(p.clientId!, (value as { duplicateId: string }).duplicateId, provenance, actor, { approvedById });
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  }
  // ARCHIVE — archiwizuje zatwierdzający ADMIN (agent nie archiwizuje sam).
  const input = value as ArchiveInput;
  const n = await archiveRecords(
    p.leadId ? "lead" : "client",
    [p.leadId ?? p.clientId!],
    { reason: input.reason, note: `${input.note} (propozycja agenta, źródło: ${p.source})`, batch: p.batch },
    { userId: approvedById ?? actor.userId, role: "ADMIN" },
    { approvedById },
  );
  return n > 0 ? { ok: true } : { ok: false, message: "Rekord jest już w archiwum albo nie istnieje." };
}

// --- decyzje ADMIN ---

export type DecisionResult = { accepted: number; rejected: number; conflicts: { id: string; current: string | null }[]; failed: { id: string; message: string }[] };

export async function decideProposals(ids: string[], action: "accept" | "reject", admin: Actor, opts: { comment?: string | null; force?: boolean } = {}): Promise<DecisionResult> {
  const result: DecisionResult = { accepted: 0, rejected: 0, conflicts: [], failed: [] };
  const rows = await prisma.changeProposal.findMany({ where: { id: { in: ids.slice(0, 500) }, status: "PENDING" } });
  const comment = opts.comment?.trim() || null;
  for (const p of rows) {
    if (action === "reject") {
      await prisma.changeProposal.update({ where: { id: p.id }, data: { status: "REJECTED", decidedById: admin.userId, decidedAt: new Date(), decisionComment: comment } });
      result.rejected++;
      continue;
    }
    // Wartość zmieniła się od zgłoszenia — bez „force” pomijamy (konflikt).
    const now = await currentFor(p).catch(() => null);
    if (!opts.force && p.currentValue !== null && now !== null && !sameLogValue(now, p.currentValue)) {
      result.conflicts.push({ id: p.id, current: now });
      continue;
    }
    const res = await execute(p.id, admin.userId);
    if (!res.ok) {
      await prisma.changeProposal.update({ where: { id: p.id }, data: { executionError: res.message } });
      result.failed.push({ id: p.id, message: res.message });
      continue;
    }
    await prisma.changeProposal.update({
      where: { id: p.id },
      data: { status: "ACCEPTED", decidedById: admin.userId, decidedAt: new Date(), decisionComment: comment, executedAt: new Date(), executionError: null },
    });
    result.accepted++;
  }
  return result;
}

// Poprawka wartości przez ADMIN przed akceptacją (tylko zmiany pól).
export async function editProposalValue(id: string, value: unknown, admin: Actor) {
  const p = await prisma.changeProposal.findUnique({ where: { id } });
  if (!p) throw new PorzadkiError("Propozycja nie istnieje.", 404);
  if (p.status !== "PENDING") throw new PorzadkiError("Poprawiać można tylko oczekujące propozycje.", 409);
  if (p.kind !== "FIELD" && p.kind !== "CONTACT_FIELD") throw new PorzadkiError("Poprawić można tylko wartość pola.");
  const proposedValue = toLogValue(normalizeProposed({ kind: p.kind, field: p.field, proposed: value } as ParsedProposal));
  await prisma.changeProposal.update({ where: { id }, data: { proposedValue, editedById: admin.userId, executionError: null } });
}

// --- lista ---

export type ChangeProposalFilters = { status?: string | null; batch?: string | null; clientId?: string | null; confidence?: string | null; kind?: string | null; executed?: boolean | null };

export async function listChangeProposals(f: ChangeProposalFilters): Promise<ChangeProposalRow[]> {
  const rows = await prisma.changeProposal.findMany({
    where: {
      ...(f.status ? { status: f.status } : {}),
      ...(f.batch ? { batch: f.batch } : {}),
      ...(f.clientId ? { clientId: f.clientId } : {}),
      ...(f.confidence ? { confidence: f.confidence } : {}),
      ...(f.kind ? { kind: f.kind } : {}),
      ...(f.executed === true ? { executedAt: { not: null } } : f.executed === false ? { executedAt: null } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 2000,
    include: { client: { select: { name: true } } },
  });
  const userIds = [...new Set(rows.flatMap((r) => [r.authorId, r.decidedById]).filter((x): x is string => !!x))];
  const contactIds = [...new Set(rows.map((r) => r.contactId).filter((x): x is string => !!x))];
  const leadIds = [...new Set(rows.map((r) => r.leadId).filter((x): x is string => !!x))];
  const dupId = (r: { kind: string; proposedValue: string | null }) =>
    r.kind === "MERGE" && r.proposedValue ? ((JSON.parse(r.proposedValue) as { duplicateId?: string }).duplicateId ?? null) : null;
  const dupIds = [...new Set(rows.map(dupId).filter((x): x is string => !!x))];
  const [users, contacts, leads, dups] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
    contactIds.length ? prisma.clientContact.findMany({ where: { id: { in: contactIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : [],
    leadIds.length ? prisma.lead.findMany({ where: { id: { in: leadIds } }, select: { id: true, title: true } }) : [],
    dupIds.length ? prisma.client.findMany({ where: { id: { in: dupIds } }, select: { id: true, name: true } }) : [],
  ]);
  const dupName = new Map(dups.map((c) => [c.id, c.name]));
  const userName = new Map(users.map((u) => [u.id, u.name]));
  const contactName = new Map(contacts.map((c) => [c.id, [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "osoba"]));
  const leadTitle = new Map(leads.map((l) => [l.id, l.title]));
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind as ProposalKind,
    clientId: r.clientId,
    clientName: r.client?.name ?? null,
    contactId: r.contactId,
    contactName: r.contactId ? (contactName.get(r.contactId) ?? null) : null,
    leadId: r.leadId,
    leadTitle: r.leadId ? (leadTitle.get(r.leadId) ?? null) : null,
    duplicateName: dupId(r) ? (dupName.get(dupId(r)!) ?? null) : null,
    field: r.field,
    currentValue: r.currentValue,
    proposedValue: r.proposedValue,
    source: r.source,
    confidence: r.confidence,
    batch: r.batch,
    changeClass: r.changeClass,
    status: r.status as ChangeProposalStatus,
    autoApproved: r.autoApproved,
    authorName: r.authorId ? (userName.get(r.authorId) ?? null) : null,
    decidedByName: r.decidedById ? (userName.get(r.decidedById) ?? null) : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionComment: r.decisionComment,
    executedAt: r.executedAt?.toISOString() ?? null,
    executionError: r.executionError,
    edited: !!r.editedById,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function countPendingForClient(clientId: string): Promise<number> {
  return prisma.changeProposal.count({ where: { clientId, status: "PENDING" } });
}

// --- klasy zatwierdzane automatycznie ---

export async function listAutoClasses() {
  const rows = await prisma.autoApprovedClass.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({ key: r.key, label: r.label, createdAt: r.createdAt.toISOString() }));
}
