-- Zamiana modelu kosztu paliwa: zamiast Vehicle.fuelCostPerKm (ręcznie
-- przeliczany koszt/km per pojazd) -> Vehicle.fuelConsumptionL100km (stałe
-- spalanie pojazdu) + PricingSetting["fuel_price_per_liter"] (jeden,
-- współdzielony parametr ceny paliwa, aktualizowany raz dla całej floty).
-- koszt/km = spalanie/100 * cena_paliwa.

-- AlterTable: pricing_settings — updatedAt do wskaźnika "ostatnia
-- aktualizacja: X dni temu" na /ustawienia/pojazdy.
ALTER TABLE `pricing_settings`
  ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- Seed: cena paliwa startowa (ADMIN i tak dostanie przypomnienie o
-- aktualizacji, patrz FuelPriceReminder) — sensowna wartość domyślna, nie
-- zgadywanie kosztu, tylko punkt startowy do natychmiastowej korekty.
INSERT INTO `pricing_settings` (`id`, `key`, `value`, `updatedAt`)
VALUES (UUID(), 'fuel_price_per_liter', 6.50, CURRENT_TIMESTAMP(3));

-- AlterTable: vehicles — fuelCostPerKm -> fuelConsumptionL100km.
-- Brak sensownego automatycznego przeliczenia starych wartości (nie znamy
-- historycznej ceny paliwa, z której powstał każdy zapisany koszt/km) —
-- nowa kolumna dostaje rozsądną wartość startową (8.00 L/100km, typowe
-- spalanie dostawczego), ADMIN poprawia realne wartości na
-- /ustawienia/pojazdy (mała, ręcznie kurowana tabela, kilka pojazdów).
ALTER TABLE `vehicles`
  ADD COLUMN `fuelConsumptionL100km` DECIMAL(5, 2) NOT NULL DEFAULT 8.00;

ALTER TABLE `vehicles` DROP COLUMN `fuelCostPerKm`;
ALTER TABLE `vehicles` DROP COLUMN `fuelCostUpdatedAt`;

-- MySQL/MariaDB: usunięcie DEFAULT to redefinicja kolumny (nie ALTER COLUMN
-- ... DROP DEFAULT jak w Postgresie). Prisma i tak zawsze przekazuje wartość
-- explicit przy insertach, więc to tylko porządkowe zejście ze schematu.
ALTER TABLE `vehicles` MODIFY COLUMN `fuelConsumptionL100km` DECIMAL(5, 2) NOT NULL;
