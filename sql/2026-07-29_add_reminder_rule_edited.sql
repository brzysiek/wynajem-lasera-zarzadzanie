-- Lets an admin manually edit a queued reminder's message body (popup on the
-- "zakolejkowane" badge) without it being silently overwritten by the next
-- fresh render from the live template — see renderTemplate()/getUpcomingQueue()
-- and sendReminderNow() in reminders.ts, which now check this flag before
-- re-rendering from the template.
-- Apply once on the production database:
--   mysql -u USER -p DBNAME < sql/2026-07-29_add_reminder_rule_edited.sql

ALTER TABLE `reminder_rules`
  ADD COLUMN `edited` BOOLEAN NOT NULL DEFAULT false AFTER `errorMessage`;
