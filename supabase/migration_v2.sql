-- =============================================================================
-- StockAdmin v2 Migration
-- =============================================================================
-- Run this in the Supabase SQL Editor AFTER the original schema.sql
-- This adds: refunds table, cost_per_unit on corrections, updated views
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Add cost_per_unit to stock_corrections
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
-- 3. Updated monthly_sales_summary: subtract refunds using a LEFT JOIN
--    (fixes the "subquery uses ungrouped column" error)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_sales_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', sr.sold_at::timestamptz)          AS month,
  SUM(sr.quantity)::integer                              AS total_units,
  SUM(sr.quantity * sr.sell_price)
    - COALESCE(SUM(refund_agg.refund_total), 0)          AS total_revenue
FROM sale_records sr
JOIN variants v ON v.id = sr.variant_id
LEFT JOIN (
  SELECT
    variant_id,
    DATE_TRUNC('month', refunded_at::timestamptz) AS refund_month,
    SUM(quantity * refund_price)                  AS refund_total
  FROM refunds
  GROUP BY variant_id, DATE_TRUNC('month', refunded_at::timestamptz)
) refund_agg
  ON  refund_agg.variant_id    = sr.variant_id
  AND refund_agg.refund_month  = DATE_TRUNC('month', sr.sold_at::timestamptz)
GROUP BY v.product_id, DATE_TRUNC('month', sr.sold_at::timestamptz);

-- ---------------------------------------------------------------------------
-- 4. Updated monthly_purchase_summary: subtract correction costs using a LEFT JOIN
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW monthly_purchase_summary AS
SELECT
  v.product_id,
  DATE_TRUNC('month', pb.purchased_at::timestamptz)       AS month,
  SUM(pb.quantity)::integer                               AS total_units,
  SUM(pb.quantity * pb.cost_price)
    - COALESCE(SUM(correction_agg.correction_cost), 0)    AS total_cost
FROM purchase_batches pb
JOIN variants v ON v.id = pb.variant_id
LEFT JOIN (
  SELECT
    variant_id,
    DATE_TRUNC('month', corrected_at::timestamptz) AS correction_month,
    SUM(ABS(adjustment) * cost_per_unit)           AS correction_cost
  FROM stock_corrections
  WHERE adjustment < 0
    AND cost_per_unit > 0
  GROUP BY variant_id, DATE_TRUNC('month', corrected_at::timestamptz)
) correction_agg
  ON  correction_agg.variant_id        = pb.variant_id
  AND correction_agg.correction_month  = DATE_TRUNC('month', pb.purchased_at::timestamptz)
GROUP BY v.product_id, DATE_TRUNC('month', pb.purchased_at::timestamptz);
