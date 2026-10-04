-- CreateTable
CREATE TABLE `proposal_areas` (
    `key` VARCHAR(32) NOT NULL,
    `label` VARCHAR(120) NOT NULL,
    `hint` VARCHAR(191) NULL,
    `dev` BOOLEAN NOT NULL DEFAULT true,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Słownik obszarów: 8 dotychczasowych (backlog panelu, dev = true) i 4 obszary skrzynki Tomka (dev = false)
INSERT INTO `proposal_areas` (`key`, `label`, `hint`, `dev`, `sortOrder`) VALUES
  ('KLIENCI', 'Klienci', NULL, true, 10),
  ('SYGNALY', 'Sygnały', NULL, true, 20),
  ('HISTORIA', 'Historia i dopasowania', NULL, true, 30),
  ('FINANSE', 'Finanse', NULL, true, 40),
  ('KALENDARZ', 'Kalendarz i rezerwacje', NULL, true, 50),
  ('KOMUNIKACJA', 'Komunikacja (SMS, maile)', NULL, true, 60),
  ('INTEGRACJE', 'Integracje (HubSpot, n8n, formularze, Gmail)', NULL, true, 70),
  ('PROCES', 'Zadania i proces pracy', NULL, true, 80),
  ('MARKETING', 'Marketing', 'Google Ads, Meta, kampanie', false, 110),
  ('STRONA', 'Strona', 'WordPress, SEO, GEO, blog, formularze, analityka', false, 120),
  ('OFERTA', 'Oferta', 'urządzenia, cennik, szkolenia, nowe usługi', false, 130),
  ('ORGANIZACJA', 'Organizacja', 'konta, dostępy, ludzie, rozliczenia z dostawcami', false, 140);

-- Zabezpieczenie: obszar spoza słownika w istniejących wnioskach trafia do niego jako deweloperski
INSERT IGNORE INTO `proposal_areas` (`key`, `label`, `dev`, `sortOrder`)
  SELECT DISTINCT `area`, `area`, true, 900 FROM `proposals`;

-- AddForeignKey
ALTER TABLE `proposals` ADD CONSTRAINT `proposals_area_fkey` FOREIGN KEY (`area`) REFERENCES `proposal_areas`(`key`) ON DELETE RESTRICT ON UPDATE CASCADE;

