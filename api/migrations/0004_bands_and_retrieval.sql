-- Migration 0004: per-airline overweight/oversize bands and source retrieval timestamps.
--
-- Two problems this fixes:
--
--   1. `overweight-checked` in fee_assumptions is a flat $100 placeholder. The
--      real charges are banded and differ per airline -- American charges $30
--      for 51-53 lb, $100 for 54-70 lb and $200 for 71-100 lb; Delta charges
--      $100 for 51-70 lb and $200 for 71-99 lb; Frontier charges $75 for 41-50 lb
--      and $129 for 51-99 lb. A flat $100 is wrong for all three, so the
--      assumption was being presented as a price. The bands live on the airline
--      record, because that is where they are published, and the engine now
--      uses the band that matches the bag in hand.
--
--      The oversize side was worse: the engine explicitly said it had no sourced
--      oversize fee and added nothing, so an oversize bag costed $0 in the
--      estimate. Every airline checked publishes an oversize charge.
--
--   2. `retrieved_at` records when the airline's own page was actually read.
--      `verified_at` records when a steward confirmed the record against it.
--      Conflating the two made it impossible to say how fresh a figure was.
--      The build now fails when any airline's source has not been re-read
--      within 90 days, and that check needs the retrieval time to exist.
--
-- Every statement is additive. Existing rows keep their values; the new
-- columns are backfilled by seed.sql, which is generated from
-- data/reference-data.json.
--
-- SQLite ADD COLUMN is not idempotent: running this twice errors on the first
-- duplicate column, which is safe to ignore if the migration already ran.
--
-- REHEARSE FIRST: cd api && npm run db:rehearse

ALTER TABLE airlines ADD COLUMN retrieved_at TEXT;

-- Band lists are values, not relations: read with their airline, written with
-- it, never queried across airlines. JSON text keeps them in one column.
ALTER TABLE airlines ADD COLUMN overweight_fees_json TEXT;
ALTER TABLE airlines ADD COLUMN oversize_fees_json TEXT;

ALTER TABLE fare_families ADD COLUMN retrieved_at TEXT;
