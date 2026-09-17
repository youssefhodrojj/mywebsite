/**
 * Sales Recording view module.
 *
 * Wires the #view-sales section (already rendered in index.html) to the
 * database and validation layers.
 *
 * Responsibilities:
 *   - Populate the product/variant cascading dropdowns.
 *   - On variant selection, load and render the sales history table.
 *   - Validate the form before submission.
 *   - Compute projected remaining stock; warn via confirmation modal when
 *     the sale would push stock below zero.
 *   - Persist the sale record and refresh the history on success.
 *   - Show toast notifications for success/error.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.3
 */

import {
  getProducts,
  getVariantsByProduct,
  getSalesByVariant,
  getPurchasesByVariant,
  getCorrectionsByVariant,
  createSaleRecord,
  showToast,
} from '../db.js';
import { validateSaleRecord } from '../validation.js';
import { computeRemainingStock } from '../stock.js';

// ---------------------------------------------------------------------------
// DOM helpers — resolved lazily so init() is safe to call before paint
// ---------------------------------------------------------------------------

const getProductSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('sale-product'));
const getVariantSelect  = () => /** @type {HTMLSelectElement} */ (document.getElementById('sale-variant'));
const getForm           = () => /** @type {HTMLFormElement}   */ (document.getElementById('form-add-sale'));
const getQuantityInput  = () => /** @type {HTMLInputElement}  */ (document.getElementById('sale-quantity'));
const getPriceInput     = () => /** @type {HTMLInputElement}  */ (document.getElementById('sale-price'));
const getDateInput      = () => /** @type {HTMLInputElement}  */ (document.getElementById('sale-date'));
const getQuantityError  = () => document.getElementById('sale-quantity-error');
const getPriceError     = () => document.getElementById('sale-price-error');
const getHistoryEl      = () => document.getElementById('sales-history');
const getErrorBanner    = () => document.getElementById('sales-error');

// Modal elements
const getModalOverlay   = () => document.getElementById('modal-overlay');
const getModalTitle     = () => document.getElementById('modal-title');
const getModalBody      = () => document.getElementById('modal-body');
const getModalCancel    = () => document.getElementById('btn-modal-cancel');
const getModalConfirm   = () => document.getElementById('btn-modal-confirm');

// ---------------------------------------------------------------------------
// Module-level handler references for idempotent init()
// ---------------------------------------------------------------------------

/** @type {((e: Event) => void) | null} */
let _productChangeHandler = null;

/** @type {((e: Event) => void) | null} */
let _variantChangeHandler = null;

/** @type {((e: SubmitEvent) => void) | null} */
let _submitHandler = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a variant's attributes object as a human-readable string.
 * e.g. { size: 'M', color: 'red' } → "size: M, color: red"
 *
 * @param {object} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '—';
  return Object.entries(attributes)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
}

/**
 * Format a date string (ISO or date-only) to a locale-friendly display.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  // Use UTC to avoid timezone-shift issues with date-only strings
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Show or hide the error banner with a message.
 * @param {string|null} message  — null clears the banner
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

/**
 * Clear all inline field errors and remove .has-error classes.
 */
function clearFieldErrors() {
  const qErr = getQuantityError();
  const pErr = getPriceError();
  if (qErr) qErr.textContent = '';
  if (pErr) pErr.textContent = '';

  getQuantityInput()?.closest('.form-group')?.classList.remove('has-error');
  getPriceInput()?.closest('.form-group')?.classList.remove('has-error');
}

/**
 * Display validation errors next to their respective fields.
 * @param {string[]} errors
 */
function showFieldErrors(errors) {
  for (const msg of errors) {
    const lowerMsg = msg.toLowerCase();
    if (lowerMsg.includes('quantity')) {
      const el = getQuantityError();
      if (el) el.textContent = msg;
      getQuantityInput()?.closest('.form-group')?.classList.add('has-error');
    } else if (lowerMsg.includes('sell price') || lowerMsg.includes('price')) {
      const el = getPriceError();
      if (el) el.textContent = msg;
      getPriceInput()?.closest('.form-group')?.classList.add('has-error');
    }
  }
}

// ---------------------------------------------------------------------------
// Modal — Promise-based confirmation dialog
// ---------------------------------------------------------------------------

