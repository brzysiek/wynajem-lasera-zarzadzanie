-- Historia wgranych wyciągów bankowych (/finanse/faktury) — jedna faktura
-- per wgranie: kiedy, jaki plik, ile transakcji rozpoznano i z jakim
-- wynikiem dopasowania.
CREATE TABLE `bank_statement_uploads` (
    `id` VARCHAR(191) NOT NULL,
    `fileName` VARCHAR(191) NOT NULL,
    `uploadedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `uploadedByUserId` VARCHAR(191) NULL,
    `transactionsParsed` INTEGER NOT NULL,
    `autoMatched` INTEGER NOT NULL,
    `ambiguous` INTEGER NOT NULL,
    `noMatch` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
