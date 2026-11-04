-- Migration 0003: constrain `status` to the three documented values.
--
-- Every reader in the application treats anything other than 'verified' as
-- "not checked yet", so a stray value fails safe rather than over-claiming.
-- That is why this is hardening and not a live-bug fix -- but nothing in the
-- database enforced the enum, so a hand-applied UPDATE could store a value no
-- code path recognises and no test would ever see.
--
-- SQLite cannot add a CHECK to an existing table, so five tables are rebuilt.
--
-- ORDERING MATTERS, and not in the obvious way. The first draft rebuilt the
-- children and then dropped `airlines`. DROP TABLE performs an implicit
-- DELETE FROM, which raises a foreign-key violation for every fare and benefit
-- still pointing at it; deferring the check only moves the failure to COMMIT,
-- because renaming the replacement table into place does not clear the
-- violation counter. So instead the new parent is built first, the new children
-- are pointed at it by name, and only then are the old tables dropped -- by
-- which time none of them has a dependent. Nothing here needs a transaction or
-- a PRAGMA, which means it is also safe to apply one statement at a time.
--
-- Two further hazards, both caught by rehearsal rather than by reading:
--   * created_at/updated_at were added to fare_families and tsa_rules by 0002
--     with no default, so existing rows hold NULL. Selecting them straight into
--     a NOT NULL column rejected every row and emptied both tables.
--   * `slug` was added to airlines by 0002 with no default and no backfill, so
--     every row that predates it holds NULL. The rebuild below requires a
--     slug, and selecting the NULL straight in rejected every airline row -
--     which also emptied fare_families and benefits, because their foreign
--     keys then pointed at a parent table with no rows. The slug falls back to
--     the row's own id, which is what the seed writes for these rows anyway.
--   * A row carrying an unrecognised status must not abort the migration, so it
--     is normalised to the fail-safe value instead.
--
-- REHEARSE FIRST: cd api && npm run db:rehearse

