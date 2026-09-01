-- Płeć gramatyczna użytkownika — do odmiany „zlecił"/„zleciła" w liście
-- zadań (polska gramatyka: forma zależy od płci zlecającego). Null dla
-- istniejących kont — do uzupełnienia przez ADMINA na /ustawienia/uzytkownicy.
ALTER TABLE `users` ADD COLUMN `grammaticalGender` ENUM('M', 'F') NULL;
