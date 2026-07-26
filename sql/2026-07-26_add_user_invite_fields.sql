-- Adds invite/activation tracking to users, for the invite-a-user flow in
-- the /ustawienia/uzytkownicy panel. Existing rows get NULL for both, which
-- the app treats as "already active" (no pending badge).
ALTER TABLE `users`
    ADD COLUMN `invitedAt` DATETIME(3) NULL AFTER `role`,
    ADD COLUMN `activatedAt` DATETIME(3) NULL AFTER `invitedAt`;
