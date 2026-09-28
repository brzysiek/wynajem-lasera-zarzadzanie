-- Lejek v2 — poprawki z przeglądu Klaudiusza (wniosek 18, 29.09). Tylko dane.
-- Wzorzec „nieudanej próby” = src/lib/leads/note-rules.ts (FAILED_ATTEMPT_RE).
-- Kolumny DATETIME trzymają UTC (Prisma), a sesja bazy jest w Europe/Warsaw,
-- więc porównania i znaczniki przez UTC_TIMESTAMP(), a „następny dzień
-- roboczy” od daty warszawskiej DATE(NOW()) — 07:00 UTC = 9:00, 14:00 UTC = 16:00

-- 2) Nowe z pierwszym kontaktem z notatek: same nieudane próby („nr zajęty”,
-- „nieudana próba”, „dzwonić jutro”, „połączenie zablokowane”) → bez
-- pierwszego kontaktu, attempts = liczba prób, kolejna próba następnego dnia
-- roboczego o 16:00. Notatka z rozmową → „W kontakcie” z krokiem „dopytać”
UPDATE `leads` l
JOIN (
  SELECT l2.`id`,
    SUM(a.`body` REGEXP _utf8mb4'(?i)(nieudan|zaj(e|ę)t|niedost(e|ę)pn|zablokowan|nie odbiera|nie odebra|poczta g(l|ł)osowa|dzwoni(c|ć) jutro|brak odpowiedzi|nie ma zasi(e|ę)gu|nie mog(e|ę) si(e|ę) dodzwoni)' COLLATE utf8mb4_unicode_ci) AS failed,
    SUM(NOT (a.`body` REGEXP _utf8mb4'(?i)(nieudan|zaj(e|ę)t|niedost(e|ę)pn|zablokowan|nie odbiera|nie odebra|poczta g(l|ł)osowa|dzwoni(c|ć) jutro|brak odpowiedzi|nie ma zasi(e|ę)gu|nie mog(e|ę) si(e|ę) dodzwoni)' COLLATE utf8mb4_unicode_ci)) AS talks
  FROM `leads` l2 JOIN `lead_activities` a ON a.`leadId` = l2.`id` AND a.`type` = 'NOTE' AND TRIM(a.`body`) <> ''
  WHERE l2.`archivedAt` IS NULL AND l2.`stage` = 'SYGNAL' AND l2.`firstContactAt` IS NOT NULL AND l2.`createdAt` >= '2026-01-01'
  GROUP BY l2.`id`
) n ON n.`id` = l.`id`
JOIN (SELECT DATE(NOW()) + INTERVAL CASE WEEKDAY(NOW()) WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END DAY AS nwd) b
SET
  l.`firstContactAt` = IF(n.talks = 0, NULL, l.`firstContactAt`),
  l.`attempts` = IF(n.talks = 0, LEAST(n.failed, 3), 0),
  l.`nextActionAt` = IF(n.talks = 0, TIMESTAMP(b.nwd, '14:00:00'), IF(l.`nextActionAt` IS NULL OR l.`nextActionAt` < UTC_TIMESTAMP(), TIMESTAMP(b.nwd, '08:00:00'), l.`nextActionAt`)),
  l.`nextStepType` = IF(n.talks = 0, 'PONOWNA_PROBA', 'DOPYTAC'),
  l.`nextStepNote` = IF(n.talks = 0, 'kolejna próba (najlepiej 16–17)', 'po rozmowie z notatki — dopytać (poprawka lejka v2)'),
  l.`stageChangedAt` = IF(n.talks = 0, l.`stageChangedAt`, UTC_TIMESTAMP()),
  l.`stage` = IF(n.talks = 0, 'SYGNAL', 'WYWIAD');

INSERT INTO `lead_activities` (`id`, `leadId`, `clientId`, `type`, `body`, `createdAt`)
SELECT UUID(), l.`id`, l.`clientId`, 'STAGE_CHANGE', 'Poprawka lejka v2: rozmowa z notatki → W kontakcie', UTC_TIMESTAMP(3)
FROM `leads` l WHERE l.`nextStepNote` = 'po rozmowie z notatki — dopytać (poprawka lejka v2)';

