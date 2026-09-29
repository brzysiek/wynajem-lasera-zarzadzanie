-- AlterTable
ALTER TABLE `clients` ADD COLUMN `transportSource` VARCHAR(32) NULL;

-- AlterTable
ALTER TABLE `client_prices` ADD COLUMN `since` DATETIME(3) NULL;


-- Wniosek 28: obecne kwoty transportu zostają bez zmian jako „ustalone”
-- ze źródłem „dotychczasowa kwota” (niczego nie zerujemy ani nie przeliczamy).
UPDATE `clients` SET `transportSource` = 'DOTYCHCZASOWA' WHERE `transportPriceNet` IS NOT NULL AND `transportSource` IS NULL;

-- Wyjątki cen: wersja obowiązuje od ostatniej zmiany wiersza.
UPDATE `client_prices` SET `since` = `updatedAt` WHERE `since` IS NULL;
