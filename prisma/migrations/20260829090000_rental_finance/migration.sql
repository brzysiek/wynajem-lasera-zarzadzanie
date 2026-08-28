-- Moduł finansowy wydarzeń (docs/finanse-wynajmu/). Finanse są przypięte do
-- wydarzenia (Rental), nie do klienta: cena bazowa (z cennika PriceRule albo
-- ręczna), dopłaty za impulsy, nakładka HS, VAT, sposób płatności. Cała
-- logika liczenia sumy: src/lib/pricing/ (server-side, nie ufamy klientowi).
--
-- Ta migracja tworzy tabele + wgrywa cennik 2025/26 jako dane startowe
-- (konfiguracja, nie fixture testowy — aplikuje się raz, śledzone w
-- _prisma_migrations). Pola pricingCategory/variantOptions na urządzeniach
-- ADMIN uzupełnia ręcznie na /urzadzenia po wdrożeniu.

-- AlterTable
ALTER TABLE `devices`
    ADD COLUMN `pricingCategory` ENUM('LIGHTSHEER_VARIANT', 'LIGHTSHEER_ET400_FLAT', 'ALMA_HARMONY', 'COOLTECH_FLAT', 'RESURFX_FLAT', 'OBSERV_FLAT') NULL,
    ADD COLUMN `variantOptions` JSON NULL;

-- AlterTable
ALTER TABLE `rentals`
    ADD COLUMN `eventType` ENUM('WYNAJEM', 'SZKOLENIE') NOT NULL DEFAULT 'WYNAJEM',
    ADD COLUMN `driverNotes` TEXT NULL;

