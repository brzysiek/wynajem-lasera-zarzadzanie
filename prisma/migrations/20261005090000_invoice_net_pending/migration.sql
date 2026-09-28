-- AlterTable
ALTER TABLE `rental_finance` ADD COLUMN `invoiceNetPending` BOOLEAN NOT NULL DEFAULT false;


-- Dane (wniosek 17, pkt 1): przyszłe rezerwacje klientów z fakturą „część” bez
-- ustalonej kwoty, dziś liczone jako całość na FV (VAT, bez części, bez
-- wystawionej faktury) — kwota na FV do ustalenia
UPDATE `rental_finance` f
  JOIN `rentals` r ON r.`id` = f.`rentalId`
  JOIN `clients` c ON c.`id` = r.`clientId`
SET f.`invoiceNetPending` = true
WHERE c.`invoiceMode` = 'PARTIAL'
  AND c.`invoicePartDefault` IS NULL
  AND f.`vatApplicable` = true
  AND f.`invoiceNet` IS NULL
  AND f.`fakturowniaInvoiceId` IS NULL
  AND f.`confirmedAt` IS NULL
  AND r.`deletedInGoogle` = false
  AND r.`startsAt` > NOW();
