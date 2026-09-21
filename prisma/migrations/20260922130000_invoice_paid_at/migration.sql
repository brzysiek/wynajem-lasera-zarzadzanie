-- Status "zapłacona" ustalany lokalnie (Fakturownia go nie zna bez
-- płatnego połączenia z bankiem) — ręczny przełącznik albo dopasowanie
-- wgranego wyciągu bankowego, dashboard /finanse/faktury.
ALTER TABLE `rental_finance`
  ADD COLUMN `paidAt` DATETIME(3) NULL;
