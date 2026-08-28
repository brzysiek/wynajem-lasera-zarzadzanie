-- Adds the "KIEROWCA" (driver) role and a single optional driver assignment
-- per rental. A driver logs in to a read-only calendar showing only the
-- rentals an admin has assigned to them (rentals.driverId = their user id).

-- AlterEnum
ALTER TABLE `users` MODIFY `role` ENUM('ADMIN', 'STAFF', 'KIEROWCA') NOT NULL DEFAULT 'STAFF';

-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `driverId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `rentals_driverId_idx` ON `rentals`(`driverId`);

-- AddForeignKey
ALTER TABLE `rentals` ADD CONSTRAINT `rentals_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
