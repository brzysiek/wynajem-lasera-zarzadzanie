-- AlterTable
ALTER TABLE `rentals` ADD COLUMN `trainingLead` VARCHAR(64) NULL,
    ADD COLUMN `trainingParticipants` INTEGER NULL,
    ADD COLUMN `trainingPlace` VARCHAR(16) NULL;

