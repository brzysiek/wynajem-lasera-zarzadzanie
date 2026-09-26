-- AlterTable
ALTER TABLE `users` ADD COLUMN `agentAssignable` BOOLEAN NOT NULL DEFAULT false;


-- Agent AI przydziela zadania tylko Tomkowi i Ani (decyzja 2026-09-27).
-- Kolejne osoby włącza ADMIN w Ustawienia → Użytkownicy.
UPDATE `users` SET `agentAssignable` = true WHERE `name` IN ('Tomek', 'Ania') AND `role` IN ('ADMIN', 'STAFF');
