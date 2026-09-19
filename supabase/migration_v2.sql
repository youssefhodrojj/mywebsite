-- =============================================================================
-- StockAdmin v2 Migration
-- =============================================================================
-- Run this in the Supabase SQL Editor AFTER the original schema.sql
-- This adds: refunds table, cost_per_unit on corrections
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add cost_per_unit to stock_corrections (for cost-reducing corrections)
-- ---------------------------------------------------------------------------
ALTER TABLE stock_corrections
  ADD COLUMN IF NOT EXISTS cost_per_unit numeric(12,2) DEFAULT 0 NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Create refunds table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refunds (
  id             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_record_id uuid           NOT NULL REFERENCES sale_records(id) ON DELETE CASCADE,
  variant_id     uuid           NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  quantity       integer        NOT NULL CHECK (quantity > 0),
  refund_price   numeric(12,2)  NOT NULL CHECK (refund_price >= 0),
  reason         text,
  refunded_at    date           NOT NULL,
  created_at     timestamptz    DEFAULT now()
);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

-- RLS: via variant -> product chain
DROP POLICY IF EXISTS "refunds_select_own" ON refunds;
CREATE POLICY "refunds_select_own"
  ON refunds FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = refunds.variant_id
        AND products.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "refunds_insert_own" ON refunds;
CREATE POLICY "refunds_insert_own"
  ON refunds FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = refunds.variant_id
        AND products.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "refunds_delete_own" ON refunds;
CREATE POLICY "refunds_delete_own"
  ON refunds FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM variants
      JOIN products ON products.id = variants.product_id
      WHERE variants.id = refunds.variant_id
        AND products.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 3. Updated monthly_sales_summary view to subtract refunds from revenue
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_sales_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', sr.sold_at::timestamptz) AS month,
  SUM(sr.quantity)::integer                    AS total_units,
  SUM(sr.quantity * sr.sell_price)
    - COALESCE((
        SELECT SUM(r.quantity * r.refund_price)
        FROM refunds r
        WHERE r.variant_id = sr.variant_id
          AND DATE_TRUNC('month', r.refunded_at::timestamptz) = DATE_TRUNC('month', sr.sold_at::timestamptz)
      ), 0)                                    AS total_revenue
FROM sale_records sr
JOIN variants v ON v.id = sr.variant_id
GROUP BY v.product_id, DATE_TRUNC('month', sr.sold_at::timestamptz);

-- ---------------------------------------------------------------------------
-- 4. Updated monthly_purchase_summary view to subtract correction costs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_purchase_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', pb.purchased_at::timestamptz) AS month,
  SUM(pb.quantity)::integer                          AS total_units,
  SUM(pb.quantity * pb.cost_price)
    - COALESCE((
        SELECT SUM(ABS(sc.adjustment) * sc.cost_per_unit)
        FROM stock_corrections sc
        WHERE sc.variant_id = pb.variant_id
          AND sc.adjustment < 0
          AND sc.cost_per_unit > 0
          AND DATE_TRUNC('month', sc.corrected_at::timestamptz) = DATE_TRUNC('month', pb.purchased_at::timestamptz)
      ), 0)                                          AS total_cost
FROM purchase_batches pb
JOIN variants v ON v.id = pb.variant_id
GROUP BY v.product_id, DATE_TRUNC('month', pb.purchased_at::timestamptz);
