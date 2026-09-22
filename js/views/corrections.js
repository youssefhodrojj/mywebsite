/**
 * corrections.js — Stock Corrections view module.
 *
 * Wires the #view-corrections section (already in index.html) to the
 * database layer. Handles:
 *   - Cascading product → variant dropdowns
 *   - Correction form submission with validation
 *   - Negative-stock confirmation modal (Requirement 4.4)
 *   - Correction history table per variant
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 8.3
 */

import {
  getProducts,
  getVariantsByProduct,
  getCorrectionsByVariant,
  getPurchasesByVariant,
  getSalesByVariant,
  getRefundsByVariant,
  createStockCorrection,
  showToast,
} from '../db.js?v=12';
import { validateStockCorrection } from '../validation.js';
import { computeRemainingStock } from '../stock.js?v=12';

// ---------------------------------------------------------------------------
// DOM helpers (resolved lazily so the module can be imported before the DOM
// is fully parsed)
// ---------------------------------------------------------------------------

const getErrorBanner    = () => document.getElementById('corrections-error');
const getProductSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('correction-product'));
const getVariantSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('correction-variant'));
const getForm           = () => /** @type {HTMLFormElement}   */ (document.getElementById('form-add-correction'));
const getAdjustmentInput = () => /** @type {HTMLInputElement} */ (document.getElementById('correction-adjustment'));
const getAdjustmentError = () => document.getElementById('correction-adjustment-error');
const getDateInput      = () => /** @type {HTMLInputElement} */ (document.getElementById('correction-date'));
const getReasonInput    = () => /** @type {HTMLInputElement} */ (document.getElementById('correction-reason'));
const getHistoryContainer = () => document.getElementById('corrections-history');

// Modal elements
const getModalOverlay   = () => document.getElementById('modal-overlay');
const getModalTitle     = () => document.getElementById('modal-title');
const getModalBody      = () => document.getElementById('modal-body');
const getBtnCancel      = () => document.getElementById('btn-modal-cancel');
const getBtnConfirm     = () => document.getElementById('btn-modal-confirm');

// ---------------------------------------------------------------------------
// Module-level state (for idempotency — old listeners are removed on re-init)
// ---------------------------------------------------------------------------

/** @type {((e: Event) => void) | null} */
let _productChangeHandler = null;
/** @type {((e: Event) => void) | null} */
let _variantChangeHandler = null;
/** @type {((e: SubmitEvent) => void) | null} */
let _submitHandler = null;

// ---------------------------------------------------------------------------
// Error banner helpers
// ---------------------------------------------------------------------------

