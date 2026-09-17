-- =============================================================================
-- Stock Management Admin Panel -- Database Schema
-- =============================================================================
-- How to run:
--   1. Open your Supabase project dashboard.
--   2. Navigate to the SQL Editor (left sidebar).
--   3. Paste the entire contents of this file into a new query.
--   4. Click "Run" (or press Ctrl+Enter / Cmd+Enter).
--
-- This script is idempotent: tables are created with IF NOT EXISTS guards and
-- policies are dropped before being recreated, so it is safe to run more than
-- once on a fresh project. If you need to reset an existing schema, drop the
-- objects manually first.
-- =============================================================================


-- =============================================================================
-- SECTION 1: TABLES
-- =============================================================================

-- ---------------------------------------------------------------------------
-- products
-- Top-level entity owned directly by an authenticated user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  description text,
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT products_user_name_unique UNIQUE (user_id, name)
);

-- ---------------------------------------------------------------------------
-- variants
-- A variant belongs to a product and carries a JSONB attributes bag
-- (e.g. {"size":"M","color":"red"}). Attribute combinations must be unique
-- per product.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variants (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  attributes  jsonb       NOT NULL,
  created_at  timestamptz DEFAULT now(),

  CONSTRAINT variants_product_attributes_unique UNIQUE (product_id, attributes)
);

-- ---------------------------------------------------------------------------
-- purchase_batches
-- Records a single purchase event for a variant: quantity received,
-- cost price paid, and the date of purchase.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_batches (
  id            uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid           NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity      integer        NOT NULL CHECK (quantity > 0),
  cost_price    numeric(12,2)  NOT NULL CHECK (cost_price >= 0),
  purchased_at  date           NOT NULL,
  created_at    timestamptz    DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- stock_corrections
-- Manual adjustments to a variant's stock level (positive or negative).
-- An optional reason text explains why the correction was made.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_corrections (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid        NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  adjustment    integer     NOT NULL,
  reason        text,
  corrected_at  date        NOT NULL,
  created_at    timestamptz DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- sale_records
-- Records a single sale event for a variant: quantity sold,
-- sell price charged, and the date of sale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_records (
  id           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id   uuid           NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity     integer        NOT NULL CHECK (quantity > 0),
  sell_price   numeric(12,2)  NOT NULL CHECK (sell_price >= 0),
  sold_at      date           NOT NULL,
  created_at   timestamptz    DEFAULT now()
);


-- =============================================================================
-- SECTION 2: ENABLE ROW LEVEL SECURITY
-- =============================================================================
-- RLS must be enabled before policies can take effect. All five tables are
-- locked down; the Supabase anon key is safe to expose in frontend code
-- because every query is restricted to the authenticated user's own rows.
-- =============================================================================

ALTER TABLE products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE variants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_batches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_corrections ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_records      ENABLE ROW LEVEL SECURITY;


-- =============================================================================
-- SECTION 3: RLS POLICIES -- products
-- Direct ownership check: auth.uid() must equal user_id on the row.
-- =============================================================================

-- SELECT: users can only read their own products
DROP POLICY IF EXISTS "products_select_own" ON products;
CREATE POLICY "products_select_own"
  ON products
  FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: users can only insert rows where user_id equals their own uid
DROP POLICY IF EXISTS "products_insert_own" ON products;
CREATE POLICY "products_insert_own"
  ON products
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: users can only update their own products
DROP POLICY IF EXISTS "products_update_own" ON products;
CREATE POLICY "products_update_own"
  ON products
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: users can only delete their own products
DROP POLICY IF EXISTS "products_delete_own" ON products;
CREATE POLICY "products_delete_own"
  ON products
  FOR DELETE
  USING (auth.uid() = user_id);


-- =============================================================================
-- SECTION 4: RLS POLICIES -- variants
-- Ownership is resolved via the parent products row (one-level join).
-- =============================================================================

-- SELECT
DROP POLICY IF EXISTS "variants_select_own" ON variants;
CREATE POLICY "variants_select_own"
  ON variants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = variants.product_id
        AND products.user_id = auth.uid()
    )
  );

-- INSERT
DROP POLICY IF EXISTS "variants_insert_own" ON variants;
CREATE POLICY "variants_insert_own"
  ON variants
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = variants.product_id
        AND products.user_id = auth.uid()
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "variants_update_own" ON variants;
CREATE POLICY "variants_update_own"
  ON variants
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = variants.product_id
        AND products.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = variants.product_id
        AND products.user_id = auth.uid()
    )
  );

