// Złote zasady obsługi zapytań (zasady-wzor.html, v1 28.09.2026): treść
// „Ściągi” w Sygnałach, podpowiedzi w karcie sygnału i cel sezonu. Edytuje
// Tomek (Ustawienia → Ściąga, Setting "sales_playbook"). Czysty moduł.

export type Rule = { title: string; text: string };
export type Playbook = {
  dayOrder: string[];
  rules: Rule[];
  questions: string[];
  scripts: {
    newOpening: string; // Nowe: otwarcie pierwszego telefonu
    newClosing: string; // koniec rozmowy terminem
    contactOffer: string; // W kontakcie: co przed ofertą
    offerFollowUp1: string; // Oferta: +3 dni rob. ({termin} = wolny termin)
    offerFollowUp2: string; // Oferta: +7 dni rob.
    postponedReturn: string; // Odłożone: co powiedzieć, gdy wracamy
  };
  season: { target: number; from: string; to: string; reward: string };
  sources: { label: string; url: string }[];
};

export const PLAYBOOK_SETTING_KEY = "sales_playbook";

export const DEFAULT_PLAYBOOK: Playbook = {
  dayOrder: ["Dzisiejsze wynajmy", "Nowe zapytania", "Umówione telefony", "Follow-upy ofert", "Wracają odłożone", "Potem porządki"],
  rules: [
    { title: "Nowe najpierw, telefon zamiast maila.", text: "Telefon w ciągu 4 h rob., najlepiej w godzinę. Po godzinie szansa na kontakt spada ponad 10×." },
    { title: "Nie odebrała → SMS od razu.", text: "Szablon jednym kliknięciem z karty sygnału." },
    { title: "3 próby w 3 różne dni i pory.", text: "Od razu · jutro 16–17 · pojutrze 8–9. Potem SMS i „brak kontaktu”." },
    { title: "Rozmowa kończy się terminem.", text: "„Czwartek rano czy piątek po 16?” – następny krok z datą zawsze." },
    { title: "Wywiad w 6 pytaniach.", text: "Gdzie · co · kiedy/jak często · szkolenie · NIP · kto decyduje." },
    { title: "Oferta w dniu rozmowy.", text: "Do 2 h: urządzenie, 2 wolne terminy, cena z transportem, pytanie „który termin?”." },
    { title: "Follow-up z nową wartością.", text: "+3 dni: trzymany termin. +7 dni: opinia klientki / efekty / nowy termin." },
    { title: "Pytaj o wybór, nie o zgodę.", text: "„16 czy 23 października?”" },
    { title: "„Nie teraz” = Odłóż z datą.", text: "„Odezwę się przed sezonem – 2 lutego pasuje?”" },
    { title: "Koniec dnia: Nowe puste, każdy sygnał z krokiem.", text: "5 minut kontroli na liście „Na dziś”." },
  ],
  questions: ["Jaki gabinet i gdzie? (transport)", "Jakie zabiegi / które urządzenie?", "Na kiedy i jak często?", "Zna sprzęt czy potrzebne szkolenie?", "Faktura – NIP?", "Kto decyduje?"],
  scripts: {
    newOpening: "„Dzień dobry, Anna Ślizowska, WynajemLasera.pl. Pobrała Pani od nas cennik – dzwonię, żeby dopasować urządzenie i termin. Ma Pani 3 minuty?”",
    newClosing: "„Wyślę ofertę dziś do 2 godzin. Zadzwonię w czwartek rano czy wolałaby Pani piątek po 16?”",
    contactOffer: "Oferta w dniu rozmowy, do 2 h: konkretne urządzenie, 2 wolne terminy z kalendarza, cena z transportem, na końcu „Który termin rezerwuję?”.",
    offerFollowUp1: "„Dzień dobry, trzymam jeszcze {termin} – potwierdzamy?”",
    offerFollowUp2: "„Dzień dobry, podsyłam efekty zabiegów u innej klientki – mam też wolny termin {termin}. Który pasuje?”",
    postponedReturn: "„Dzień dobry, umawiałyśmy się, że odezwę się teraz. Sezon startuje – mam wolne {termin}. Rezerwujemy?”",
  },
  season: { target: 8, from: "2026-09-01", to: "2027-05-31", reward: "kolacja i kino 🎬" },
  sources: [
    { label: "Lead Response Management Study (Oldroyd / InsideSales, MIT)", url: "https://www.leadresponsemanagement.org/lrm_study/" },
    { label: "InsideSales – Response time matters", url: "https://www.insidesales.com/response-time-matters/" },
    { label: "Cirrus Insight – statystyki follow-upów", url: "https://www.cirrusinsight.com/blog/sales-follow-up-statistics" },
    { label: "Amabile, Kramer – The Power of Small Wins (HBR 2011)", url: "https://hbr.org/2011/05/the-power-of-small-wins" },
    { label: "Gollwitzer, Sheeran 2006 – implementation intentions (meta-analiza)", url: "https://www.researchgate.net/publication/37367696_Implementation_Intentions_and_Goal_Achievement_A_Meta-Analysis_of_Effects_and_Processes" },
  ],
};