function showBannerError(message) {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

function clearBannerError() {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Field-level error helpers
// ---------------------------------------------------------------------------

/**
 * Show a field-level validation error on the adjustment input.
 * @param {string} message
 */
function showAdjustmentError(message) {
  const errEl = getAdjustmentError();
  if (errEl) errEl.textContent = message;

  // Add .has-error to the closest .form-group ancestor
  const input = getAdjustmentInput();
  if (input) {
    const group = input.closest('.form-group');
    if (group) group.classList.add('has-error');
  }
}

function clearAdjustmentError() {
  const errEl = getAdjustmentError();
  if (errEl) errEl.textContent = '';

  const input = getAdjustmentInput();
  if (input) {
    const group = input.closest('.form-group');
    if (group) group.classList.remove('has-error');
  }
}

// ---------------------------------------------------------------------------
// Variant label formatting
// ---------------------------------------------------------------------------

/**
 * Format a variant's attributes object as a human-readable string.
 * e.g. { size: 'M', color: 'red' } → "size: M, color: red"
 *
 * @param {object} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '(no attributes)';
  return Object.entries(attributes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
}

// ---------------------------------------------------------------------------
// Modal promise helper
// ---------------------------------------------------------------------------

/**
 * Show the global confirmation modal and return a Promise that resolves to
 * `true` when the user clicks Confirm, or `false` when they click Cancel.
 *
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>}
 */
function askConfirmation(title, body) {
  return new Promise((resolve) => {
    const overlay   = getModalOverlay();
    const titleEl   = getModalTitle();
    const bodyEl    = getModalBody();
    const cancelBtn = getBtnCancel();
    const confirmBtn = getBtnConfirm();

    if (!overlay || !cancelBtn || !confirmBtn) {
      // Fallback to native confirm if modal elements are missing
      resolve(window.confirm(`${title}\n\n${body}`));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.textContent  = body;

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');

    function close(result) {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      cancelBtn.removeEventListener('click', onCancel);
      confirmBtn.removeEventListener('click', onConfirm);
      resolve(result);
    }

    function onCancel()  { close(false); }
    function onConfirm() { close(true);  }

    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
  });
}

// ---------------------------------------------------------------------------
// History table rendering
// ---------------------------------------------------------------------------

/**
 * Fetch and render the correction history for the given variant.
 *
 * @param {string} variantId
 */
async function renderHistory(variantId) {
  const container = getHistoryContainer();
  if (!container) return;

  if (!variantId) {
    container.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
    return;
  }

  container.innerHTML = '<p class="text-muted">Loading…</p>';

  try {
    const corrections = await getCorrectionsByVariant(variantId);

    if (corrections.length === 0) {
      container.innerHTML = '<p class="text-muted">No corrections recorded yet.</p>';
      return;
    }

    const rows = corrections
      .map((c) => {
        const adj    = c.adjustment > 0 ? `+${c.adjustment}` : String(c.adjustment);
        const reason = c.reason ? escapeHtml(c.reason) : '<span class="text-muted">—</span>';
        return `
          <tr>
            <td>${escapeHtml(c.corrected_at)}</td>
            <td>${escapeHtml(adj)}</td>
            <td>${reason}</td>
          </tr>`;
      })
      .join('');

    container.innerHTML = `
      <table aria-label="Correction history">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Adjustment (+/−)</th>
            <th scope="col">Reason</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>`;
  } catch (err) {
    container.innerHTML = `<p class="text-muted" role="alert">Failed to load correction history: ${escapeHtml(err.message)}</p>`;
  }
}

// ---------------------------------------------------------------------------
// Small escaping helper to avoid XSS when inserting DB values into innerHTML
// ---------------------------------------------------------------------------

/** @param {string} str */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Stock Corrections view.
 *
 * Safe to call multiple times — each call removes the previous event
 * listeners before attaching fresh ones (idempotent).
 */
export async function init() {
  clearBannerError();
  clearAdjustmentError();

  // ── Default date to today ──────────────────────────────────────────────
  const dateInput = getDateInput();
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // ── 1. Populate the product dropdown ──────────────────────────────────
  const productSelect = getProductSelect();
  if (!productSelect) return;

  try {
    const products = await getProducts();

    // Preserve any currently selected value so re-init doesn't lose it
    const prevProductId = productSelect.value;

    // Rebuild options
    productSelect.innerHTML = '<option value="">— select product —</option>';
    for (const p of products) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      productSelect.appendChild(opt);
    }

    // Restore previous selection if it still exists
    if (prevProductId) productSelect.value = prevProductId;
  } catch (err) {
    showBannerError(`Failed to load products: ${err.message}`);
    return;
  }

  // ── 2. Product → Variant cascade ──────────────────────────────────────
  if (_productChangeHandler) {
    productSelect.removeEventListener('change', _productChangeHandler);
  }

  _productChangeHandler = async () => {
    const variantSelect = getVariantSelect();
    if (!variantSelect) return;

    const productId = productSelect.value;

    // Reset variant select
    variantSelect.innerHTML = '<option value="">— select variant —</option>';

    // Clear history when product changes
    await renderHistory('');

    if (!productId) return;

    try {
      const variants = await getVariantsByProduct(productId);
      for (const v of variants) {
        const opt = document.createElement('option');
        opt.value = v.id;
        opt.textContent = formatAttributes(v.attributes);
        variantSelect.appendChild(opt);
      }
    } catch (err) {
      showBannerError(`Failed to load variants: ${err.message}`);
    }
  };

  productSelect.addEventListener('change', _productChangeHandler);

  // ── 3. Variant → History ───────────────────────────────────────────────
  const variantSelect = getVariantSelect();
  if (variantSelect) {
    if (_variantChangeHandler) {
      variantSelect.removeEventListener('change', _variantChangeHandler);
    }

    _variantChangeHandler = async () => {
      await renderHistory(variantSelect.value);
    };

    variantSelect.addEventListener('change', _variantChangeHandler);
  }

  // If a variant was already selected when we re-init, reload its history
  if (variantSelect?.value) {
    await renderHistory(variantSelect.value);
  }

  // ── 4. Form submission ─────────────────────────────────────────────────
  const form = getForm();
  if (!form) return;

  if (_submitHandler) {
    form.removeEventListener('submit', _submitHandler);
  }

  _submitHandler = async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();

    clearBannerError();
    clearAdjustmentError();

    const variantId  = variantSelect?.value ?? '';
    const adjustment = parseInt(getAdjustmentInput()?.value ?? '', 10);
    const correctedAt = getDateInput()?.value ?? '';
    const reason     = getReasonInput()?.value.trim() ?? '';

    // ── 4a / 4b. Validate adjustment ──────────────────────────────────
    const { valid, errors } = validateStockCorrection({ adjustment });
    if (!valid) {
      showAdjustmentError(errors[0]);
      return;
    }

    if (!variantId) {
      showBannerError('Please select a product and variant.');
      return;
    }

    if (!correctedAt) {
      showBannerError('Please enter a date for the correction.');
      return;
    }

    // ── 4d. Compute current remaining stock ───────────────────────────
    let currentStock;
    try {
      const [purchases, sales, corrections, refunds] = await Promise.all([
        getPurchasesByVariant(variantId),
        getSalesByVariant(variantId),
        getCorrectionsByVariant(variantId),
        getRefundsByVariant(variantId),
      ]);
      currentStock = computeRemainingStock(purchases, sales, corrections, refunds);
    } catch (err) {
      showToast(`Failed to fetch stock data: ${err.message}`);
      return;
    }

    // ── 4e / 4f. Negative stock warning ───────────────────────────────
    const projected = currentStock + adjustment;
    if (projected < 0) {
      const confirmed = await askConfirmation(
        'Stock will go negative',
        `This correction will result in a stock of ${projected}. Proceed?`
      );
      if (!confirmed) return;
    }

    // ── 4g. Save correction ───────────────────────────────────────────
    try {
      const costPerUnitInput = document.getElementById('correction-cost-per-unit');
      const costPerUnit = costPerUnitInput ? parseFloat(costPerUnitInput.value) || 0 : 0;

      await createStockCorrection({
        variantId,
        adjustment,
        reason: reason || undefined,
        correctedAt,
        costPerUnit,
      });
    } catch (err) {
      showToast(err.message);
      return;
    }

    // ── 4h. Success: toast, reset form, re-render history ─────────────
    showToast('Correction saved', 'success');
    form.reset();

    // Restore default date after reset
    const di = getDateInput();
    if (di) di.value = new Date().toISOString().slice(0, 10);

    await renderHistory(variantId);
  };

  form.addEventListener('submit', _submitHandler);
}

export default init;
