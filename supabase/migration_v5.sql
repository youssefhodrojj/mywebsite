-- =============================================================================
-- StockAdmin v5 Migration -- Fix monthly_sales_summary fan-out JOIN bug
-- =============================================================================
-- Run in Supabase SQL Editor
-- =============================================================================

CREATE OR REPLACE VIEW monthly_sales_summary AS
WITH sales_agg AS (
  SELECT
    v.product_id,
    DATE_TRUNC('month', sr.sold_at::timestamptz) AS month,
    SUM(sr.quantity)::integer        AS gross_units,
    SUM(sr.quantity * sr.sell_price) AS gross_revenue
  FROM sale_records sr
  JOIN variants v ON v.id = sr.variant_id
  GROUP BY v.product_id, DATE_TRUNC('month', sr.sold_at::timestamptz)
),
refund_agg AS (
  SELECT
    v.product_id,
    DATE_TRUNC('month', r.refunded_at::timestamptz) AS month,
    SUM(r.quantity)::integer         AS refund_units,
    SUM(r.quantity * r.refund_price) AS refund_total
  FROM refunds r
  JOIN variants v ON v.id = r.variant_id
  GROUP BY v.product_id, DATE_TRUNC('month', r.refunded_at::timestamptz)
)
SELECT
  s.product_id,
  s.month,
  -- Net units sold = gross sold minus refunded units this month
  (s.gross_units - COALESCE(r.refund_units, 0))::integer AS total_units,
  -- Net revenue = gross revenue minus refund amounts
  s.gross_revenue - COALESCE(r.refund_total, 0)          AS total_revenue
FROM sales_agg s
LEFT JOIN refund_agg r
  ON r.product_id = s.product_id
  AND r.month     = s.month;
