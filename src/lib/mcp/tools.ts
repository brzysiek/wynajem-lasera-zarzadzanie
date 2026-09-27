import { prisma } from "@/lib/prisma";
import { normalizePolishPhone } from "@/lib/reminders";
import type { AgentCtx } from "@/lib/agent-api/handler";
import { AgentApiError } from "@/lib/agent-api/handler";
import { listAgentClients, parseRegion } from "@/lib/agent-api/clients";
import { loadUnassignedRentals } from "@/lib/clients/rental-match";
import { parseManualEntry } from "@/lib/agent-api/manual-entry";
import { paginate } from "@/lib/agent-api/token";
import { loadClientDetail } from "@/lib/clients/load";
import { patchClient, patchContact } from "@/lib/clients/update";
import { mergeClients } from "@/lib/clients/merge";
import { isQualificationActive, qualifyClient } from "@/lib/clients/qualify";
import { parseContactInput } from "@/lib/clients/validate";
import { loadLeadDetail, loadLeadRows } from "@/lib/leads/load";
import { addLeadNote } from "@/lib/leads/actions";
import { loadHistoryReview } from "@/lib/history/review-load";
import { loadFvWithoutInvoice } from "@/lib/invoicing/fv-check-load";
import { listArchive } from "@/lib/porzadki/archive";
import { listRules } from "@/lib/porzadki/cleanup-rules";
import { listChangeLog } from "@/lib/changelog/load";
import { toLogValue } from "@/lib/changelog/diff";
import { parseProvenance } from "@/lib/changelog/provenance";
import { recordChanges } from "@/lib/changelog/record";
import { addProposalComment, createProposal, findSimilar, listProposals, loadProposal, setProposalStatus, updateProposal } from "@/lib/porzadki/proposals";
import { isStatus, parseProposalInput, type ProposalInput } from "@/lib/porzadki/rules";
import { createRemark, listRemarks, parseRemarkInput, updateRemark, type RemarkInput } from "@/lib/porzadki/remarks";
import { normalizeRemarkBody } from "@/lib/agent-api/remark-body";
import { taskDto } from "@/lib/tasks";
import { agentAssignees } from "@/lib/agent-api/assignees";
import { agentMatchDecision } from "@/lib/agent-api/match-decision";
import { listSuspectedBlobs } from "@/lib/clients/blob-load";
import { listAutoClasses, listChangeProposals, submitProposals } from "@/lib/porzadki/change-proposals";
import { listPaymentsForAgent, loadPaymentCoverage } from "@/lib/invoicing/bank-transfers";
import { invoicePaymentStatus, paymentLabel } from "@/lib/clients/payment-status";
import { dropNullJson } from "@/lib/clients/profile-fields";
import { addOpportunity } from "@/lib/clients/opportunities";
import { listExclusions } from "@/lib/porzadki/exclusions";
import { getHideKeywords } from "@/lib/porzadki/exclusion-load";

// Narzędzia serwera MCP (/api/mcp) dla konta z rolą AGENT — te same reguły
// co panel i API agenta (src/lib/permissions.ts): odczyt + zapisy agenta,
// bez usuwania, archiwizacji, rezerwacji, faktur, SMS-ów i maili. Zmiany
// danych klientów zawsze ze źródłem, pewnością i paczką → dziennik zmian.

type Args = Record<string, unknown>;
type JsonSchema = Record<string, unknown>;
export type McpTool = {
  name: string;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  readOnly: boolean;
  run: (args: Args, agent: AgentCtx) => Promise<unknown>;
};

const s = (description: string, extra: JsonSchema = {}) => ({ type: "string", description, ...extra });
const n = (description: string) => ({ type: "integer", description });
const b = (description: string) => ({ type: "boolean", description });
const obj = (properties: Record<string, JsonSchema>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });

const PROVENANCE = {
  zrodlo: s("Źródło / dowód zmiany, np. „mail kontakt@ 2026-03-14, temat …”, „Biała lista NIP”, „FV 12/03/2026”."),
  pewnosc: s("Pewność zmiany.", { enum: ["wysoka", "srednia", "niska"] }),
  paczka: s("Paczka akceptacji, np. P-2026-09-27-01."),
};
const PAGE = { strona: n("Numer strony (od 1)."), na_strone: n("Rozmiar strony, 1–200 (domyślnie 50).") };

