/**
 * stock-view.js — Remaining Stock summary view module.
 *
 * Wires the #view-stock section (already in index.html) to the database
 * and stock computation layers.
 *
 * Responsibilities:
 *   - Load all products and their variants from the DB.
 *   - For each variant fetch purchases, sales, and corrections; compute
 *     remaining stock via computeRemainingStock().
 *   - Render the summary table: Product | Variant attributes | Remaining Stock.
 *   - Apply .row--low-stock to rows where remaining stock ≤ 0.
 *   - Live product-name text filter (#stock-filter) re-renders the table
 *     on every 'input' event (case-insensitive substring match).
 *   - Show the error banner when any fetch fails.
 *   - Idempotent: removes and re-attaches the filter listener on each init().
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import {
  getProducts,
  getVariantsByProduct,
  getPurchasesByVariant,
  getSalesByVariant,
  getCorrectionsByVariant,
} from '../db.js';
import { computeRemainingStock, isLowStock } from '../stock.js';

// ---------------------------------------------------------------------------
// DOM helpers (resolved lazily)
// ---------------------------------------------------------------------------

const getErrorBanner  = () => document.getElementById('stock-error');
const getFilterInput  = () => /** @type {HTMLInputElement|null} */ (document.getElementById('stock-filter'));
const getTableBody    = () => document.getElementById('stock-table-body');

// ---------------------------------------------------------------------------
// Module-level state for idempotent init()
// ---------------------------------------------------------------------------

/**
 * Full dataset — built on every init() call and shared with the filter
 * handler so re-renders don't need another network round-trip.
 *
 * @type {Array<{productName: string, variantId: string, variantAttributes: object, remainingStock: number}>}
 */
let _rows = [];

/** @type {((e: Event) => void) | null} */
let _filterHandler = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a value for safe insertion via innerHTML.
 * @param {unknown} val
 * @returns {string}
 */
function escapeHtml(val) {
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a variant attributes object as "key: value, …" pairs.
 * @param {object} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return '—';
  }
  const pairs = Object.entries(attributes);
  if (!pairs.length) return '—';
  return pairs.map(([k, v]) => `${k}: ${v}`).join(', ');
}

/**
 * Show or clear the error banner.
 * @param {string|null} message — null hides the banner
 */
function setErrorBanner(message) {
  const el = getErrorBanner();
  if (!el) return;
  if (message) {
    el.textContent = message;
    el.classList.add('visible');
  } else {
    el.textContent = '';
    el.classList.remove('visible');
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * (Re-)render the stock table body using the current _rows dataset,
 * filtered by the given search term.
 *
 * @param {string} [filterText=''] — case-insensitive substring to match
 *   against productName; empty string shows all rows.
 */
function renderTable(filterText = '') {
  const tbody = getTableBody();
  if (!tbody) return;

  const term = filterText.trim().toLowerCase();

  const visible = term
    ? _rows.filter(row => row.productName.toLowerCase().includes(term))
    : _rows;

  if (!visible.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="3" class="text-muted">${
          term ? 'No products match the current filter.' : 'No stock data available.'
        }</td>
      </tr>`;
    return;
  }

  const html = visible.map(row => {
    const lowStockClass = isLowStock(row.remainingStock) ? ' class="row--low-stock"' : '';
    const attrsText = escapeHtml(formatAttributes(row.variantAttributes));
    const productText = escapeHtml(row.productName);
    const stockText = escapeHtml(String(row.remainingStock));

    return `<tr${lowStockClass}>
      <td>${productText}</td>
      <td>${attrsText}</td>
      <td>${stockText}</td>
    </tr>`;
  }).join('');

  tbody.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Remaining Stock summary view.
 *
 * Fetches all products → variants → purchases/sales/corrections in parallel
 * per variant, computes remaining stock, then renders the summary table.
 *
 * Safe to call multiple times (idempotent):
 *   - Re-fetches fresh data on each call.
 *   - Removes the previous filter listener before attaching a new one.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */
export async function init() {
  setErrorBanner(null);
  _rows = [];

  // Show loading state while fetching
  const tbody = getTableBody();
  if (tbody) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Loading…</td></tr>';
  }

  // ── 1. Load all products ──────────────────────────────────────────────────
  let products = [];
  try {
    products = await getProducts();
  } catch (err) {
    setErrorBanner(`Failed to load products: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  if (!products.length) {
    _rows = [];
    renderTable();
    return;
  }

  // ── 2. Load variants for every product (in parallel) ────────────────────
  let productVariantPairs = [];
  try {
    const variantResults = await Promise.all(
      products.map(p => getVariantsByProduct(p.id).then(variants => ({ product: p, variants })))
    );
    for (const { product, variants } of variantResults) {
      for (const variant of variants) {
        productVariantPairs.push({ product, variant });
      }
    }
  } catch (err) {
    setErrorBanner(`Failed to load variants: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  if (!productVariantPairs.length) {
    _rows = [];
    renderTable();
    return;
  }

  // ── 3. Compute remaining stock for each variant (all fetches in parallel) ─
  try {
    const stockResults = await Promise.all(
      productVariantPairs.map(async ({ product, variant }) => {
        const [purchases, sales, corrections] = await Promise.all([
          getPurchasesByVariant(variant.id),
          getSalesByVariant(variant.id),
          getCorrectionsByVariant(variant.id),
        ]);
        const remainingStock = computeRemainingStock(purchases, sales, corrections);
        return {
          productName: product.name,
          variantId: variant.id,
          variantAttributes: variant.attributes,
          remainingStock,
        };
      })
    );
    _rows = stockResults;
  } catch (err) {
    setErrorBanner(`Failed to load stock data: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // ── 4. Initial render (no filter applied yet) ────────────────────────────
  const filterInput = getFilterInput();
  const currentFilter = filterInput?.value ?? '';
  renderTable(currentFilter);

  // ── 5. Wire live filter input (idempotent) ───────────────────────────────
  if (filterInput) {
    if (_filterHandler) {
      filterInput.removeEventListener('input', _filterHandler);
    }

    _filterHandler = () => {
      renderTable(filterInput.value);
    };

    filterInput.addEventListener('input', _filterHandler);
  }
}

export default init;
