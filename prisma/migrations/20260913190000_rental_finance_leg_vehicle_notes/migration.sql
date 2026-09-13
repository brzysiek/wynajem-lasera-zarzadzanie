-- Dostawa i odbiór mogą jechać różnymi pojazdami (kierowca ten sam — patrz
-- ustalenia w rozmowie), więc koszt paliwa i uwagi kierowcy trzeba liczyć/
-- zbierać PER ETAP, nie dla całego wynajmu naraz.
-- pickupVehicleId = NULL oznacza "ten sam pojazd co Rental.vehicleId"
-- (domyślne, częste) — ustawiane suwakiem w widoku kierowcy tylko gdy inny.
ALTER TABLE `rental_finance`
  ADD COLUMN `pickupVehicleId` VARCHAR(191) NULL,
  ADD COLUMN `deliveryNotes` TEXT NULL,
  ADD COLUMN `pickupNotes` TEXT NULL;

-- CreateIndex
CREATE INDEX `rental_finance_pickupVehicleId_idx` ON `rental_finance`(`pickupVehicleId`);

-- AddForeignKey
ALTER TABLE `rental_finance`
  ADD CONSTRAINT `rental_finance_pickupVehicleId_fkey` FOREIGN KEY (`pickupVehicleId`) REFERENCES `vehicles`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: dotychczasowa ogólna Rental.driverNotes (jedna uwaga na cały
-- wynajem) trafia do deliveryNotes, żeby nie zgubić wpisów już zostawionych
-- przez kierowców. Zapisywanie jakiejkolwiek uwagi przez kierowcę zawsze
-- tworzyło rekord rental_finance (PATCH /api/rentals/[id]/finance/driver
-- robi upsert bezwarunkowo), więc INNER JOIN tu wystarcza.
UPDATE `rental_finance` rf
  JOIN `rentals` r ON r.id = rf.rentalId
  SET rf.deliveryNotes = r.driverNotes
  WHERE r.driverNotes IS NOT NULL AND r.driverNotes <> '';

-- AlterTable: pole zastąpione przez rental_finance.deliveryNotes/pickupNotes.
ALTER TABLE `rentals` DROP COLUMN `driverNotes`;