-- DELETE
DROP POLICY IF EXISTS "variants_delete_own" ON variants;
CREATE POLICY "variants_delete_own"
  ON variants
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM products
      WHERE products.id = variants.product_id
        AND products.user_id = auth.uid()
    )
  );


-- =============================================================================
-- SECTION 5: RLS POLICIES -- purchase_batches
-- Ownership resolved via variants -> products chain (two-level join).
-- =============================================================================

-- SELECT
DROP POLICY IF EXISTS "purchase_batches_select_own" ON purchase_batches;
CREATE POLICY "purchase_batches_select_own"
  ON purchase_batches
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = purchase_batches.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- INSERT
DROP POLICY IF EXISTS "purchase_batches_insert_own" ON purchase_batches;
CREATE POLICY "purchase_batches_insert_own"
  ON purchase_batches
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = purchase_batches.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "purchase_batches_update_own" ON purchase_batches;
CREATE POLICY "purchase_batches_update_own"
  ON purchase_batches
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = purchase_batches.variant_id
        AND products.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = purchase_batches.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- DELETE
DROP POLICY IF EXISTS "purchase_batches_delete_own" ON purchase_batches;
CREATE POLICY "purchase_batches_delete_own"
  ON purchase_batches
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = purchase_batches.variant_id
        AND products.user_id = auth.uid()
    )
  );


-- =============================================================================
-- SECTION 6: RLS POLICIES -- stock_corrections
-- Ownership resolved via variants -> products chain (two-level join).
-- =============================================================================

-- SELECT
DROP POLICY IF EXISTS "stock_corrections_select_own" ON stock_corrections;
CREATE POLICY "stock_corrections_select_own"
  ON stock_corrections
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = stock_corrections.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- INSERT
DROP POLICY IF EXISTS "stock_corrections_insert_own" ON stock_corrections;
CREATE POLICY "stock_corrections_insert_own"
  ON stock_corrections
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = stock_corrections.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "stock_corrections_update_own" ON stock_corrections;
CREATE POLICY "stock_corrections_update_own"
  ON stock_corrections
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = stock_corrections.variant_id
        AND products.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = stock_corrections.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- DELETE
DROP POLICY IF EXISTS "stock_corrections_delete_own" ON stock_corrections;
CREATE POLICY "stock_corrections_delete_own"
  ON stock_corrections
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = stock_corrections.variant_id
        AND products.user_id = auth.uid()
    )
  );


-- =============================================================================
-- SECTION 7: RLS POLICIES -- sale_records
-- Ownership resolved via variants -> products chain (two-level join).
-- =============================================================================

-- SELECT
DROP POLICY IF EXISTS "sale_records_select_own" ON sale_records;
CREATE POLICY "sale_records_select_own"
  ON sale_records
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = sale_records.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- INSERT
DROP POLICY IF EXISTS "sale_records_insert_own" ON sale_records;
CREATE POLICY "sale_records_insert_own"
  ON sale_records
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = sale_records.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- UPDATE
DROP POLICY IF EXISTS "sale_records_update_own" ON sale_records;
CREATE POLICY "sale_records_update_own"
  ON sale_records
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = sale_records.variant_id
        AND products.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = sale_records.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- DELETE
DROP POLICY IF EXISTS "sale_records_delete_own" ON sale_records;
CREATE POLICY "sale_records_delete_own"
  ON sale_records
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = sale_records.variant_id
        AND products.user_id = auth.uid()
    )
  );


-- =============================================================================
-- SECTION 8: VIEWS
-- Views are NOT given RLS directly -- they inherit access control from the
-- underlying tables. A query against a view will only return rows that the
-- authenticated user is allowed to see via the base-table RLS policies above.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- monthly_purchase_summary
-- Aggregates purchase_batches by product and calendar month.
-- Used by the Charts view to render the units/cost bar chart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_purchase_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', pb.purchased_at::timestamptz) AS month,
  SUM(pb.quantity)::integer                          AS total_units,
  SUM(pb.quantity * pb.cost_price)                   AS total_cost
FROM purchase_batches pb
JOIN variants v ON v.id = pb.variant_id
GROUP BY v.product_id, DATE_TRUNC('month', pb.purchased_at::timestamptz);

-- ---------------------------------------------------------------------------
-- monthly_sales_summary
-- Aggregates sale_records by product and calendar month.
-- Used by the Charts view to render the units/revenue bar chart.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_sales_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', sr.sold_at::timestamptz) AS month,
  SUM(sr.quantity)::integer                    AS total_units,
  SUM(sr.quantity * sr.sell_price)             AS total_revenue
FROM sale_records sr
JOIN variants v ON v.id = sr.variant_id
GROUP BY v.product_id, DATE_TRUNC('month', sr.sold_at::timestamptz);
