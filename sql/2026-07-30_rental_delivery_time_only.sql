-- The delivery/pickup fields only ever need the time of day (the date is
-- always the rental's own start/end date and is never surfaced anywhere),
-- so replace the DATETIME columns with plain "HH:MM" strings.
ALTER TABLE `rentals`
    ADD COLUMN `deliveryTime` VARCHAR(5) NULL AFTER `deliveryAddress`,
    ADD COLUMN `pickupTime` VARCHAR(5) NULL AFTER `deliveryTime`;

UPDATE `rentals` SET `deliveryTime` = DATE_FORMAT(`deliveryAt`, '%H:%i') WHERE `deliveryAt` IS NOT NULL;
UPDATE `rentals` SET `pickupTime` = DATE_FORMAT(`pickupAt`, '%H:%i') WHERE `pickupAt` IS NOT NULL;

ALTER TABLE `rentals`
    DROP COLUMN `deliveryAt`,
    DROP COLUMN `pickupAt`;
