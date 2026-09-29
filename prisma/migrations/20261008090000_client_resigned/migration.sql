-- AlterTable
ALTER TABLE `clients` ADD COLUMN `resignedAt` DATETIME(3) NULL,
    ADD COLUMN `resignedNote` TEXT NULL,
    ADD COLUMN `resignedReason` VARCHAR(32) NULL,
    ADD COLUMN `resignedRecontactAt` DATETIME(3) NULL;


-- Wniosek 24: od razu „Zrezygnował” — Depilou (kupiła laser, 28.09) i Beauty
-- Wood (brak klientek, zrezygnowała w 2025), z wpisem w dzienniku
UPDATE `clients` SET `resignedAt` = '2026-09-28 10:00:00', `resignedReason` = 'KUPILA_URZADZENIE', `resignedNote` = 'Kupiła własny laser tulowo-erbowy (notatka Ani 28.09)'
WHERE `id` = 'cmuhfo9b0007hbhipreb7h6am' AND `resignedAt` IS NULL;
UPDATE `clients` SET `resignedAt` = '2026-09-28 10:00:00', `resignedReason` = 'BRAK_KLIENTEK', `resignedNote` = 'Brak klientek na zabiegi — zrezygnowała z wynajmów w 2025 (notatka Ani 28.09)'
WHERE `id` = 'cmuhfo7t5004qbhip4chj9sud' AND `resignedAt` IS NULL;
INSERT INTO `change_logs` (`id`, `createdAt`, `clientId`, `clientName`, `entity`, `entityId`, `operation`, `field`, `before`, `after`, `source`)
SELECT UUID(), UTC_TIMESTAMP(3), c.`id`, c.`name`, 'CLIENT', c.`id`, 'STATUS_CHANGE', 'resigned', 'null', CONCAT('"', c.`resignedReason`, '"'), 'wniosek 24: stan „Zrezygnował” z notatek Ani 28.09'
FROM `clients` c WHERE c.`id` IN ('cmuhfo9b0007hbhipreb7h6am', 'cmuhfo7t5004qbhip4chj9sud') AND c.`resignedAt` IS NOT NULL;
