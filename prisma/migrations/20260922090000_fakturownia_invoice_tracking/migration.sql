-- Śledzenie faktur VAT wystawianych przez Fakturownię z panelu rozliczenia
-- (RentalFinance) + cache NIP kontrahenta z HubSpot (Rental), potrzebny do
-- wyszukania kontrahenta w Fakturowni przed wystawieniem.
ALTER TABLE `rentals`
  ADD COLUMN `contactNipCache` VARCHAR(191) NULL;

ALTER TABLE `rental_finance`
  ADD COLUMN `fakturowniaInvoiceId` INTEGER NULL,
  ADD COLUMN `fakturowniaInvoiceNumber` VARCHAR(191) NULL,
  ADD COLUMN `invoiceIssuedAt` DATETIME(3) NULL,
  ADD COLUMN `invoiceError` TEXT NULL;
