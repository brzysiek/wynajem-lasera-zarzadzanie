-- AlterTable
ALTER TABLE `clients` ADD COLUMN `invoiceBuyerName` VARCHAR(191) NULL,
    ADD COLUMN `invoiceBuyerNip` VARCHAR(16) NULL;


-- Cennik: Cooltech 1 dzień 950 zł netto (decyzja Tomka 27.09.2026; było 900).
UPDATE `price_rules` SET `priceNet` = 950.00 WHERE `pricingCategory` = 'COOLTECH_FLAT' AND `variant` IS NULL AND `durationDays` = 1 AND `priceNet` = 900.00;

-- Osoby: jedna „rola” — tekst roli pasujący do listy przechodzi do roles[]
-- (tylko gdy roles puste); reszta zostaje jako „inna rola”.
UPDATE `client_contacts` SET `roles` = JSON_ARRAY('owner'), `role` = NULL WHERE `roles` IS NULL AND `role` IS NOT NULL AND (LOWER(`role`) LIKE 'właściciel%' OR LOWER(`role`) LIKE 'wlasciciel%' OR LOWER(`role`) = 'owner');
UPDATE `client_contacts` SET `roles` = JSON_ARRAY('reception'), `role` = NULL WHERE `roles` IS NULL AND `role` IS NOT NULL AND LOWER(`role`) LIKE 'recepcj%';
UPDATE `client_contacts` SET `roles` = JSON_ARRAY('cosmetologist'), `role` = NULL WHERE `roles` IS NULL AND `role` IS NOT NULL AND LOWER(`role`) LIKE 'kosmetolo%';
UPDATE `client_contacts` SET `roles` = JSON_ARRAY('invoices'), `role` = NULL WHERE `roles` IS NULL AND `role` IS NOT NULL AND (LOWER(`role`) LIKE 'księgow%' OR LOWER(`role`) LIKE 'ksiegow%' OR LOWER(`role`) = 'faktury');
