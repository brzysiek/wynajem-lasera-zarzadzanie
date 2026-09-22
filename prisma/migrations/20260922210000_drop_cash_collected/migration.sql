-- Usuwa osobne pole "gotówka odebrana" (wynajem) — przy PaymentMethod.CASH
-- gotówkę uznajemy teraz za odebraną dokładnie wtedy, gdy confirmedAt != null
-- (jeden, sticky przycisk "Potwierdzam odbiór..." w panelu kierowcy robi obie
-- rzeczy naraz). transportCashCollected zostaje bez zmian — to osobny etap
-- (transport bywa rozliczany przy dostawie, nie przy odbiorze).
ALTER TABLE `rental_finance`
  DROP COLUMN `cashCollected`;
