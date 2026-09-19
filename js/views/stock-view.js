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

const getErrorBanner      = () => document.getElementById('stock-error');
const getProductFilter    = () => document.getElementById('stock-product-filter');
const getVariantFilter    = () => document.getElementById('stock-variant-filter');
const getStockLevelFilter = () => document.getElementById('stock-count-filter');
const getTableBody        = () => document.getElementById('stock-table-body');

/** @type {Array<{productId:string, productName:string, variantId:string, variantAttributes:object, remainingStock:number}>} */
let _rows = [];

// Store ALL handlers at module level so they can be removed on re-init
let _onProductChange    = null;
let _onVariantChange    = null;
let _onStockLevelChange = null;

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return '--';
  const pairs = Object.entries(attrs);
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

  const productId   = getProductFilter()?.value ?? '';
  const variantId   = getVariantFilter()?.value ?? '';
  const stockLevel  = getStockLevelFilter()?.value ?? '';

  let visible = _rows;

  if (productId)              visible = visible.filter(r => r.productId  === productId);
  if (variantId)              visible = visible.filter(r => r.variantId  === variantId);
  if (stockLevel === 'low')   visible = visible.filter(r => r.remainingStock <= 0);
  else if (stockLevel === 'instock') visible = visible.filter(r => r.remainingStock > 0);

  if (!visible.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No stock data matches the selected filters.</td></tr>';
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

function populateVariantDropdown(productId) {
  const sel = getVariantFilter();
  if (!sel) return;

  const prev = sel.value;
  sel.innerHTML = '<option value="">-- all variants --</option>';

  const source = productId ? _rows.filter(r => r.productId === productId) : _rows;
  const seen = new Set();
  for (const row of source) {
    if (seen.has(row.variantId)) continue;
    seen.add(row.variantId);
    const opt = document.createElement('option');
    opt.value = row.variantId;
    opt.textContent = formatAttributes(row.variantAttributes);
    sel.appendChild(opt);
  }

  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

export async function init() {
  setErrorBanner(null);
  _rows = [];

  const tbody = getTableBody();
  if (tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-muted">Loading...</td></tr>';

  // --- Remove all stale listeners ---
  const productSel    = getProductFilter();
  const variantSel    = getVariantFilter();
  const stockLevelSel = getStockLevelFilter();

  if (_onProductChange    && productSel)    productSel.removeEventListener('change',    _onProductChange);
  if (_onVariantChange    && variantSel)    variantSel.removeEventListener('change',    _onVariantChange);
  if (_onStockLevelChange && stockLevelSel) stockLevelSel.removeEventListener('change', _onStockLevelChange);

  // --- Load products ---
  let products = [];
  try {
    products = await getProducts();
  } catch (err) {
    setErrorBanner(`Failed to load products: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // --- Populate product dropdown ---
  if (productSel) {
    productSel.innerHTML = '<option value="">-- all products --</option>';
    for (const p of products) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      productSel.appendChild(opt);
    }
  }

  if (!products.length) { renderTable(); return; }

  // --- Load all variants and compute stock ---
  try {
    const variantResults = await Promise.all(
      products.map(p => getVariantsByProduct(p.id).then(vs => ({ product: p, variants: vs })))
    );

    const pairs = [];
    for (const { product, variants } of variantResults) {
      for (const variant of variants) pairs.push({ product, variant });
    }

    _rows = await Promise.all(
      pairs.map(async ({ product, variant }) => {
        const [purchases, sales, corrections] = await Promise.all([
          getPurchasesByVariant(variant.id),
          getSalesByVariant(variant.id),
          getCorrectionsByVariant(variant.id),
        ]);
        return {
          productId:         product.id,
          productName:       product.name,
          variantId:         variant.id,
          variantAttributes: variant.attributes,
          remainingStock:    computeRemainingStock(purchases, sales, corrections),
        };
      })
    );
  } catch (err) {
    setErrorBanner(`Failed to load stock data: ${err.message}`);
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // --- Populate variant dropdown and render ---
  populateVariantDropdown('');
  renderTable();

  // --- Wire new listeners ---
  _onProductChange = () => {
    populateVariantDropdown(productSel?.value ?? '');
    renderTable();
  };
  _onVariantChange    = () => renderTable();
  _onStockLevelChange = () => renderTable();

  productSel?.addEventListener('change',    _onProductChange);
  variantSel?.addEventListener('change',    _onVariantChange);
  stockLevelSel?.addEventListener('change', _onStockLevelChange);
}

export default init;
