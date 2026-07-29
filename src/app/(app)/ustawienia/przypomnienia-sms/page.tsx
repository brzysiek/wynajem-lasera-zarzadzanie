import { auth } from "@/auth";
import { PageHeader } from "@/components/page-header";
import { ReminderSettingsPanel } from "@/components/reminder-settings-panel";
import { ReminderManualRunPanel } from "@/components/reminder-manual-run-panel";
import { UpcomingQueuePanel } from "@/components/upcoming-queue-panel";
import { getRemindersEnabled, getReminderCheckLogs, getUpcomingQueue, QUEUE_LOOKAHEAD_DAYS } from "@/lib/reminders";
import { BASE_PATH } from "@/lib/base-path";

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
  const [session, remindersEnabled, checkLogs, upcomingQueue] = await Promise.all([
    auth(),
    getRemindersEnabled(),
    getReminderCheckLogs(),
    getUpcomingQueue(),
  ]);
  const isAdmin = session?.user.role === "ADMIN";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Przypomnienia SMS" description="Automatyczne SMS-y do klientów i historia ich wysyłki." />

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        Ta strona steruje automatycznymi SMS-ami do klientów — <strong>przypomnieniami</strong> 7, 3 i 1 dzień przed
        wynajmem. (Potwierdzenie rezerwacji wysyłasz teraz ręcznie, bezpośrednio w widoku rezerwacji.) Nie musisz nic
        uruchamiać ani klikać — wysyłka działa sama, w tle, w dwóch krokach:
        <ul className="my-2 list-disc space-y-1 pl-5">
          <li>
            <strong>sprawdzenie, co jest do wysyłki</strong> — zbiera <strong>kolejkę</strong> przypomnień, które
            zbliżają się do terminu wysyłki (widoczna poniżej, do {QUEUE_LOOKAHEAD_DAYS} dni naprzód; możesz w niej
            anulować pojedyncze przypomnienie, zanim pójdzie do klienta) — domyślnie działa całą dobę, co 5 minut,
          </li>
          <li>
            <strong>wysyłka</strong> — wysyła z kolejki to, czego termin faktycznie nadszedł — domyślnie o każdej
            pełnej godzinie między 9:00 a 17:00.
          </li>
        </ul>
        Jeśli trzeba pilnie wstrzymać wszystkie SMS-y (np. żeby poprawić treść albo uniknąć wysyłki podczas awarii),
        możesz je wyłączyć przyciskiem poniżej. To bezpieczny wyłącznik: nic wtedy nie wychodzi do klientów, a to, co
        w tym czasie „dojrzało” do wysyłki, po włączeniu z powrotem <strong>nie zostanie dosłane z opóźnieniem</strong>{" "}
        — zostanie po prostu pominięte, żeby klienci nie dostali nieaktualnej wiadomości.
      </div>

      <ReminderSettingsPanel initialEnabled={remindersEnabled} />

      {isAdmin && <ReminderManualRunPanel />}

      <UpcomingQueuePanel initialItems={upcomingQueue} />

      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="mb-2">
          <strong>Jak to jest zrobione technicznie:</strong> ten mechanizm napędzają dwa niezależne{" "}
          <strong>Cron Joby w cPanelu (Cyberfolks)</strong> — nie sam proces aplikacji. Ten hosting (LiteSpeed
          lsnode) nie gwarantuje, że proces Node.js działa non-stop w tle — bywa usypiany lub restartowany, gdy nikt
          akurat nie przegląda strony — więc wewnętrzny mechanizm w samej aplikacji nie był wiarygodny.
        </p>
        <p className="mb-2">
          Pierwszy Cron Job wywołuje adres <Code>/api/cron/reminders</Code> często (domyślnie co 5 minut, całą dobę) i
          buduje kolejkę widoczną powyżej. Drugi Cron Job wywołuje adres <Code>/api/cron/reminders/send</Code>{" "}
          domyślnie co godzinę między 9:00 a 17:00 — to on faktycznie wysyła to, co z kolejki jest już aktualne.
          Dokładny harmonogram obu zadań jest ustalony wyłącznie w samym cPanelu (aplikacja go nie zna ani nie
          pokazuje). Wynik każdego wywołania (ile sprawdzono, ile wysłano, ile błędów) trafia do historii poniżej —
          oba kroki można też odpalić od razu, bez czekania na cron, przyciskami „Sprawdź teraz” / „Wyślij teraz”
          powyżej.
        </p>
      </div>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-1 text-lg font-semibold text-gray-900">Jak zmienić harmonogram lub sekret</h2>
        <p className="mb-5 text-sm text-gray-500">
          Oba Cron Joby są skonfigurowane w panelu hostingowym (Cyberfolks), nie w tej aplikacji — to jedyne miejsce,
          w którym można zmienić ich częstotliwość, w tym godziny wysyłki.
        </p>
        <Steps>
          <li>
            Zaloguj się do cPanela na Cyberfolks i wejdź w <Code>Cron Jobs</Code>.
          </li>
          <li>
            Znajdź dwa zadania pod domeną, na której działa aplikacja: jedno wywołujące{" "}
            <Code>{`${BASE_PATH}/api/cron/reminders`}</Code> (budowanie kolejki) i drugie wywołujące{" "}
            <Code>{`${BASE_PATH}/api/cron/reminders/send`}</Code> (wysyłka).
          </li>
          <li>
            Częstotliwość lub godzinę zmienisz edytując pola <Code>Minute / Hour / Day / Month / Weekday</Code>{" "}
            odpowiedniego zadania (np. <Code>0 9-17 * * *</Code> oznacza „co pełną godzinę między 9:00 a 17:00” dla
            zadania wysyłki).
          </li>
          <li>
            Sekret uwierzytelniający (nagłówek <Code>x-cron-secret</Code> w komendzie <Code>curl</Code> obu zadań)
            musi być identyczny z wartością <Code>CRON_SECRET</Code> w pliku <Code>.env</Code> na serwerze. Jeśli
            zmienisz jedno, zmień też drugie i zrestartuj aplikację (<Code>touch tmp/restart.txt</Code> albo przez
            deploy) — inaczej zadania zaczną dostawać błąd 403 i przestaną działać po cichu.
          </li>
        </Steps>
      </section>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-gray-900">Historia sprawdzeń</h2>
          <p className="mt-1 text-sm text-gray-500">
            Każde uruchomienie budowania kolejki lub wysyłki — automatyczne (Cron Job) albo ręczne (przyciski
            „Sprawdź teraz” / „Wyślij teraz” powyżej).
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
                  <th className="px-4 py-2"># do wysłania</th>
                  <th className="px-4 py-2"># wysłanych</th>
                  <th className="px-4 py-2"># błędów</th>
                  <th className="px-4 py-2"># nowo w kolejce</th>
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
                    <td className="px-4 py-2 text-gray-700">{log.queuedCount}</td>
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
