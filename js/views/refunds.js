/**
 * refunds.js — Refunds view
 *
 * Wires the refund form and history table to the database layer.
 * All DOM elements are already present in index.html; this module only
 * sets their content and attaches event listeners.
 *
 * A refund restores stock automatically because the stock computation
 * includes refunds. It also reduces revenue, tracked via charts.
 */

import {
  getProducts,
  getVariantsByProduct,
  getSalesByVariant,
  getRefundsByVariant,
  createRefund,
  deleteRefund,
  showToast,
} from '../db.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe HTML insertion.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/**
 * Format a variant's attributes object as a human-readable label.
 * @param {object} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '—';
  return Object.entries(attributes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// DOM helpers (lazily resolved so the module is safe to import early)
// ---------------------------------------------------------------------------

const getErrorBanner    = () => document.getElementById('refunds-error');
const getProductSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('refund-product'));
const getVariantSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('refund-variant'));
const getSaleSelect     = () => /** @type {HTMLSelectElement} */ (document.getElementById('refund-sale'));
const getForm           = () => /** @type {HTMLFormElement}   */ (document.getElementById('form-add-refund'));
const getQuantityInput  = () => /** @type {HTMLInputElement}  */ (document.getElementById('refund-quantity'));
const getPriceInput     = () => /** @type {HTMLInputElement}  */ (document.getElementById('refund-price'));
const getDateInput      = () => /** @type {HTMLInputElement}  */ (document.getElementById('refund-date'));
const getReasonInput    = () => /** @type {HTMLInputElement|HTMLTextAreaElement} */ (document.getElementById('refund-reason'));
const getQtyError       = () => document.getElementById('refund-quantity-error');
const getPriceError     = () => document.getElementById('refund-price-error');
const getHistoryEl      = () => document.getElementById('refunds-history');

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
 * @param {HTMLElement|null} errorSpan
 * @param {string} message
 */
function setFieldError(errorSpan, message) {
  if (!errorSpan) return;
  errorSpan.textContent = message;
  errorSpan.closest('.form-group')?.classList.add('has-error');
}

/** Clear all refund-form inline field errors. */
function clearFieldErrors() {
  for (const spanEl of [getQtyError(), getPriceError()]) {
    if (!spanEl) continue;
    spanEl.textContent = '';
    spanEl.closest('.form-group')?.classList.remove('has-error');
  }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Populate the #refund-product dropdown.
 * @param {Array<{id: string, name: string}>} products
 */
function renderProductOptions(products) {
  const sel = getProductSelect();
  if (!sel) return;
  sel.innerHTML = '<option value="">— select product —</option>';
  for (const p of products) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    sel.appendChild(opt);
  }
}

/**
 * Populate the #refund-variant dropdown.
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
 * Populate the #refund-sale dropdown from sales for the selected variant.
 * @param {Array<{id: string, sold_at: string, quantity: number, sell_price: string|number}>} sales
 */
function renderSaleOptions(sales) {
  const sel = getSaleSelect();
  if (!sel) return;
  sel.innerHTML = '<option value="">— select sale record —</option>';
  for (const s of sales) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `Date: ${formatDate(s.sold_at)} | Qty: ${s.quantity} | Price: ${Number(s.sell_price).toFixed(2)}`;
    sel.appendChild(opt);
  }
}

/**
 * Render the refund history table for the currently selected variant.
 * @param {Array<{id: string, refunded_at: string, quantity: number, refund_price: string|number, reason: string|null}>} refunds
 */
