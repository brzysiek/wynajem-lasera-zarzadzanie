-- Rental-context SMS placeholder tokens were renamed to carry a
-- "rezerwacja_" prefix, so it's visually clear which tokens need a specific
-- rental's context to resolve (as opposed to e.g. {telefon_obslugi}, a
-- static value):
--   {klient}      -> {rezerwacja_klient}
--   {urzadzenie}  -> {rezerwacja_urzadzenie}
--   {data_start}  -> {rezerwacja_data_start}
--   {data_koniec} -> {rezerwacja_data_koniec}
-- The renderer (src/lib/reminders.ts, src/lib/sms-template.ts) only
-- recognizes the new names, so any saved template still using the old ones
-- needs its content rewritten once. Apply once on the production database:
--   mysql -u USER -p DBNAME < sql/2026-07-29_rename_rental_placeholder_tokens.sql

UPDATE `message_templates`
SET `body` = REPLACE(
                REPLACE(
                  REPLACE(
                    REPLACE(`body`, '{klient}', '{rezerwacja_klient}'),
                    '{urzadzenie}', '{rezerwacja_urzadzenie}'
                  ),
                  '{data_start}', '{rezerwacja_data_start}'
                ),
                '{data_koniec}', '{rezerwacja_data_koniec}'
              )
WHERE `body` LIKE '%{klient}%'
   OR `body` LIKE '%{urzadzenie}%'
   OR `body` LIKE '%{data_start}%'
   OR `body` LIKE '%{data_koniec}%';

UPDATE `message_templates`
SET `subject` = REPLACE(
                  REPLACE(
                    REPLACE(
                      REPLACE(`subject`, '{klient}', '{rezerwacja_klient}'),
                      '{urzadzenie}', '{rezerwacja_urzadzenie}'
                    ),
                    '{data_start}', '{rezerwacja_data_start}'
                  ),
                  '{data_koniec}', '{rezerwacja_data_koniec}'
                )
WHERE `subject` LIKE '%{klient}%'
   OR `subject` LIKE '%{urzadzenie}%'
   OR `subject` LIKE '%{data_start}%'
   OR `subject` LIKE '%{data_koniec}%';
