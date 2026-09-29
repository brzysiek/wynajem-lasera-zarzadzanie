-- AlterTable
ALTER TABLE `proposals` ADD COLUMN `deployedAt` DATETIME(3) NULL,
    ADD COLUMN `deployedCommit` VARCHAR(16) NULL;


-- Wniosek 30, porządek po wdrożeniu: wnioski 20–27 z commitem, w którym weszły
-- (najnowszy wymieniający numer). Status bez zmian — odhacza Tomek.
UPDATE `proposals` SET `deployedCommit` = '8551d7d', `deployedAt` = '2026-09-29 17:47:08' WHERE `number` IN (20, 21, 22) AND `deployedCommit` IS NULL;
UPDATE `proposals` SET `deployedCommit` = '448f212', `deployedAt` = '2026-09-29 18:08:04' WHERE `number` = 23 AND `deployedCommit` IS NULL;
UPDATE `proposals` SET `deployedCommit` = 'c1a1786', `deployedAt` = '2026-09-29 19:09:12' WHERE `number` = 26 AND `deployedCommit` IS NULL;
UPDATE `proposals` SET `deployedCommit` = 'e902775', `deployedAt` = '2026-09-29 19:37:13' WHERE `number` IN (24, 25, 27) AND `deployedCommit` IS NULL;
