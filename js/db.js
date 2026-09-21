/**
 * db.js â€” Centralised database access layer
 *
 * All Supabase queries live here. View modules never import supabase-js
 * directly; they call functions from this module instead.
 *
 * Convention:
 *   - Every function returns a Promise that resolves with the data.
 *   - On any Supabase error the function throws a new Error so callers
 *     can catch it and show feedback without crashing the whole app.
 *
 * Functions are grouped in the following sections:
 *   1. UI helpers         â€” showToast
 *   2. Products           â€” getProducts, createProduct, updateProduct, deleteProduct
 *   3. Variants           â€” getVariantsByProduct, createVariant, updateVariant
 *   4. Purchase Batches   â€” (added in task 6.2)
 *   5. Stock Corrections  â€” (added in task 6.2)
 *   6. Sale Records       â€” (added in task 6.2)
 *   7. Chart data         â€” (added in task 6.3)
 */

import { supabaseClient } from './supabase.js';

// ============================================================
// 1. UI helpers
// ============================================================

/**
 * showToast â€” display a brief notification in the #toast-container.
 *
 * @param {string} message  â€” The text to display.
 * @param {'error'|'success'} [type='error']  â€” Visual style.
 */
export function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const msg = document.createElement('span');
  msg.className = 'toast-message';
  msg.textContent = message;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toast-close';
  closeBtn.setAttribute('aria-label', 'Dismiss notification');
  closeBtn.textContent = 'Ã—';
  closeBtn.addEventListener('click', () => toast.remove());

  toast.appendChild(msg);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 4000);
}

// ============================================================
// 2. Products
// ============================================================

/**
 * Fetch all products belonging to the current authenticated user,
 * ordered alphabetically by name.
 *
 * @returns {Promise<Array<{id: string, name: string, description: string|null, created_at: string}>>}
 */
