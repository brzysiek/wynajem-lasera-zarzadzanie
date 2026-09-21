-- Status "zapłacona" przeniesiony z RentalFinance (działał tylko dla faktur
-- wystawionych przez tę apkę, czyli w praktyce dla jednej faktury) do
-- osobnej tabeli, keyed wyłącznie po ID faktury z Fakturowni — żeby działał
-- dla WSZYSTKICH faktur w dziale, także wystawionych ręcznie w Fakturowni
-- przed powstaniem tej integracji. Kolumna rental_finance.paidAt nigdy nie
-- miała realnych danych (dodana w tej samej sesji, zero zapisów), więc
-- bezpiecznie do usunięcia bez migracji danych.
ALTER TABLE `rental_finance`
  DROP COLUMN `paidAt`;

CREATE TABLE `fakturownia_payments` (
    `fakturowniaInvoiceId` INTEGER NOT NULL,
    `paidAt` DATETIME(3) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`fakturowniaInvoiceId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
