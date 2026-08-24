-- Categories are flat now. Keep the legacy column for database compatibility,
-- but remove all hierarchy data before the API stops exposing it.
UPDATE categories SET parent_id = NULL WHERE parent_id IS NOT NULL;
