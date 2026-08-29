-- ADMIN/STAFF z tą flagą mogą wejść w „podgląd kierowcy" w aplikacji
-- (rola efektywna trzymana w cookie, bez zmiany roli w bazie).
ALTER TABLE `users` ADD COLUMN `canActAsDriver` BOOLEAN NOT NULL DEFAULT false;
