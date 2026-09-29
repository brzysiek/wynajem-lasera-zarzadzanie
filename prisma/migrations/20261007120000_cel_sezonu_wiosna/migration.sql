-- Cel sezonu (wniosek 21, decyzja Tomka 29.09.2026) — tylko dane.
-- 1) Lista „wracają z wiosny” zamrożona 29.09.2026: 19 gabinetów z listy
-- „przed sezonem” (wynajmy wiosną, brak rezerwacji na jesień), bez klientki
-- z własnym sprzętem. Liczy się raz, przy pierwszej rezerwacji w sezonie
INSERT INTO `settings` (`key`, `value`)
VALUES ('season_spring_list', '{"frozenAt":"2026-09-29","clientIds":["cmuhfo6hm001cbhipp6hsx1od","cmuhfo6l00035bhipnr46glk7","cmuhfo7t5004qbhip4chj9sud","cmuhfo9b0007hbhipreb7h6am","cmuhfo9dr008rbhip925tj8ux","cmuhfo9dw008ubhipysltvp79","cmuhfo9gd00a3bhipt3ysy17a","cmuhfoane00bzbhiprw590ms7","cmuhfoaqf00dhbhipmv52ncw5","cmuhfoc0o00dwbhipcwdoo8t9","cmuhfoc1l00epbhip37x7z3rw","cmuhfoc6g00gvbhip7fttm0re","cmuhfodd400jjbhipfcwhth7r","cmuhfoek600n1bhip8lirwboi","cmuhfoeky00njbhipl32cibni","cmuhfoen100o1bhip42f0cyle","cmuhfoft300ojbhipqcslt95t","cmuhfokdf00zpbhip4i2ey7nw","cmujgbnj70003bh7mvagzwq3d"]}')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- 2) Plan dnia „Wracają z wiosny”: sygnał „W kontakcie” z krokiem „umówić
-- termin” dla każdego gabinetu z listy bez otwartego sygnału (stała
-- klientka — poza konwersją nowych). Po 3 telefony dziennie od najbliższego
-- dnia roboczego, 9:00, wg liczby wynajmów w 12 mies. Prowadzi Ania.
-- DATETIME w UTC (Prisma), sesja bazy w Europe/Warsaw — 07:00 UTC
INSERT INTO `leads` (`id`, `clientId`, `clientContactId`, `title`, `type`, `stage`, `stageChangedAt`, `ownerId`, `nextActionAt`, `nextStepType`, `nextStepNote`, `attempts`, `followUpNo`, `sourceRef`, `returningClient`, `callList`, `createdAt`, `updatedAt`)
SELECT UUID(), x.id, x.contactId, LEFT(CONCAT('Wraca z wiosny — ', x.label), 191), 'INNE', 'WYWIAD', UTC_TIMESTAMP(3),
  (SELECT u.`id` FROM `users` u WHERE u.`name` = 'Ania' AND u.`role` IN ('ADMIN', 'STAFF') LIMIT 1),
  TIMESTAMP(x.base + INTERVAL (x.k + 2 * FLOOR((WEEKDAY(x.base) + x.k) / 5)) DAY, '07:00:00'),
  'UMOW_TERMIN', 'wraca z wiosny — umówić termin na sezon (cel sezonu)', 0, 0, CONCAT('wiosna:', x.id), 1, 0, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)
FROM (
  SELECT r.*, FLOOR((ROW_NUMBER() OVER (ORDER BY r.r12 DESC, r.label) - 1) / 3) AS k,
    DATE(NOW()) + INTERVAL CASE WEEKDAY(NOW()) WHEN 4 THEN 3 WHEN 5 THEN 2 ELSE 1 END DAY AS base
  FROM (
    SELECT c.`id`, COALESCE(c.`shortName`, c.`name`) AS label,
      (SELECT cc.`id` FROM `client_contacts` cc WHERE cc.`clientId` = c.`id` ORDER BY cc.`isPrimary` DESC LIMIT 1) AS contactId,
      (SELECT COUNT(*) FROM `rentals` rr WHERE rr.`clientId` = c.`id` AND rr.`eventType` = 'WYNAJEM' AND rr.`deletedInGoogle` = 0 AND rr.`startsAt` >= UTC_TIMESTAMP() - INTERVAL 365 DAY AND rr.`startsAt` < UTC_TIMESTAMP())
      + (SELECT COUNT(*) FROM `rental_history` h WHERE h.`clientId` = c.`id` AND h.`kind` = 'WYNAJEM' AND h.`matchState` IN ('AUTO', 'CONFIRMED') AND h.`startsAt` >= UTC_TIMESTAMP() - INTERVAL 365 DAY) AS r12
    FROM `clients` c
    WHERE c.`id` IN ('cmuhfo6hm001cbhipp6hsx1od','cmuhfo6l00035bhipnr46glk7','cmuhfo7t5004qbhip4chj9sud','cmuhfo9b0007hbhipreb7h6am','cmuhfo9dr008rbhip925tj8ux','cmuhfo9dw008ubhipysltvp79','cmuhfo9gd00a3bhipt3ysy17a','cmuhfoane00bzbhiprw590ms7','cmuhfoaqf00dhbhipmv52ncw5','cmuhfoc0o00dwbhipcwdoo8t9','cmuhfoc1l00epbhip37x7z3rw','cmuhfoc6g00gvbhip7fttm0re','cmuhfodd400jjbhipfcwhth7r','cmuhfoek600n1bhip8lirwboi','cmuhfoeky00njbhipl32cibni','cmuhfoen100o1bhip42f0cyle','cmuhfoft300ojbhipqcslt95t','cmuhfokdf00zpbhip4i2ey7nw','cmujgbnj70003bh7mvagzwq3d') AND c.`archivedAt` IS NULL
      AND NOT EXISTS (SELECT 1 FROM `leads` l WHERE l.`clientId` = c.`id` AND l.`archivedAt` IS NULL AND l.`stage` IN ('SYGNAL', 'WYWIAD', 'OFERTA', 'REZERWACJA', 'ODLOZONE'))
  ) r
) x;

INSERT INTO `lead_activities` (`id`, `leadId`, `clientId`, `type`, `body`, `createdAt`)
SELECT UUID(), l.`id`, l.`clientId`, 'SYSTEM', 'Cel sezonu: gabinet z wiosny bez rezerwacji na jesień (lista z 29.09) — Plan dnia „Wracają z wiosny”', UTC_TIMESTAMP(3)
FROM `leads` l WHERE l.`sourceRef` LIKE 'wiosna:%' AND NOT EXISTS (SELECT 1 FROM `lead_activities` a WHERE a.`leadId` = l.`id`);
