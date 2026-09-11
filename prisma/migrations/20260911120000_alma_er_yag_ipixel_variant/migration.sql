-- Nowy wariant głowicy Alma Harmony: sama głowica Er:YAG iPixel (bez Dye-VL).
-- Cena domyślna tylko dla 1 dnia (1200 zł) — dłuższe wynajmy tego wariantu
-- nie mają dziś ustalonej ceny wielodniowej, biuro wpisze ją ręcznie (jak
-- każde inne urządzenie/wariant bez reguły w cenniku).
INSERT INTO `price_rules` (`id`, `pricingCategory`, `variant`, `durationDays`, `priceNet`) VALUES
    (UUID(), 'ALMA_HARMONY', 'er_yag_ipixel', 1, 1200);
