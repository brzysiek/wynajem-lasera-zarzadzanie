-- Membrany Cooltech — ten sam wzorzec co nakładka HS (RentalFinance.capUsedHS/
-- capCountHS/capFeeNet): kierowca zaznacza zużycie + liczbę, dopłata do
-- kwoty wynajmu, cena/szt. jako współdzielony PricingSetting (ADMIN edytuje
-- w Ustawieniach → Cennik, snapshot per wynajem przy pierwszym zaznaczeniu).
ALTER TABLE `rental_finance`
  ADD COLUMN `membraneUsed` BOOLEAN NULL,
  ADD COLUMN `membraneCount` INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN `membraneFeeNet` DECIMAL(10, 2) NULL;

INSERT INTO `pricing_settings` (`id`, `key`, `value`, `updatedAt`)
VALUES (UUID(), 'membrane_fee_cooltech_net', 70, CURRENT_TIMESTAMP(3));
