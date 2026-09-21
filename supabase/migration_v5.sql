-- =============================================================================
-- StockAdmin v5 Migration -- Fix monthly_sales_summary fan-out JOIN bug
-- =============================================================================
-- Run in Supabase SQL Editor
--
-- Bug: When multiple sale records exist for the same variant+month,
-- the LEFT JOIN with refund_agg caused the refund total to be counted
-- once per sale row before aggregation, multiplying the deduction.
-- Example: 2 sales of 35.00 = 70.00 revenue, 1 refund of 35.00
-- Bug result: 70.00 - (35.00 * 2) = 0.00 (wrong)
-- Fixed result: 70.00 - 35.00 = 35.00 (correct)
--
-- Fix: use CTEs to pre-aggregate both sides before joining.
-- =============================================================================

CREATE OR REPLACE VIEW monthly_sales_summary AS
WITH sales_agg AS (
  SELECT
    v.product_id,
    DATE_TRUNC('month', sr.sold_at::timestamptz) AS month,
    SUM(sr.quantity)::integer        AS total_units,
    SUM(sr.quantity * sr.sell_price) AS gross_revenue
  FROM sale_records sr
  JOIN variants v ON v.id = sr.variant_id
  GROUP BY v.product_id, DATE_TRUNC('month', sr.sold_at::timestamptz)
),
refund_agg AS (
  SELECT
    v.product_id,
    DATE_TRUNC('month', r.refunded_at::timestamptz) AS month,
    SUM(r.quantity * r.refund_price) AS refund_total
  FROM refunds r
  JOIN variants v ON v.id = r.variant_id
  GROUP BY v.product_id, DATE_TRUNC('month', r.refunded_at::timestamptz)
)
SELECT
  s.product_id,
  s.month,
  s.total_units,
  s.gross_revenue - COALESCE(r.refund_total, 0) AS total_revenue
FROM sales_agg s
LEFT JOIN refund_agg r
  ON r.product_id = s.product_id
  AND r.month     = s.month;
