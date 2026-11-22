-- AlterTable
ALTER TABLE `users` ADD COLUMN `driverAssignable` BOOLEAN NOT NULL DEFAULT false;

-- Tomek jeździ jako kierowca: można go przypisać w rezerwacji, stawka godzinowa 50 zł (decyzja 2026-11-22).
-- Kolejne osoby włącza ADMIN w Ustawienia → Użytkownicy.
UPDATE `users` SET `driverAssignable` = true, `hourlyRate` = 50.00 WHERE `name` = 'Tomek' AND `role` = 'ADMIN';