-- CreateTable
CREATE TABLE `rental_finance` (
    `id` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NOT NULL,
    `baseRentalPriceNet` DECIMAL(10, 2) NOT NULL,
    `baseRentalPriceSource` ENUM('PRICE_LIST', 'MANUAL', 'PULSE_CALCULATED') NOT NULL,
    `baseRentalPriceOverrideNote` TEXT NULL,
    `deviceVariant` VARCHAR(191) NULL,
    `pulseCounterStart` INTEGER NULL,
    `pulseCounterEnd` INTEGER NULL,
    `pulseCalculationStatus` ENUM('PENDING', 'CALCULATED') NULL,
    `pulseSurchargeNet` DECIMAL(10, 2) NULL,
    `capUsedHS` BOOLEAN NULL,
    `capFeeNet` DECIMAL(10, 2) NULL,
    `vatApplicable` BOOLEAN NOT NULL DEFAULT false,
    `vatRate` DECIMAL(5, 2) NOT NULL DEFAULT 23,
    `totalNet` DECIMAL(10, 2) NOT NULL,
    `totalGross` DECIMAL(10, 2) NOT NULL,
    `paymentMethod` ENUM('CASH', 'TRANSFER') NOT NULL,
    `cashCollected` BOOLEAN NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `rental_finance_rentalId_key`(`rentalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `price_rules` (
    `id` VARCHAR(191) NOT NULL,
    `pricingCategory` ENUM('LIGHTSHEER_VARIANT', 'LIGHTSHEER_ET400_FLAT', 'ALMA_HARMONY', 'COOLTECH_FLAT', 'RESURFX_FLAT', 'OBSERV_FLAT') NOT NULL,
    `variant` VARCHAR(191) NULL,
    `durationDays` INTEGER NOT NULL,
    `priceNet` DECIMAL(10, 2) NOT NULL,

    UNIQUE INDEX `price_rules_pricingCategory_variant_durationDays_key`(`pricingCategory`, `variant`, `durationDays`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pulse_tiers` (
    `id` VARCHAR(191) NOT NULL,
    `pricingCategory` ENUM('LIGHTSHEER_VARIANT', 'LIGHTSHEER_ET400_FLAT', 'ALMA_HARMONY', 'COOLTECH_FLAT', 'RESURFX_FLAT', 'OBSERV_FLAT') NOT NULL,
    `durationDays` INTEGER NOT NULL,
    `order` INTEGER NOT NULL,
    `maxPulses` INTEGER NULL,
    `priceNet` DECIMAL(10, 2) NOT NULL,
    `isOverflowTier` BOOLEAN NOT NULL DEFAULT false,
    `overflowStepPulses` INTEGER NULL,
    `overflowStepPriceNet` DECIMAL(10, 2) NULL,

    UNIQUE INDEX `pulse_tiers_pricingCategory_durationDays_order_key`(`pricingCategory`, `durationDays`, `order`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `pricing_settings` (
    `id` VARCHAR(191) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `value` DECIMAL(12, 4) NOT NULL,

    UNIQUE INDEX `pricing_settings_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `rental_finance` ADD CONSTRAINT `rental_finance_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed: cennik 2025/26 (docs/finanse-wynajmu/ sekcja 2). id = UUID() — nieprzezroczysty string,
-- Prismie nie przeszkadza że nie jest cuid.

INSERT INTO `price_rules` (`id`, `pricingCategory`, `variant`, `durationDays`, `priceNet`) VALUES
    (UUID(), 'LIGHTSHEER_VARIANT', 'single_standard', 1, 850),
    (UUID(), 'LIGHTSHEER_VARIANT', 'single_standard', 2, 1500),
    (UUID(), 'LIGHTSHEER_VARIANT', 'single_standard', 3, 2000),
    (UUID(), 'LIGHTSHEER_VARIANT', 'double', 1, 1100),
    (UUID(), 'LIGHTSHEER_VARIANT', 'double', 2, 1900),
    (UUID(), 'LIGHTSHEER_VARIANT', 'double', 3, 2500),
    (UUID(), 'LIGHTSHEER_ET400_FLAT', NULL, 1, 650),
    (UUID(), 'LIGHTSHEER_ET400_FLAT', NULL, 2, 1100),
    (UUID(), 'LIGHTSHEER_ET400_FLAT', NULL, 3, 1450),
    (UUID(), 'ALMA_HARMONY', 'dye_vl', 1, 1200),
    (UUID(), 'ALMA_HARMONY', 'dye_vl', 2, 2000),
    (UUID(), 'ALMA_HARMONY', 'dye_vl', 3, 2500),
    (UUID(), 'ALMA_HARMONY', 'dye_vl_ipixel', 1, 1900),
    (UUID(), 'ALMA_HARMONY', 'dye_vl_ipixel', 2, 3100),
    (UUID(), 'ALMA_HARMONY', 'dye_vl_ipixel', 3, 3900),
    (UUID(), 'COOLTECH_FLAT', NULL, 1, 950),
    (UUID(), 'COOLTECH_FLAT', NULL, 2, 1500),
    (UUID(), 'COOLTECH_FLAT', NULL, 3, 2000),
    (UUID(), 'RESURFX_FLAT', NULL, 1, 900),
    (UUID(), 'RESURFX_FLAT', NULL, 2, 1600),
    (UUID(), 'RESURFX_FLAT', NULL, 3, 2100),
    (UUID(), 'OBSERV_FLAT', NULL, 1, 800),
    (UUID(), 'OBSERV_FLAT', NULL, 7, 1200),
    (UUID(), 'OBSERV_FLAT', NULL, 14, 2000);

INSERT INTO `pulse_tiers` (`id`, `pricingCategory`, `durationDays`, `order`, `maxPulses`, `priceNet`, `isOverflowTier`, `overflowStepPulses`, `overflowStepPriceNet`) VALUES
    (UUID(), 'LIGHTSHEER_VARIANT', 1, 1, 10000, 750, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 1, 2, 12000, 850, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 1, 3, NULL, 950, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 1, 20000, 1300, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 2, 21500, 1400, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 3, 23000, 1500, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 4, 24500, 1600, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 5, 26000, 1700, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 2, 6, NULL, 1700, true, 1500, 100),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 1, 20000, 1600, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 2, 21500, 1700, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 3, 23000, 1800, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 4, 24500, 1900, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 5, 26000, 2000, false, NULL, NULL),
    (UUID(), 'LIGHTSHEER_VARIANT', 3, 6, NULL, 2000, true, 1500, 100);

INSERT INTO `pricing_settings` (`id`, `key`, `value`) VALUES
    (UUID(), 'cap_fee_hs_net', 70),
    (UUID(), 'vat_rate_default', 23),
    (UUID(), 'alma_pulse_rate_net', 0.06);
