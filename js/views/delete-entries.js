/**
 * Delete Entries view module.
 *
 * Allows searching for and deleting wrong sale or purchase entries.
 * Wires the #view-delete-entries section in index.html.
 *
 * Responsibilities:
 *   - Populate the #de-product dropdown with all products.
 *   - On search, fetch sales or purchases filtered by type, product and date range.
 *   - Render results in a table with a delete button per row.
 *   - Confirm before deletion; refresh results and show toast after.
 */

import {
  getProducts,
  getAllSales,
  getAllPurchases,
  deleteSaleRecord,
  deletePurchaseBatch,
  showToast,
} from '../db.js';

// ---------------------------------------------------------------------------
// DOM helpers — resolved lazily so init() is safe to call before paint
// ---------------------------------------------------------------------------

const getErrorBanner  = () => document.getElementById('delete-entries-error');
const getTypeSelect   = () => /** @type {HTMLSelectElement} */ (document.getElementById('de-type'));
const getProductSelect= () => /** @type {HTMLSelectElement} */ (document.getElementById('de-product'));
const getDateStart    = () => /** @type {HTMLInputElement}  */ (document.getElementById('de-date-start'));
const getDateEnd      = () => /** @type {HTMLInputElement}  */ (document.getElementById('de-date-end'));
const getSearchBtn    = () => document.getElementById('btn-de-search');
const getResultsEl    = () => document.getElementById('delete-entries-results');

// ---------------------------------------------------------------------------
// Module-level handler reference for idempotent init()
// ---------------------------------------------------------------------------

/** @type {((e: Event) => void) | null} */
let _searchHandler = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe insertion into HTML.
 * @param {unknown} value
 * @returns {string}
 */
function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a variant's attributes object as a human-readable string.
 * e.g. { size: 'M', color: 'red' } → "size: M, color: red"
 *
 * @param {object|null|undefined} attributes
 * @returns {string}
 */
function formatAttributes(attributes) {
  if (!attributes || typeof attributes !== 'object') return '—';
  const entries = Object.entries(attributes);
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}: ${value}`).join(', ');
}

/**
 * Format a date string (ISO or date-only) to a locale-friendly display.
 * @param {string|null|undefined} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  // Append time component for date-only strings to avoid timezone-shift issues
  const d = new Date(dateStr.length === 10 ? dateStr + 'T00:00:00Z' : dateStr);
  return isNaN(d.getTime())
    ? escapeHtml(dateStr)
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Show or hide the error banner.
 * @param {string|null} message — null clears the banner
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
 * Render a table of sale records with a delete button per row.
 * @param {Array<object>} records
 */
function renderSalesTable(records) {
  const container = getResultsEl();
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = '<p class="no-data">No entries found.</p>';
    return;
  }

  const rows = records.map(record => {
    const date      = formatDate(record.sold_at);
    const product   = escapeHtml(record.variants?.products?.name ?? '—');
    const variant   = escapeHtml(formatAttributes(record.variants?.attributes));
    const qty       = escapeHtml(record.quantity);
    const price     = Number(record.sell_price).toFixed(2);
    const total     = (Number(record.quantity) * Number(record.sell_price)).toFixed(2);
    const id        = escapeHtml(record.id);

    return `<tr>
      <td>${date}</td>
      <td>${product}</td>
      <td>${variant}</td>
      <td>${qty}</td>
      <td>${price}</td>
      <td>${total}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-id="${id}" data-action="delete-sale">
          Delete
        </button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Product</th>
          <th>Variant</th>
          <th>Qty</th>
          <th>Price/unit</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/**
 * Render a table of purchase batches with a delete button per row.
 * @param {Array<object>} records
 */
