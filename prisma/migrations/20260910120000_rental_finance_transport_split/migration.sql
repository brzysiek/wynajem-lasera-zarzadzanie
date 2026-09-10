-- Transport jako osobna płatność. Do tej pory cena transportu to był wolny
-- tekst na `rentals.transportPrice` doklejany do jednej sumy z jednym VAT-em i
-- jednym sposobem płatności. Teraz transport ma własną kwotę netto, własny
-- (opcjonalny) VAT 23% i własny sposób płatności — pod przypadek "klientka
-- płaci 100 zł gotówką za transport, a 1230 zł przelewem za wynajem".
ALTER TABLE `rental_finance`
  ADD COLUMN `transportPriceNet` DECIMAL(10, 2) NULL,
  ADD COLUMN `transportPaidSeparately` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `transportVatApplicable` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `transportPaymentMethod` ENUM('CASH', 'TRANSFER') NULL,
  ADD COLUMN `transportCashCollected` BOOLEAN NULL,
  ADD COLUMN `transportTotalNet` DECIMAL(10, 2) NULL,
  ADD COLUMN `transportTotalGross` DECIMAL(10, 2) NULL;

-- Backfill: przenieś pierwszą liczbę z tekstu `rentals.transportPrice`
-- ("500 zł", "300", "150,50 netto") do `transportPriceNet`. Wartości bez
-- liczby ("do uzgodnienia") zostają NULL — biuro wpisze przy edycji.
-- transportPaidSeparately zostaje false (dotychczasowe zachowanie).
UPDATE `rental_finance` `rf`
JOIN `rentals` `r` ON `r`.`id` = `rf`.`rentalId`
SET `rf`.`transportPriceNet` = CAST(
  REPLACE(
    REGEXP_SUBSTR(REPLACE(`r`.`transportPrice`, ',', '.'), '[0-9]+(\\.[0-9]+)?'),
    ' ', ''
  ) AS DECIMAL(10, 2)
)
WHERE `r`.`transportPrice` IS NOT NULL
  AND REGEXP_SUBSTR(REPLACE(`r`.`transportPrice`, ',', '.'), '[0-9]+(\\.[0-9]+)?') IS NOT NULL;
