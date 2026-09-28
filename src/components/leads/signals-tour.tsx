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
  name,
  season,
  target,
  reward,
  onFinish,
  onLater,
  onBeforeStep,
}: {
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
  const rewardText = reward.replace(/\s*\p{Extended_Pictographic}+$/u, "");

  const steps: Step[] = [
    {
      target: "plan",
      title: "Plan dnia i Twój cel",
      body: (
        <>
          <p>Tu zaczynasz dzień. Kolejność zawsze ta sama: wynajmy → nowe → umówione telefony → follow-upy → powroty.</p>
          <p>
            Kliknij punkt, a lista pokaże tylko te sprawy. Zrobione robi się zielone. Po prawej cel sezonu:{" "}
            <b className="text-[#0C3450]">
              {target} rezerwacji z nowych = {rewardText} 🎬
            </b>
            .
          </p>
        </>
      ),
    },
    {
      target: "today-table",
      title: "Lista „Na dziś”",
      maxHeight: 290,
      body: (
        <>
          <p>
            Tylko to, czym trzeba zająć się dziś – od najpilniejszego. <b className="text-[#B8612F]">Terakota = po czasie.</b>
          </p>
          <p>Nowe zapytanie? Zadzwoń w ciągu 4 godzin – wtedy szansa na rozmowę jest wielokrotnie większa.</p>
        </>
      ),
    },
    {
      target: "row-actions",
      title: "Jedno kliknięcie zamiast notatek",
      body: (
        <>
          <p>
            <b className="text-[#0C3450]">Rozmawiałam</b> – zapytanie przechodzi do „W kontakcie”, a osoba staje się Potencjalną klientką.
          </p>
          <p>
            <b className="text-[#0C3450]">Nie odebrała → SMS</b> – SMS z szablonu i kolejna próba jutro same się ustawią. Oferta wysłana z kontakt@ też przesunie się sama.
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
            Filtr <b className="text-[#0C3450]">„Wszystkie aktywne”</b> pokazuje pełną listę zapytań. <b className="text-[#0C3450]">„Odłożone”</b> – te, które wrócą w swoim dniu.
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
  const current = step > 0 ? steps[step - 1] : null;

  const measure = useCallback(() => {
    if (!current) return setRect(null);
    const el = document.querySelector<HTMLElement>(`[data-tour="${current.target}"]`);
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

  if (step === 0) {
    return (
      <div className="fixed inset-0 z-[60] flex items-start justify-center bg-[rgba(12,52,80,0.58)] px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Nowe Sygnały">
        <div className="w-full max-w-[520px] rounded-[10px] bg-white px-7 py-[26px] text-[13px] text-[#2A3540] shadow-[0_10px_36px_rgba(0,0,0,0.3)]">
          <div className="text-[10px] uppercase tracking-[0.12em] text-[#5C6166]">Nowe Sygnały</div>
          <h2 className="m-0 mb-2 mt-1 text-[22px] font-semibold text-[#0C3450]">Cześć {name}! 👋</h2>
          <p>Sygnały mają nową odsłonę – prostszą i z podpowiedziami. Pokażę Ci 5 rzeczy, zajmie to minutę.</p>
          <ul className="ml-[18px] mt-2.5 list-disc text-[#3A4450]">
            <li className="my-[3px]">Plan dnia i Twój cel sezonu</li>
            <li className="my-[3px]">Lista „Na dziś” – od najpilniejszego</li>
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