function renderPurchasesTable(records) {
  const container = getResultsEl();
  if (!container) return;

  if (!records || records.length === 0) {
    container.innerHTML = '<p class="no-data">No entries found.</p>';
    return;
  }

  const rows = records.map(record => {
    const date      = formatDate(record.purchased_at);
    const product   = escapeHtml(record.variants?.products?.name ?? '—');
    const variant   = escapeHtml(formatAttributes(record.variants?.attributes));
    const qty       = escapeHtml(record.quantity);
    const cost      = Number(record.cost_price).toFixed(2);
    const total     = (Number(record.quantity) * Number(record.cost_price)).toFixed(2);
    const id        = escapeHtml(record.id);

    return `<tr>
      <td>${date}</td>
      <td>${product}</td>
      <td>${variant}</td>
      <td>${qty}</td>
      <td>${cost}</td>
      <td>${total}</td>
      <td>
        <button class="btn btn-danger btn-sm" data-id="${id}" data-action="delete-purchase">
          Delete
        </button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <table class="history-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Product</th>
          <th>Variant</th>
          <th>Qty</th>
          <th>Cost/unit</th>
          <th>Total</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Read the current filter values and fetch/render matching records.
 * Returns the fetched records array (useful for callers that need to re-render).
 */
async function runSearch() {
  const type      = getTypeSelect()?.value ?? 'sales';
  const productId = getProductSelect()?.value || undefined;
  const startDate = getDateStart()?.value  || undefined;
  const endDate   = getDateEnd()?.value    || undefined;

  setErrorBanner(null);
  const container = getResultsEl();
  if (container) container.innerHTML = '';

  try {
    if (type === 'sales') {
      const records = await getAllSales({ startDate, endDate, productId });
      renderSalesTable(records);
    } else {
      const records = await getAllPurchases({ startDate, endDate, productId });
      renderPurchasesTable(records);
    }
  } catch (err) {
    setErrorBanner(`Failed to load entries: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Exported init — idempotent
// ---------------------------------------------------------------------------

export async function init() {
  // ── 1. Populate product dropdown ────────────────────────────────────────
  const productSelect = getProductSelect();
  if (productSelect) {
    productSelect.innerHTML = '<option value="">-- all products --</option>';
    try {
      const products = await getProducts();
      for (const p of products) {
        const opt = document.createElement('option');
        opt.value       = p.id;
        opt.textContent = p.name;
        productSelect.appendChild(opt);
      }
    } catch (err) {
      setErrorBanner(`Failed to load products: ${err.message}`);
    }
  }

  // ── 2. Wire search button (idempotent — remove old handler first) ────────
  const searchBtn = getSearchBtn();
  if (searchBtn) {
    if (_searchHandler) {
      searchBtn.removeEventListener('click', _searchHandler);
    }

    _searchHandler = async () => {
      await runSearch();
    };

    searchBtn.addEventListener('click', _searchHandler);
  }

  // ── 3. Wire delete buttons via event delegation on results container ─────
  const resultsEl = getResultsEl();
  if (resultsEl) {
    // Remove any previously attached delegated listener by replacing the node
    // clone trick isn't needed — instead we keep a single delegated handler
    // attached to the stable container; delegation naturally handles dynamic rows.
    if (!resultsEl.dataset.delegated) {
      resultsEl.dataset.delegated = 'true';

      resultsEl.addEventListener('click', async (e) => {
        const btn = /** @type {HTMLElement} */ (e.target).closest('button[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id     = btn.dataset.id;
        if (!id) return;

        if (action === 'delete-sale') {
          const confirmed = confirm('Delete this sale entry? This cannot be undone.');
          if (!confirmed) return;
          try {
            await deleteSaleRecord(id);
            showToast('Sale entry deleted.', 'success');
            await runSearch();
          } catch (err) {
            showToast(`Failed to delete sale: ${err.message}`, 'error');
          }
        } else if (action === 'delete-purchase') {
          const confirmed = confirm('Delete this purchase entry? This cannot be undone.');
          if (!confirmed) return;
          try {
            await deletePurchaseBatch(id);
            showToast('Purchase entry deleted.', 'success');
            await runSearch();
          } catch (err) {
            showToast(`Failed to delete purchase: ${err.message}`, 'error');
          }
        }
      });
    }
  }
}
