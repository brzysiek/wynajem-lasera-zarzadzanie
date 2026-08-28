-- "Ustalona cena transportu" — an agreed transport price kept per rental,
-- auto-filled from the HubSpot contact property `ustalona_cena_transportu`
-- when a contact is assigned (analogous to deliveryAddress <- contact address).

-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `contactTransportPriceCache` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `transportPrice` VARCHAR(191) NULL;
