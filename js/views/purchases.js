/**
 * purchases.js — Purchase Batches view
 *
 * Wires the purchase form and history table to the database layer.
 * All DOM elements are already present in index.html; this module only
 * sets their content and attaches event listeners.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 8.3
 */

import {
  getProducts,
  getVariantsByProduct,
  getPurchasesByVariant,
  createPurchaseBatch,
  showToast,
} from '../db.js';
import { validatePurchaseBatch } from '../validation.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a variant's attributes object as a human-readable label.
 * e.g. { size: 'M', color: 'red' } → "size: M, color: red"
 *
 * @param {object} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '—';
  return Object.entries(attributes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

/**
 * Return today's date as a 'YYYY-MM-DD' string (local time).
 * @returns {string}
 */
function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Format a date string (YYYY-MM-DD or ISO) into a localised display string.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  // Append T00:00:00 so it parses as local time rather than UTC midnight
  const d = new Date(dateStr.length === 10 ? `${dateStr}T00:00:00` : dateStr);
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// DOM helpers (lazily resolved so the module is safe to import early)
// ---------------------------------------------------------------------------

const getErrorBanner    = () => document.getElementById('purchases-error');
const getProductSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('purchase-product'));
const getVariantSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('purchase-variant'));
const getForm           = () => /** @type {HTMLFormElement}   */ (document.getElementById('form-add-purchase'));
const getQuantityInput  = () => /** @type {HTMLInputElement}  */ (document.getElementById('purchase-quantity'));
const getCostInput      = () => /** @type {HTMLInputElement}  */ (document.getElementById('purchase-cost'));
const getDateInput      = () => /** @type {HTMLInputElement}  */ (document.getElementById('purchase-date'));
const getQtyError       = () => document.getElementById('purchase-quantity-error');
const getCostError      = () => document.getElementById('purchase-cost-error');
const getDateError      = () => document.getElementById('purchase-date-error');
const getHistoryEl      = () => document.getElementById('purchases-history');

// ---------------------------------------------------------------------------
// Banner / field-error helpers
// ---------------------------------------------------------------------------

/**
 * Show the view-level error banner.
 * @param {string} message
 */
