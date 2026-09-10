-- Czas pracy kierowcy (minuty) — wpisywany ręcznie w widoku kierowcy, obok
-- liczników impulsów. Wyłącznie zbieranie danych pod przyszły moduł kosztów
-- bezpośrednich (koszt pracy kierowcy); nigdzie jeszcze nie raportowane.
ALTER TABLE `rental_finance`
  ADD COLUMN `deliveryDurationMinutes` INTEGER NULL,
  ADD COLUMN `pickupDurationMinutes` INTEGER NULL;
