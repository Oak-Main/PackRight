-- Apply once, after 0004. Existing records retain their standard weight limits.
ALTER TABLE airlines ADD COLUMN personal_item_weight REAL;
ALTER TABLE airlines ADD COLUMN checked_reject_weight_at REAL;
ALTER TABLE airlines ADD COLUMN checked_max_accepted_linear_dim REAL;
ALTER TABLE airlines ADD COLUMN single_excess_fee INTEGER NOT NULL DEFAULT 0;
ALTER TABLE airlines ADD COLUMN excess_covered_from_bag INTEGER;
ALTER TABLE fare_families ADD COLUMN carry_on_purchasable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE fare_families ADD COLUMN included_checked_weight REAL;
