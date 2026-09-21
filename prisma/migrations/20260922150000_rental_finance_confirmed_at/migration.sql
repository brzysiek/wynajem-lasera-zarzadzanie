-- Jawne, globalne potwierdzenie odbioru przez kierowcę — zastępuje
-- dotychczasowe wnioskowanie "raport złożony" z cashCollected/capUsedHS/
-- membraneUsed (te pola zapisują się przy KAŻDYM autosave panelu, nie tylko
-- przy świadomym zakończeniu rozliczenia).
ALTER TABLE `rental_finance`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL;
