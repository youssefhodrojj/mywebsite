/**
 * charts-view.js — Monthly Charts view
 *
 * Wires the #view-charts section (already rendered in index.html) to the
 * database layer and the Chart.js rendering helpers in charts.js.
 *
 * Responsibilities:
 *   - Default start/end month inputs to a sensible range on init.
 *   - Populate the optional product filter dropdown from getProducts().
 *   - Fetch monthly purchase and sales summaries, aggregate by month, and
 *     pass the aggregated data to the chart rendering functions.
 *   - Re-run the same fetch+render on every "Apply" click.
 *   - Show the #charts-error banner on any error; clear it on success.
 *   - Be idempotent: safe to call init() multiple times.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */

import { getProducts, getMonthlyPurchaseSummary, getMonthlySalesSummary } from '../db.js';
import { renderUnitsChart, renderMonetaryChart } from '../charts.js';

// ---------------------------------------------------------------------------
// DOM accessors — resolved lazily so the module is safe to import early
// ---------------------------------------------------------------------------

const getErrorBanner     = () => document.getElementById('charts-error');
const getStartMonthInput = () => /** @type {HTMLInputElement}  */ (document.getElementById('chart-start-month'));
const getEndMonthInput   = () => /** @type {HTMLInputElement}  */ (document.getElementById('chart-end-month'));
const getProductFilter   = () => /** @type {HTMLSelectElement} */ (document.getElementById('chart-product-filter'));
const getApplyButton     = () => document.getElementById('btn-apply-chart-filters');

// ---------------------------------------------------------------------------
// Banner helpers
// ---------------------------------------------------------------------------

/**
 * Show the error banner with a message.
 * @param {string} message
 */
