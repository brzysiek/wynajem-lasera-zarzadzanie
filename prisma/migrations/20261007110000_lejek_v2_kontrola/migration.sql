-- Lejek v2 — kontrola po wdrożeniu 29.09 09:35 (wniosek 18). Tylko dane.
-- Kolumny DATETIME trzymają UTC (Prisma), sesja bazy jest w Europe/Warsaw,
-- dlatego znaczniki przez UTC_TIMESTAMP().

-- 2) Krok „follow-up oferty” przed etapem „Oferta wysłana” (Sanok, Sosnowiec):
-- oferta już poszła → „Oferta wysłana”. Data wejścia w etap = ostatni mail
-- z ofertą z kontakt@ po wpłynięciu zapytania (bez automatu z cennikiem),
-- a gdy go brak — teraz
UPDATE `leads` l
LEFT JOIN (
  SELECT l2.`id`, MAX(e.`sentAt`) AS offerAt
  FROM `leads` l2
  JOIN `email_messages` e ON e.`clientId` = l2.`clientId` AND e.`direction` = 'OUT' AND e.`sentAt` >= l2.`createdAt`
    AND LOWER(e.`subject`) LIKE '%ofert%' AND LOWER(e.`subject`) NOT LIKE '%cennik oraz aktualna oferta%'
  WHERE l2.`archivedAt` IS NULL AND l2.`stage` IN ('SYGNAL', 'WYWIAD') AND l2.`nextStepType` = 'FOLLOW_UP_OFERTY'
  GROUP BY l2.`id`
) o ON o.`id` = l.`id`
SET l.`nextStepNote` = CONCAT('przeniesione do „Oferta wysłana” (poprawka lejka v2)', IF(l.`nextStepNote` IS NULL OR l.`nextStepNote` = '', '', CONCAT(' — ', l.`nextStepNote`))),
  l.`firstContactAt` = COALESCE(l.`firstContactAt`, o.offerAt, UTC_TIMESTAMP()),
  l.`lastContactAt` = GREATEST(COALESCE(l.`lastContactAt`, '1970-01-01'), COALESCE(o.offerAt, '1970-01-01')),
  l.`stageChangedAt` = COALESCE(o.offerAt, UTC_TIMESTAMP()),
  l.`attempts` = 0,
  l.`stage` = 'OFERTA'
WHERE l.`archivedAt` IS NULL AND l.`stage` IN ('SYGNAL', 'WYWIAD') AND l.`nextStepType` = 'FOLLOW_UP_OFERTY';

INSERT INTO `lead_activities` (`id`, `leadId`, `clientId`, `type`, `body`, `createdAt`)
SELECT UUID(), l.`id`, l.`clientId`, 'STAGE_CHANGE', 'Poprawka lejka v2: krok „follow-up oferty” → Oferta wysłana', UTC_TIMESTAMP(3)
FROM `leads` l WHERE l.`nextStepNote` LIKE 'przeniesione do „Oferta wysłana” (poprawka lejka v2)%';

UPDATE `leads` SET `nextStepNote` = NULLIF(TRIM(LEADING ' — ' FROM SUBSTRING(`nextStepNote`, CHAR_LENGTH('przeniesione do „Oferta wysłana” (poprawka lejka v2)') + 1)), '')
WHERE `nextStepNote` LIKE 'przeniesione do „Oferta wysłana” (poprawka lejka v2)%';

UPDATE `clients` c
SET c.`qualifiedAt` = UTC_TIMESTAMP(), c.`qualifiedReason` = 'BACKFILL'
WHERE c.`qualifiedAt` IS NULL AND c.`archivedAt` IS NULL
  AND EXISTS (SELECT 1 FROM `leads` l WHERE l.`clientId` = c.`id` AND l.`archivedAt` IS NULL AND l.`stage` = 'OFERTA');

-- 3) Scalenie duplikatów (P-19): sygnał, który przejął wyższy etap z
-- duplikatu, dostał datę scalenia jako datę wejścia w etap („oferta 29.09”).
-- Przywracamy datę z duplikatu (justynaszczupacka 12.01, violettape3 20.04)
UPDATE `leads` s
JOIN `leads` a ON a.`clientId` = s.`clientId` AND a.`id` <> s.`id` AND a.`archiveReason` = 'DUPLIKAT' AND a.`stage` = s.`stage`
SET s.`stageChangedAt` = a.`stageChangedAt`
WHERE s.`archivedAt` IS NULL AND a.`stageChangedAt` < s.`stageChangedAt`
  AND EXISTS (SELECT 1 FROM `lead_activities` x WHERE x.`leadId` = s.`id` AND x.`type` = 'STAGE_CHANGE' AND x.`body` LIKE 'Przejęto z duplikatu%→%');
