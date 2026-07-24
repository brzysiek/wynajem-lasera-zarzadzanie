-- Seed: initial administrator account
-- Login: lukasz@wynajemlasera.pl
-- Password: 12345678 (bcrypt hash below, cost factor 10)
INSERT INTO `users` (`id`, `email`, `passwordHash`, `name`, `role`, `createdAt`)
VALUES (
    '98dcaafa-efe7-4ecf-a73a-bac2e251b53f',
    'lukasz@wynajemlasera.pl',
    '$2b$10$.gseMydpRSklch1x79Z24e0GA2.ZnLWUTiirgMOy/MHbr9jKwCtly',
    'Łukasz',
    'ADMIN',
    CURRENT_TIMESTAMP
);
