-- Adds the delivery/pickup details (address, delivery datetime, pickup
-- datetime) shown in the rental form's new "Dostawa" section and in the
-- Nadchodzące columns.
ALTER TABLE `rentals`
    ADD COLUMN `deliveryAddress` TEXT NULL AFTER `contactAddressCache`,
    ADD COLUMN `deliveryAt` DATETIME(3) NULL AFTER `deliveryAddress`,
    ADD COLUMN `pickupAt` DATETIME(3) NULL AFTER `deliveryAt`;