function showBanner(message) {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

/** Hide and clear the error banner. */
function clearBanner() {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Return the current month as a 'YYYY-MM' string using local time.
 * @returns {string}
 */
function currentMonth() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

/**
 * Subtract N whole months from a 'YYYY-MM' string.
 * Clamps correctly at month boundaries (e.g. 5 months before Jan 2024 → Aug 2023).
 *
 * @param {string} yyyyMm  — e.g. '2024-03'
 * @param {number} n       — number of months to subtract
 * @returns {string}       — 'YYYY-MM'
 */
function subtractMonths(yyyyMm, n) {
  const [year, month] = yyyyMm.split('-').map(Number);
  // Convert to a zero-based total-month count, subtract, then convert back
  const totalMonths = year * 12 + (month - 1) - n;
  const newYear  = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, '0')}`;
}

/**
 * Format an ISO timestamp (or 'YYYY-MM-DD') to a short 'Mon YYYY' label
 * (e.g. 'Jan 2024') using the browser's locale.
 *
 * @param {string} isoDate  — e.g. '2024-01-01T00:00:00+00:00'
 * @returns {string}
 */
function formatMonthLabel(isoDate) {
  // Normalise to 'YYYY-MM-01' to avoid any timezone-shift confusion
  const datePart = isoDate.slice(0, 7); // 'YYYY-MM'
  const d = new Date(`${datePart}-01T00:00:00Z`);
  return isNaN(d.getTime())
    ? datePart
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregate purchase and sales summary rows into parallel arrays suitable
 * for passing to the chart renderers.
 *
 * Both summary arrays may contain multiple rows per month (one per product
 * when no product filter is applied), so we sum within each month bucket.
 *
 * @param {Array<{month: string, total_units: number, total_cost: string|number}>}   purchases
 * @param {Array<{month: string, total_units: number, total_revenue: string|number}>} sales
 * @returns {{
 *   labels:          string[],
 *   purchasedUnits:  number[],
 *   purchaseCosts:   number[],
 *   soldUnits:       number[],
 *   salesRevenue:    number[],
 * }}
 */
function aggregateByMonth(purchases, sales) {
  // Collect all unique month keys (ISO prefix 'YYYY-MM-…') from both sets
  const monthSet = new Set([
    ...purchases.map((r) => r.month.slice(0, 7)),
    ...sales.map((r) => r.month.slice(0, 7)),
  ]);

  // Sort chronologically
  const sortedMonths = [...monthSet].sort();

  /** @type {Map<string, {purchasedUnits: number, purchaseCosts: number, soldUnits: number, salesRevenue: number}>} */
  const buckets = new Map();
  for (const m of sortedMonths) {
    buckets.set(m, { purchasedUnits: 0, purchaseCosts: 0, soldUnits: 0, salesRevenue: 0 });
  }

  for (const row of purchases) {
    const key = row.month.slice(0, 7);
    const b   = buckets.get(key);
    if (b) {
      b.purchasedUnits += Number(row.total_units)  || 0;
      b.purchaseCosts  += Number(row.total_cost)   || 0;
    }
  }

  for (const row of sales) {
    const key = row.month.slice(0, 7);
    const b   = buckets.get(key);
    if (b) {
      b.soldUnits    += Number(row.total_units)   || 0;
      b.salesRevenue += Number(row.total_revenue) || 0;
    }
  }

  const labels         = [];
  const purchasedUnits = [];
  const purchaseCosts  = [];
  const soldUnits      = [];
  const salesRevenue   = [];

  for (const m of sortedMonths) {
    const b = buckets.get(m);
    // Reconstruct a parseable date string from the 'YYYY-MM' key
    labels.push(formatMonthLabel(`${m}-01T00:00:00Z`));
    purchasedUnits.push(b.purchasedUnits);
    purchaseCosts.push(b.purchaseCosts);
    soldUnits.push(b.soldUnits);
    salesRevenue.push(b.salesRevenue);
  }

  return { labels, purchasedUnits, purchaseCosts, soldUnits, salesRevenue };
}

// ---------------------------------------------------------------------------
// Core fetch-and-render logic (shared by init auto-load and Apply button)
// ---------------------------------------------------------------------------

/**
 * Read the current filter values, fetch summary data, aggregate, and render
 * both charts.  Clears the error banner on success; shows it on failure.
 *
 * @returns {Promise<void>}
 */
async function fetchAndRender() {
  const startMonth = getStartMonthInput()?.value ?? '';
  const endMonth   = getEndMonthInput()?.value   ?? '';
  const productId  = getProductFilter()?.value   ?? '';

  // Guard: we need at least a start and end month
  if (!startMonth || !endMonth) {
    showBanner('Please select a start month and an end month.');
    return;
  }

  if (startMonth > endMonth) {
    showBanner('Start month must not be after end month.');
    return;
  }

  clearBanner();

  try {
    const [purchaseRows, salesRows] = await Promise.all([
      getMonthlyPurchaseSummary({
        startMonth,
        endMonth,
        productId: productId || undefined,
      }),
      getMonthlySalesSummary({
        startMonth,
        endMonth,
        productId: productId || undefined,
      }),
    ]);

    const { labels, purchasedUnits, purchaseCosts, soldUnits, salesRevenue } =
      aggregateByMonth(purchaseRows, salesRows);

    renderUnitsChart('chart-units', labels, purchasedUnits, soldUnits);
    renderMonetaryChart('chart-monetary', labels, purchaseCosts, salesRevenue);
  } catch (err) {
    showBanner(`Failed to load chart data: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Module-level listener reference for idempotent cleanup
// ---------------------------------------------------------------------------

/** @type {(() => void) | null} */
let _applyClickHandler = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Monthly Charts view.
 *
 * Safe to call multiple times — previous event listeners are removed before
 * new ones are attached (idempotent).
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7
 */
export async function init() {
  clearBanner();

  // ---- Set default date range ------------------------------------------------
  const startInput = getStartMonthInput();
  const endInput   = getEndMonthInput();
  const end         = currentMonth();
  const start       = subtractMonths(end, 5);

  if (startInput) startInput.value = start;
  if (endInput)   endInput.value   = end;

  // ---- Populate product filter dropdown --------------------------------------
  const productFilter = getProductFilter();
  if (productFilter) {
    // Always reset to just the "all products" placeholder, then re-populate
    productFilter.innerHTML = '<option value="">— all products —</option>';

    try {
      const products = await getProducts();
      for (const p of products) {
        const opt = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = p.name;
        productFilter.appendChild(opt);
      }
    } catch (err) {
      // Non-fatal: the chart can still render for all products
      showBanner(`Could not load product list: ${err.message}`);
    }
  }

  // ---- Wire Apply button -----------------------------------------------------
  const applyBtn = getApplyButton();
  if (applyBtn) {
    if (_applyClickHandler) {
      applyBtn.removeEventListener('click', _applyClickHandler);
    }
    _applyClickHandler = () => fetchAndRender();
    applyBtn.addEventListener('click', _applyClickHandler);
  }

  // ---- Auto-load charts on init ----------------------------------------------
  await fetchAndRender();
}

export default init;