const str = (v: unknown, max = 2000): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Zapisane ustawienie (JSON) → pełna ściąga; brakujące / złe pola z domyślnych.
export function parsePlaybook(raw: string | null | undefined): Playbook {
  let o: Record<string, unknown> = {};
  try {
    const v = JSON.parse(raw ?? "");
    if (v && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch {
    // brak ustawienia — domyślne
  }
  const d = DEFAULT_PLAYBOOK;
  const list = (v: unknown, fallback: string[], max: number) => {
    const arr = Array.isArray(v) ? v.map((x) => str(x, 300)).filter((x): x is string => !!x).slice(0, max) : [];
    return arr.length ? arr : fallback;
  };
  const rules = Array.isArray(o.rules)
    ? (o.rules as unknown[])
        .map((r) => (r && typeof r === "object" ? { title: str((r as Rule).title, 200), text: str((r as Rule).text, 600) ?? "" } : null))
        .filter((r): r is Rule => !!r && !!r.title)
        .slice(0, 20)
    : [];
  const sc = (o.scripts && typeof o.scripts === "object" ? o.scripts : {}) as Record<string, unknown>;
  const se = (o.season && typeof o.season === "object" ? o.season : {}) as Record<string, unknown>;
  const target = Number(se.target);
  const sources = Array.isArray(o.sources)
    ? (o.sources as unknown[])
        .map((x) => (x && typeof x === "object" ? { label: str((x as { label: unknown }).label, 200), url: str((x as { url: unknown }).url, 500) } : null))
        .filter((x): x is { label: string; url: string } => !!x?.label && !!x.url && /^https?:\/\//.test(x.url))
    : [];
  return {
    dayOrder: list(o.dayOrder, d.dayOrder, 8),
    rules: rules.length ? rules : d.rules,
    questions: list(o.questions, d.questions, 10),
    scripts: {
      newOpening: str(sc.newOpening) ?? d.scripts.newOpening,
      newClosing: str(sc.newClosing) ?? d.scripts.newClosing,
      contactOffer: str(sc.contactOffer) ?? d.scripts.contactOffer,
      offerFollowUp1: str(sc.offerFollowUp1) ?? d.scripts.offerFollowUp1,
      offerFollowUp2: str(sc.offerFollowUp2) ?? d.scripts.offerFollowUp2,
      postponedReturn: str(sc.postponedReturn) ?? d.scripts.postponedReturn,
    },
    season: {
      target: Number.isInteger(target) && target > 0 && target < 1000 ? target : d.season.target,
      from: typeof se.from === "string" && DAY.test(se.from) ? se.from : d.season.from,
      to: typeof se.to === "string" && DAY.test(se.to) ? se.to : d.season.to,
      reward: str(se.reward, 200) ?? d.season.reward,
    },
    sources: sources.length ? sources : d.sources,
  };
}

// Cel sezonu: rezerwacje z sygnałów nowych klientów (bez stałych klientek),
// które wpłynęły w sezonie i doszły co najmniej do Rezerwacji.
export function seasonReservations(
  leads: { createdAt: Date; returningClient?: boolean; stage: string; maxStage?: string; rentalId: string | null }[],
  season: Playbook["season"],
): number {
  const from = new Date(`${season.from}T00:00:00`);
  const to = new Date(`${season.to}T23:59:59`);
  return leads.filter(
    (l) =>
      !l.returningClient &&
      l.createdAt >= from &&
      l.createdAt <= to &&
      l.stage !== "PRZEGRANA" &&
      (l.rentalId != null || l.stage === "REZERWACJA" || l.stage === "WYGRANA" || l.maxStage === "REZERWACJA" || l.maxStage === "WYGRANA"),
  ).length;
}

// Tekst skryptu z wolnym terminem ({termin}).
export function fillScript(text: string, vars: { termin?: string | null }): string {
  return text.replace(/\{termin\}/g, vars.termin ?? "[termin]");
}
