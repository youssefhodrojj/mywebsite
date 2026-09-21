-- =============================================================================
-- StockAdmin v4 Migration -- Fix monthly cost corrections
-- =============================================================================
-- Run in Supabase SQL Editor after migration_v3.sql
--
-- Problem: the previous monthly_purchase_summary view only subtracted
-- correction costs in the same month as the original purchase.
-- If a correction happened in a different month, it was invisible in charts.
--
-- Fix: use a UNION approach so corrections appear in their OWN month.
-- The monthly chart now shows:
--   - September: 375.00 cost (purchases made in September)
--   - October: -50.00 cost adjustment (correction made in October)
-- This is more accurate and matches standard accounting practice.
-- =============================================================================

CREATE OR REPLACE VIEW monthly_purchase_summary AS

-- Part 1: actual purchase costs per month
SELECT
  v.product_id,
  DATE_TRUNC('month', pb.purchased_at::timestamptz) AS month,
  SUM(pb.quantity)::integer                          AS total_units,
  SUM(pb.quantity * pb.cost_price)                   AS total_cost
FROM purchase_batches pb
JOIN variants v ON v.id = pb.variant_id
GROUP BY v.product_id, DATE_TRUNC('month', pb.purchased_at::timestamptz)

UNION ALL

-- Part 2: correction cost write-offs appear in the month of the correction
-- These show as negative cost (reducing the total cost for that month)
SELECT
  v.product_id,
  DATE_TRUNC('month', sc.corrected_at::timestamptz)  AS month,
  0::integer                                          AS total_units,
  -SUM(ABS(sc.adjustment) * sc.cost_per_unit)         AS total_cost
FROM stock_corrections sc
JOIN variants v ON v.id = sc.variant_id
WHERE sc.adjustment < 0
  AND sc.cost_per_unit > 0
GROUP BY v.product_id, DATE_TRUNC('month', sc.corrected_at::timestamptz);
