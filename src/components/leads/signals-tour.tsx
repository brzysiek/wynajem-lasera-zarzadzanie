"use client";

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";

// Przewodnik po nowych Sygnałach (wniosek 19, wzór docs/wzory/przewodnik-wzor.html):
// powitanie + 5 kroków. Przyciemnienie, jasna ramka wokół pokazywanego
// elementu ([data-tour="…"]), karta obok niego, kropki postępu. Klawisze:
// → / Enter dalej, ← wstecz, Esc pomiń. Na telefonie — karta na dole, bez
// ramki. Przewodnik nic nie zmienia w danych (tylko flaga obejrzenia).

type Step = { target: string; title: string; body: ReactNode; maxHeight?: number };
type Rect = { top: number; left: number; width: number; height: number };

const BTN = "inline-flex h-8 items-center rounded-[6px] border border-[#C9D3DC] bg-white px-3 text-[13px] text-[#0C3450] hover:border-[#1B6FA8]";
const BTN_PRI = "inline-flex h-8 items-center rounded-[6px] border border-[#1B6FA8] bg-[#1B6FA8] px-3 text-[13px] text-white hover:bg-[#0C3450]";
const CARD_W = 360;

export function SignalsTour({
  variant = "v2",
  name,
  season,
  target,
  reward,
  onFinish,
  onLater,
  onBeforeStep,
}: {
  // Wniosek 33: „v3” = 3 kroki „Co nowego” (pasek na Tablicy, chip kroku, Wynik rozmowy).
  // „v4” = „Tablica – jak pracujemy” (dla Ani): powitanie + 9 kroków, teksty z
  // docs przewodnik-tablica-ania.md (30.09.2026).
  variant?: "v2" | "v3" | "v4";
  name: string;
  season: number;
  target: number;
  reward: string;
  onFinish: () => void; // Pomiń / Zaczynamy! — obejrzany
  onLater: () => void; // Później — pokaże się przy kolejnym wejściu
  onBeforeStep?: (i: number) => void; // np. przełącz na Listę „Na dziś”
}) {
  const [step, setStep] = useState(0); // 0 = powitanie
  const [rect, setRect] = useState<Rect | null>(null);
  const [mobile, setMobile] = useState(false);
  // Liczba kart w kolumnie pokazywanej w kroku (data-count na celu).
  const [count, setCount] = useState<number | null>(null);
  const rewardText = reward.replace(/\s*\p{Extended_Pictographic}+$/u, "");

  const stepsV3: Step[] = [
    {
      target: "plan",
      title: "„Do zrobienia dziś” jest też na Tablicy",
      body: (
        <>
          <p>Pasek widać teraz na każdej zakładce. Kliknij kafelek, np. „Nowe zapytania” – przejdziesz do „Na dziś” tylko z tymi sprawami.</p>
        </>
      ),
    },
    {
      target: "step-chip",
      title: "Kolorowy „następny krok” na karcie",
      body: (
        <>
          <p>
            Kliknij chip na karcie – zobaczysz, co zrobić: rodzaj kroku, termin i ostatnią notatkę. <b className="text-[#B8612F]">Terakota = zaległe</b>, <b className="text-[#1B6FA8]">niebieski = dziś</b>, szary = później.
          </p>
        </>
      ),
    },
    {
      target: "step-chip",
      title: "Po rozmowie: „Wynik rozmowy”",
      body: (
        <>
          <p>
            W rozwiniętym kroku (i w karcie sygnału) kliknij <b className="text-[#0C3450]">Wynik rozmowy</b> – panel sam ustawi etap i kolejny krok z datą.
          </p>
        </>
      ),
    },
  ];
  const stepsV2: Step[] = [
    {
      target: "plan",
      title: "Plan dnia i Twój cel",
      body: (
        <>
          <p>Tu zaczynasz dzień. Kolejność zawsze ta sama: wynajmy → nowe → umówione telefony → wracają z wiosny → follow-upy → powroty.</p>
          <p>
            Kliknij punkt, a lista pokaże tylko te sprawy. Zrobione robi się zielone. Po prawej cel sezonu:{" "}
            <b className="text-[#0C3450]">
              {target} gabinetów (wracające z wiosny + nowe), nagroda co 5 – {rewardText} 🎬
            </b>
            .
          </p>
        </>
      ),
    },
    {
      target: "today-table",
      title: "Zakładka „Na dziś”",
      maxHeight: 290,
      body: (
        <>
          <p>
            Tylko to, czym trzeba zająć się dziś – od najpilniejszego. <b className="text-[#B8612F]">Terakota = po czasie.</b>
          </p>
          <p>Kliknięcie karty rozwija ją na miejscu (oś czasu, historia). Nowe zapytanie? Zadzwoń w ciągu 4 godzin – wtedy szansa na rozmowę jest wielokrotnie większa.</p>
        </>
      ),
    },
    {
      target: "row-actions",
      title: "Jedno kliknięcie zamiast notatek",
      body: (
        <>
          <p>
            <b className="text-[#0C3450]">Wynik rozmowy</b> – wybierasz, jak poszło (umówiła termin, nie odebrała, oddzwoni, później, oferta, rezygnuje), a panel sam ustawia etap i następny krok.
          </p>
          <p>
            <b className="text-[#0C3450]">Nie odebrała</b> – SMS z szablonu i kolejna próba jutro same się ustawią. Oferta wysłana z kontakt@ też przesunie się sama.
          </p>
        </>
      ),
    },
    {
      target: "tab-board",
      title: "Tablica i filtry",
      body: (
        <>
          <p>
            <b className="text-[#0C3450]">Tablica</b> to ten sam lejek w kolumnach: Nowe → W kontakcie → Oferta → Rezerwacja. Karty przeciągasz albo klikasz przyciski.
          </p>
          <p>
            Filtry <b className="text-[#0C3450]">„Odłożone”</b> (wrócą w swoim dniu) i <b className="text-[#0C3450]">„Przegrane”</b> są na Tablicy. Najedź na termin kroku – zobaczysz notatkę i ostatni kontakt.
          </p>
        </>
      ),
    },
    {
      target: "cheatsheet",
      title: "Ściąga zawsze pod ręką",
      body: (
        <>
          <p>10 złotych zasad, kolejność dnia i gotowe teksty SMS i maili. Tu też włączysz ten przewodnik jeszcze raz.</p>
          <p>
            Powodzenia – {season} z {target} już jest! 🎬
          </p>
        </>
      ),
    },
  ];
  const B = "text-[#0C3450]";
  const n = count ?? 0;
  const cardsLabel = `${n} ${n === 1 ? "karta" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? "karty" : "kart"}`;
  const stepsV4: Step[] = [
    {
      target: "plan",
      title: "Pasek „Do zrobienia dziś”",
      body: <p>Tu widzisz, co czeka na Ciebie dzisiaj. Kliknij kafelek, a zobaczysz tylko te sprawy. Każda odhaczona rzecz przybliża nas do celu sezonu 🎬</p>,
    },
    {
      target: "col-SYGNAL",
      title: "Kolumna „Nowe”",
      maxHeight: 380,
      body: (
        <>
          {count != null && (
            <p className="text-[12px] text-[#5C6166]">
              Teraz w kolumnie: <b className={B}>{cardsLabel}</b>
            </p>
          )}
          <p>Tu trafiają świeże zapytania: formularz ze strony, pobrany cennik, sygnał dodany ręcznie. Nikt jeszcze z tymi osobami nie rozmawiał.</p>
          <p>Najlepiej zadzwonić w ciągu 4 godzin, bo wtedy klientka ma nas jeszcze w głowie i najchętniej rozmawia. Fajnie, jeśli na koniec dnia ta kolumna jest pusta, ale jeśli coś zostanie na jutro, to też jest w porządku.</p>
        </>
      ),
    },
    {
      target: "col-WYWIAD",
      title: "Kolumna „W kontakcie”",
      maxHeight: 380,
      body: (
        <>
          {count != null && (
            <p className="text-[12px] text-[#5C6166]">
              Teraz w kolumnie: <b className={B}>{cardsLabel}</b>
            </p>
          )}
          <p>Tu jest wszystko, co już się toczy:</p>
          <ul className="mb-1.5 ml-[18px] list-disc">
            <li>zapytania, z którymi była rozmowa albo na które odpisałyśmy mailem;</li>
            <li>nasze klientki z poprzedniego sezonu, które w tym roku jeszcze nie wynajmowały. Dlatego na kafelku często widzisz nazwę gabinetu;</li>
            <li>sprawy, które wróciły z „Odłożonych” w swoim dniu.</li>
          </ul>
          <p>
            Kolumna jest ułożona według daty następnego kroku. <b className={B}>Zaczynasz od góry</b>: na górze jest to, co najpilniejsze.
          </p>
        </>
      ),
    },
    {
      target: "step-chip",
      title: "Następny krok na kafelku",
      body: (
        <>
          <p>Każda karta ma swój następny krok. Najedź na niego, a zobaczysz, co było ostatnio i dlaczego wypada właśnie wtedy. Kliknij, żeby go wykonać.</p>
          <p>
            Kolory: <b className="text-[#B8612F]">terakota</b> = zaległe, <b className="text-[#1B6FA8]">niebieski</b> = na dziś, <b className="text-[#5C6166]">szary</b> = później.
          </p>
        </>
      ),
    },
    {
      target: "step-chip",
      title: "Po każdym kontakcie: „Wynik rozmowy”",
      body: (
        <>
          <p>
            Po telefonie, SMS-ie albo mailu kliknij <b className={B}>Wynik rozmowy</b> i wybierz, jak poszło. Panel sam przesunie kartę i ustawi kolejny krok:
          </p>
          <ul className="mb-1.5 ml-[18px] list-disc">
            <li>
              <b className={B}>Umówiła termin</b> → Rezerwacja (liczy się do celu sezonu 🎉)
            </li>
            <li>
              <b className={B}>Oddzwoni / przemyśli</b> → krok z datą
            </li>
            <li>
              <b className={B}>Urlop / później</b> → zostaje w kontakcie, z datą
            </li>
            <li>
              <b className={B}>Wysłać ofertę</b> → przypomnienie ustawi się samo za 3 dni
            </li>
            <li>
              <b className={B}>Nie odebrała</b> → patrz następny krok
            </li>
            <li>
              <b className={B}>Rezygnuje</b> → Przegrana, z powodem
            </li>
          </ul>
        </>
      ),
    },
    {
      target: "step-chip",
      title: "Klientka nie odbiera",
      body: (
        <>
          <p>
            Zdarza się bardzo często i to normalne. Kliknij <b className={B}>Wynik rozmowy → Nie odebrała</b>. Panel:
          </p>
          <ul className="mb-1.5 ml-[18px] list-disc">
            <li>zaproponuje krótki SMS: „dzwoniłam, kiedy mogę oddzwonić?”;</li>
            <li>sam ustawi kolejną próbę o innej porze: jutro ok. 16:00, potem rano ok. 8:30.</li>
          </ul>
          <p>Po 3 próbach w różne dni możesz spokojnie zamknąć sprawę jako „brak kontaktu”. Panel Ci to podpowie.</p>
        </>
      ),
    },
    {
      target: "col-WYWIAD",
      title: "Jak zakończyć rozmowę",
      maxHeight: 380,
      body: (
        <>
          <p>Dobrze, żeby każda rozmowa kończyła się umówionym kolejnym kontaktem. Gdy klientka potrzebuje czasu, nie może teraz rozmawiać albo chce się zastanowić, zapytaj:</p>
          <p className="italic">„Kiedy mogę się odezwać – w czwartek rano czy w piątek po 16?”</p>
          <p>Wpisz tę datę w Wyniku rozmowy.</p>
          <p>
            Jeśli teraz zupełnie nie (np. „wrócę przed sezonem”), kliknij na karcie <b className={B}>Odłóż</b> i wybierz datę i powód. Karta sama wróci w tym dniu.
          </p>
          <p>
            Pytania do rozmowy i gotowe teksty znajdziesz w karcie sygnału w ramce <b className={B}>„Podpowiedź”</b>.
          </p>
        </>
      ),
    },
    {
      target: "nav-porzadki",
      title: "Coś niejasne? Pomoc i maile",
      body: (
        <>
          <p>
            Jeśli coś jest niezrozumiałe, nie pasuje albo nie działa, wpisz to w <b className={B}>Porządki/optymalizacje → Uwagi</b>. Każda uwaga się liczy, dzięki nim poprawiamy panel pod Ciebie.
          </p>
          <p>
            Jeśli potrzebujesz czegoś od razu albo nie możesz czegoś znaleźć, napisz do agenta Klaudiusza w aplikacji Claude, w projekcie <b className={B}>„asystent obsługi klienta”</b>.
          </p>
          <p>
            <b className={B}>Maile i SMS-y do klientek też robimy teraz tam.</b> Agent zna historię klientki, cennik, warunki i wolne terminy, więc przygotuje gotowy szkic w Twoim stylu. Ty go tylko sprawdzasz i wysyłasz.
          </p>
        </>
      ),
    },
    {
      target: "cheatsheet",
      title: "Ściąga",
      body: (
        <>
          <p>Złote zasady, kolejność dnia i gotowe SMS-y są zawsze tutaj. Tu też włączysz ten przewodnik jeszcze raz.</p>
          <p>
            Powodzenia! Już {season} z {target} gabinetów w tym sezonie 🎬
          </p>
        </>
      ),
    },
  ];
  const steps = variant === "v4" ? stepsV4 : variant === "v3" ? stepsV3 : stepsV2;
  const current = step > 0 ? steps[step - 1] : null;

  const measure = useCallback(() => {
    if (!current) return setRect(null);
    // Pierwszy WIDOCZNY cel (np. menu: boczne na komputerze, górne na telefonie).
    const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${current.target}"]`)].find((x) => x.getClientRects().length > 0) ?? null;
    const c = el?.getAttribute("data-count");
    setCount(c != null && c !== "" ? Number(c) : null);
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: current.maxHeight ? Math.min(r.height, current.maxHeight) : r.height });
  }, [current]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const set = () => setMobile(mq.matches);
    set();
    mq.addEventListener("change", set);
    return () => mq.removeEventListener("change", set);
  }, []);

  // Przewiń do elementu, potem zmierz (także przy przewijaniu / zmianie okna).
  useLayoutEffect(() => {
    if (!current) return;
    onBeforeStep?.(step);
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
    el?.scrollIntoView({ block: "center", behavior: "auto" });
    const t = window.setTimeout(measure, 60);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const next = useCallback(() => (step >= steps.length ? onFinish() : setStep((s) => s + 1)), [step, steps.length, onFinish]);
  const back = useCallback(() => setStep((s) => Math.max(1, s - 1)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFinish();
      else if (e.key === "ArrowRight" || e.key === "Enter") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft" && step > 1) back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onFinish, step]);

  // Położenie karty: pod elementem, nad nim, obok — tak, żeby go nie zasłaniać.
  const cardStyle = (() => {
    if (mobile || !rect) return null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const h = 260;
    const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12);
    if (rect.top + rect.height + 12 + h < vh) return { top: rect.top + rect.height + 14, left };
    if (rect.top - 12 - h > 0) return { top: rect.top - h - 14, left };
    if (rect.left + rect.width + 12 + CARD_W < vw) return { top: Math.max(12, Math.min(rect.top, vh - h - 12)), left: rect.left + rect.width + 14 };
    return { top: Math.max(12, Math.min(rect.top, vh - h - 12)), left: Math.max(12, rect.left - CARD_W - 14) };
  })();

  if (step === 0 && variant === "v4") {
    // Powitanie zawsze do Ani (Tomek widzi dokładnie to, co Ania).
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(12,52,80,0.58)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Tablica – jak pracujemy">
        <div className="w-full max-w-[520px] rounded-[10px] bg-white px-7 py-[26px] text-[13px] text-[#2A3540] shadow-[0_10px_36px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Tablica – jak pracujemy</div>
          <h2 className="m-0 mb-2 mt-1 text-[22px] font-semibold text-[#0C3450]">Dzień dobry, Aniu! 👋</h2>
          <p>Tablica to Twoje centrum dowodzenia zapytaniami. W 2 minuty pokażę Ci, jak z nią pracować, żeby nic nie uciekło, a dzień szedł spokojnie i po kolei.</p>
          <div className="mt-4 flex gap-2">
            <button type="button" autoFocus className={BTN_PRI} onClick={() => setStep(1)}>
              Zaczynamy
            </button>
            <button type="button" className={BTN} onClick={onLater}>
              Później
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 0 && variant === "v3") {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(12,52,80,0.58)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Co nowego w Sygnałach">
        <div className="w-full max-w-[520px] rounded-[10px] bg-white px-7 py-[26px] text-[13px] text-[#2A3540] shadow-[0_10px_36px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Co nowego</div>
          <h2 className="m-0 mb-2 mt-1 text-[22px] font-semibold text-[#0C3450]">{name ? `${name}, 3 zmiany w Sygnałach` : "3 zmiany w Sygnałach"}</h2>
          <ul className="ml-[18px] mt-2.5 list-disc text-[#3A4450]">
            <li className="my-[3px]">„Do zrobienia dziś” także na Tablicy</li>
            <li className="my-[3px]">Kolorowy „następny krok” na karcie – kliknij</li>
            <li className="my-[3px]">„Wynik rozmowy” ustawia etap i kolejny krok</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <button type="button" autoFocus className={BTN_PRI} onClick={() => setStep(1)}>
              Dalej
            </button>
            <button type="button" className={BTN} onClick={onLater}>
              Później
            </button>
            <button type="button" className="ml-auto text-[12px] text-[#5C6166] hover:text-[#0C3450]" onClick={onFinish}>
              Pomiń
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 0) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(12,52,80,0.58)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Nowe Sygnały">
        <div className="w-full max-w-[520px] rounded-[10px] bg-white px-7 py-[26px] text-[13px] text-[#2A3540] shadow-[0_10px_36px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Nowe Sygnały</div>
          <h2 className="m-0 mb-2 mt-1 text-[22px] font-semibold text-[#0C3450]">Cześć {name}! 👋</h2>
          <p>Sygnały mają nową odsłonę – prostszą i z podpowiedziami. Pokażę Ci 5 rzeczy, zajmie to minutę.</p>
          <ul className="ml-[18px] mt-2.5 list-disc text-[#3A4450]">
            <li className="my-[3px]">Plan dnia i Twój cel sezonu</li>
            <li className="my-[3px]">„Na dziś” – kolejka od najpilniejszego</li>
            <li className="my-[3px]">Jedno kliknięcie zamiast notatek</li>
            <li className="my-[3px]">Tablica – lejek jako kolumny</li>
            <li className="my-[3px]">Ściąga – zasady i gotowe teksty</li>
          </ul>
          <div className="mt-4 flex gap-2">
            <button type="button" autoFocus className={BTN_PRI} onClick={() => setStep(1)}>
              Pokaż (1 min)
            </button>
            <button type="button" className={BTN} onClick={onLater}>
              Później
            </button>
          </div>
        </div>
      </div>
    );
  }

  const card = (
    <div
      className={`${mobile ? "fixed inset-x-3 bottom-3" : "fixed"} z-[62] rounded-[8px] bg-white px-[18px] py-4 text-[13px] text-[#3A4450] shadow-[0_8px_28px_rgba(0,0,0,0.25)] [&_p]:mb-1.5`}
      style={mobile ? undefined : cardStyle ? { ...cardStyle, width: CARD_W } : { top: "30vh", left: "50%", transform: "translateX(-50%)", width: CARD_W }}
      role="dialog"
      aria-modal="true"
      aria-label={current!.title}
    >
      <div className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">
        Krok {step} z {steps.length}
      </div>
      <h3 className="m-0 mb-1.5 mt-1 text-[17px] font-semibold text-[#0C3450]">{current!.title}</h3>
      {current!.body}
      <div className="mt-2.5 flex items-center gap-2">
        <span className="flex flex-1 gap-[5px]">
          {steps.map((_, i) => (
            <i key={i} className={`h-[7px] w-[7px] rounded-full ${i + 1 === step ? "bg-[#1B6FA8]" : "bg-[#D5DDE4]"}`} />
          ))}
        </span>
        {step > 1 && (
          <button type="button" className={BTN} onClick={back}>
            Wstecz
          </button>
        )}
        <button type="button" autoFocus className={BTN_PRI} onClick={next}>
          {step === steps.length ? "Zaczynamy!" : "Dalej"}
        </button>
      </div>
      <button type="button" onClick={onFinish} className="mt-2 text-[12px] text-[#5C6166] hover:text-[#0C3450]">
        Pomiń przewodnik · wrócisz do niego w „Ściądze”
      </button>
    </div>
  );

  return (
    <>
      {/* Tło: przyciemnienie z „dziurą” na pokazywany element (klik w tło nic nie robi). */}
      <div className="fixed inset-0 z-[60]" aria-hidden onClick={(e) => e.stopPropagation()} />
      {rect && !mobile ? (
        <div
          className="pointer-events-none fixed z-[61] rounded-[6px] border-2 border-white shadow-[0_0_0_9999px_rgba(12,52,80,0.58)]"
          style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
        />
      ) : (
        <div className="pointer-events-none fixed inset-0 z-[61] bg-[rgba(12,52,80,0.58)]" />
      )}
      {card}
    </>
  );
}
