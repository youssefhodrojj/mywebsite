/**
 * products.js — Products & Variants view
 *
 * Renders the full product catalog with nested variants, remaining stock,
 * add/edit/delete product forms, and add/edit variant forms.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 8.3, 8.5
 */

import {
  getProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  getVariantsByProduct,
  createVariant,
  updateVariant,
  getPurchasesByVariant,
  getSalesByVariant,
  getCorrectionsByVariant,
  getRefundsByVariant,
  getProductDeletionImpact,
  showToast,
} from '../db.js';

import { validateProductName, validateVariantAttributes } from '../validation.js';
import { computeRemainingStock, isLowStock } from '../stock.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const getView        = () => document.getElementById('view-products');
const getErrorBanner = () => document.getElementById('products-error');
const getAddForm     = () => /** @type {HTMLFormElement} */ (document.getElementById('form-add-product'));
const getNameInput   = () => /** @type {HTMLInputElement} */ (document.getElementById('product-name'));
const getDescInput   = () => /** @type {HTMLInputElement} */ (document.getElementById('product-description'));
const getNameError   = () => document.getElementById('product-name-error');
const getListEl      = () => document.getElementById('products-list');

// ---------------------------------------------------------------------------
// Error banner helpers
// ---------------------------------------------------------------------------

