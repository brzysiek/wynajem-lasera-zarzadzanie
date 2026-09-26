-- AlterTable
ALTER TABLE `api_tokens` ADD COLUMN `expiresAt` DATETIME(3) NULL,
    ADD COLUMN `kind` VARCHAR(8) NOT NULL DEFAULT 'STATIC',
    ADD COLUMN `oauthClientId` VARCHAR(191) NULL,
    ADD COLUMN `refreshExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `refreshHash` VARCHAR(64) NULL;

-- CreateTable
CREATE TABLE `oauth_clients` (
    `id` VARCHAR(191) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `clientName` VARCHAR(191) NULL,
    `redirectUris` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_clients_clientId_key`(`clientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `oauth_codes` (
    `id` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(64) NOT NULL,
    `clientId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `approvedById` VARCHAR(191) NOT NULL,
    `redirectUri` TEXT NOT NULL,
    `codeChallenge` VARCHAR(128) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `oauth_codes_codeHash_key`(`codeHash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `api_tokens_refreshHash_key` ON `api_tokens`(`refreshHash`);