function renderHistory(refunds) {
  const container = getHistoryEl();
  if (!container) return;

  if (!refunds || refunds.length === 0) {
    container.innerHTML = '<p class="text-muted">No refunds recorded for this variant yet.</p>';
    return;
  }

  const rows = refunds
    .map(
      (r) => `
      <tr>
        <td>${escapeHtml(formatDate(r.refunded_at))}</td>
        <td>${escapeHtml(r.quantity)}</td>
        <td>${Number(r.refund_price).toFixed(2)}</td>
        <td>${escapeHtml(r.reason ?? '—')}</td>
        <td>
          <button
            type="button"
            class="btn-delete"
            data-id="${escapeHtml(r.id)}"
            aria-label="Delete refund"
          >Delete</button>
        </td>
      </tr>`
    )
    .join('');

  container.innerHTML = `
    <table class="history-table" aria-label="Refund history">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Qty Refunded</th>
          <th scope="col">Refund Price/unit</th>
          <th scope="col">Reason</th>
          <th scope="col">Actions</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  // Attach delete handlers to each button
  container.querySelectorAll('button.btn-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = /** @type {HTMLElement} */ (btn).dataset.id;
      if (!id) return;
      if (!confirm('Delete this refund record? This cannot be undone.')) return;
      try {
        await deleteRefund(id);
        showToast('Refund deleted', 'success');
        // Re-render history for the current variant
        const variantId = getVariantSelect()?.value;
        if (variantId) {
          const updated = await getRefundsByVariant(variantId);
          renderHistory(updated);
        }
      } catch (err) {
        showToast(err.message);
      }
    });
  });
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
 * Initialise the Refunds view.
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

    // Reset downstream dropdowns and history
    renderVariantOptions([]);
    renderSaleOptions([]);
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

  // -- Variant → sales dropdown + history --------------------------------------
  _onVariantChange = async (e) => {
    const variantId = /** @type {HTMLSelectElement} */ (e.target).value;

    renderSaleOptions([]);

    if (!variantId) {
      if (historyEl) {
        historyEl.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
      }
      return;
    }

    try {
      const [sales, refunds] = await Promise.all([
        getSalesByVariant(variantId),
        getRefundsByVariant(variantId),
      ]);
      renderSaleOptions(sales);
      renderHistory(refunds);
    } catch (err) {
      showBanner(`Failed to load data for variant: ${err.message}`);
    }
  };

  // -- Form submit -------------------------------------------------------------
  _onFormSubmit = async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();
    clearBanner();
    clearFieldErrors();

    const variantId      = variantSel.value;
    const saleRecordId   = getSaleSelect()?.value ?? '';
    const quantityRaw    = getQuantityInput()?.value ?? '';
    const priceRaw       = getPriceInput()?.value ?? '';
    const refundedAt     = getDateInput()?.value ?? '';
    const reason         = getReasonInput()?.value?.trim() ?? '';

    // -- Presence checks -------------------------------------------------------
    if (!variantId) {
      showBanner('Please select a product and variant before saving.');
      return;
    }

    if (!saleRecordId) {
      showBanner('Please select a sale record to refund against.');
      return;
    }

    if (!refundedAt) {
      showBanner('Please set a refund date.');
      return;
    }

    // -- Numeric validation ----------------------------------------------------
    let hasError = false;

    const quantity = parseInt(quantityRaw, 10);
    if (!quantityRaw || isNaN(quantity) || quantity <= 0 || !Number.isInteger(quantity)) {
      setFieldError(getQtyError(), 'Quantity must be a positive whole number.');
      hasError = true;
    }

    const refundPrice = parseFloat(priceRaw);
    if (priceRaw === '' || isNaN(refundPrice) || refundPrice < 0) {
      setFieldError(getPriceError(), 'Refund price must be 0 or greater.');
      hasError = true;
    }

    if (hasError) return;

    // -- Persist ---------------------------------------------------------------
    try {
      await createRefund({ saleRecordId, variantId, quantity, refundPrice, reason, refundedAt });
      showToast('Refund recorded', 'success');

      // Reset numeric/date/reason fields; keep product + variant + sale selected
      const qtyEl    = getQuantityInput();
      const priceEl  = getPriceInput();
      const dateEl   = getDateInput();
      const reasonEl = getReasonInput();
      if (qtyEl)    qtyEl.value    = '';
      if (priceEl)  priceEl.value  = '';
      if (dateEl)   dateEl.value   = todayISO();
      if (reasonEl) reasonEl.value = '';

      // Refresh history table
      const refunds = await getRefundsByVariant(variantId);
      renderHistory(refunds);
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