function showBanner(message) {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

function clearBanner() {
  const el = getErrorBanner();
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

// ---------------------------------------------------------------------------
// Field error helpers
// ---------------------------------------------------------------------------

/**
 * Show an inline field error and add has-error class to the parent .form-group.
 * @param {HTMLElement|null} errorEl
 * @param {string} message
 */
function showFieldError(errorEl, message) {
  if (!errorEl) return;
  errorEl.textContent = message;
  const group = errorEl.closest('.form-group');
  if (group) group.classList.add('has-error');
}

/**
 * Clear an inline field error.
 * @param {HTMLElement|null} errorEl
 */
function clearFieldError(errorEl) {
  if (!errorEl) return;
  errorEl.textContent = '';
  const group = errorEl.closest('.form-group');
  if (group) group.classList.remove('has-error');
}

// ---------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------

/**
 * Render a human-readable string from an attributes object.
 * E.g. { size: 'M', color: 'red' } → 'size: M, color: red'
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
 * Read key-value attribute pairs from a container element.
 * Pairs are stored in .attr-pair elements with two <input> children.
 * Returns a plain object or null if any key is blank.
 *
 * @param {HTMLElement} container
 * @returns {{ [key: string]: string } | null}
 */
function readAttributePairs(container) {
  const pairs = container.querySelectorAll('.attr-pair');
  if (pairs.length === 0) return null;

  const result = {};
  for (const pair of pairs) {
    const inputs = pair.querySelectorAll('input');
    const key   = (inputs[0]?.value ?? '').trim();
    const value = (inputs[1]?.value ?? '').trim();
    if (!key) return null;          // key required
    result[key] = value;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Attribute pair row builder (DOM, no innerHTML)
// ---------------------------------------------------------------------------

/**
 * Build and return an .attr-pair row with two inputs and a remove button.
 *
 * @param {string} [keyVal='']   — pre-filled key
 * @param {string} [valueVal=''] — pre-filled value
 * @returns {HTMLDivElement}
 */
function buildAttrPairRow(keyVal = '', valueVal = '') {
  const row = document.createElement('div');
  row.className = 'attr-pair';

  const keyInput = document.createElement('input');
  keyInput.type        = 'text';
  keyInput.placeholder = 'Attribute (e.g. size)';
  keyInput.value       = keyVal;
  keyInput.setAttribute('aria-label', 'Attribute key');

  const valInput = document.createElement('input');
  valInput.type        = 'text';
  valInput.placeholder = 'Value (e.g. M)';
  valInput.value       = valueVal;
  valInput.setAttribute('aria-label', 'Attribute value');

  const removeBtn = document.createElement('button');
  removeBtn.type      = 'button';
  removeBtn.className = 'btn-remove-attr';
  removeBtn.setAttribute('aria-label', 'Remove attribute');
  removeBtn.textContent = '×';
  removeBtn.addEventListener('click', () => {
    const siblings = row.parentElement?.querySelectorAll('.attr-pair');
    if (siblings && siblings.length > 1) {
      row.remove();
    }
    // Keep at least one row
  });

  row.appendChild(keyInput);
  row.appendChild(valInput);
  row.appendChild(removeBtn);
  return row;
}

// ---------------------------------------------------------------------------
// Variant stock fetching
// ---------------------------------------------------------------------------

/**
 * Fetch all stock-relevant records for a variant and compute remaining stock.
 *
 * @param {string} variantId
 * @returns {Promise<number>}
 */
async function fetchVariantStock(variantId) {
  const [purchases, sales, corrections, refunds] = await Promise.all([
    getPurchasesByVariant(variantId),
    getSalesByVariant(variantId),
    getCorrectionsByVariant(variantId),
    getRefundsByVariant(variantId),
  ]);
  return computeRemainingStock(purchases, sales, corrections, refunds);
}

// ---------------------------------------------------------------------------
// Product card rendering
// ---------------------------------------------------------------------------

/**
 * Build the HTML string for the variants table inside a product card.
 *
 * @param {Array<{ id: string, attributes: object }>} variants
 * @param {Map<string, number>} stockMap  — variantId → remaining stock
 * @returns {string}
 */
function buildVariantsTableHTML(variants, stockMap) {
  if (variants.length === 0) {
    return '<p class="text-muted" style="font-size:0.85rem; margin:0.5rem 0;">No variants yet.</p>';
  }

  const rows = variants.map((v) => {
    const stock    = stockMap.get(v.id) ?? 0;
    const lowStock = isLowStock(stock);
    const rowClass = lowStock ? 'row--low-stock' : '';
    const icon     = lowStock ? '<span class="stock-icon" aria-hidden="true"></span>' : '';
    const attrs    = formatAttributes(v.attributes);
    return `
      <tr class="${rowClass}" data-variant-id="${v.id}">
        <td>${escapeHtml(attrs)}</td>
        <td>${icon}${stock}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm btn-edit-variant" data-variant-id="${v.id}">Edit</button>
        </td>
      </tr>`;
  }).join('');

  return `
    <div style="overflow-x:auto; -webkit-overflow-scrolling:touch; margin-top:0.5rem;">
      <table style="width:100%; min-width:360px; border-collapse:collapse; font-size:0.88rem;">
        <thead>
          <tr style="background:var(--color-bg);">
            <th style="text-align:left; padding:0.4rem 0.75rem; font-size:0.75rem; font-weight:600; text-transform:uppercase; color:var(--color-text-muted); border-bottom:1px solid var(--color-border);">Attributes</th>
            <th style="text-align:left; padding:0.4rem 0.75rem; font-size:0.75rem; font-weight:600; text-transform:uppercase; color:var(--color-text-muted); border-bottom:1px solid var(--color-border); white-space:nowrap;">Stock</th>
            <th style="width:64px; border-bottom:1px solid var(--color-border);"></th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </div>`;
}

/**
 * Basic HTML escape to prevent XSS when interpolating user data.
 *
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---------------------------------------------------------------------------
// Inline edit product form (DOM-built for accessibility)
// ---------------------------------------------------------------------------

/**
 * Build and inject an inline edit-product form directly after the product
 * heading row.  Replaces any existing inline form for the same product.
 *
 * @param {HTMLElement} productCard  — the .product-card element
 * @param {{ id: string, name: string, description: string|null }} product
 * @param {() => void} onSaved  — callback to re-render everything
 */
function showEditProductForm(productCard, product, onSaved) {
  // Remove any existing inline edit form in this card
  productCard.querySelector('.inline-edit-product')?.remove();

  const wrapper = document.createElement('div');
  wrapper.className = 'inline-edit-product card';
  wrapper.style.cssText = 'margin-top:0.75rem; background:var(--color-bg); border:1px dashed var(--color-border);';

  const heading = document.createElement('p');
  heading.style.cssText = 'font-weight:600; margin-bottom:0.75rem;';
  heading.textContent = 'Edit product';

  const formRow = document.createElement('div');
  formRow.className = 'form-row';

  // Name field
  const nameGroup = document.createElement('div');
  nameGroup.className = 'form-group';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Product name';
  const nameInput = document.createElement('input');
  nameInput.type  = 'text';
  nameInput.value = product.name;
  nameInput.required = true;
  const nameErr = document.createElement('span');
  nameErr.className = 'field-error';
  nameGroup.append(nameLabel, nameInput, nameErr);

  // Description field
  const descGroup = document.createElement('div');
  descGroup.className = 'form-group';
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  const descInput = document.createElement('input');
  descInput.type  = 'text';
  descInput.value = product.description ?? '';
  descGroup.append(descLabel, descInput);

  formRow.append(nameGroup, descGroup);

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:0.5rem; margin-top:0.5rem;';

  const saveBtn = document.createElement('button');
  saveBtn.type      = 'button';
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type      = 'button';
  cancelBtn.className = 'btn btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';

  btnRow.append(saveBtn, cancelBtn);
  wrapper.append(heading, formRow, btnRow);
  productCard.appendChild(wrapper);

  // Wire cancel
  cancelBtn.addEventListener('click', () => wrapper.remove());

  // Wire save
  saveBtn.addEventListener('click', async () => {
    const newName = nameInput.value.trim();
    const newDesc = descInput.value.trim();

    // Clear prior error
    nameErr.textContent = '';
    nameGroup.classList.remove('has-error');

    if (!newName) {
      nameErr.textContent = 'Product name must be a non-empty string.';
      nameGroup.classList.add('has-error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await updateProduct(product.id, { name: newName, description: newDesc || null });
      showToast('Product updated', 'success');
      onSaved();
    } catch (/** @type {any} */ err) {
      showToast(err.message ?? 'Failed to update product');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// ---------------------------------------------------------------------------
// Inline edit variant form
// ---------------------------------------------------------------------------

/**
 * Build and inject an inline edit-variant form directly in the variant row.
 *
 * @param {HTMLTableRowElement} variantRow
 * @param {{ id: string, attributes: object }} variant
 * @param {Array<object>} existingAttributesList  — other variants' attributes
 * @param {() => void} onSaved
 */
function showEditVariantForm(variantRow, variant, existingAttributesList, onSaved) {
  // Remove any existing inline edit form after this row
  variantRow.nextElementSibling?.classList.contains('inline-edit-variant-row') &&
    variantRow.nextElementSibling.remove();

  const editRow = document.createElement('tr');
  editRow.className = 'inline-edit-variant-row';

  const td = document.createElement('td');
  td.colSpan = 3;
  td.style.cssText = 'padding:0.75rem; background:var(--color-bg);';

  const wrapper = document.createElement('div');

  // Attribute pairs container
  const pairsContainer = document.createElement('div');
  pairsContainer.className = 'attr-pairs';

  // Populate with current attributes
  const currentEntries = Object.entries(variant.attributes);
  if (currentEntries.length === 0) {
    pairsContainer.appendChild(buildAttrPairRow());
  } else {
    currentEntries.forEach(([k, v]) => {
      pairsContainer.appendChild(buildAttrPairRow(k, String(v)));
    });
  }

  // Add pair button
  const addPairBtn = document.createElement('button');
  addPairBtn.type      = 'button';
  addPairBtn.className = 'btn btn-secondary btn-sm';
  addPairBtn.style.marginTop = '0.4rem';
  addPairBtn.textContent = '+ Add attribute';
  addPairBtn.addEventListener('click', () => {
    pairsContainer.appendChild(buildAttrPairRow());
  });

  // Error span
  const errorSpan = document.createElement('span');
  errorSpan.style.cssText = 'color:var(--color-danger); font-size:0.8rem; display:block; margin-top:0.4rem;';

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex; gap:0.5rem; margin-top:0.5rem;';

  const saveBtn = document.createElement('button');
  saveBtn.type      = 'button';
  saveBtn.className = 'btn btn-primary btn-sm';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type      = 'button';
  cancelBtn.className = 'btn btn-secondary btn-sm';
  cancelBtn.textContent = 'Cancel';

  btnRow.append(saveBtn, cancelBtn);
  wrapper.append(pairsContainer, addPairBtn, errorSpan, btnRow);
  td.appendChild(wrapper);
  editRow.appendChild(td);
  variantRow.insertAdjacentElement('afterend', editRow);

  // Wire cancel
  cancelBtn.addEventListener('click', () => editRow.remove());

  // Wire save
  saveBtn.addEventListener('click', async () => {
    errorSpan.textContent = '';

    const attrs = readAttributePairs(pairsContainer);
    if (attrs === null) {
      errorSpan.textContent = 'Each attribute must have a non-empty key.';
      return;
    }

    // Validate against other variants (exclude self)
    const { valid, errors } = validateVariantAttributes(attrs, existingAttributesList);
    if (!valid) {
      errorSpan.textContent = errors[0] ?? 'Invalid attributes.';
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      await updateVariant(variant.id, { attributes: attrs });
      showToast('Variant updated', 'success');
      onSaved();
    } catch (/** @type {any} */ err) {
      showToast(err.message ?? 'Failed to update variant');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  });
}

// ---------------------------------------------------------------------------
// Add-variant form builder
// ---------------------------------------------------------------------------

/**
 * Build the "Add Variant" form card for a product and append it to the
 * product card element.
 *
 * @param {HTMLElement} productCard
 * @param {string} productId
 * @param {Array<object>} existingAttributesList  — existing variants' attributes
 * @param {() => void} onSaved
 */
function buildAddVariantForm(productCard, productId, existingAttributesList, onSaved) {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:1rem; border-top:1px solid var(--color-border); padding-top:1rem;';

  const heading = document.createElement('p');
  heading.style.cssText = 'font-weight:600; font-size:0.9rem; margin-bottom:0.5rem;';
  heading.textContent = 'Add Variant';

  // Attribute pairs container
  const pairsContainer = document.createElement('div');
  pairsContainer.className = 'attr-pairs';
  pairsContainer.appendChild(buildAttrPairRow());

  // Add pair button
  const addPairBtn = document.createElement('button');
  addPairBtn.type      = 'button';
  addPairBtn.className = 'btn btn-secondary btn-sm';
  addPairBtn.style.marginTop = '0.4rem';
  addPairBtn.textContent = '+ Add attribute';
  addPairBtn.addEventListener('click', () => {
    pairsContainer.appendChild(buildAttrPairRow());
  });

  // Error span
  const errorSpan = document.createElement('span');
  errorSpan.className = 'field-error';
  errorSpan.style.display = 'block';
  errorSpan.style.marginTop = '0.25rem';

  // Submit button
  const submitBtn = document.createElement('button');
  submitBtn.type      = 'button';
  submitBtn.className = 'btn btn-primary btn-sm';
  submitBtn.style.marginTop = '0.5rem';
  submitBtn.textContent = 'Add Variant';

  submitBtn.addEventListener('click', async () => {
    errorSpan.textContent = '';

    const attrs = readAttributePairs(pairsContainer);
    if (attrs === null) {
      errorSpan.textContent = 'Each attribute must have a non-empty key.';
      return;
    }

    const { valid, errors } = validateVariantAttributes(attrs, existingAttributesList);
    if (!valid) {
      errorSpan.textContent = errors[0] ?? 'Invalid attributes.';
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';
    try {
      await createVariant({ productId, attributes: attrs });
      showToast('Variant added', 'success');
      onSaved();
    } catch (/** @type {any} */ err) {
      showToast(err.message ?? 'Failed to create variant');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Add Variant';
    }
  });

  wrapper.append(heading, pairsContainer, addPairBtn, errorSpan, submitBtn);
  productCard.appendChild(wrapper);
}

// ---------------------------------------------------------------------------
// Main render function
// ---------------------------------------------------------------------------

/**
 * Fetch all data and re-render the products list.
 */
async function renderProductsList() {
  const listEl = getListEl();
  if (!listEl) return;

  listEl.innerHTML = '<p class="text-muted">Loading products…</p>';
  clearBanner();

  let products;
  try {
    products = await getProducts();
  } catch (/** @type {any} */ err) {
    listEl.innerHTML = '';
    showBanner(`Failed to load products: ${err.message}`);
    return;
  }

  if (products.length === 0) {
    listEl.innerHTML = '<p class="text-muted">No products yet. Use the form above to add your first product.</p>';
    return;
  }

  listEl.innerHTML = '';

  for (const product of products) {
    // Fetch variants
    let variants = [];
    try {
      variants = await getVariantsByProduct(product.id);
    } catch {
      // Non-fatal: show product without variants
    }

    // Fetch stock for each variant
    const stockMap = new Map();
    await Promise.all(
      variants.map(async (v) => {
        try {
          const stock = await fetchVariantStock(v.id);
          stockMap.set(v.id, stock);
        } catch {
          stockMap.set(v.id, 0);
        }
      })
    );

    // Build product card
    const card = document.createElement('div');
    card.className = 'card product-card';
    card.dataset.productId = product.id;

    // --- Product header ---
    const headerHTML = `
      <div class="product-header" style="display:flex; align-items:flex-start; gap:1rem; flex-wrap:wrap;">
        <div style="flex:1; min-width:0;">
          <h2 style="font-size:1.05rem; font-weight:700; margin:0;">${escapeHtml(product.name)}</h2>
          ${product.description ? `<p class="text-muted" style="font-size:0.85rem; margin:0.2rem 0 0;">${escapeHtml(product.description)}</p>` : ''}
        </div>
        <div style="display:flex; gap:0.5rem; flex-shrink:0;">
          <button type="button" class="btn btn-secondary btn-sm btn-edit-product" data-product-id="${product.id}">Edit</button>
          <button type="button" class="btn btn-danger btn-sm btn-delete-product" data-product-id="${product.id}" data-product-name="${escapeHtml(product.name)}">Delete</button>
        </div>
      </div>`;

    card.innerHTML = headerHTML;

    // --- Variants table (HTML) ---
    const variantsSection = document.createElement('div');
    variantsSection.style.marginTop = '1rem';
    variantsSection.innerHTML = buildVariantsTableHTML(variants, stockMap);
    card.appendChild(variantsSection);

    // --- Wire edit-variant buttons ---
    const existingAttributesList = variants.map((v) => v.attributes);
    variantsSection.querySelectorAll('.btn-edit-variant').forEach((btn) => {
      btn.addEventListener('click', () => {
        const variantId = /** @type {HTMLElement} */ (btn).dataset.variantId;
        const variant   = variants.find((v) => v.id === variantId);
        if (!variant) return;

        // Exclude this variant from duplicate check (editing self)
        const othersAttributes = variants
          .filter((v) => v.id !== variantId)
          .map((v) => v.attributes);

        const row = /** @type {HTMLTableRowElement} */ (btn.closest('tr'));
        if (row) showEditVariantForm(row, variant, othersAttributes, renderProductsList);
      });
    });

    // --- Add Variant form ---
    buildAddVariantForm(card, product.id, existingAttributesList, renderProductsList);

    // --- Wire Edit Product button ---
    card.querySelector('.btn-edit-product')?.addEventListener('click', () => {
      showEditProductForm(card, product, renderProductsList);
    });

    // --- Wire Delete Product button ---
    card.querySelector('.btn-delete-product')?.addEventListener('click', async () => {
      const productName = /** @type {HTMLElement} */ (
        card.querySelector('.btn-delete-product')
      )?.dataset.productName ?? product.name;

      // Show impact before confirming
      let impact = null;
      try {
        impact = await getProductDeletionImpact(product.id);
      } catch {
        // non-fatal -- continue with generic message
      }

      let msg = `WARNING: Permanently delete "${productName}"?\n\n`;
      if (impact) {
        msg += `This will also delete:\n`;
        msg += `  - ${impact.variantCount} variant(s)\n`;
        msg += `  - ${impact.purchaseCount} purchase record(s)\n`;
        msg += `  - ${impact.saleCount} sale record(s)\n`;
        msg += `  - ${impact.correctionCount} correction record(s)\n\n`;
      }
      msg += `This CANNOT be undone. Type the product name to confirm:`;

      const typed = prompt(msg);
      if (typed?.trim().toLowerCase() !== productName.trim().toLowerCase()) {
        if (typed !== null) {
          showToast('Product name did not match. Delete cancelled.');
        }
        return;
      }

      try {
        await deleteProduct(product.id);
        showToast(`Product "${productName}" deleted`, 'success');
        renderProductsList();
      } catch (/** @type {any} */ err) {
        showToast(err.message ?? 'Failed to delete product');
      }
    });

    listEl.appendChild(card);
  }
}

// ---------------------------------------------------------------------------
// Add Product form wiring
// ---------------------------------------------------------------------------

/** Track the current submit handler reference to prevent duplicate listeners. */
let _addProductHandler = null;

/**
 * Wire (or re-wire) the #form-add-product submit handler.
 * Uses a module-level reference so repeated init() calls don't stack up listeners.
 */
function wireAddProductForm() {
  const form = getAddForm();
  if (!form) return;

  if (_addProductHandler) {
    form.removeEventListener('submit', _addProductHandler);
  }

  _addProductHandler = async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();

    const nameInput  = getNameInput();
    const descInput  = getDescInput();
    const nameErrEl  = getNameError();

    const name = nameInput?.value.trim() ?? '';
    const desc = descInput?.value.trim() ?? '';

    // Clear previous field error
    clearFieldError(nameErrEl);

    // Gather existing product names for duplicate check
    let existingNames = [];
    try {
      const products = await getProducts();
      existingNames = products.map((p) => p.name);
    } catch {
      // If we can't fetch names, proceed and let the DB constraint handle it
    }

    const { valid, errors } = validateProductName(name, existingNames);
    if (!valid) {
      showFieldError(nameErrEl, errors[0] ?? 'Invalid product name.');
      return;
    }

    /** @type {HTMLButtonElement|null} */
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Saving…';
    }

    try {
      await createProduct({ name, description: desc || null });
      showToast(`Product "${name}" added`, 'success');
      if (nameInput) nameInput.value = '';
      if (descInput) descInput.value = '';
      clearFieldError(nameErrEl);
      await renderProductsList();
    } catch (/** @type {any} */ err) {
      showToast(err.message ?? 'Failed to create product');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add Product';
      }
    }
  };

  form.addEventListener('submit', _addProductHandler);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Products & Variants view.
 *
 * Safe to call multiple times — idempotent (re-wires form listeners and
 * re-renders the product list on each call).
 *
 * Requirements: 2.1–2.8, 8.3, 8.5
 */
export async function init() {
  const view = getView();
  if (!view) return;

  clearBanner();
  wireAddProductForm();
  await renderProductsList();
}

export default init;
