-- Wniosek 26: porządek jednorazowy w zadaniach. Tylko dane.
-- 1) Zadania „Sygnał: …” → kroki ich sygnałów (jedna data). natalia: krok
-- 01.10 13:00 z treści zadania (sygnał bez terminu). Wojtaszek i schulz: krok
-- już ma tę samą datę — zadanie się zamyka. Piela (07.09) bez zmian (decyzja
-- Ani, grupa Zaległe)
UPDATE `leads` SET `nextActionAt` = '2026-10-01 11:00:00.000', `nextStepNote` = 'telefon godz. 13:00 (z zadania)'
WHERE `id` = 'cmuipssut00iqbhjzy4w0gs9n' AND `nextActionAt` IS NULL AND `archivedAt` IS NULL;

INSERT INTO `lead_activities` (`id`, `leadId`, `clientId`, `type`, `body`, `createdAt`)
SELECT UUID(), l.`id`, l.`clientId`, 'SYSTEM', 'Zadanie „Sygnał: …” zamienione na krok sygnału (porządek zadań)', UTC_TIMESTAMP(3)
FROM `leads` l WHERE l.`id` IN ('cmuipssut00iqbhjzy4w0gs9n', 'cmuipmdw300frbhjze6jrlk48', 'd51a0ec5-bbe4-11f1-8291-1070fd283b8e');

INSERT INTO `task_comments` (`id`, `taskId`, `body`, `createdAt`)
SELECT UUID(), t.`id`, 'Zamienione na krok sygnału — termin i treść są w sygnale (porządek zadań, wniosek 26).', UTC_TIMESTAMP(3)
FROM `tasks` t WHERE t.`id` IN ('d5ba7112-845b-466c-96e5-5d89a942e8a0', 'e58f82e0-3e24-485f-85b5-0b95c603ccc4', '330d6720-b77d-4ba6-909f-8b7ec56cb998') AND t.`status` = 'OPEN';

-- 2) Zadania-listy agenta → Kalendarz → „Do dopięcia” (kolejki liczone z danych)
INSERT INTO `task_comments` (`id`, `taskId`, `body`, `createdAt`)
SELECT UUID(), t.`id`, 'Przeniesione do Kalendarz → Do dopięcia (kolejki liczone na bieżąco z danych, wniosek 26).', UTC_TIMESTAMP(3)
FROM `tasks` t WHERE t.`id` IN ('a438ecff-5928-4bee-a80b-0d57dfac117f', '6760fe7f-adfb-4294-be64-4f02fbed736c', 'eec96588-1720-4b55-80bf-e8e5d6154fce', '21e70ebd-7f90-44a5-a19b-e424ce311dec') AND t.`status` = 'OPEN';

INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), UTC_TIMESTAMP(3), t.`clientId`, 'TASK', t.`id`, 'FIELD_CHANGE', 'status', '"OPEN"', '"DONE"', 'porządek zadań (wniosek 26)'
FROM `tasks` t WHERE t.`status` = 'OPEN' AND t.`id` IN ('d5ba7112-845b-466c-96e5-5d89a942e8a0', 'e58f82e0-3e24-485f-85b5-0b95c603ccc4', '330d6720-b77d-4ba6-909f-8b7ec56cb998', 'a438ecff-5928-4bee-a80b-0d57dfac117f', '6760fe7f-adfb-4294-be64-4f02fbed736c', 'eec96588-1720-4b55-80bf-e8e5d6154fce', '21e70ebd-7f90-44a5-a19b-e424ce311dec');

UPDATE `tasks` SET `status` = 'DONE', `completedAt` = UTC_TIMESTAMP(3), `updatedAt` = UTC_TIMESTAMP(3)
WHERE `status` = 'OPEN' AND `id` IN ('d5ba7112-845b-466c-96e5-5d89a942e8a0', 'e58f82e0-3e24-485f-85b5-0b95c603ccc4', '330d6720-b77d-4ba6-909f-8b7ec56cb998', 'a438ecff-5928-4bee-a80b-0d57dfac117f', '6760fe7f-adfb-4294-be64-4f02fbed736c', 'eec96588-1720-4b55-80bf-e8e5d6154fce', '21e70ebd-7f90-44a5-a19b-e424ce311dec');
