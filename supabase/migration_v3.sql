-- =============================================================================
-- StockAdmin v3 Migration -- Audit Log + History
-- =============================================================================
-- Run in Supabase SQL Editor after migration_v2.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Audit log table
-- Records every significant action automatically via triggers
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  action      text        NOT NULL,  -- 'INSERT', 'DELETE', 'UPDATE'
  table_name  text        NOT NULL,
  record_id   uuid,
  description text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_select_own" ON audit_log;
CREATE POLICY "audit_log_select_own"
  ON audit_log FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "audit_log_insert_own" ON audit_log;
CREATE POLICY "audit_log_insert_own"
  ON audit_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Trigger function: log inserts and deletes on key tables
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION log_audit_event()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_desc    text;
BEGIN
  v_user_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    v_desc := 'Created record in ' || TG_TABLE_NAME;
    INSERT INTO audit_log(user_id, action, table_name, record_id, description)
    VALUES (v_user_id, 'INSERT', TG_TABLE_NAME, NEW.id, v_desc);
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_desc := 'Deleted record from ' || TG_TABLE_NAME;
    INSERT INTO audit_log(user_id, action, table_name, record_id, description)
    VALUES (v_user_id, 'DELETE', TG_TABLE_NAME, OLD.id, v_desc);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ---------------------------------------------------------------------------
-- Attach triggers to all key tables
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS audit_products ON products;
CREATE TRIGGER audit_products
  AFTER INSERT OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_variants ON variants;
CREATE TRIGGER audit_variants
  AFTER INSERT OR DELETE ON variants
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_purchase_batches ON purchase_batches;
CREATE TRIGGER audit_purchase_batches
  AFTER INSERT OR DELETE ON purchase_batches
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_sale_records ON sale_records;
CREATE TRIGGER audit_sale_records
  AFTER INSERT OR DELETE ON sale_records
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_stock_corrections ON stock_corrections;
CREATE TRIGGER audit_stock_corrections
  AFTER INSERT OR DELETE ON stock_corrections
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();

DROP TRIGGER IF EXISTS audit_refunds ON refunds;
CREATE TRIGGER audit_refunds
  AFTER INSERT OR DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION log_audit_event();
