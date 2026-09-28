-- Lejek v2, etap V1 (porządek w danych) — tylko dane, bez zmian schematu.

-- 1) Kwalifikacja: automatyczny mail z cennikiem (szablon po pobraniu cennika
-- ze strony) to nie kontakt. Cofamy ją klientom, którzy nie mieli żadnej
-- innej wymiany maili, kontaktu w sygnale ani wynajmu
UPDATE `clients` c
SET c.`qualifiedAt` = NULL, c.`qualifiedReason` = 'COFNIĘTE: tylko automatyczny cennik (lejek v2)'
WHERE c.`archivedAt` IS NULL AND c.`qualifiedReason` = 'EMAIL_REPLY'
  AND NOT EXISTS (SELECT 1 FROM `email_messages` e WHERE e.`clientId` = c.`id` AND (e.`direction` = 'IN' OR e.`subject` IS NULL OR e.`subject` <> 'Cennik oraz aktualna oferta - wynajemlasera.pl'))
  AND NOT EXISTS (SELECT 1 FROM `leads` l WHERE l.`clientId` = c.`id` AND l.`firstContactAt` IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM `rentals` r WHERE r.`clientId` = c.`id`);

-- 2) Etapy wg historii, tylko do przodu: otwarte sygnały z 2026 bez
-- pierwszego kontaktu, a z prawdziwą wymianą maili po zapytaniu (bez
-- automatycznego cennika) — pierwszy kontakt z maila, Nowe → W kontakcie,
-- a mail z ofertą → Oferta wysłana (follow-up 1). Stary etap z tabeli
-- pomocniczej (kolejność SET w UPDATE wielotabelowym nie jest gwarantowana)
UPDATE `leads` l JOIN (
  SELECT l2.`id`, l2.`stage` AS oldStage, MIN(e.`sentAt`) AS firstAt, MAX(e.`sentAt`) AS lastAt,
    MAX(e.`direction` = 'OUT' AND LOWER(e.`subject`) LIKE '%ofert%' AND LOWER(e.`subject`) NOT LIKE '%cennik oraz aktualna oferta%') AS offer
  FROM `leads` l2 JOIN `email_messages` e ON e.`clientId` = l2.`clientId` AND e.`sentAt` >= l2.`createdAt`
    AND (e.`direction` = 'IN' OR e.`subject` IS NULL OR e.`subject` <> 'Cennik oraz aktualna oferta - wynajemlasera.pl')
  WHERE l2.`archivedAt` IS NULL AND l2.`createdAt` >= '2026-01-01' AND l2.`firstContactAt` IS NULL
    AND l2.`stage` IN ('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA')
  GROUP BY l2.`id`, l2.`stage`
) m ON m.`id` = l.`id`
SET
  l.`firstContactAt` = m.firstAt,
  l.`lastContactAt` = GREATEST(COALESCE(l.`lastContactAt`, m.lastAt), m.lastAt),
  l.`nextStepType` = CASE
    WHEN m.oldStage = 'REZERWACJA' THEN l.`nextStepType`
    WHEN m.offer = 1 OR m.oldStage = 'OFERTA' THEN 'FOLLOW_UP_OFERTY'
    ELSE 'DOPYTAC' END,
  l.`nextStepNote` = CASE
    WHEN m.oldStage = 'REZERWACJA' THEN l.`nextStepNote`
    WHEN m.offer = 1 OR m.oldStage = 'OFERTA' THEN 'oferta wysłana mailem — follow-up (migracja lejka v2)'
    ELSE 'kontakt mailowy — ustal dalszy krok (migracja lejka v2)' END,
  l.`followUpNo` = CASE WHEN m.oldStage <> 'REZERWACJA' AND (m.offer = 1 OR m.oldStage = 'OFERTA') THEN GREATEST(l.`followUpNo`, 1) ELSE l.`followUpNo` END,
  l.`nextActionAt` = CASE WHEN m.oldStage = 'REZERWACJA' THEN l.`nextActionAt` ELSE NOW() END,
  l.`stageChangedAt` = CASE WHEN m.oldStage = 'SYGNAL' OR (m.oldStage = 'WYWIAD' AND m.offer = 1) THEN m.lastAt ELSE l.`stageChangedAt` END,
  l.`stage` = CASE
    WHEN m.oldStage IN ('SYGNAL', 'WYWIAD') AND m.offer = 1 THEN 'OFERTA'
    WHEN m.oldStage = 'SYGNAL' THEN 'WYWIAD'
    ELSE m.oldStage END;

INSERT INTO `lead_activities` (`id`, `leadId`, `clientId`, `type`, `body`, `createdAt`)
SELECT UUID(), l.`id`, l.`clientId`, 'STAGE_CHANGE',
  CONCAT('Migracja lejka v2: kontakt mailowy od ', DATE_FORMAT(l.`firstContactAt`, '%d.%m'), ' → ', CASE l.`stage` WHEN 'OFERTA' THEN 'Oferta wysłana' WHEN 'WYWIAD' THEN 'W kontakcie' ELSE 'Rezerwacja' END),
  NOW(3)
FROM `leads` l
WHERE l.`nextStepNote` LIKE '%(migracja lejka v2)';

-- 3) Rozłożenie zaległych terminów (migracja L1 ustawiła wszystkim jedną
-- godzinę): otwarte sygnały z 2026, starsze niż 2 dni, termin minął —
-- po 8 na dzień roboczy od następnego dnia roboczego, co 30 min od 9:00,
-- najpierw oferty i rozmowy, potem rezerwacje WWW, formularze, telefony
UPDATE `leads` l JOIN (
  SELECT `id`, ROW_NUMBER() OVER (
    ORDER BY CASE `stage` WHEN 'OFERTA' THEN 0 WHEN 'WYWIAD' THEN 1 WHEN 'REZERWACJA' THEN 2 ELSE 3 END,
      CASE `type` WHEN 'REZERWACJA_WWW' THEN 0 WHEN 'KONTAKT' THEN 1 WHEN 'TELEFON' THEN 2 ELSE 3 END,
      `createdAt` DESC) - 1 AS rn
  FROM `leads`
  WHERE `archivedAt` IS NULL AND `createdAt` >= '2026-01-01' AND `stage` IN ('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA')
    AND `nextActionAt` IS NOT NULL AND `nextActionAt` <= NOW() AND `createdAt` < NOW() - INTERVAL 2 DAY
) q ON q.`id` = l.`id`
JOIN (SELECT DATE(NOW()) + INTERVAL CASE WEEKDAY(NOW()) WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END DAY AS d0) b
SET l.`nextActionAt` = TIMESTAMP(b.d0 + INTERVAL ((q.rn DIV 8) + 2 * FLOOR((WEEKDAY(b.d0) + (q.rn DIV 8)) / 5)) DAY, '07:00:00') + INTERVAL ((q.rn MOD 8) * 30) MINUTE;

-- 4) Podział Klienci / kontakty z zapytań włączony: Potencjalni = tylko osoby
-- z interakcją (nietknięte kontakty zostają w Sygnałach)
INSERT INTO `settings` (`key`, `value`) VALUES ('clients_qualification_active', '1')
ON DUPLICATE KEY UPDATE `value` = '1';
