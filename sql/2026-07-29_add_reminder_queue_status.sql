-- Two-stage reminder pipeline: an hourly cron promotes SCHEDULED 1/3/7-day
-- reminders into QUEUED once they're within a 7-day lookahead window (giving
-- an "Nadchodzące powiadomienia do wysłania" review/cancel UI something to
-- show ahead of time), and a separate daily cron (schedule configured
-- directly in cPanel) sends whatever in QUEUED is actually due that day.
-- Apply once on the production database:
--   mysql -u USER -p DBNAME < sql/2026-07-29_add_reminder_queue_status.sql

ALTER TABLE `reminder_rules`
  MODIFY COLUMN `status` ENUM('SCHEDULED', 'QUEUED', 'SENT', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'SCHEDULED';

ALTER TABLE `reminder_check_logs`
  ADD COLUMN `queuedCount` INTEGER NOT NULL DEFAULT 0 AFTER `failedCount`;
