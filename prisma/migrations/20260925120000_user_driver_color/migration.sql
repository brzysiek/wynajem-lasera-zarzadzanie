-- Kolor ikony kierownicy na kafelkach kalendarza (rola KIEROWCA) — żeby dało
-- się odróżnić przypisanego kierowcę bez najeżdżania kursorem na tooltip.
ALTER TABLE `users`
  ADD COLUMN `driverColor` VARCHAR(191) NULL;