export async function getProducts() {
  const { data, error } = await supabaseClient
    .from('products')
    .select('id, name, description, created_at')
    .order('name', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Create a new product.
 *
 * @param {{ name: string, description?: string }} param0
 * @returns {Promise<{id: string, name: string, description: string|null, created_at: string}>}
 */
export async function createProduct({ name, description = null }) {
  // Get current user to satisfy RLS policy: user_id = auth.uid()
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data, error } = await supabaseClient
    .from('products')
    .insert({ name, description, user_id: userId })
    .select('id, name, description, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update a product's name and/or description.
 *
 * @param {string} id  â€” UUID of the product to update.
 * @param {{ name?: string, description?: string }} fields
 * @returns {Promise<{id: string, name: string, description: string|null, created_at: string}>}
 */
export async function updateProduct(id, { name, description }) {
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (description !== undefined) updates.description = description;

  const { data, error } = await supabaseClient
    .from('products')
    .update(updates)
    .eq('id', id)
    .select('id, name, description, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete a product by its UUID.
 * The caller is responsible for showing a confirmation dialog before
 * invoking this function (Requirement 8.5).
 *
 * @param {string} id  â€” UUID of the product to delete.
 * @returns {Promise<void>}
 */
export async function deleteProduct(id) {
  const { error } = await supabaseClient
    .from('products')
    .delete()
    .eq('id', id);

  if (error) throw new Error(error.message);
}

// ============================================================
// 3. Variants
// ============================================================

/**
 * Fetch all variants belonging to a given product, ordered by creation date.
 *
 * @param {string} productId  â€” UUID of the parent product.
 * @returns {Promise<Array<{id: string, product_id: string, attributes: object, created_at: string}>>}
 */
export async function getVariantsByProduct(productId) {
  const { data, error } = await supabaseClient
    .from('variants')
    .select('id, product_id, attributes, created_at')
    .eq('product_id', productId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Create a new variant for a product.
 *
 * @param {{ productId: string, attributes: object }} param0
 *   attributes â€” JSON object describing the variant (e.g. { size: 'M', color: 'red' })
 * @returns {Promise<{id: string, product_id: string, attributes: object, created_at: string}>}
 */
export async function createVariant({ productId, attributes }) {
  const { data, error } = await supabaseClient
    .from('variants')
    .insert({ product_id: productId, attributes })
    .select('id, product_id, attributes, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Update a variant's attribute values.
 *
 * @param {string} id  â€” UUID of the variant to update.
 * @param {{ attributes: object }} param1
 * @returns {Promise<{id: string, product_id: string, attributes: object, created_at: string}>}
 */
export async function updateVariant(id, { attributes }) {
  const { data, error } = await supabaseClient
    .from('variants')
    .update({ attributes })
    .eq('id', id)
    .select('id, product_id, attributes, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 4. Purchase Batches
// ============================================================

/**
 * Fetch all purchase batches for a given variant, ordered by date descending.
 *
 * @param {string} variantId  — UUID of the variant.
 * @returns {Promise<Array<{id: string, variant_id: string, quantity: number, cost_price: string, purchased_at: string, created_at: string}>>}
 */
export async function getPurchasesByVariant(variantId) {
  const { data, error } = await supabaseClient
    .from('purchase_batches')
    .select('id, variant_id, quantity, cost_price, purchased_at, created_at')
    .eq('variant_id', variantId)
    .order('purchased_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Record a new purchase batch.
 *
 * @param {{ variantId: string, quantity: number, costPrice: number, purchasedAt: string }} param0
 * @returns {Promise<{id: string, variant_id: string, quantity: number, cost_price: string, purchased_at: string, created_at: string}>}
 */
export async function createPurchaseBatch({ variantId, quantity, costPrice, purchasedAt }) {
  const { data, error } = await supabaseClient
    .from('purchase_batches')
    .insert({ variant_id: variantId, quantity, cost_price: costPrice, purchased_at: purchasedAt })
    .select('id, variant_id, quantity, cost_price, purchased_at, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 5. Stock Corrections
// ============================================================

/**
 * Fetch all stock corrections for a given variant, ordered by date descending.
 *
 * @param {string} variantId  — UUID of the variant.
 * @returns {Promise<Array<{id: string, variant_id: string, adjustment: number, reason: string|null, corrected_at: string, created_at: string}>>}
 */
export async function getCorrectionsByVariant(variantId) {
  const { data, error } = await supabaseClient
    .from('stock_corrections')
    .select('id, variant_id, adjustment, reason, corrected_at, created_at')
    .eq('variant_id', variantId)
    .order('corrected_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Record a new stock correction.
 *
 * @param {{ variantId: string, adjustment: number, reason?: string, correctedAt: string }} param0
 * @returns {Promise<{id: string, variant_id: string, adjustment: number, reason: string|null, corrected_at: string, created_at: string}>}
 */
export async function createStockCorrection({ variantId, adjustment, reason, correctedAt, costPerUnit = 0 }) {
  const { data, error } = await supabaseClient
    .from('stock_corrections')
    .insert({ variant_id: variantId, adjustment, reason: reason || null, corrected_at: correctedAt, cost_per_unit: costPerUnit })
    .select('id, variant_id, adjustment, cost_per_unit, reason, corrected_at, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 6. Sale Records
// ============================================================

/**
 * Fetch all sale records for a given variant, ordered by date descending.
 *
 * @param {string} variantId  — UUID of the variant.
 * @returns {Promise<Array<{id: string, variant_id: string, quantity: number, sell_price: string, sold_at: string, created_at: string}>>}
 */
export async function getSalesByVariant(variantId) {
  const { data, error } = await supabaseClient
    .from('sale_records')
    .select('id, variant_id, quantity, sell_price, sold_at, created_at')
    .eq('variant_id', variantId)
    .order('sold_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Record a new sale.
 *
 * @param {{ variantId: string, quantity: number, sellPrice: number, soldAt: string }} param0
 * @returns {Promise<{id: string, variant_id: string, quantity: number, sell_price: string, sold_at: string, created_at: string}>}
 */
export async function createSaleRecord({ variantId, quantity, sellPrice, soldAt }) {
  const { data, error } = await supabaseClient
    .from('sale_records')
    .insert({ variant_id: variantId, quantity, sell_price: sellPrice, sold_at: soldAt })
    .select('id, variant_id, quantity, sell_price, sold_at, created_at')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 7. Chart data
// ============================================================

/**
 * Compute the first day of the month immediately following endMonth.
 *
 * @param {string} endMonth  — 'YYYY-MM' format
 * @returns {string}  — 'YYYY-MM-DD' of the first day of the next month
 */
function _nextMonthStart(endMonth) {
  const [year, month] = endMonth.split('-').map(Number);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

/**
 * Query the `monthly_purchase_summary` view for a date range, optionally
 * filtered by product.
 *
 * The view exposes: product_id, month (timestamptz), total_units (integer),
 * total_cost (numeric).
 *
 * @param {{ startMonth: string, endMonth: string, productId?: string }} param0
 *   startMonth / endMonth — 'YYYY-MM' (inclusive on both ends)
 *   productId             — optional UUID; when provided only rows for that
 *                           product are returned
 * @returns {Promise<Array<{product_id: string, month: string, total_units: number, total_cost: string}>>}
 */
export async function getMonthlyPurchaseSummary({ startMonth, endMonth, productId } = {}) {
  const startDate = `${startMonth}-01`;
  const endDate = _nextMonthStart(endMonth);

  let query = supabaseClient
    .from('monthly_purchase_summary')
    .select('product_id, month, total_units, total_cost')
    .gte('month', startDate)
    .lt('month', endDate)
    .order('month', { ascending: true });

  if (productId) {
    query = query.eq('product_id', productId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Query the `monthly_sales_summary` view for a date range, optionally
 * filtered by product.
 *
 * The view exposes: product_id, month (timestamptz), total_units (integer),
 * total_revenue (numeric).
 *
 * @param {{ startMonth: string, endMonth: string, productId?: string }} param0
 *   startMonth / endMonth — 'YYYY-MM' (inclusive on both ends)
 *   productId             — optional UUID; when provided only rows for that
 *                           product are returned
 * @returns {Promise<Array<{product_id: string, month: string, total_units: number, total_revenue: string}>>}
 */
export async function getMonthlySalesSummary({ startMonth, endMonth, productId } = {}) {
  const startDate = `${startMonth}-01`;
  const endDate = _nextMonthStart(endMonth);

  let query = supabaseClient
    .from('monthly_sales_summary')
    .select('product_id, month, total_units, total_revenue')
    .gte('month', startDate)
    .lt('month', endDate)
    .order('month', { ascending: true });

  if (productId) {
    query = query.eq('product_id', productId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 8. Refunds
// ============================================================

/**
 * Get all refunds for a variant.
 */
export async function getRefundsByVariant(variantId) {
  const { data, error } = await supabaseClient
    .from('refunds')
    .select('id, sale_record_id, variant_id, quantity, refund_price, reason, refunded_at, created_at')
    .eq('variant_id', variantId)
    .order('refunded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Get all refunds for a specific sale record.
 */
export async function getRefundsBySale(saleRecordId) {
  const { data, error } = await supabaseClient
    .from('refunds')
    .select('id, sale_record_id, variant_id, quantity, refund_price, reason, refunded_at, created_at')
    .eq('sale_record_id', saleRecordId)
    .order('refunded_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Create a refund record.
 */
export async function createRefund({ saleRecordId, variantId, quantity, refundPrice, reason, refundedAt }) {
  const { data, error } = await supabaseClient
    .from('refunds')
    .insert({
      sale_record_id: saleRecordId,
      variant_id: variantId,
      quantity,
      refund_price: refundPrice,
      reason: reason || null,
      refunded_at: refundedAt,
    })
    .select('id, sale_record_id, variant_id, quantity, refund_price, reason, refunded_at, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Delete a refund by id.
 */
export async function deleteRefund(id) {
  const { error } = await supabaseClient.from('refunds').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ============================================================
// 9. Delete sale / purchase entries
// ============================================================

/**
 * Delete a sale record by id.
 */
export async function deleteSaleRecord(id) {
  const { error } = await supabaseClient.from('sale_records').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Delete a purchase batch by id.
 */
export async function deletePurchaseBatch(id) {
  const { error } = await supabaseClient.from('purchase_batches').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Get ALL sales across all variants for the current user, with product/variant info.
 * Supports optional date range and product filter.
 */
export async function getAllSales({ startDate, endDate, productId } = {}) {
  let query = supabaseClient
    .from('sale_records')
    .select(`
      id, quantity, sell_price, sold_at, created_at,
      variants!inner(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .order('sold_at', { ascending: false });

  if (startDate) query = query.gte('sold_at', startDate);
  if (endDate)   query = query.lte('sold_at', endDate);
  if (productId) query = query.eq('variants.products.id', productId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Get ALL purchases across all variants for the current user, with product/variant info.
 */
export async function getAllPurchases({ startDate, endDate, productId } = {}) {
  let query = supabaseClient
    .from('purchase_batches')
    .select(`
      id, quantity, cost_price, purchased_at, created_at,
      variants!inner(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .order('purchased_at', { ascending: false });

  if (startDate) query = query.gte('purchased_at', startDate);
  if (endDate)   query = query.lte('purchased_at', endDate);
  if (productId) query = query.eq('variants.products.id', productId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 10. Daily report data
// ============================================================

/**
 * Get all sales for a specific date (YYYY-MM-DD), with product/variant info.
 */
export async function getSalesForDate(dateStr) {
  const { data, error } = await supabaseClient
    .from('sale_records')
    .select(`
      id, quantity, sell_price, sold_at,
      variants!inner(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .eq('sold_at', dateStr)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Get all purchases for a specific date (YYYY-MM-DD), with product/variant info.
 */
export async function getPurchasesForDate(dateStr) {
  const { data, error } = await supabaseClient
    .from('purchase_batches')
    .select(`
      id, quantity, cost_price, purchased_at,
      variants!inner(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .eq('purchased_at', dateStr)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Get all refunds for a specific date (YYYY-MM-DD), with product/variant info.
 */
export async function getRefundsForDate(dateStr) {
  const { data, error } = await supabaseClient
    .from('refunds')
    .select(`
      id, quantity, refund_price, reason, refunded_at,
      variants!inner(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .eq('refunded_at', dateStr)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

// ============================================================
// 11. Dashboard monthly stats
// ============================================================

/**
 * Get total sales stats for the current calendar month.
 * units = gross units sold minus refunded units this month
 * revenue = gross sales revenue minus refund amounts this month
 */
export async function getMonthlySalesStats() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const startOfMonth = `${yyyy}-${mm}-01`;
  const nextM = now.getMonth() + 1 === 12 ? `${yyyy + 1}-01-01` : `${yyyy}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

  // Fetch sales and refunds for this month in parallel
  const [salesRes, refundsRes] = await Promise.all([
    supabaseClient.from('sale_records').select('quantity, sell_price')
      .gte('sold_at', startOfMonth).lt('sold_at', nextM),
    supabaseClient.from('refunds').select('quantity, refund_price')
      .gte('refunded_at', startOfMonth).lt('refunded_at', nextM),
  ]);

  if (salesRes.error) throw new Error(salesRes.error.message);
  const sales   = salesRes.data ?? [];
  const refunds = refundsRes.error ? [] : (refundsRes.data ?? []);

  const grossUnits   = sales.reduce((s, r) => s + Number(r.quantity), 0);
  const refundUnits  = refunds.reduce((s, r) => s + Number(r.quantity), 0);
  const grossRevenue = sales.reduce((s, r) => s + Number(r.quantity) * Number(r.sell_price), 0);
  const refundAmount = refunds.reduce((s, r) => s + Number(r.quantity) * Number(r.refund_price), 0);

  return {
    units:        grossUnits - refundUnits,
    revenue:      grossRevenue - refundAmount,
    grossRevenue,
    refundAmount,
  };
}

/**
 * Get total purchase stats for the current calendar month.
 * units = units purchased this month + correction adjustments this month
 * cost  = gross purchase cost minus correction write-offs this month
 */
export async function getMonthlyPurchaseStats() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const startOfMonth = `${yyyy}-${mm}-01`;
  const nextM = now.getMonth() + 1 === 12 ? `${yyyy + 1}-01-01` : `${yyyy}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

  // Fetch purchases and corrections for this month in parallel
  const [purchasesRes, correctionsRes] = await Promise.all([
    supabaseClient.from('purchase_batches').select('quantity, cost_price')
      .gte('purchased_at', startOfMonth).lt('purchased_at', nextM),
    supabaseClient.from('stock_corrections').select('adjustment, cost_per_unit')
      .gte('corrected_at', startOfMonth).lt('corrected_at', nextM),
  ]);

  if (purchasesRes.error) throw new Error(purchasesRes.error.message);
  const purchases   = purchasesRes.data ?? [];
  const corrections = correctionsRes.error ? [] : (correctionsRes.data ?? []);

  const grossUnits      = purchases.reduce((s, r) => s + Number(r.quantity), 0);
  const correctionUnits = corrections.reduce((s, r) => s + Number(r.adjustment), 0);
  const grossCost       = purchases.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price), 0);
  const correctionCost  = corrections
    .filter(c => Number(c.adjustment) < 0 && Number(c.cost_per_unit) > 0)
    .reduce((s, c) => s + Math.abs(Number(c.adjustment)) * Number(c.cost_per_unit), 0);

  const netUnits = grossUnits + correctionUnits;
  const netCost  = grossCost - correctionCost;
  const avgCostPerUnit = netUnits > 0 ? netCost / netUnits : 0;

  return {
    units:         netUnits,
    cost:          netCost,
    avgCostPerUnit,
  };
}

// ============================================================
// 12. Dashboard all-time stats (fast batch queries)
// ============================================================

// v8 -- async helpers for non-fatal queries
/**
 * Get all-time totals. Refunds restore stock and reduce revenue. Corrections adjust cost.
 * Tables/columns added in migration_v2 are fetched with graceful fallback.
 */
export async function getDashboardStats() {

  // Helper: run a supabase query and return {data, error} without throwing
  async function safeQuery(queryBuilder) {
    try {
      const result = await queryBuilder;
      return result;
    } catch (e) {
      return { data: [], error: e };
    }
  }

  const [
    productsRes,
    variantsRes,
    purchasesRes,
    salesRes,
    correctionsRes,
    refundsRes,
  ] = await Promise.all([
    safeQuery(supabaseClient.from('products').select('id', { count: 'exact', head: true })),
    safeQuery(supabaseClient.from('variants').select('id, product_id', { count: 'exact' })),
    safeQuery(supabaseClient.from('purchase_batches').select('variant_id, quantity, cost_price')),
    safeQuery(supabaseClient.from('sale_records').select('variant_id, quantity, sell_price')),
    // Non-fatal: cost_per_unit column only exists after migration_v2
    safeQuery(supabaseClient.from('stock_corrections').select('variant_id, adjustment, cost_per_unit')),
    // Non-fatal: refunds table only exists after migration_v2
    safeQuery(supabaseClient.from('refunds').select('variant_id, quantity, refund_price')),
  ]);

  if (productsRes.error) throw new Error(productsRes.error.message);
  if (variantsRes.error) throw new Error(variantsRes.error.message);
  if (purchasesRes.error) throw new Error(purchasesRes.error.message);
  if (salesRes.error) throw new Error(salesRes.error.message);

  const purchases   = purchasesRes.data ?? [];
  const sales       = salesRes.data ?? [];
  // If corrections or refunds failed (table/column not yet created), treat as empty
  const corrections = correctionsRes.error ? [] : (correctionsRes.data ?? []);
  const refunds     = refundsRes.error     ? [] : (refundsRes.data     ?? []);

  const totalProducts = productsRes.count ?? 0;
  const totalVariants = variantsRes.data?.length ?? 0;

  // Purchase cost minus correction write-offs
  const totalPurchaseCost =
    purchases.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price), 0)
    - corrections
        .filter(c => Number(c.adjustment) < 0 && Number(c.cost_per_unit) > 0)
        .reduce((s, c) => s + Math.abs(Number(c.adjustment)) * Number(c.cost_per_unit), 0);

  // Sales revenue minus refund amounts
  const totalRefundAmount = refunds.reduce((s, r) => s + Number(r.quantity) * Number(r.refund_price), 0);
  const totalSalesRevenue =
    sales.reduce((s, r) => s + Number(r.quantity) * Number(r.sell_price), 0)
    - totalRefundAmount;

  // Units sold minus refunded units
  const totalUnitsSold =
    sales.reduce((s, r) => s + Number(r.quantity), 0)
    - refunds.reduce((s, r) => s + Number(r.quantity), 0);

  // Units in stock = purchased + corrections - sold + refunds
  const totalUnitsPurchased = purchases.reduce((s, r) => s + Number(r.quantity), 0);
  const totalCorrectionUnits = corrections.reduce((s, c) => s + Number(c.adjustment), 0);
  const totalRefundedUnits = refunds.reduce((s, r) => s + Number(r.quantity), 0);
  const totalUnitsInStock = totalUnitsPurchased + totalCorrectionUnits - totalUnitsSold;

  // Low stock count per variant
  const allVariantIds = (variantsRes.data ?? []).map(v => v.id);
  let lowStockCount = 0;

  if (allVariantIds.length > 0) {
    const purchaseMap   = {};
    const salesMap      = {};
    const correctionMap = {};
    const refundMap     = {};

    for (const r of purchases) {
      purchaseMap[r.variant_id] = (purchaseMap[r.variant_id] ?? 0) + Number(r.quantity);
    }
    for (const r of sales) {
      salesMap[r.variant_id] = (salesMap[r.variant_id] ?? 0) + Number(r.quantity);
    }
    for (const r of corrections) {
      correctionMap[r.variant_id] = (correctionMap[r.variant_id] ?? 0) + Number(r.adjustment);
    }
    for (const r of refunds) {
      refundMap[r.variant_id] = (refundMap[r.variant_id] ?? 0) + Number(r.quantity);
    }

    for (const variantId of allVariantIds) {
      const remaining =
        (purchaseMap[variantId]   ?? 0)
        - (salesMap[variantId]    ?? 0)
        + (correctionMap[variantId] ?? 0)
        + (refundMap[variantId]   ?? 0);
      if (remaining <= 0) lowStockCount++;
    }
  }

  // Gross Profit = Revenue - Cost of units actually sold (not total stock cost)
  // avg cost per unit = total purchase cost / total units purchased
  const rawPurchaseCost = purchases.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price), 0);
  const avgCostPerUnit = totalUnitsPurchased > 0 ? rawPurchaseCost / totalUnitsPurchased : 0;
  const costOfGoodsSold = avgCostPerUnit * totalUnitsSold;
  const totalGrossProfit = totalSalesRevenue - costOfGoodsSold;

  return {
    totalProducts,
    totalVariants,
    totalPurchaseCost,
    totalSalesRevenue,
    totalUnitsSold,
    totalUnitsPurchased,
    totalUnitsInStock,
    lowStockCount,
    totalGrossProfit,
    avgCostPerUnit,
    costOfGoodsSold,
  };
}

/**
 * Get all data for export/backup as JSON.
 */
export async function exportAllData() {
  const [products, variants, purchases, sales, corrections, refunds] = await Promise.all([
    supabaseClient.from('products').select('*'),
    supabaseClient.from('variants').select('*'),
    supabaseClient.from('purchase_batches').select('*'),
    supabaseClient.from('sale_records').select('*'),
    supabaseClient.from('stock_corrections').select('*'),
    supabaseClient.from('refunds').select('*'),
  ]);

  // Non-fatal -- return what we have
  return {
    exported_at: new Date().toISOString(),
    products:    products.data    ?? [],
    variants:    variants.data    ?? [],
    purchases:   purchases.data   ?? [],
    sales:       sales.data       ?? [],
    corrections: corrections.data ?? [],
    refunds:     refunds.data     ?? [],
  };
}

/**
 * Get audit log entries, most recent first, with optional limit.
 */
export async function getAuditLog({ limit = 100 } = {}) {
  const { data, error } = await supabaseClient
    .from('audit_log')
    .select('id, action, table_name, record_id, description, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Get impact count for a product before deletion.
 */
export async function getProductDeletionImpact(productId) {
  const variants = await supabaseClient
    .from('variants')
    .select('id')
    .eq('product_id', productId);
  if (variants.error) throw new Error(variants.error.message);

  const variantIds = (variants.data ?? []).map(v => v.id);
  if (variantIds.length === 0) {
    return { variantCount: 0, purchaseCount: 0, saleCount: 0, correctionCount: 0 };
  }

  const [purchasesRes, salesRes, correctionsRes] = await Promise.all([
    supabaseClient.from('purchase_batches').select('id', { count: 'exact', head: true }).in('variant_id', variantIds),
    supabaseClient.from('sale_records').select('id', { count: 'exact', head: true }).in('variant_id', variantIds),
    supabaseClient.from('stock_corrections').select('id', { count: 'exact', head: true }).in('variant_id', variantIds),
  ]);

  return {
    variantCount:    variantIds.length,
    purchaseCount:   purchasesRes.count ?? 0,
    saleCount:       salesRes.count ?? 0,
    correctionCount: correctionsRes.count ?? 0,
  };
}
