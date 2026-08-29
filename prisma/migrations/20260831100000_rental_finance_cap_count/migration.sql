-- Klientka czasem zużywa więcej niż jedną nakładkę HS. capUsedHS zostaje
-- (czy w ogóle użyto), capCountHS mówi ile — domyślnie 1, snapshot capFeeNet
-- to nadal cena za 1 szt., suma mnoży fee * count.
ALTER TABLE `rental_finance` ADD COLUMN `capCountHS` INTEGER NOT NULL DEFAULT 1;
