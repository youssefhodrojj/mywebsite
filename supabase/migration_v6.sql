-- =============================================================================
-- migration_v6: exchanges + expense_labels + expenses
-- Run this in the Supabase SQL Editor
-- =============================================================================

-- ---------------------------------------------------------------------------
-- expense_labels  — parametrable label list (name only, no price)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expense_labels (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text        NOT NULL,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT expense_labels_user_name_unique UNIQUE (user_id, name)
);

ALTER TABLE expense_labels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expense_labels_select_own" ON expense_labels;
CREATE POLICY "expense_labels_select_own" ON expense_labels
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "expense_labels_insert_own" ON expense_labels;
CREATE POLICY "expense_labels_insert_own" ON expense_labels
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "expense_labels_delete_own" ON expense_labels;
CREATE POLICY "expense_labels_delete_own" ON expense_labels
  FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- expenses  — actual expense entries
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id           uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label_id     uuid          REFERENCES expense_labels(id) ON DELETE SET NULL,
  amount       numeric(12,2) NOT NULL CHECK (amount > 0),
  note         text,
  expense_date date          NOT NULL DEFAULT CURRENT_DATE,
  created_at   timestamptz   DEFAULT now()
);

ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "expenses_select_own" ON expenses;
CREATE POLICY "expenses_select_own" ON expenses
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "expenses_insert_own" ON expenses;
CREATE POLICY "expenses_insert_own" ON expenses
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "expenses_delete_own" ON expenses;
CREATE POLICY "expenses_delete_own" ON expenses
  FOR DELETE USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- exchanges  — swap out_variant for in_variant, optional price correction
-- price_correction > 0 means customer pays extra, < 0 means we owe them
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exchanges (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid          NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  out_variant_id   uuid          NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  in_variant_id    uuid          NOT NULL REFERENCES variants(id) ON DELETE RESTRICT,
  quantity         integer       NOT NULL DEFAULT 1 CHECK (quantity > 0),
  price_correction numeric(12,2) NOT NULL DEFAULT 0,
  exchange_date    date          NOT NULL DEFAULT CURRENT_DATE,
  note             text,
  created_at       timestamptz   DEFAULT now()
);

ALTER TABLE exchanges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exchanges_select_own" ON exchanges;
CREATE POLICY "exchanges_select_own" ON exchanges
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "exchanges_insert_own" ON exchanges;
CREATE POLICY "exchanges_insert_own" ON exchanges
  FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "exchanges_delete_own" ON exchanges;
CREATE POLICY "exchanges_delete_own" ON exchanges
  FOR DELETE USING (user_id = auth.uid());