/**
 * Open the global confirmation modal and return a Promise that resolves to
 * true (confirmed) or false (cancelled).
 *
 * @param {string} title
 * @param {string} body
 * @returns {Promise<boolean>}
 */
function confirmModal(title, body) {
  return new Promise((resolve) => {
    const overlay = getModalOverlay();
    const titleEl = getModalTitle();
    const bodyEl  = getModalBody();
    const cancelBtn  = getModalCancel();
    const confirmBtn = getModalConfirm();

    if (!overlay) {
      // Fallback: use browser confirm if modal DOM is missing
      resolve(window.confirm(`${title}\n\n${body}`));
      return;
    }

    if (titleEl) titleEl.textContent = title;
    if (bodyEl)  bodyEl.textContent  = body;

    overlay.classList.add('open');
    overlay.removeAttribute('aria-hidden');

    /** @type {(() => void) | null} */
    let cleanup = null;

    const onConfirm = () => {
      cleanup?.();
      resolve(true);
    };

    const onCancel = () => {
      cleanup?.();
      resolve(false);
    };

    cleanup = () => {
      overlay.classList.remove('open');
      overlay.setAttribute('aria-hidden', 'true');
      confirmBtn?.removeEventListener('click', onConfirm);
      cancelBtn?.removeEventListener('click', onCancel);
    };

    confirmBtn?.addEventListener('click', onConfirm, { once: true });
    cancelBtn?.addEventListener('click', onCancel, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/**
 * Populate the product dropdown with the given products array.
 * Preserves the placeholder option at index 0.
 *
 * @param {Array<{id: string, name: string}>} products
 */
function renderProductOptions(products) {
  const select = getProductSelect();
  if (!select) return;

  // Remove all options except the placeholder
  while (select.options.length > 1) select.remove(1);

  for (const product of products) {
    const opt = document.createElement('option');
    opt.value = product.id;
    opt.textContent = product.name;
    select.appendChild(opt);
  }
}

/**
 * Populate the variant dropdown with the given variants array.
 * Resets to placeholder and disables if no variants are provided.
 *
 * @param {Array<{id: string, attributes: object}>} variants
 */
function renderVariantOptions(variants) {
  const select = getVariantSelect();
  if (!select) return;

  while (select.options.length > 1) select.remove(1);

  if (!variants.length) {
    select.disabled = true;
    return;
  }

  select.disabled = false;
  for (const variant of variants) {
    const opt = document.createElement('option');
    opt.value = variant.id;
    opt.textContent = formatAttributes(variant.attributes);
    select.appendChild(opt);
  }
}

/**
 * Render the sales history table for the given sale records.
 *
 * @param {Array<{id: string, quantity: number, sell_price: string, sold_at: string}>} sales
 */
function renderHistory(sales) {
  const container = getHistoryEl();
  if (!container) return;

  if (!sales.length) {
    container.innerHTML = '<p class="text-muted">No sales recorded for this variant yet.</p>';
    return;
  }

  const table = document.createElement('table');
  table.setAttribute('aria-label', 'Sales history');

  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th scope="col">Date</th>
      <th scope="col">Qty Sold</th>
      <th scope="col">Sell Price per Unit</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const sale of sales) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${formatDate(sale.sold_at)}</td>
      <td>${sale.quantity}</td>
      <td>${parseFloat(sale.sell_price).toFixed(2)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.innerHTML = '';
  container.appendChild(table);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Sales Recording view.
 *
 * Safe to call multiple times — event listeners are cleaned up and
 * re-attached on each call (idempotent).
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.3
 */
export async function init() {
  setErrorBanner(null);
  clearFieldErrors();

  // ---- Default date to today ----
  const dateInput = getDateInput();
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // ---- Load products into dropdown ----
  let products = [];
  try {
    products = await getProducts();
    renderProductOptions(products);
  } catch (err) {
    setErrorBanner(`Failed to load products: ${err.message}`);
    return;
  }

  // Reset variant dropdown to its initial disabled state
  renderVariantOptions([]);

  // Reset history area
  const historyEl = getHistoryEl();
  if (historyEl) {
    historyEl.innerHTML = '<p class="text-muted">Select a product and variant to see history.</p>';
  }

  // ---- Cascading dropdown: product → variant ----
  const productSelect = getProductSelect();
  const variantSelect = getVariantSelect();

  if (productSelect) {
    if (_productChangeHandler) {
      productSelect.removeEventListener('change', _productChangeHandler);
    }

    _productChangeHandler = async () => {
      const productId = productSelect.value;

      // Reset variant dropdown and history
      renderVariantOptions([]);
      if (historyEl) {
        historyEl.innerHTML = '<p class="text-muted">Select a variant to see history.</p>';
      }

      if (!productId) return;

      try {
        const variants = await getVariantsByProduct(productId);
        renderVariantOptions(variants);
      } catch (err) {
        setErrorBanner(`Failed to load variants: ${err.message}`);
      }
    };

    productSelect.addEventListener('change', _productChangeHandler);
  }

  // ---- Variant change → load history ----
  if (variantSelect) {
    if (_variantChangeHandler) {
      variantSelect.removeEventListener('change', _variantChangeHandler);
    }

    _variantChangeHandler = async () => {
      const variantId = variantSelect.value;

      if (!variantId) {
        if (historyEl) {
          historyEl.innerHTML = '<p class="text-muted">Select a variant to see history.</p>';
        }
        return;
      }

      try {
        const sales = await getSalesByVariant(variantId);
        renderHistory(sales);
      } catch (err) {
        if (historyEl) {
          historyEl.innerHTML = `<p class="text-muted">Failed to load history: ${err.message}</p>`;
        }
      }
    };

    variantSelect.addEventListener('change', _variantChangeHandler);
  }

  // ---- Form submission ----
  const form = getForm();
  if (form) {
    if (_submitHandler) {
      form.removeEventListener('submit', _submitHandler);
    }

    _submitHandler = async (/** @type {SubmitEvent} */ e) => {
      e.preventDefault();
      clearFieldErrors();
      setErrorBanner(null);

      const variantId = variantSelect?.value ?? '';
      if (!variantId) {
        setErrorBanner('Please select a product and variant first.');
        return;
      }

      // ---- Parse inputs ----
      const quantityRaw = getQuantityInput()?.value ?? '';
      const priceRaw    = getPriceInput()?.value ?? '';
      const soldAt      = getDateInput()?.value ?? '';

      const quantity  = parseInt(quantityRaw, 10);
      const sellPrice = parseFloat(priceRaw);

      // ---- Validate ----
      const { valid, errors } = validateSaleRecord({ quantity, sellPrice });
      if (!valid) {
        showFieldErrors(errors);
        return;
      }

      if (!soldAt) {
        setErrorBanner('Please provide a date for this sale.');
        return;
      }

      // ---- Compute projected remaining stock (Req 5.6) ----
      let projected = null;
      try {
        const [purchases, existingSales, corrections] = await Promise.all([
          getPurchasesByVariant(variantId),
          getSalesByVariant(variantId),
          getCorrectionsByVariant(variantId),
        ]);
        const currentStock = computeRemainingStock(purchases, existingSales, corrections);
        projected = currentStock - quantity;
      } catch (err) {
        // Non-fatal: skip the warning check and proceed
        console.warn('[sales] Could not compute projected stock:', err.message);
      }

      // ---- Warn if projected stock goes below zero ----
      if (projected !== null && projected < 0) {
        const confirmed = await confirmModal(
          'Stock will go negative',
          `This sale will result in a remaining stock of ${projected}. Proceed?`
        );
        if (!confirmed) return;
      }

      // ---- Persist ----
      try {
        await createSaleRecord({ variantId, quantity, sellPrice, soldAt });
        showToast('Sale recorded', 'success');

        // Reset only the quantity, price, and date fields — keep dropdowns
        const qInput = getQuantityInput();
        const pInput = getPriceInput();
        const dInput = getDateInput();
        if (qInput) qInput.value = '';
        if (pInput) pInput.value = '';
        if (dInput) dInput.value = new Date().toISOString().slice(0, 10);

        // Re-render history for the currently selected variant
        try {
          const updatedSales = await getSalesByVariant(variantId);
          renderHistory(updatedSales);
        } catch {
          // History refresh failure is non-fatal
        }
      } catch (err) {
        showToast(err.message);
      }
    };

    form.addEventListener('submit', _submitHandler);
  }
}

export default init;