function showBanner(message) {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

/** Hide the view-level error banner. */
function clearBanner() {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

/**
 * Display an inline field error and add the .has-error class to its
 * closest .form-group ancestor.
 *
 * @param {HTMLElement|null} errorSpan
 * @param {string} message
 */
function setFieldError(errorSpan, message) {
  if (!errorSpan) return;
  errorSpan.textContent = message;
  errorSpan.closest('.form-group')?.classList.add('has-error');
}

/** Clear all purchase-form inline field errors. */
function clearFieldErrors() {
  for (const spanEl of [getQtyError(), getCostError(), getDateError()]) {
    if (!spanEl) continue;
    spanEl.textContent = '';
    spanEl.closest('.form-group')?.classList.remove('has-error');
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Populate the #purchase-product dropdown.
 * @param {Array<{id: string, name: string}>} products
 */
function renderProductOptions(products) {
  const sel = getProductSelect();
  if (!sel) return;

  // Keep the placeholder option, replace the rest
  sel.innerHTML = '<option value="">— select product —</option>';
  for (const p of products) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

/**
 * Populate the #purchase-variant dropdown from a product's variants.
 * @param {Array<{id: string, attributes: object}>} variants
 */
function renderVariantOptions(variants) {
  const sel = getVariantSelect();
  if (!sel) return;

  sel.innerHTML = '<option value="">— select variant —</option>';
  for (const v of variants) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = formatAttributes(v.attributes);
    sel.appendChild(opt);
  }
}

/**
 * Render the purchase history table for the currently selected variant.
 * @param {Array<{id: string, purchased_at: string, quantity: number, cost_price: string|number}>} purchases
 */
function renderHistory(purchases) {
  const container = getHistoryEl();
  if (!container) return;

  if (!purchases || purchases.length === 0) {
    container.innerHTML = '<p class="text-muted">No purchase batches recorded for this variant yet.</p>';
    return;
  }

  const rows = purchases
    .map(
      (p) => `
      <tr>
        <td>${formatDate(p.purchased_at)}</td>
        <td>${p.quantity}</td>
        <td>${Number(p.cost_price).toFixed(2)}</td>
      </tr>`
    )
    .join('');

  container.innerHTML = `
    <table class="history-table" aria-label="Purchase history">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Qty</th>
          <th scope="col">Cost/unit</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Listener references (stored at module level for idempotent cleanup)
// ---------------------------------------------------------------------------

/** @type {((e: Event) => void) | null} */
let _onProductChange = null;

/** @type {((e: Event) => void) | null} */
let _onVariantChange = null;

/** @type {((e: SubmitEvent) => void) | null} */
let _onFormSubmit = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Purchases view.
 *
 * Safe to call multiple times — previous event listeners are removed before
 * new ones are attached (idempotent).
 */
export async function init() {
  const productSel = getProductSelect();
  const variantSel = getVariantSelect();
  const form       = getForm();
  const dateInput  = getDateInput();
  const historyEl  = getHistoryEl();

  if (!productSel || !variantSel || !form) return;

  // -- Remove stale listeners --------------------------------------------------
  if (_onProductChange) productSel.removeEventListener('change', _onProductChange);
  if (_onVariantChange) variantSel.removeEventListener('change', _onVariantChange);
  if (_onFormSubmit)    form.removeEventListener('submit', _onFormSubmit);

  // -- Set default date --------------------------------------------------------
  if (dateInput && !dateInput.value) {
    dateInput.value = todayISO();
  }

  // -- Reset history placeholder -----------------------------------------------
  if (historyEl) {
    historyEl.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
  }

  clearBanner();
  clearFieldErrors();

  // -- Load products -----------------------------------------------------------
  let products = [];
  try {
    products = await getProducts();
  } catch (err) {
    showBanner(`Failed to load products: ${err.message}`);
  }
  renderProductOptions(products);

  // -- Product → variant cascade -----------------------------------------------
  _onProductChange = async (e) => {
    const productId = /** @type {HTMLSelectElement} */ (e.target).value;

    // Reset variant dropdown and history
    renderVariantOptions([]);
    if (historyEl) {
      historyEl.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
    }

    if (!productId) return;

    try {
      const variants = await getVariantsByProduct(productId);
      renderVariantOptions(variants);
    } catch (err) {
      showBanner(`Failed to load variants: ${err.message}`);
    }
  };

  // -- Variant → history -------------------------------------------------------
  _onVariantChange = async (e) => {
    const variantId = /** @type {HTMLSelectElement} */ (e.target).value;

    if (!variantId) {
      if (historyEl) {
        historyEl.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
      }
      return;
    }

    try {
      const purchases = await getPurchasesByVariant(variantId);
      renderHistory(purchases);
    } catch (err) {
      showBanner(`Failed to load purchase history: ${err.message}`);
    }
  };

  // -- Form submit -------------------------------------------------------------
  _onFormSubmit = async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();
    clearBanner();
    clearFieldErrors();

    const variantId   = variantSel.value;
    const quantityRaw = getQuantityInput()?.value ?? '';
    const costRaw     = getCostInput()?.value ?? '';
    const purchasedAt = getDateInput()?.value ?? '';

    // -- Basic presence checks before numeric parse ----------------------------
    let hasError = false;

    if (!variantId) {
      showBanner('Please select a product and variant before saving.');
      return;
    }

    if (!purchasedAt) {
      setFieldError(getDateError(), 'Date is required.');
      hasError = true;
    }

    const quantity  = parseInt(quantityRaw, 10);
    const costPrice = parseFloat(costRaw);

    // -- Domain validation via validation.js -----------------------------------
    const { valid, errors } = validatePurchaseBatch({ quantity, costPrice });

    if (!valid) {
      // Map errors back to the relevant field spans
      for (const msg of errors) {
        if (msg.toLowerCase().includes('quantity')) {
          setFieldError(getQtyError(), msg);
        } else if (msg.toLowerCase().includes('cost') || msg.toLowerCase().includes('price')) {
          setFieldError(getCostError(), msg);
        } else {
          showBanner(msg);
        }
      }
      hasError = true;
    }

    if (hasError || !valid) return;

    // -- Persist ---------------------------------------------------------------
    try {
      await createPurchaseBatch({ variantId, quantity, costPrice, purchasedAt });
      showToast('Purchase recorded', 'success');

      // Reset numeric/date fields only; keep product + variant selected
      const qtyEl  = getQuantityInput();
      const costEl = getCostInput();
      const dateEl = getDateInput();
      if (qtyEl)  qtyEl.value  = '';
      if (costEl) costEl.value = '';
      if (dateEl) dateEl.value = todayISO();

      // Refresh history table
      const purchases = await getPurchasesByVariant(variantId);
      renderHistory(purchases);
    } catch (err) {
      showToast(err.message);
    }
  };

  // -- Attach listeners --------------------------------------------------------
  productSel.addEventListener('change', _onProductChange);
  variantSel.addEventListener('change', _onVariantChange);
  form.addEventListener('submit', _onFormSubmit);
}

export default init;
