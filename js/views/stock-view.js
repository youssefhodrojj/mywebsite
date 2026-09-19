/**
 * stock-view.js -- Remaining Stock summary view.
 * Uses dropdown selects for product and variant filtering.
 */

import {
  getProducts,
  getVariantsByProduct,
  getPurchasesByVariant,
  getSalesByVariant,
  getCorrectionsByVariant,
} from '../db.js';
import { computeRemainingStock, isLowStock } from '../stock.js';

const getErrorBanner       = () => document.getElementById('stock-error');
const getProductFilter     = () => document.getElementById('stock-product-filter');
const getVariantFilter     = () => document.getElementById('stock-variant-filter');
const getStockLevelFilter  = () => document.getElementById('stock-count-filter');
const getTableBody         = () => document.getElementById('stock-table-body');

/** @type {Array<{productId: string, productName: string, variantId: string, variantAttributes: object, remainingStock: number}>} */
let _rows = [];

/** @type {(() => void) | null} */
let _filterHandler = null;

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) return '--';
  const pairs = Object.entries(attributes);
  if (!pairs.length) return '--';
  return pairs.map(([k, v]) => `${k}: ${v}`).join(', ');
}

function setErrorBanner(message) {
  const el = getErrorBanner();
  if (!el) return;
  if (message) { el.textContent = message; el.classList.add('visible'); }
  else         { el.textContent = '';       el.classList.remove('visible'); }
}

function renderTable() {
  const tbody = getTableBody();
  if (!tbody) return;

  const productId        = getProductFilter()?.value ?? '';
  const variantId        = getVariantFilter()?.value ?? '';
  const stockLevelFilter = getStockLevelFilter()?.value ?? '';

  let visible = _rows;

  if (productId) {
    visible = visible.filter(row => row.productId === productId);
  }

  if (variantId) {
    visible = visible.filter(row => row.variantId === variantId);
  }

  if (stockLevelFilter === 'low') {
    visible = visible.filter(row => row.remainingStock <= 0);
  } else if (stockLevelFilter === 'instock') {
    visible = visible.filter(row => row.remainingStock > 0);
  }

  if (!visible.length) {
    tbody.innerHTML = `<tr><td colspan="3" class="text-muted">No stock data matches the selected filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = visible.map(row => {
    const cls = isLowStock(row.remainingStock) ? ' class="row--low-stock"' : '';
    return `<tr${cls}>
      <td>${escapeHtml(row.productName)}</td>
      <td>${escapeHtml(formatAttributes(row.variantAttributes))}</td>
      <td>${escapeHtml(String(row.remainingStock))}</td>
    </tr>`;
  }).join('');
}

/**
 * Populate the variant dropdown based on selected product.
 * If no product selected, show all variants.
 */
function populateVariantDropdown(productId) {
  const variantSelect = getVariantFilter();
  if (!variantSelect) return;

  const prevValue = variantSelect.value;
  variantSelect.innerHTML = '<option value="">-- all variants --</option>';

  const source = productId
    ? _rows.filter(r => r.productId === productId)
    : _rows;

  // Deduplicate by variantId
  const seen = new Set();
  for (const row of source) {
    if (seen.has(row.variantId)) continue;
    seen.add(row.variantId);
    const opt = document.createElement('option');
    opt.value = row.variantId;
    opt.textContent = formatAttributes(row.variantAttributes);
    variantSelect.appendChild(opt);
  }

  // Restore previous selection if still valid
  if (prevValue && [...variantSelect.options].some(o => o.value === prevValue)) {
    variantSelect.value = prevValue;
  }
}

export async function init() {
  setErrorBanner(null);
  _rows = [];

  const tbody = getTableBody();
  if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Loading...</td></tr>';

  // Load products
  let products = [];
  try {
    products = await getProducts();
  } catch (err) {
    setErrorBanner(`Failed to load products: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // Populate product dropdown
  const productSelect = getProductFilter();
  if (productSelect) {
    productSelect.innerHTML = '<option value="">-- all products --</option>';
    for (const p of products) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      productSelect.appendChild(opt);
    }
  }

  if (!products.length) {
    _rows = [];
    renderTable();
    return;
  }

  // Load variants and stock for all products
  try {
    const variantResults = await Promise.all(
      products.map(p => getVariantsByProduct(p.id).then(variants => ({ product: p, variants })))
    );

    const pairs = [];
    for (const { product, variants } of variantResults) {
      for (const variant of variants) {
        pairs.push({ product, variant });
      }
    }

    const stockResults = await Promise.all(
      pairs.map(async ({ product, variant }) => {
        const [purchases, sales, corrections] = await Promise.all([
          getPurchasesByVariant(variant.id),
          getSalesByVariant(variant.id),
          getCorrectionsByVariant(variant.id),
        ]);
        return {
          productId: product.id,
          productName: product.name,
          variantId: variant.id,
          variantAttributes: variant.attributes,
          remainingStock: computeRemainingStock(purchases, sales, corrections),
        };
      })
    );

    _rows = stockResults;
  } catch (err) {
    setErrorBanner(`Failed to load stock data: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // Populate variant dropdown (all variants initially)
  populateVariantDropdown('');

  // Initial render
  renderTable();

  // Wire filters (idempotent)
  const variantSelect     = getVariantFilter();
  const stockLevelSelect  = getStockLevelFilter();

  if (_filterHandler) {
    productSelect?.removeEventListener('change', _filterHandler);
    variantSelect?.removeEventListener('change', _filterHandler);
    stockLevelSelect?.removeEventListener('change', _filterHandler);
  }

  _filterHandler = () => {
    // When product changes, update variant dropdown to show only that product's variants
    const selectedProduct = productSelect?.value ?? '';
    populateVariantDropdown(selectedProduct);
    renderTable();
  };

  // Separate handler for variant/stock changes (no need to repopulate variant dropdown)
  const _subFilterHandler = () => renderTable();

  productSelect?.addEventListener('change', _filterHandler);
  variantSelect?.addEventListener('change', _subFilterHandler);
  stockLevelSelect?.addEventListener('change', _subFilterHandler);
}

export default init;
