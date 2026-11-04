-- PackRight D1 schema (v2)
--
-- Every policy record carries provenance so the application can tell a user
-- where a number came from and when it was last checked. See
-- data/reference-data.json for the canonical dataset and
-- api/scripts/generate-seed.mjs for the generator that produces seed.sql.
--
-- status is one of:
--   'verified'   a named steward compared the record against source_url on verified_at
--   'unverified' the value is carried over and has a source URL but no steward check
--   'assumption' PackRight applies this as a labelled planning assumption, not a quoted price

CREATE TABLE IF NOT EXISTS airlines (
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

  -- Published overweight and oversize charge bands, as JSON arrays.
  -- Airlines price these in bands rather than one flat rate (American: $30 for
  -- 51-53 lb, $100 for 54-70 lb, $200 for 71-100 lb), so a single column cannot
  -- hold them. NULL means the airline publishes no band list and the engine
  -- falls back to the labelled planning assumption.
  overweight_fees_json TEXT,
  oversize_fees_json TEXT,

  source_url TEXT,
  source_title TEXT,
  effective_date TEXT,
  -- UTC timestamp of when source_url was read for the current check. Separate
  -- from verified_at, which is when a steward confirmed the record.
  retrieved_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  scope TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_airlines_slug ON airlines(slug);

CREATE TABLE IF NOT EXISTS fare_families (
  id TEXT PRIMARY KEY,
  airline_id TEXT NOT NULL,
  name TEXT NOT NULL,

  includes_personal_item INTEGER NOT NULL DEFAULT 1,
  includes_carry_on INTEGER NOT NULL DEFAULT 0,

  -- Nullable on purpose. NULL means "PackRight has no sourced figure", which the
  -- fee engine reports as unpriced rather than substituting a guess.
  first_checked_fee REAL,
  second_checked_fee REAL,
  third_plus_checked_fee REAL,
  carry_on_fee REAL,

  source_url TEXT,
  source_title TEXT,
  effective_date TEXT,
  retrieved_at TEXT,
  verified_at TEXT,
  verified_by TEXT,
  scope TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('verified','unverified','assumption')),
  change_note TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (airline_id) REFERENCES airlines(id)
);

CREATE INDEX IF NOT EXISTS idx_fare_families_airline ON fare_families(airline_id);

CREATE TABLE IF NOT EXISTS benefits (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  airline_id TEXT NOT NULL,

  -- benefit_type separates eligibility systems. Only CREDIT_CARD is modelled today.
  -- Elite status must be added as its own type with its own tier/scope rules, never
  -- folded into this list. See audit issue P0-08.
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
  FOREIGN KEY (airline_id) REFERENCES airlines(id)
);

CREATE INDEX IF NOT EXISTS idx_benefits_airline ON benefits(airline_id);
CREATE INDEX IF NOT EXISTS idx_benefits_type ON benefits(benefit_type);

CREATE TABLE IF NOT EXISTS tsa_rules (
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

-- Fee amounts that no airline publishes as a single figure. The engine applies
-- these only when it has no sourced value, and always labels the result as an
-- assumption so the UI can badge it.
CREATE TABLE IF NOT EXISTS fee_assumptions (
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

-- Audit trail for fee/limit changes, so a published change log can be generated
-- without exposing internal operator detail.
CREATE TABLE IF NOT EXISTS data_change_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  record_id TEXT NOT NULL,
  field TEXT NOT NULL,
  previous_value TEXT,
  current_value TEXT,
  source_url TEXT,
  changed_by TEXT,
  note TEXT,
  changed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_change_log_record ON data_change_log(record_type, record_id);
