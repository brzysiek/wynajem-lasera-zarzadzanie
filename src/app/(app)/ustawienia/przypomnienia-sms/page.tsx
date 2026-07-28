import { PageHeader } from "@/components/page-header";
import { ReminderSettingsPanel } from "@/components/reminder-settings-panel";
import { getReminderHour, getRemindersEnabled, getReminderCheckLogs } from "@/lib/reminders";

function formatDateTime(value: Date): string {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "medium" });
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-800">{children}</code>;
}

function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="list-decimal space-y-3 pl-5 text-sm text-gray-700">{children}</ol>;
}

export default async function ReminderSettingsPage() {
  const [hour, remindersEnabled, checkLogs] = await Promise.all([
    getReminderHour(),
    getRemindersEnabled(),
    getReminderCheckLogs(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Przypomnienia SMS" description="Automatyczne SMS-y do klientów i historia ich wysyłki." />

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        Ta strona steruje automatycznymi SMS-ami do klientów. System sam, bez Twojego udziału, wysyła:
        <ul className="my-2 list-disc space-y-1 pl-5">
          <li>
            <strong>potwierdzenie rezerwacji</strong> — zaraz po zapisaniu wynajmu,
          </li>
          <li>
            <strong>przypomnienia</strong> — 7, 3 i 1 dzień przed wynajmem, o porze dnia, którą ustawisz poniżej.
          </li>
        </ul>
        Nie musisz nic uruchamiać ani klikać — wysyłka działa sama, w tle. Jedyne co możesz tu zmienić, to godzina,
        o której mają wychodzić przypomnienia (np. rano, żeby SMS nie przyszedł do klienta w nocy). SMS-y mogą wyjść
        z kilkuminutowym opóźnieniem względem wybranej godziny — to normalne i nie wymaga żadnej reakcji.
        <br />
        <br />
        Jeśli trzeba pilnie wstrzymać wszystkie SMS-y (np. żeby poprawić treść albo uniknąć wysyłki podczas awarii),
        możesz je wyłączyć przyciskiem poniżej. To bezpieczny wyłącznik: nic wtedy nie wychodzi do klientów, a to, co
        w tym czasie „dojrzało” do wysyłki, po włączeniu z powrotem <strong>nie zostanie dosłane z opóźnieniem</strong>{" "}
        — zostanie po prostu pominięte, żeby klienci nie dostali nieaktualnej wiadomości.
      </div>

      <ReminderSettingsPanel initialHour={hour} initialEnabled={remindersEnabled} />

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="mb-2">
          <strong>Jak to jest zrobione technicznie:</strong> sprawdzanie, co jest do wysłania, wykonuje zewnętrzny{" "}
          <strong>Cron Job w cPanelu (Cyberfolks)</strong> — nie sam proces aplikacji. Ten hosting (LiteSpeed lsnode)
          nie gwarantuje, że proces Node.js działa non-stop w tle — bywa usypiany lub restartowany, gdy nikt akurat
          nie przegląda strony — więc wewnętrzny mechanizm w samej aplikacji nie był wiarygodny. Cron Job budzi
          aplikację i na stałym harmonogramie (obecnie co 5 minut) wywołuje adres{" "}
          <Code>/api/cron/reminders</Code>, niezależnie od ruchu na stronie.
        </p>
        <p>
          Każde takie wywołanie sprawdza w bazie wszystkie zaplanowane przypomnienia SMS i wysyła te, których termin
          już nadszedł: potwierdzenia rezerwacji — od razu, bez warunku godzinowego; przypomnienia 7/3/1-dniowe —
          dopiero gdy bieżąca godzina (czasu polskiego) osiągnęła godzinę ustawioną powyżej. Wynik każdego wywołania
          (ile sprawdzono, ile wysłano, ile błędów) trafia do historii poniżej.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Jak zmienić harmonogram lub sekret</h2>
        <p className="mb-5 text-sm text-gray-500">
          Cron Job jest skonfigurowany w panelu hostingowym (Cyberfolks), nie w tej aplikacji — to jedyne miejsce,
          w którym można zmienić częstotliwość sprawdzeń.
        </p>
        <Steps>
          <li>
            Zaloguj się do cPanela na Cyberfolks i wejdź w <Code>Cron Jobs</Code>.
          </li>
          <li>
            Znajdź zadanie wywołujące adres <Code>/wynajem/api/cron/reminders</Code> pod domeną, na której działa
            aplikacja — to ono odpowiada za automatyczne sprawdzenia.
          </li>
          <li>
            Częstotliwość zmienisz edytując pola <Code>Minute / Hour / Day / Month / Weekday</Code> tego zadania
            (np. <Code>*/5 * * * *</Code> oznacza „co 5 minut”).
          </li>
          <li>
            Sekret uwierzytelniający (nagłówek <Code>x-cron-secret</Code> w komendzie <Code>curl</Code> zadania)
            musi być identyczny z wartością <Code>CRON_SECRET</Code> w pliku <Code>.env</Code> na serwerze. Jeśli
            zmienisz jedno, zmień też drugie i zrestartuj aplikację (<Code>touch tmp/restart.txt</Code> albo przez
            deploy) — inaczej zadanie zacznie dostawać błąd 403 i przestanie działać po cichu.
          </li>
          <li>
            Doraźne, natychmiastowe sprawdzenie (bez czekania na cron) można też odpalić ręcznie przyciskiem
            „Wyślij teraz” na stronie <Code>Wysyłka SMS</Code>.
          </li>
        </Steps>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Historia sprawdzeń</h2>
          <p className="mt-1 text-sm text-gray-500">
            Każde sprawdzenie przypomnień do wysyłki — automatyczne (cron) albo ręczne (przycisk „Wyślij teraz”).
          </p>
        </div>
        {checkLogs.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">Brak zarejestrowanych sprawdzeń.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs font-medium text-gray-500">
                <tr>
                  <th className="px-4 py-2">Godzina</th>
                  <th className="px-4 py-2"># sprawdzonych wynajmów</th>
                  <th className="px-4 py-2"># przypomnień do wysłania</th>
                  <th className="px-4 py-2"># wysłanych przypomnień</th>
                  <th className="px-4 py-2"># błędów</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {checkLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="whitespace-nowrap px-4 py-2 text-gray-700">
                      <span className="flex items-center gap-2">
                        {formatDateTime(log.createdAt)}
                        {log.source === "MANUAL" ? (
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                            Ręczne
                          </span>
                        ) : (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600">
                            Automatyczne
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-700">{log.rentalsChecked}</td>
                    <td className="px-4 py-2 text-gray-700">{log.dueCount}</td>
                    <td className="px-4 py-2 text-gray-700">{log.sentCount}</td>
                    <td className="px-4 py-2 text-gray-700">
                      {log.failedCount > 0 ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-700">
                          {log.failedCount}
                        </span>
                      ) : (
                        "0"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
