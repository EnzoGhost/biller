-- Add language preference to users
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