function str(a: Args, k: string): string | null {
  const v = a[k];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function req(a: Args, k: string): string {
  const v = str(a, k);
  if (!v) throw new AgentApiError(`Brak parametru ${k}.`);
  return v;
}
function day(a: Args, k: string): Date | null {
  const v = str(a, k);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new AgentApiError(`${k}: data RRRR-MM-DD.`);
  return new Date(`${v}T00:00:00.000Z`);
}
function page(a: Args) {
  const pageNo = Math.max(1, Math.floor(Number(a.strona) || 1));
  const perPage = Math.min(200, Math.max(1, Math.floor(Number(a.na_strone) || 50)));
  return { page: pageNo, perPage, skip: (pageNo - 1) * perPage };
}
function withoutKeys(a: Args, keys: string[]): Args {
  return Object.fromEntries(Object.entries(a).filter(([k]) => !keys.includes(k)));
}

// Odpowiedzialny za zadanie: id albo imię/nazwa osoby z biura (ADMIN/STAFF).
async function officePerson(ref: string): Promise<{ id: string; name: string }> {
  const people = await agentAssignees();
  const low = ref.toLowerCase();
  const hit = people.find((p) => p.id === ref) ?? people.find((p) => p.name.toLowerCase() === low) ?? people.find((p) => p.name.toLowerCase().startsWith(low));
  if (!hit) throw new AgentApiError(`Nie znam osoby „${ref}” w biurze. Dostępne: ${people.map((p) => p.name).join(", ")}.`);
  return hit;
}

const TASK_INCLUDE = {
  author: { select: { id: true, name: true, grammaticalGender: true } },
  assignee: { select: { id: true, name: true } },
  _count: { select: { comments: true } },
} as const;

export const TOOLS: McpTool[] = [
  // ------------------------------------------------------------- odczyt
  {
    name: "reguly_porzadkow",
    title: "Reguły porządków",
    description: "Stałe ustalenia porządkowania danych (np. „samo imię nie wystarcza do dopasowania”). Przeczytaj przed pracą.",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ rules: await listRules() }),
  },
  {
    name: "klienci_lista",
    title: "Lista klientów",
    description:
      "Klienci i kontakty z zapytań z paginacją. Filtry: brak telefonu / NIP / miasta, status (POTENCJALNY, NOWY, STALY, USPIONY, BYLY, NIE_KONTAKTOWAC), miasto, region, " +
      "„przed sezonem” (wynajmowały w poprzednim półroczu, a na bieżące nie mają wynajmu ani rezerwacji), bez następnego kroku, zmienione od daty, tylko kontakty z zapytań, wyszukiwanie (także nazwa robocza i aliasy z kalendarzy). " +
      "Każdy rekord: shortName, region, rentals12m, nextRental (unassigned = rezerwacja bez klienta z propozycją), rhythmDays, churnRisk, nextStep, beforeSeason, check (status do sprawdzenia).",
    inputSchema: obj({
      brak_telefonu: b("Tylko bez telefonu."),
      brak_nip: b("Tylko bez NIP."),
      brak_miasta: b("Tylko bez miasta."),
      status: s("Status klienta.", { enum: ["POTENCJALNY", "NOWY", "STALY", "USPIONY", "BYLY", "NIE_KONTAKTOWAC"] }),
      miasto: s("Fragment nazwy miasta."),
      region: s("Region z kodu pocztowego / miasta.", { enum: ["KRAKOWSKI", "MALOPOLSKA", "PODKARPACIE", "SLASK", "SWIETOKRZYSKIE", "INNE"] }),
      przed_sezonem: b("Tylko „przed sezonem” (pętla półroczy I–VIII / IX–XII)."),
      bez_nastepnego_kroku: b("Tylko bez następnego kroku (brak pola, zadania i zaplanowanego kontaktu)."),
      zmienione_od: s("Dane zmienione od daty RRRR-MM-DD."),
      zapytania: b("true = tylko kontakty z zapytań, false = tylko klienci (działa po włączeniu kwalifikacji klientów)."),
      q: s("Szukaj: nazwa, NIP, osoba, e-mail, telefon."),
      ...PAGE,
    }),
    readOnly: true,
    run: async (a) => {
      const list = await listAgentClients({
        missingPhone: a.brak_telefonu === true,
        missingNip: a.brak_nip === true,
        missingCity: a.brak_miasta === true,
        status: str(a, "status"),
        city: str(a, "miasto"),
        changedSince: day(a, "zmienione_od"),
        inquiries: typeof a.zapytania === "boolean" ? a.zapytania : null,
        q: str(a, "q"),
        region: str(a, "region"),
        beforeSeason: a.przed_sezonem === true,
        noNextStep: a.bez_nastepnego_kroku === true,
      });
      if (str(a, "region") && !parseRegion(str(a, "region"))) throw new AgentApiError("region: KRAKOWSKI, MALOPOLSKA, PODKARPACIE, SLASK, SWIETOKRZYSKIE albo INNE.");
      // Dopóki kwalifikacja jest wyłączona (Ustawienia → Klienci), wszyscy są
      // „klientami” — filtr zapytania=true zwraca wtedy pustą listę.
      const qualification = typeof a.zapytania === "boolean" ? await isQualificationActive() : null;
      return {
        ...paginate(list, page(a)),
        ...(qualification === false ? { uwaga: "Kwalifikacja klientów jest wyłączona — wszyscy są na liście klientów, więc kontaktów z zapytań nie wyróżniamy (zapytania=true zwraca 0)." } : {}),
      };
    },
  },
  {
    name: "rezerwacje_bez_klienta",
    title: "Rezerwacje bez klienta",
    description:
      "Przyszłe rezerwacje z kalendarzy urządzeń bez przypisanego klienta (wniosek 13), z propozycją klienta (alias z dopasowań, seria tytułu, podobieństwo nazwy; pewnosc 0–1). " +
      "Pewne dopasowania (alias, ta sama seria, kontakt HubSpot) panel przypisuje sam przy synchronizacji kalendarzy. Tylko odczyt: agent NIE zmienia rezerwacji — " +
      "listę do potwierdzenia zgłasza biuru (np. zadanie_utworz dla Ani); potwierdza biuro w Klienci → Dopasowania historii, sekcja „Rezerwacje bez klienta”.",
    inputSchema: obj({ ...PAGE }),
    readOnly: true,
    run: async (a) => {
      const list = await loadUnassignedRentals();
      return paginate(
        list.map((r) => ({
          id: r.id,
          tytul: r.title,
          od: r.startsAt,
          do: r.endsAt,
          urzadzenie: r.deviceName,
          typ: r.eventType,
          propozycje: r.candidates.map((c) => ({ klientId: c.clientId, nazwa: c.name, nazwaRobocza: c.shortName, miasto: c.city, pewnosc: c.score })),
        })),
        page(a),
      );
    },
  },
  {
    name: "klient",
    title: "Karta klienta",
    description:
      "Pełna karta klienta: dane, osoby (z rolami, zwrotem, kanałem, szkoleniami), wynajmy i faktury (status wpłaty z wyciągów), komunikacja, historia; " +
      "profile = nowe pola karty (REGON, forma, PKD, VAT, paszport dostawy, profil gabinetu, zgody, następny krok); fieldMeta = pochodzenie każdego pola " +
      "(source, sourceRef, verifiedAt, verifiedBy, lockedManual); rhythm = pola liczone (rytm, dzień tygodnia, urządzenie, przerwa, prognoza, ryzyko); opportunities = szanse sprzedaży.",
    inputSchema: obj({ id: s("ID klienta.") }, ["id"]),
    readOnly: true,
    run: async (a) => {
      const d = await loadClientDetail(req(a, "id"));
      if (!d) throw new AgentApiError("Nie znaleziono klienta.", 404);
      return d;
    },
  },
  {
    name: "sygnaly_lista",
    title: "Lista sygnałów",
    description: "Sygnały (zapytania) od najnowszych, z paginacją. Filtry: etap, typ, wpłynęło od, do obdzwonienia, klient, szukaj.",
    inputSchema: obj({
      etap: s("Etap.", { enum: ["SYGNAL", "WYWIAD", "OFERTA", "REZERWACJA", "WYGRANA", "PRZEGRANA"] }),
      typ: s("Typ.", { enum: ["POBRANIE_CENNIKA", "KONTAKT", "REZERWACJA_WWW", "SZKOLENIE_WWW", "TELEFON", "EMAIL", "INNE"] }),
      od: s("Wpłynęło od RRRR-MM-DD."),
      do_obdzwonienia: b("Tylko lista „Do obdzwonienia”."),
      klient_id: s("ID klienta."),
      q: s("Szukaj."),
      ...PAGE,
    }),
    readOnly: true,
    run: async (a) => {
      const from = day(a, "od");
      const q = str(a, "q")?.toLowerCase() ?? "";
      const rows = (await loadLeadRows()).filter(
        (r) =>
          (!str(a, "etap") || r.stage === str(a, "etap")) &&
          (!str(a, "typ") || r.type === str(a, "typ")) &&
          (!from || new Date(r.createdAt) >= from) &&
          (a.do_obdzwonienia !== true || r.callList) &&
          (!str(a, "klient_id") || r.clientId === str(a, "klient_id")) &&
          (!q || [r.title, r.person, r.email, r.phone, r.clientName, r.city].filter(Boolean).join(" ").toLowerCase().includes(q)),
      );
      rows.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return paginate(rows, page(a));
    },
  },
  {
    name: "sygnal",
    title: "Karta sygnału",
    description: "Szczegół sygnału z osią czasu.",
    inputSchema: obj({ id: s("ID sygnału.") }, ["id"]),
    readOnly: true,
    run: async (a) => {
      const d = await loadLeadDetail(req(a, "id"));
      if (!d) throw new AgentApiError("Sygnał nie istnieje.", 404);
      return d;
    },
  },
  {
    name: "kalendarz_wynajmy",
    title: "Kalendarz wynajmów",
    description: "Wynajmy i szkolenia w zakresie dat (maks. 93 dni): urządzenie, klient, adres, kierowca, rozliczenie, znacznik FV i faktura.",
    inputSchema: obj({ od: s("Od RRRR-MM-DD."), do: s("Do RRRR-MM-DD (włącznie).") }, ["od", "do"]),
    readOnly: true,
    run: async (a) => {
      const from = day(a, "od")!;
      const to = new Date(day(a, "do")!.getTime() + 86_399_999);
      if (to.getTime() - from.getTime() > 93 * 86_400_000) throw new AgentApiError("Zakres maks. 93 dni.");
      const rows = await prisma.rental.findMany({
        where: { deletedInGoogle: false, startsAt: { lte: to }, endsAt: { gte: from } },
        orderBy: { startsAt: "asc" },
        select: {
          id: true,
          title: true,
          startsAt: true,
          endsAt: true,
          eventType: true,
          clientId: true,
          client: { select: { name: true } },
          contactNameCache: true,
          contactPhoneCache: true,
          contactCompanyCache: true,
          deliveryAddress: true,
          device: { select: { name: true } },
          driver: { select: { name: true } },
          finance: { select: { vatApplicable: true, totalNet: true, totalGross: true, paymentMethod: true, fakturowniaInvoiceNumber: true, confirmedAt: true } },
        },
      });
      return {
        rentals: rows.map((r) => ({
          id: r.id,
          title: r.title,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          eventType: r.eventType,
          device: r.device.name,
          clientId: r.clientId,
          clientName: r.client?.name ?? r.contactCompanyCache ?? r.contactNameCache,
          contactPhone: r.contactPhoneCache,
          deliveryAddress: r.deliveryAddress,
          driver: r.driver?.name ?? null,
          fv: r.finance?.vatApplicable ?? false,
          totalNet: r.finance?.totalNet.toString() ?? null,
          totalGross: r.finance?.totalGross.toString() ?? null,
          payment: r.finance?.paymentMethod ?? null,
          invoiceNumber: r.finance?.fakturowniaInvoiceNumber ?? null,
          driverReport: r.finance?.confirmedAt ? "potwierdzony" : "brak",
        })),
      };
    },
  },
  {
    name: "dopasowania",
    title: "Dopasowania historii",
    description: "Grupy wydarzeń z kalendarzy i faktury z Fakturowni ze stanem dopasowania do klienta.",
    inputSchema: obj({ stan: s("Stan dopasowania.", { enum: ["UNMATCHED", "SUGGESTED", "AUTO", "CONFIRMED", "IGNORED"] }) }),
    readOnly: true,
    run: async (a) => {
      const state = str(a, "stan");
      const data = await loadHistoryReview();
      return {
        totals: data.totals,
        groups: state ? data.groups.filter((g) => g.state === state) : data.groups,
        invoices: state ? data.invoices.filter((i) => i.state === state) : data.invoices,
      };
    },
  },
  {
    name: "podejrzane_zlepki",
    title: "Podejrzane zlepki klientów",
    description:
      "Klienci, pod którymi prawdopodobnie jest kilka gabinetów (osoby z adresami zastępczymi typu brak.pl, faktury na różne NIP-y, NIP spoza faktur, firma HubSpot łącząca wiele osób) — od najbardziej podejrzanych, z uzasadnieniem.",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ blobs: await listSuspectedBlobs() }),
  },
  {
    name: "faktury",
    title: "Faktury z Fakturowni",
    description:
      "Faktury (kopia w panelu) z paginacją i statusem wpłaty: zapłacona (przelew z wyciągu) / gotówka (oznaczona ręcznie: data, kto przyjął) / częściowo / " +
      "po terminie (tylko klient z formą płatności „przelew”) / brak przelewu (wyciąg obejmuje termin, przelewu nie ma — może gotówka) / nie sprawdzono. " +
      "Filtry: data sprzedaży od/do, klient, NIP, bez klienta, bez wynajmu. faktura_id = ID faktury w Fakturowni (do narzędzia platnosci i propozycji dopasowanie_platnosci).",
    inputSchema: obj({
      od: s("Data sprzedaży od RRRR-MM-DD."),
      do: s("Data sprzedaży do RRRR-MM-DD."),
      klient_id: s("ID klienta."),
      nip: s("NIP nabywcy."),
      bez_klienta: b("Tylko bez przypisanego klienta."),
      bez_wynajmu: b("Tylko bez powiązanego wynajmu."),
      ...PAGE,
    }),
    readOnly: true,
    run: async (a) => {
      const from = day(a, "od");
      const to = day(a, "do");
      const where = {
        ...(from || to ? { sellDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(str(a, "klient_id") ? { clientId: str(a, "klient_id") } : {}),
        ...(str(a, "nip") ? { buyerTaxNo: str(a, "nip")!.replace(/\D/g, "") } : {}),
        ...(a.bez_klienta === true ? { clientId: null } : {}),
        ...(a.bez_wynajmu === true ? { rentalId: null } : {}),
      };
      const p = page(a);
      const [total, rows, coverage] = await Promise.all([
        prisma.clientInvoice.count({ where }),
        prisma.clientInvoice.findMany({ where, orderBy: { sellDate: "desc" }, skip: p.skip, take: p.perPage, include: { client: { select: { name: true, paymentForm: true } } } }),
        loadPaymentCoverage(),
      ]);
      const payments = await prisma.fakturowniaPayment.findMany({ where: { fakturowniaInvoiceId: { in: rows.map((r) => r.fakturowniaInvoiceId) } } });
      const transfers = await prisma.bankTransfer.findMany({ where: { id: { in: payments.map((x) => x.bankTransferId).filter((x): x is string => !!x) } }, select: { id: true, amount: true } });
      const paid = new Map(payments.map((x) => [x.fakturowniaInvoiceId, x]));
      const amount = new Map(transfers.map((t) => [t.id, Number(t.amount.toString())]));
      const today = new Date();
      return {
        paymentsAsOf: coverage ? coverage.to.toISOString().slice(0, 10) : null,
        items: rows.map((r) => {
          const pay = paid.get(r.fakturowniaInvoiceId);
          const status = invoicePaymentStatus(
            {
              paidAt: pay?.paidAt ?? null,
              paidAmount: pay?.bankTransferId ? (amount.get(pay.bankTransferId) ?? null) : null,
              paidMethod: (pay?.method as "CASH" | "TRANSFER" | "MANUAL" | null | undefined) ?? null,
              paidReceivedBy: pay?.receivedBy ?? null,
              clientPaymentForm: r.client?.paymentForm ?? null,
              totalGross: Number(r.totalGross.toString()),
              paymentType: r.paymentType,
              paymentTo: r.paymentTo,
              issueDate: r.issueDate,
              archived: r.fakturowniaInvoiceId < 0,
              cashConfirmed: false,
            },
            today,
            coverage,
          );
          return {
            id: r.id,
            fakturowniaId: r.fakturowniaInvoiceId,
            number: r.number,
            sellDate: r.sellDate.toISOString().slice(0, 10),
            buyerName: r.buyerName,
            buyerTaxNo: r.buyerTaxNo,
            totalGross: r.totalGross.toString(),
            positions: r.positionsSummary,
            clientId: r.clientId,
            clientName: r.client?.name ?? null,
            rentalId: r.rentalId,
            matchState: r.matchState,
            paymentTo: r.paymentTo?.toISOString().slice(0, 10) ?? null,
            payment: { status: status.kind, label: paymentLabel(status), paidAt: pay?.paidAt.toISOString().slice(0, 10) ?? null, method: pay?.method ?? null, receivedBy: pay?.receivedBy ?? null, byBankTransfer: !!pay?.bankTransferId },
          };
        }),
        page: p.page,
        perPage: p.perPage,
        total,
      };
    },
  },
  {
    name: "wykluczenia",
    title: "Lista wykluczeń domen",
    description:
      "Tylko odczyt. Domeny i adresy z listy wykluczeń (EXCLUDE: maile nie trafiają do panelu, kontakty i transakcje z HubSpota nie tworzą klientów ani sygnałów; " +
      "HIDE: wątki ukryte w historii klienta, chyba że temat / skrót zawiera słowa o wynajmie) i te słowa. Nowe domeny zgłaszaj propozycją rodzaju wykluczenie w propozycje_dodaj.",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ rows: await listExclusions(), keywords: await getHideKeywords() }),
  },
  {
    name: "szansa_dodaj",
    title: "Dodaj szansę sprzedaży",
    description:
      "Dodaje szansę sprzedaży na karcie klienta (sekcja „Szanse sprzedaży”): urzadzenie (temat, np. „Cooltech – modelowanie ciała”), etap (pomysl | rozmowa | oferta | decyzja), " +
      "szansa (wysoka | srednia | niska | sprawdzic), ostatni_kontakt i wrocic (RRRR-MM-DD), opis. Wpis w dzienniku. Wymagane: zrodlo, pewnosc, paczka.",
    inputSchema: obj(
      {
        klient_id: s("ID klienta."),
        urzadzenie: s("Urządzenie / temat szansy."),
        etap: s("Etap.", { enum: ["pomysl", "rozmowa", "oferta", "decyzja"] }),
        szansa: s("Ocena szansy.", { enum: ["wysoka", "srednia", "niska", "sprawdzic"] }),
        ostatni_kontakt: s("Ostatni kontakt RRRR-MM-DD."),
        wrocic: s("Kiedy wrócić RRRR-MM-DD."),
        opis: s("Opis (skąd wiadomo, co ustalono)."),
        ...PROVENANCE,
      },
      ["klient_id", "urzadzenie", "zrodlo", "pewnosc", "paczka"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const prov = parseProvenance(a, { required: true });
      if (!prov.ok) throw new AgentApiError(prov.message);
      if (!prov.value.batch) throw new AgentApiError("Podaj paczkę zmiany (paczka).");
      const r = await addOpportunity(req(a, "klient_id"), withoutKeys(a, ["klient_id", "zrodlo", "pewnosc", "paczka"]), { userId: agent.userId, provenance: prov.value });
      if (!r.ok) throw new AgentApiError(r.message, r.status);
      return { id: r.id };
    },
  },
  {
    name: "platnosci",
    title: "Wpłaty z wyciągów bankowych",
    description:
      "Tylko odczyt. Przelewy przychodzące z wgranych wyciągów CSV (Finanse) z dopasowaniem do faktur: stan AUTO / MANUAL / AMBIGUOUS (kandydaci) / NONE; " +
      "lista nieopłaconych faktur w zakresie śledzenia wpłat (status po terminie / nie sprawdzono / oczekuje); data ostatniego importu i „wpłaty aktualne na”. " +
      "Niedopasowany przelew zgłoś propozycją rodzaju dopasowanie_platnosci (przelew_id, faktura_id) w propozycje_dodaj.",
    inputSchema: obj({
      od: s("Data przelewu od RRRR-MM-DD."),
      do: s("Data przelewu do RRRR-MM-DD."),
      stan: s("Stan przelewów.", { enum: ["niedopasowane", "dopasowane", "AUTO", "MANUAL", "AMBIGUOUS", "NONE"] }),
      klient_id: s("ID klienta — przelewy dopasowane do jego faktur i jego nieopłacone faktury."),
      ...PAGE,
    }),
    readOnly: true,
    run: async (a) => {
      const p = page(a);
      return { ...(await listPaymentsForAgent({ from: day(a, "od"), to: day(a, "do"), state: str(a, "stan"), clientId: str(a, "klient_id"), skip: p.skip, take: p.perPage })), page: p.page, perPage: p.perPage };
    },
  },
  {
    name: "fv_bez_faktury",
    title: "FV bez faktury",
    description: "Zakończone wynajmy ze znacznikiem FV bez faktury, z podpowiedzią prawdopodobnej faktury z Fakturowni.",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ rentals: await loadFvWithoutInvoice() }),
  },
  {
    name: "archiwum",
    title: "Archiwum",
    description: "Co już jest w archiwum (sprawdź przed zaproponowaniem archiwizacji). Archiwizuje administrator.",
    inputSchema: obj({ typ: s("Typ.", { enum: ["client", "lead"] }), powod: s("Powód archiwizacji."), paczka: s("Paczka."), q: s("Szukaj.") }),
    readOnly: true,
    run: async (a) => ({ rows: await listArchive({ type: str(a, "typ"), reason: str(a, "powod"), batch: str(a, "paczka"), q: str(a, "q") }) }),
  },
  {
    name: "dziennik",
    title: "Dziennik zmian",
    description: "Wpisy dziennika zmian (przed → po, źródło, pewność, paczka). Filtry: klient, paczka, obiekt, daty, szukaj.",
    inputSchema: obj({
      klient_id: s("ID klienta."),
      paczka: s("Paczka."),
      obiekt: s("Obiekt.", { enum: ["CLIENT", "CONTACT", "LEAD", "HISTORY", "INVOICE", "TASK", "NOTE"] }),
      od: s("Od RRRR-MM-DD."),
      do: s("Do RRRR-MM-DD."),
      q: s("Szukaj."),
      limit: n("Maks. wpisów (domyślnie 300)."),
    }),
    readOnly: true,
    run: async (a) => {
      const to = day(a, "do");
      return {
        entries: await listChangeLog(
          { clientId: str(a, "klient_id"), batch: str(a, "paczka"), entity: str(a, "obiekt"), from: day(a, "od"), to: to ? new Date(to.getTime() + 86_399_999) : null, q: str(a, "q") },
          Number(a.limit) || 300,
        ),
      };
    },
  },
  {
    name: "wnioski_lista",
    title: "Wnioski",
    description: "Wnioski o zmiany w panelu i procesie. Filtry: status (open = otwarte), obszar, typ, priorytet, blokuje, klient, szukaj.",
    inputSchema: obj({ status: s("open albo kod statusu."), obszar: s("Obszar."), typ: s("Typ."), priorytet: s("HIGH, MEDIUM, LOW."), blokuje: b("Tylko blokujące porządki."), klient_id: s("ID klienta."), q: s("Szukaj.") }),
    readOnly: true,
    run: async (a) =>
      listProposals({
        status: str(a, "status"),
        area: str(a, "obszar"),
        type: str(a, "typ"),
        priority: str(a, "priorytet"),
        blocks: typeof a.blokuje === "boolean" ? a.blokuje : null,
        clientId: str(a, "klient_id"),
        q: str(a, "q"),
      }),
  },
  {
    name: "wniosek",
    title: "Wniosek",
    description: "Szczegół wniosku: pola, historia statusów, komentarze, powiązania.",
    inputSchema: obj({ id: s("ID wniosku.") }, ["id"]),
    readOnly: true,
    run: async (a, agent) => {
      const p = await loadProposal(req(a, "id"), agent);
      if (!p) throw new AgentApiError("Wniosek nie istnieje.", 404);
      return p;
    },
  },
  {
    name: "uwagi_lista",
    title: "Uwagi",
    description: "Uwagi (obserwacje). Filtry: status OPEN/CLOSED, obszar, klient, szukaj.",
    inputSchema: obj({ status: s("Status.", { enum: ["OPEN", "CLOSED"] }), obszar: s("Obszar."), klient_id: s("ID klienta."), q: s("Szukaj.") }),
    readOnly: true,
    run: async (a, agent) => ({ remarks: await listRemarks({ status: str(a, "status"), area: str(a, "obszar"), clientId: str(a, "klient_id"), q: str(a, "q") }, agent) }),
  },
  {
    name: "zadania_lista",
    title: "Zadania",
    description: "Zadania zespołu. status: open (domyślnie), done, all. moje = tylko utworzone przez agenta.",
    inputSchema: obj({ status: s("Status.", { enum: ["open", "done", "all"] }), moje: b("Tylko moje (utworzone przez agenta).") }),
    readOnly: true,
    run: async (a, agent) => {
      const st = str(a, "status") ?? "open";
      const rows = await prisma.task.findMany({
        where: { ...(st === "open" ? { status: "OPEN" as const } : st === "done" ? { status: "DONE" as const } : {}), ...(a.moje === true ? { authorId: agent.userId } : {}) },
        include: TASK_INCLUDE,
        orderBy: [{ status: "asc" }, { dueDate: "asc" }, { createdAt: "desc" }],
        take: 500,
      });
      return { tasks: rows.map(taskDto) };
    },
  },
  {
    name: "osoby_biura",
    title: "Osoby z biura",
    description: "Komu można przypisać zadanie (osoby wskazane przez administratora — dziś Tomek i Ania).",
    inputSchema: obj({}),
    readOnly: true,
    run: async () => ({ people: await agentAssignees() }),
  },

  // ------------------------------------------------------------- zapis
  {
    name: "klient_zmien",
    title: "Zmień dane klienta",
    description:
      "Zmienia dane klienta; każda zmiana pola trafia do dziennika (przed → po) i do pochodzenia pola (zrodlo). Pola: name, nip, street, zip, city, country, clinicType, " +
      "source (źródło pozyskania, nie zmiany), deviceInterests, statusOverride oraz nowe pola karty: shortName, regon, legalForm, businessStartDate, pkd, vatStatus, bankAccounts, " +
      "deliveryAddress, deliveryNotes, services, openingHours, links, ownDevices, seasonality, invoiceEmail, marketingConsent, smsReminders, googleReview, " +
      "nextStepText + nextStepDueAt (baner „Następny krok”; pierwsza linia = krok, dalsze = kontekst). null czyści pole. " +
      "Warunki handlowe (agreedPrice = cena ustalona za sam wynajem, transportPriceNet = transport, paymentForm = gotówka | przelew | oba, paymentTerms, frameAgreement) " +
      "tylko przez propozycje_dodaj. Wymagane: zrodlo, pewnosc, paczka.",
    inputSchema: obj(
      {
        klient_id: s("ID klienta."),
        name: s("Nazwa."),
        nip: s("NIP (10 cyfr)."),
        street: s("Ulica i numer."),
        zip: s("Kod pocztowy."),
        city: s("Miasto."),
        country: s("Kraj."),
        clinicType: s("Rodzaj gabinetu.", { enum: ["GABINET_KOSMETOLOGICZNY", "KLINIKA_MEDYCYNY_ESTETYCZNEJ", "SALON_BEAUTY", "KOSMETOLOG_MOBILNY", "INNE"] }),
        source: s("Źródło pozyskania.", { enum: ["FORMULARZ_WWW", "TELEFON", "POLECENIE", "GOOGLE_ADS", "META", "POWRACAJACY", "INNE"] }),
        deviceInterests: { type: "array", items: { type: "string", enum: ["LIGHTSHEER", "LIGHTSHEER_ET400", "ALMA_HARMONY", "COOLTECH", "RESURFX", "OBSERV", "SZKOLENIE"] }, description: "Zainteresowania (pełna lista)." },
        statusOverride: { type: ["string", "null"], enum: ["NIE_KONTAKTOWAC", null], description: "„Nie kontaktować” albo null." },
        shortName: s("Nazwa robocza, np. MiWiNi."),
        regon: s("REGON (9 albo 14 cyfr)."),
        legalForm: s("Forma prawna, np. JDG, sp. z o.o."),
        businessStartDate: s("Data rozpoczęcia działalności RRRR-MM-DD."),
        pkd: { type: ["array", "null"], items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" }, main: { type: "boolean" } } }, description: "PKD: [{ code: \"96.02.Z\", name, main }] — pierwszy główny." },
        vatStatus: s("Status VAT: Czynny / Zwolniony / Niezarejestrowany."),
        bankAccounts: { type: ["array", "null"], items: { type: "string" }, description: "Rachunki (26 cyfr)." },
        deliveryAddress: s("Adres dostawy (gdy inny niż adres firmy)."),
        deliveryNotes: { type: ["object", "null"], properties: { entrance: { type: "string" }, floor: { type: "string" }, parking: { type: "string" }, power: { type: "string" }, receiver: { type: "string" } }, description: "Paszport dostawy." },
        services: { type: ["array", "null"], items: { type: "string" }, description: "Usługi gabinetu (tagi)." },
        openingHours: s("Godziny otwarcia."),
        links: { type: ["object", "null"], properties: { www: { type: "string" }, instagram: { type: "string" }, facebook: { type: "string" }, booksy: { type: "string" }, fresha: { type: "string" } }, description: "Kanały online." },
        ownDevices: s("Własne urządzenia gabinetu / konkurencja."),
        seasonality: s("Sezonowość, np. depilacja X–VI, przerwa VII–VIII."),
        invoiceEmail: s("E-mail do faktur."),
        marketingConsent: { type: ["object", "null"], properties: { email: { type: "boolean" }, sms: { type: "boolean" }, date: { type: "string" }, source: { type: "string" } }, description: "Zgoda marketingowa." },
        smsReminders: { type: ["boolean", "null"], description: "SMS-przypomnienia o wynajmie." },
        googleReview: { type: ["object", "null"], properties: { askedAt: { type: "string" }, given: { type: "boolean" } }, description: "Opinia Google: prośba (data) i czy wystawiona." },
        nextStepText: { type: ["string", "null"], description: "Następny krok (baner na karcie)." },
        nextStepDueAt: { type: ["string", "null"], description: "Termin następnego kroku RRRR-MM-DD." },
        ...PROVENANCE,
      },
      ["klient_id", "zrodlo", "pewnosc", "paczka"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const r = await patchClient(req(a, "klient_id"), withoutKeys(a, ["klient_id"]), agent, { requireBatch: true });
      if (!r.ok) throw new AgentApiError(r.message, r.status);
      return { changed: r.changed, refreshedRentals: r.refreshedRentals };
    },
  },
  {
    name: "osoba_zmien",
    title: "Zmień osobę kontaktową",
    description:
      "Zmienia osobę kontaktową klienta (imię, nazwisko, telefony, e-mail, rola opisowa, osoba główna) oraz: roles (owner / decides / invoices / reception / cosmetologist), " +
      "preferredChannel, salutation (np. „Pani Basiu”), trainedOn [{ device, date }]. Wymagane: zrodlo, pewnosc, paczka.",
    inputSchema: obj(
      {
        klient_id: s("ID klienta."),
        osoba_id: s("ID osoby."),
        firstName: s("Imię."),
        lastName: s("Nazwisko."),
        phone: s("Telefon."),
        phone2: s("Drugi telefon."),
        phone2Label: s("Etykieta drugiego telefonu."),
        email: s("E-mail."),
        role: s("Rola, np. właścicielka."),
        isPrimary: b("true = ustaw jako osobę główną."),
        roles: { type: ["array", "null"], items: { type: "string", enum: ["owner", "decides", "invoices", "reception", "cosmetologist"] }, description: "Role jako tagi." },
        preferredChannel: s("Preferowany kanał, np. SMS i telefon."),
        salutation: s("Forma zwracania się, np. Pani Basiu."),
        trainedOn: { type: ["array", "null"], items: { type: "object", properties: { device: { type: "string" }, date: { type: "string" } } }, description: "Szkolenia z urządzeń." },
        ...PROVENANCE,
      },
      ["klient_id", "osoba_id", "zrodlo", "pewnosc", "paczka"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const r = await patchContact(req(a, "klient_id"), req(a, "osoba_id"), withoutKeys(a, ["klient_id", "osoba_id"]), agent, { requireBatch: true });
      if (!r.ok) throw new AgentApiError(r.message, r.status);
      return { changed: r.changed, refreshedRentals: r.refreshedRentals };
    },
  },
  {
    name: "osoba_dodaj",
    title: "Dodaj osobę kontaktową",
    description: "Dodaje osobę kontaktową do klienta. Wymagane: imię albo nazwisko, zrodlo, pewnosc, paczka.",
    inputSchema: obj(
      { klient_id: s("ID klienta."), firstName: s("Imię."), lastName: s("Nazwisko."), phone: s("Telefon."), email: s("E-mail."), role: s("Rola."), ...PROVENANCE },
      ["klient_id", "zrodlo", "pewnosc", "paczka"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const clientId = req(a, "klient_id");
      const prov = parseProvenance(a, { required: true });
      if (!prov.ok) throw new AgentApiError(prov.message);
      if (!prov.value.batch) throw new AgentApiError("Podaj paczkę zmiany (paczka).");
      const parsed = parseContactInput(withoutKeys(a, ["klient_id", "zrodlo", "pewnosc", "paczka"]), { normalizePhone: normalizePolishPhone }, { requireName: true });
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      const client = await prisma.client.findUnique({ where: { id: clientId }, select: { _count: { select: { contacts: true } } } });
      if (!client) throw new AgentApiError("Nie znaleziono klienta.", 404);
      const isPrimary = client._count.contacts === 0;
      const created = await prisma.$transaction(async (tx) => {
        const c = await tx.clientContact.create({ data: { ...dropNullJson(parsed.data), clientId, isPrimary } });
        await recordChanges(tx, { userId: agent.userId, provenance: prov.value }, [
          { entity: "CONTACT", entityId: c.id, clientId, operation: "CREATE", before: "null", after: toLogValue({ ...parsed.data, isPrimary }) },
        ]);
        return c;
      });
      return { id: created.id };
    },
  },
  {
    name: "klienci_scal",
    title: "Scal duplikat",
    description: "Scala duplikat w klienta docelowego: wszystko z duplikatu przechodzi, puste pola się uzupełniają, duplikat trafia do archiwum („duplikat”). Wymagane: zrodlo, pewnosc, paczka.",
    inputSchema: obj({ docelowy_id: s("Klient, który zostaje."), duplikat_id: s("Duplikat."), ...PROVENANCE }, ["docelowy_id", "duplikat_id", "zrodlo", "pewnosc", "paczka"]),
    readOnly: false,
    run: async (a, agent) => {
      if (!str(a, "paczka")) throw new AgentApiError("Podaj paczkę zmiany (paczka).");
      const r = await mergeClients(req(a, "docelowy_id"), req(a, "duplikat_id"), a, agent);
      if (!r.ok) throw new AgentApiError(r.message, r.status);
      return { moved: r.moved };
    },
  },
  {
    name: "przenies_do_klientow",
    title: "Przenieś do klientów",
    description: "Przenosi kontakt z zapytania do klientów (Potencjalny). Wpis w dzienniku.",
    inputSchema: obj({ klient_id: s("ID kontaktu z zapytania.") }, ["klient_id"]),
    readOnly: false,
    run: async (a, agent) => {
      const id = req(a, "klient_id");
      const before = await prisma.client.findUnique({ where: { id }, select: { qualifiedAt: true, qualifiedReason: true } });
      if (!before) throw new AgentApiError("Nie znaleziono klienta.", 404);
      const changed = await qualifyClient(id, "MANUAL");
      if (changed) {
        const after = await prisma.client.findUnique({ where: { id }, select: { qualifiedAt: true, qualifiedReason: true } });
        await recordChanges(prisma, { userId: agent.userId }, [
          { entity: "CLIENT", entityId: id, clientId: id, operation: "QUALIFY", field: "qualifiedAt", before: toLogValue(before), after: toLogValue(after) },
        ]);
      }
      return { changed };
    },
  },
  {
    name: "notatka_klient",
    title: "Notatka przy kliencie",
    description: "Dodaje notatkę na osi czasu klienta.",
    inputSchema: obj({ klient_id: s("ID klienta."), tresc: s("Treść notatki.") }, ["klient_id", "tresc"]),
    readOnly: false,
    run: async (a, agent) => {
      const clientId = req(a, "klient_id");
      const text = req(a, "tresc").slice(0, 5000);
      if (!(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw new AgentApiError("Nie znaleziono klienta.", 404);
      const act = await prisma.leadActivity.create({ data: { clientId, type: "NOTE", body: text, userId: agent.userId } });
      await recordChanges(prisma, { userId: agent.userId }, [{ entity: "NOTE", entityId: act.id, clientId, operation: "CREATE", before: "null", after: toLogValue(text) }]);
      return { id: act.id };
    },
  },
  {
    name: "notatka_sygnal",
    title: "Notatka przy sygnale",
    description: "Dodaje notatkę przy sygnale (bez przejmowania sygnału i zmiany etapu).",
    inputSchema: obj({ sygnal_id: s("ID sygnału."), tresc: s("Treść notatki.") }, ["sygnal_id", "tresc"]),
    readOnly: false,
    run: async (a, agent) => {
      const text = req(a, "tresc").slice(0, 5000);
      const note = await addLeadNote(req(a, "sygnal_id"), text, agent.userId);
      await recordChanges(prisma, { userId: agent.userId }, [{ entity: "NOTE", entityId: note.activityId, clientId: note.clientId, operation: "CREATE", before: "null", after: toLogValue(text) }]);
      return { id: note.activityId };
    },
  },
  {
    name: "zadanie_utworz",
    title: "Nowe zadanie",
    description: "Tworzy zadanie dla osoby z biura (dla: id albo imię, np. „Ania”). Opcjonalnie przy kliencie albo sygnale.",
    inputSchema: obj(
      { tytul: s("Treść zadania."), szczegoly: s("Szczegóły."), dla: s("Odpowiedzialny: id albo imię."), termin: s("Termin RRRR-MM-DD."), klient_id: s("ID klienta."), sygnal_id: s("ID sygnału.") },
      ["tytul", "dla"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const title = req(a, "tytul").slice(0, 191);
      const who = await officePerson(req(a, "dla"));
      const leadId = str(a, "sygnal_id");
      let clientId = str(a, "klient_id");
      if (leadId) {
        const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { clientId: true } });
        if (!lead) throw new AgentApiError("Sygnał nie istnieje.", 404);
        clientId ??= lead.clientId;
      }
      if (clientId && !(await prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }))) throw new AgentApiError("Nie znaleziono klienta.", 404);
      const task = await prisma.task.create({
        data: { title, notes: str(a, "szczegoly"), dueDate: day(a, "termin"), assigneeId: who.id, authorId: agent.userId, clientId, leadId },
      });
      await recordChanges(prisma, { userId: agent.userId }, [
        { entity: "TASK", entityId: task.id, clientId, operation: "CREATE", before: "null", after: toLogValue({ title, assignee: who.name, leadId }) },
      ]);
      return { id: task.id, dla: who.name };
    },
  },
  {
    name: "zadanie_zmien",
    title: "Zmień własne zadanie",
    description: "Zmienia albo zamyka zadanie utworzone przez agenta (tytuł, szczegóły, termin, status open/done).",
    inputSchema: obj({ id: s("ID zadania."), tytul: s("Tytuł."), szczegoly: s("Szczegóły."), termin: s("Termin RRRR-MM-DD albo pusty."), status: s("Status.", { enum: ["open", "done"] }) }, ["id"]),
    readOnly: false,
    run: async (a, agent) => {
      const id = req(a, "id");
      const t = await prisma.task.findUnique({ where: { id } });
      if (!t) throw new AgentApiError("Nie znaleziono zadania.", 404);
      if (t.authorId !== agent.userId) throw new AgentApiError("Agent zmienia tylko własne zadania.", 403);
      const data: Record<string, unknown> = {};
      if (str(a, "tytul")) data.title = str(a, "tytul")!.slice(0, 191);
      if ("szczegoly" in a) data.notes = str(a, "szczegoly");
      if ("termin" in a) data.dueDate = day(a, "termin");
      if (str(a, "status") === "done") Object.assign(data, { status: "DONE", completedAt: new Date() });
      if (str(a, "status") === "open") Object.assign(data, { status: "OPEN", completedAt: null });
      if (!Object.keys(data).length) throw new AgentApiError("Brak zmian.");
      await prisma.task.update({ where: { id }, data });
      const entries = Object.entries(data)
        .filter(([k]) => k !== "completedAt")
        .map(([k, v]) => ({ entity: "TASK" as const, entityId: id, clientId: t.clientId, operation: "FIELD_CHANGE" as const, field: k, before: toLogValue((t as Record<string, unknown>)[k]), after: toLogValue(v) }));
      await recordChanges(prisma, { userId: agent.userId }, entries);
      return { ok: true };
    },
  },
  {
    name: "zadanie_komentarz",
    title: "Komentarz do zadania",
    description: "Dodaje komentarz do zadania.",
    inputSchema: obj({ id: s("ID zadania."), tresc: s("Treść.") }, ["id", "tresc"]),
    readOnly: false,
    run: async (a, agent) => {
      const id = req(a, "id");
      const task = await prisma.task.findUnique({ where: { id }, select: { clientId: true } });
      if (!task) throw new AgentApiError("Nie znaleziono zadania.", 404);
      const text = req(a, "tresc").slice(0, 5000);
      const c = await prisma.taskComment.create({ data: { taskId: id, userId: agent.userId, body: text } });
      await recordChanges(prisma, { userId: agent.userId }, [{ entity: "TASK_COMMENT", entityId: c.id, clientId: task.clientId, operation: "CREATE", before: "null", after: toLogValue(text) }]);
      return { id: c.id };
    },
  },
  {
    name: "wniosek_utworz",
    title: "Nowy wniosek",
    description:
      "Tworzy wniosek (status NOWY albo DO_DECYZJI). Obszar: KLIENCI, SYGNALY, HISTORIA, FINANSE, KALENDARZ, KOMUNIKACJA, INTEGRACJE, PROCES. Typ: BLAD, REGULA, BRAK_DANYCH, UX, AUTOMATYZACJA, JAKOSC_DANYCH, POMYSL, PYTANIE. Zwraca podobne otwarte wnioski — sprawdź je.",
    inputSchema: obj(
      {
        title: s("Tytuł (jedno zdanie)."),
        area: s("Obszar."),
        type: s("Typ."),
        problem: s("Problem (markdown)."),
        evidence: s("Dowód: 2–5 przykładów z identyfikatorami."),
        scale: s("Skala, np. 224 klientów."),
        causes: { type: "array", items: { type: "string", enum: ["PANEL", "HUBSPOT", "N8N", "FORMULARZ", "PROCES", "INNE"] } },
        proposal: s("Propozycja (markdown)."),
        priority: s("Priorytet.", { enum: ["HIGH", "MEDIUM", "LOW"] }),
        priorityReason: s("Uzasadnienie priorytetu."),
        blocksCleanup: b("Blokuje porządki."),
        clientIds: { type: "array", items: { type: "string" }, description: "Powiązani klienci (ID)." },
        status: s("Status.", { enum: ["NOWY", "DO_DECYZJI"] }),
      },
      ["title", "area", "type"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const parsed = parseProposalInput(a, false);
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      const data = parsed.data as ProposalInput;
      const similar = await findSimilar(data.title, data.area);
      const p = await createProposal(data, agent, a.status === "DO_DECYZJI" ? "DO_DECYZJI" : "NOWY");
      return { id: p.id, number: p.number, similar };
    },
  },
  {
    name: "wniosek_zmien",
    title: "Zmień wniosek",
    description: "Zmienia własny wniosek (w statusie NOWY / DO_DECYZJI): dowolne pola z tworzenia (podane zastępują stare) i/lub status NOWY ↔ DO_DECYZJI.",
    inputSchema: obj(
      {
        id: s("ID wniosku."),
        title: s("Tytuł (jedno zdanie)."),
        area: s("Obszar."),
        type: s("Typ."),
        problem: s("Problem (markdown)."),
        evidence: s("Dowód."),
        scale: s("Skala."),
        causes: { type: "array", items: { type: "string", enum: ["PANEL", "HUBSPOT", "N8N", "FORMULARZ", "PROCES", "INNE"] } },
        proposal: s("Propozycja (markdown)."),
        priority: s("Priorytet.", { enum: ["HIGH", "MEDIUM", "LOW"] }),
        priorityReason: s("Uzasadnienie priorytetu."),
        blocksCleanup: b("Blokuje porządki."),
        clientIds: { type: "array", items: { type: "string" }, description: "Powiązani klienci (ID) — pełna lista." },
        status: s("Status.", { enum: ["NOWY", "DO_DECYZJI"] }),
        comment: s("Komentarz do zmiany statusu."),
      },
      ["id"],
    ),
    readOnly: false,
    run: async (a, agent) => {
      const id = req(a, "id");
      const { status, comment, ...fields } = withoutKeys(a, ["id"]);
      if (status !== undefined && !isStatus(status)) throw new AgentApiError("Nieznany status.");
      const parsed = parseProposalInput(fields, true);
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      if (Object.keys(parsed.data).length) await updateProposal(id, parsed.data, agent);
      if (isStatus(status)) await setProposalStatus(id, status, agent, { comment: typeof comment === "string" ? comment : null });
      return loadProposal(id, agent);
    },
  },
  {
    name: "wniosek_komentarz",
    title: "Komentarz do wniosku",
    description: "Dodaje komentarz do wniosku.",
    inputSchema: obj({ id: s("ID wniosku."), tresc: s("Treść.") }, ["id", "tresc"]),
    readOnly: false,
    run: async (a, agent) => {
      await addProposalComment(req(a, "id"), req(a, "tresc"), agent);
      return { ok: true };
    },
  },
  {
    name: "uwaga_utworz",
    title: "Nowa uwaga",
    description: "Dodaje uwagę (obserwację) — także propozycję archiwizacji z powodem i dowodem. Opcjonalnie przy kliencie albo sygnale.",
    inputSchema: obj({ tresc: s("Treść."), obszar: s("Obszar."), dowod: s("Dowód / źródło."), klient_id: s("ID klienta."), sygnal_id: s("ID sygnału.") }, ["tresc"]),
    readOnly: false,
    run: async (a, agent) => {
      const { status: _s, ...body } = normalizeRemarkBody(a);
      void _s;
      const parsed = parseRemarkInput(body, false);
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      const r = await createRemark(parsed.data as RemarkInput, agent);
      return { id: r.id };
    },
  },
  {
    name: "uwaga_zmien",
    title: "Zmień uwagę",
    description: "Zmienia własną uwagę albo ją zamyka (status CLOSED).",
    inputSchema: obj({ id: s("ID uwagi."), tresc: s("Treść."), obszar: s("Obszar."), dowod: s("Dowód."), status: s("Status.", { enum: ["OPEN", "CLOSED"] }) }, ["id"]),
    readOnly: false,
    run: async (a, agent) => {
      const { status, ...rest } = normalizeRemarkBody(withoutKeys(a, ["id"]));
      if (status !== undefined && status !== "OPEN" && status !== "CLOSED") throw new AgentApiError("status: OPEN albo CLOSED.");
      const parsed = parseRemarkInput(rest, true);
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      await updateRemark(req(a, "id"), { ...parsed.data, ...(status ? { status: status as "OPEN" | "CLOSED" } : {}) }, agent);
      return { ok: true };
    },
  },
  {
    name: "dopasowanie_decyzja",
    title: "Decyzja w dopasowaniach",
    description:
      "Przypisuje / pomija / cofa grupy wydarzeń z kalendarzy (klucze z narzędzia dopasowania: groups[].key) albo faktury (faktury_ids). Przypisanie tworzy alias — kolejne wydarzenia z tą nazwą dopasują się same. Wpis w dzienniku.",
    inputSchema: obj(
      {
        rodzaj: s("Co.", { enum: ["kalendarz", "faktury"] }),
        akcja: s("Decyzja.", { enum: ["przypisz", "pomin", "cofnij"] }),
        klucze: { type: "array", items: { type: "string" }, description: "Klucze grup z kalendarzy (rodzaj kalendarz)." },
        faktury_ids: { type: "array", items: { type: "string" }, description: "ID faktur (rodzaj faktury)." },
        klient_id: s("Klient (przy przypisz)."),
      },
      ["rodzaj", "akcja"],
    ),
    readOnly: false,
    run: async (a, agent) => agentMatchDecision(a, agent.userId),
  },
  {
    name: "propozycje_dodaj",
    title: "Zgłoś propozycje zmian",
    description:
      "Zgłasza hurtem propozycje do akceptacji administratora (Porządki → Propozycje). Każda: rodzaj (pole | osoba | archiwizacja | scalenie | wydzielenie | dopasowanie_platnosci | wykluczenie), klient_id, " +
      "dla pola: pole + proponowane (także nowe pola karty jak w klient_zmien oraz agreedPrice, transportPriceNet, paymentForm, paymentTerms, frameAgreement); dla osoby: osoba_id + pole + proponowane (także roles, preferredChannel, salutation, trainedOn); dla archiwizacji: klient_id albo sygnal_id + powod + dopisek; dla scalenia: duplikat_id; " +
      "dla wydzielenia (rodzaj: wydzielenie; klient-zlepek → nowy klient): osoby_ids, nazwa, opcjonalnie nip, ulica, kod, miasto, " +
      "invoiceNip (faktury z tym NIP-em nabywcy przechodzą; bez niego — faktury z NIP-em nowego klienta), historyKeys (klucze grup z kalendarzy z narzędzia dopasowania). " +
      "Nowy klient nie dziedziczy źródła ani tagu HubSpot zlepka. " +
      "Dla wykluczenia (lista wykluczeń domen): wartosci (lista domen albo adresów, maks. 500), typ (wyklucz | ukrywaj), dopisek — po akceptacji maile z nich nie trafiają do panelu. " +
      "Dla dopasowania_platnosci (przelew z wyciągu → faktura): przelew_id i faktura_id z narzędzia platnosci; po akceptacji faktura jest zapłacona z datą przelewu. " +
      "Zawsze zrodlo, pewnosc, paczka; opcjonalnie klasa (np. miasto_slownik) — klasy zatwierdzone na stałe wykonują się od razu. " +
      "Odrzucone wcześniej zmiany są blokowane (dostaniesz komentarz odrzucenia).",
    inputSchema: obj({ propozycje: { type: "array", items: { type: "object" }, description: "Lista propozycji (maks. 500)." } }, ["propozycje"]),
    readOnly: false,
    run: async (a, agent) => ({ results: await submitProposals(a.propozycje as unknown[], agent) }),
  },
  {
    name: "propozycje_lista",
    title: "Propozycje zmian",
    description: "Propozycje i ich stan: status PENDING / ACCEPTED / REJECTED (z komentarzem), paczka, klient; oraz klasy zatwierdzane automatycznie.",
    inputSchema: obj({ status: s("Status.", { enum: ["PENDING", "ACCEPTED", "REJECTED"] }), paczka: s("Paczka."), klient_id: s("ID klienta.") }),
    readOnly: true,
    run: async (a) => {
      const [proposals, classes] = await Promise.all([
        listChangeProposals({ status: str(a, "status"), batch: str(a, "paczka"), clientId: str(a, "klient_id") }),
        listAutoClasses(),
      ]);
      return { proposals, autoApprovedClasses: classes };
    },
  },
  {
    name: "dziennik_wpis",
    title: "Ręczny wpis w dzienniku",
    description:
      "Wpis dla zmian spoza narzędzi panelu (np. zmiana w HubSpocie). obiekt: klient, kontakt, sygnal, dopasowanie, faktura. operacja: zmiana_pola, scalenie, zmiana_statusu, przeniesienie_do_zapytan, nie_kontaktowac, potwierdzenie_dopasowania, odrzucenie_dopasowania. Wymagane: przed (może być null), zrodlo, pewnosc.",
    inputSchema: {
      type: "object",
      properties: {
        obiekt: s("Obiekt."),
        obiekt_id: s("ID rekordu."),
        klient_id: s("ID klienta."),
        operacja: s("Operacja."),
        pole: s("Pole."),
        przed: { description: "Wartość przed (dowolny JSON, może być null)." },
        po: { description: "Wartość po (dowolny JSON)." },
        ...PROVENANCE,
      },
      required: ["obiekt", "obiekt_id", "operacja", "przed", "zrodlo", "pewnosc"],
    },
    readOnly: false,
    run: async (a, agent) => {
      const parsed = parseManualEntry(a);
      if (!parsed.ok) throw new AgentApiError(parsed.message);
      const e = parsed.value;
      const client = e.clientId ? await prisma.client.findUnique({ where: { id: e.clientId }, select: { id: true, name: true } }) : null;
      if (e.clientId && !client) throw new AgentApiError("Klient nie istnieje.", 404);
      const row = await prisma.changeLog.create({
        data: {
          userId: agent.userId,
          clientId: client?.id ?? null,
          clientName: client?.name ?? null,
          entity: e.entity,
          entityId: e.entityId,
          operation: e.operation,
          field: e.field,
          before: e.before,
          after: e.after,
          source: e.provenance.source,
          confidence: e.provenance.confidence,
          batch: e.provenance.batch,
        },
      });
      return { id: row.id };
    },
  },
];

export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
