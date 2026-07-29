"use client";

import { useEffect, useRef, useState } from "react";
import { BASE_PATH } from "@/lib/base-path";
import type { ReminderCheckLogDto } from "@/lib/reminders";

const PAGE_SIZES = [10, 25, 50, 100, 500] as const;

function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString("pl-PL", { dateStyle: "short", timeStyle: "medium" });
}

export function ReminderCheckLogTable({
  initialLogs,
  initialTotal,
}: {
  initialLogs: ReminderCheckLogDto[];
  initialTotal: number;
}) {
  const [logs, setLogs] = useState(initialLogs);
  const [total, setTotal] = useState(initialTotal);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [activityOnly, setActivityOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const skippedFirst = useRef(false);

  useEffect(() => {
    if (!skippedFirst.current) {
      skippedFirst.current = true;
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      activityOnly: String(activityOnly),
    });
    fetch(`${BASE_PATH}/api/reminders/check-logs?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setLogs(data.logs);
        setTotal(data.total);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, activityOnly]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Historia sprawdzeń</h2>
          <p className="mt-1 text-sm text-gray-500">
            Każde uruchomienie budowania kolejki lub wysyłki — automatyczne (Cron Job) albo ręczne (przyciski
            „Sprawdź teraz” / „Wyślij teraz” powyżej).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-700">
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={activityOnly}
              onChange={(e) => {
                setActivityOnly(e.target.checked);
                setPage(1);
              }}
            />
            Tylko z aktywnością (niezerowe)
          </label>
          <label className="flex items-center gap-1.5">
            Na stronie
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-gray-300 px-2 py-1 text-sm"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {logs.length === 0 ? (
        <div className="p-12 text-center text-sm text-gray-400">
          {activityOnly ? "Brak sprawdzeń z aktywnością." : "Brak zarejestrowanych sprawdzeń."}
        </div>
      ) : (
        <div className={`overflow-x-auto ${isLoading ? "opacity-50" : ""}`}>
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
              {logs.map((log) => (
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

      {total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm text-gray-600">
          <span>
            {from}–{to} z {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || isLoading}
              className="rounded-md border border-gray-300 px-2.5 py-1 disabled:opacity-40"
            >
              Poprzednia
            </button>
            <span>
              Strona {page} z {totalPages}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || isLoading}
              className="rounded-md border border-gray-300 px-2.5 py-1 disabled:opacity-40"
            >
              Następna
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
