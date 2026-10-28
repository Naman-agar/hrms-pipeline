-- TPRD 01 §4 — raw migration added after init: trigram indexes for user search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX users_search_trgm ON "User" USING gin ((lower("firstName" || ' ' || "lastName")) gin_trgm_ops);
CREATE INDEX users_email_trgm  ON "User" USING gin (lower(email) gin_trgm_ops);