-- ---------- new parent ----------
CREATE TABLE airlines_v3 (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  iata_code TEXT NOT NULL,
  personal_item_length REAL,
  personal_item_width REAL,
  personal_item_height REAL,
  carry_on_length REAL,
  carry_on_width REAL,
  carry_on_height REAL,
  carry_on_weight REAL,
  checked_bag_weight REAL,
  checked_bag_linear_dim REAL,
  source_url TEXT,
  source_title TEXT,
  effective_date TEXT,
  verified_at TEXT,
  verified_by TEXT,
  scope TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO airlines_v3 (
  id, slug, name, iata_code,
  personal_item_length, personal_item_width, personal_item_height,
  carry_on_length, carry_on_width, carry_on_height, carry_on_weight,
  checked_bag_weight, checked_bag_linear_dim,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency, status, change_note, created_at, updated_at
)
SELECT
  id, COALESCE(slug, id), name, iata_code,
  personal_item_length, personal_item_width, personal_item_height,
  carry_on_length, carry_on_width, carry_on_height, carry_on_weight,
  checked_bag_weight, checked_bag_linear_dim,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency,
  CASE WHEN status IN ('verified','unverified','assumption') THEN status ELSE 'unverified' END,
  change_note,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM airlines;

-- ---------- new children, referencing the new parent ----------
CREATE TABLE fare_families_v3 (
  id TEXT PRIMARY KEY,
  airline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  includes_personal_item INTEGER NOT NULL DEFAULT 1,
  includes_carry_on INTEGER NOT NULL DEFAULT 0,
  first_checked_fee REAL,
  second_checked_fee REAL,
  third_plus_checked_fee REAL,
  carry_on_fee REAL,
  source_url TEXT,
  source_title TEXT,
  effective_date TEXT,
  verified_at TEXT,
  verified_by TEXT,
  scope TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (airline_id) REFERENCES airlines_v3(id)
);

INSERT INTO fare_families_v3 (
  id, airline_id, name, includes_personal_item, includes_carry_on,
  first_checked_fee, second_checked_fee, third_plus_checked_fee, carry_on_fee,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency, status, change_note, created_at, updated_at
)
SELECT
  id, airline_id, name, includes_personal_item, includes_carry_on,
  first_checked_fee, second_checked_fee, third_plus_checked_fee, carry_on_fee,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency,
  CASE WHEN status IN ('verified','unverified','assumption') THEN status ELSE 'unverified' END,
  change_note,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM fare_families;

CREATE TABLE benefits_v3 (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  airline_id TEXT NOT NULL,
  benefit_type TEXT NOT NULL DEFAULT 'CREDIT_CARD',
  tier TEXT,
  waives_first_checked INTEGER NOT NULL DEFAULT 0,
  waives_second_checked INTEGER NOT NULL DEFAULT 0,
  waives_carry_on INTEGER NOT NULL DEFAULT 0,
  companion_limit INTEGER NOT NULL DEFAULT 0,
  source_url TEXT,
  source_title TEXT,
  effective_date TEXT,
  verified_at TEXT,
  verified_by TEXT,
  scope TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (airline_id) REFERENCES airlines_v3(id)
);

INSERT INTO benefits_v3 (
  id, name, airline_id, benefit_type, tier,
  waives_first_checked, waives_second_checked, waives_carry_on, companion_limit,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency, status, change_note, created_at, updated_at
)
SELECT
  id, name, airline_id, benefit_type, tier,
  waives_first_checked, waives_second_checked, waives_carry_on, companion_limit,
  source_url, source_title, effective_date, verified_at, verified_by,
  scope, currency,
  CASE WHEN status IN ('verified','unverified','assumption') THEN status ELSE 'unverified' END,
  change_note,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM benefits;

-- ---------- retire the old tables, children first ----------
DROP TABLE fare_families;
DROP TABLE benefits;
DROP TABLE airlines;

-- Renaming the parent rewrites the REFERENCES clauses in both new children.
ALTER TABLE airlines_v3 RENAME TO airlines;
ALTER TABLE fare_families_v3 RENAME TO fare_families;
ALTER TABLE benefits_v3 RENAME TO benefits;

CREATE UNIQUE INDEX IF NOT EXISTS idx_airlines_slug ON airlines(slug);
CREATE INDEX IF NOT EXISTS idx_fare_families_airline ON fare_families(airline_id);
CREATE INDEX IF NOT EXISTS idx_benefits_airline ON benefits(airline_id);
CREATE INDEX IF NOT EXISTS idx_benefits_type ON benefits(benefit_type);

-- ---------- tables with no relationships ----------
CREATE TABLE tsa_rules_v3 (
  id TEXT PRIMARY KEY,
  item_name TEXT NOT NULL,
  category TEXT NOT NULL,
  allowed_carry_on INTEGER,
  allowed_checked INTEGER,
  notes TEXT,
  source_url TEXT,
  source_title TEXT,
  verified_at TEXT,
  verified_by TEXT,
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO tsa_rules_v3 (
  id, item_name, category, allowed_carry_on, allowed_checked, notes,
  source_url, source_title, verified_at, verified_by, status, change_note,
  created_at, updated_at
)
SELECT
  id, item_name, category, allowed_carry_on, allowed_checked, notes,
  source_url, source_title, verified_at, verified_by,
  CASE WHEN status IN ('verified','unverified','assumption') THEN status ELSE 'unverified' END,
  change_note,
  COALESCE(created_at, datetime('now')),
  COALESCE(updated_at, datetime('now'))
FROM tsa_rules;

DROP TABLE tsa_rules;
ALTER TABLE tsa_rules_v3 RENAME TO tsa_rules;

CREATE TABLE fee_assumptions_v3 (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'assumption' CHECK (status IN ('verified','unverified','assumption')),
  verified_at TEXT,
  verified_by TEXT,
  change_note TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO fee_assumptions_v3 (
  id, label, amount, currency, status, verified_at, verified_by, change_note, updated_at
)
SELECT
  id, label, amount, currency,
  CASE WHEN status IN ('verified','unverified','assumption') THEN status ELSE 'assumption' END,
  verified_at, verified_by, change_note,
  COALESCE(updated_at, datetime('now'))
FROM fee_assumptions;

DROP TABLE fee_assumptions;
ALTER TABLE fee_assumptions_v3 RENAME TO fee_assumptions;