-- 1) Termin pierwszego kontaktu nowych z ostatnich 7 dni (bez kontaktu i
-- prób): najbliższy dzień roboczy 9:00 od wpłynięcia (zamiast znacznika
-- migracji 27.09 23:10 albo rozłożenia na 02.10)
UPDATE `leads`
SET `nextActionAt` = CASE
    WHEN WEEKDAY(`createdAt`) < 5 AND TIME(`createdAt`) < '07:00:00' THEN TIMESTAMP(DATE(`createdAt`), '07:00:00')
    ELSE TIMESTAMP(DATE(`createdAt`) + INTERVAL CASE WEEKDAY(`createdAt`) WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END DAY, '07:00:00')
  END,
  `nextStepType` = 'PIERWSZY_KONTAKT'
WHERE `archivedAt` IS NULL AND `stage` = 'SYGNAL' AND `firstContactAt` IS NULL AND `attempts` = 0 AND `createdAt` >= UTC_TIMESTAMP() - INTERVAL 7 DAY;

-- 3) Krok niezgodny z etapem: „W kontakcie” bez żadnego kontaktu i z krokiem
-- „pierwszy kontakt” → z powrotem „Nowe”. Pozostałe dalsze etapy z krokiem
-- pierwszego kontaktu / próby → krok właściwy dla etapu (Rezerwacja bez
-- wynajmu: „połącz z wynajmem w kalendarzu”)
UPDATE `leads` l
SET l.`stage` = 'SYGNAL', l.`stageChangedAt` = UTC_TIMESTAMP()
WHERE l.`archivedAt` IS NULL AND l.`stage` = 'WYWIAD' AND l.`firstContactAt` IS NULL AND l.`nextStepType` = 'PIERWSZY_KONTAKT'
  AND NOT EXISTS (SELECT 1 FROM `lead_activities` a WHERE a.`leadId` = l.`id` AND a.`type` IN ('CALL', 'EMAIL', 'SMS', 'NOTE'));

UPDATE `leads`
SET `nextStepNote` = CASE WHEN `stage` = 'REZERWACJA' AND `rentalId` IS NULL THEN 'połącz z wynajmem w kalendarzu' ELSE `nextStepNote` END,
  `attempts` = 0,
  `nextStepType` = CASE `stage` WHEN 'OFERTA' THEN 'FOLLOW_UP_OFERTY' WHEN 'REZERWACJA' THEN 'INNE' ELSE 'DOPYTAC' END
WHERE `archivedAt` IS NULL AND `stage` IN ('WYWIAD', 'OFERTA', 'REZERWACJA', 'ODLOZONE') AND `nextStepType` IN ('PIERWSZY_KONTAKT', 'PONOWNA_PROBA');

-- 4) Kwalifikacja z interakcji: sygnał dalej niż „Nowe” z pierwszym kontaktem
-- albo przegrana po rozmowie (nie same nieudane próby) → klient Potencjalny
UPDATE `clients` c
SET c.`qualifiedAt` = UTC_TIMESTAMP(), c.`qualifiedReason` = 'BACKFILL'
WHERE c.`qualifiedAt` IS NULL AND c.`archivedAt` IS NULL AND EXISTS (
  SELECT 1 FROM `leads` l WHERE l.`clientId` = c.`id` AND l.`archivedAt` IS NULL AND l.`firstContactAt` IS NOT NULL AND (
    l.`stage` IN ('WYWIAD', 'OFERTA', 'REZERWACJA', 'WYGRANA', 'ODLOZONE')
    OR (l.`stage` = 'PRZEGRANA' AND EXISTS (
      SELECT 1 FROM `lead_activities` a WHERE a.`leadId` = l.`id` AND (a.`type` IN ('CALL', 'EMAIL') OR (a.`type` = 'NOTE'
        AND NOT (a.`body` REGEXP _utf8mb4'(?i)(nieudan|zaj(e|ę)t|niedost(e|ę)pn|zablokowan|nie odbiera|nie odebra|poczta g(l|ł)osowa|dzwoni(c|ć) jutro|brak odpowiedzi|nie ma zasi(e|ę)gu|nie mog(e|ę) si(e|ę) dodzwoni)' COLLATE utf8mb4_unicode_ci)))))));
