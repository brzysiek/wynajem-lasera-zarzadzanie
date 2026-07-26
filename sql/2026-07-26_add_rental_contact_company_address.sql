-- Adds company/address cache fields to rentals, for the HubSpot contact
-- assignment feature in the /kalendarz rental modal.
ALTER TABLE `rentals`
    ADD COLUMN `contactCompanyCache` VARCHAR(191) NULL AFTER `contactEmailCache`,
    ADD COLUMN `contactAddressCache` TEXT NULL AFTER `contactCompanyCache`;
