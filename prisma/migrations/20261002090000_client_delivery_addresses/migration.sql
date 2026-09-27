-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `deliveryAddressId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `client_delivery_addresses` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `label` VARCHAR(64) NOT NULL,
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `street` VARCHAR(191) NULL,
    `zip` VARCHAR(8) NULL,
    `city` VARCHAR(191) NULL,
    `lat` DOUBLE NULL,
    `lng` DOUBLE NULL,
    `geoPrecision` VARCHAR(16) NULL,
    `geoQuery` VARCHAR(255) NULL,
    `geoState` VARCHAR(64) NULL,
    `geoCounty` VARCHAR(64) NULL,
    `distanceKm` DECIMAL(6, 1) NULL,
    `durationMin` INTEGER NULL,
    `routeCalculatedAt` DATETIME(3) NULL,
    `entrance` TEXT NULL,
    `floor` TEXT NULL,
    `parking` TEXT NULL,
    `power` TEXT NULL,
    `receiver` TEXT NULL,
    `openingHours` TEXT NULL,
    `usualStartTime` VARCHAR(16) NULL,
    `officeNotes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `client_delivery_addresses_clientId_idx`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `delivery_feedback` (
    `id` VARCHAR(191) NOT NULL,
    `addressId` VARCHAR(191) NOT NULL,
    `rentalId` VARCHAR(191) NULL,
    `driverId` VARCHAR(191) NULL,
    `text` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `delivery_feedback_addressId_createdAt_idx`(`addressId`, `createdAt`),
    INDEX `delivery_feedback_rentalId_idx`(`rentalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `rentals_deliveryAddressId_idx` ON `rentals`(`deliveryAddressId`);

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_deliveryAddressId_fkey` FOREIGN KEY (`deliveryAddressId`) REFERENCES `client_delivery_addresses`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_delivery_addresses` ADD CONSTRAINT `client_delivery_addresses_clientId_fkey` FOREIGN KEY (`clientId`) REFERENCES `clients`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_feedback` ADD CONSTRAINT `delivery_feedback_addressId_fkey` FOREIGN KEY (`addressId`) REFERENCES `client_delivery_addresses`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_feedback` ADD CONSTRAINT `delivery_feedback_rentalId_fkey` FOREIGN KEY (`rentalId`) REFERENCES `rentals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `delivery_feedback` ADD CONSTRAINT `delivery_feedback_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;


-- Paszport dostawy: dotychczasowy adres dostawy (albo adres firmy), uwagi
-- „na miejscu”, godziny otwarcia i odległość trafiają do adresu domyślnego
-- „Gabinet”. Współrzędne z mapy klientek przechodzą razem z kluczem adresu
-- (adres dostawy był pusty, więc klucz = adres firmy), trasę OSRM przelicza
-- panel przy pierwszym zapisie adresu albo z mapy („Uzupełnij współrzędne”).
INSERT INTO `client_delivery_addresses`
  (`id`, `clientId`, `label`, `isDefault`, `street`, `zip`, `city`, `lat`, `lng`, `geoPrecision`, `geoQuery`, `distanceKm`,
   `entrance`, `floor`, `parking`, `power`, `receiver`, `openingHours`, `createdAt`, `updatedAt`)
SELECT
  CONCAT('cda', REPLACE(UUID(), '-', '')),
  c.`id`,
  'Gabinet',
  true,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN LEFT(TRIM(c.`deliveryAddress`), 191) ELSE c.`street` END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE LEFT(c.`zip`, 8) END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE LEFT(c.`city`, 191) END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE c.`lat` END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE c.`lng` END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE c.`geoPrecision` END,
  CASE WHEN NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL THEN NULL ELSE c.`geoQuery` END,
  c.`distanceKm`,
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.`deliveryNotes`, '$.entrance')), 'null'),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.`deliveryNotes`, '$.floor')), 'null'),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.`deliveryNotes`, '$.parking')), 'null'),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.`deliveryNotes`, '$.power')), 'null'),
  NULLIF(JSON_UNQUOTE(JSON_EXTRACT(c.`deliveryNotes`, '$.receiver')), 'null'),
  c.`openingHours`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `clients` c
WHERE NULLIF(TRIM(c.`deliveryAddress`), '') IS NOT NULL
   OR c.`deliveryNotes` IS NOT NULL
   OR NULLIF(TRIM(c.`openingHours`), '') IS NOT NULL
   OR c.`distanceKm` IS NOT NULL
   OR NULLIF(TRIM(c.`street`), '') IS NOT NULL
   OR NULLIF(TRIM(c.`zip`), '') IS NOT NULL
   OR NULLIF(TRIM(c.`city`), '') IS NOT NULL;
