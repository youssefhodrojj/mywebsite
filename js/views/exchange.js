/**
 * Exchange view — swap one variant for another.
 *
 * Stock effect:
 *   - out_variant stock increases  (customer returns it)
 *   - in_variant  stock decreases  (we give them the new one)
 *
 * Outgoing dropdown  — only variants that have been sold (can only exchange what was sold)
 * Incoming dropdown  — only variants with remaining stock > 0 (can only give what's available)
 *
 * Sales records are NOT modified. An optional price_correction is recorded
 * (positive = customer pays more, negative = we refund the difference).
 */

import { getSoldVariantsByProduct, getInStockVariantsByProduct, showToast } from '../db.js';
import { supabaseClient } from '../supabase.js';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getExchanges() {
  const { data, error } = await supabaseClient
    .from('exchanges')
    .select(`
      id, quantity, price_correction, exchange_date, note, created_at,
      out_variant:out_variant_id(
        id, attributes,
        products!inner(id, name)
      ),
      in_variant:in_variant_id(
        id, attributes,
        products!inner(id, name)
      )
    `)
    .order('exchange_date', { ascending: false })
    .order('created_at',    { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

async function createExchange({ outVariantId, inVariantId, quantity, priceCorrection, exchangeDate, note }) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');

  const { data, error } = await supabaseClient
    .from('exchanges')
    .insert({
      user_id:          userId,
      out_variant_id:   outVariantId,
      in_variant_id:    inVariantId,
      quantity,
      price_correction: priceCorrection ?? 0,
      exchange_date:    exchangeDate,
      note:             note || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteExchange(id) {
  const { error } = await supabaseClient.from('exchanges').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const getErrorBanner = () => document.getElementById('exchange-error');

function setError(msg) {
  const el = getErrorBanner();
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.add('visible'); }
  else      { el.textContent = ''; el.classList.remove('visible'); }
}

function formatAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '—';
  const e = Object.entries(attrs);
  return e.length ? e.map(([k, v]) => `${k}: ${v}`).join(', ') : '—';
}

function fmt(n) {
  const v = Number(n);
  return v === 0 ? '0.00' : (v > 0 ? '+' : '') + v.toFixed(2);
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Populate dropdowns using smart variant lists
// ---------------------------------------------------------------------------

/**
 * Populate a product select + wired variant select from a grouped list.
 * @param {HTMLSelectElement} productSel
 * @param {HTMLSelectElement} variantSel
 * @param {Array<{productId, productName, variants}>} groups
 */
function populateProductAndVariant(productSel, variantSel, groups) {
  // Populate product dropdown
  productSel.innerHTML = '<option value="">-- select product --</option>';
  for (const g of groups) {
    const opt = document.createElement('option');
    opt.value = g.productId;
    opt.textContent = g.productName;
    productSel.appendChild(opt);
  }

  // Wire change event: filter variant dropdown to selected product
  productSel.addEventListener('change', () => {
    const selectedGroup = groups.find(g => g.productId === productSel.value);
    variantSel.innerHTML = '<option value="">-- select variant --</option>';
    if (!selectedGroup) return;
    for (const v of selectedGroup.variants) {
      const opt = document.createElement('option');
      opt.value = v.id;
      const stockLabel = v.stock !== undefined ? ` (${v.stock} in stock)` : '';
      opt.textContent = formatAttrs(v.attributes) + stockLabel;
      variantSel.appendChild(opt);
    }
  });
}

// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------

async function loadHistory() {
  const tbody = document.getElementById('exchange-history-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="text-muted">Loading…</td></tr>';
  try {
    const rows = await getExchanges();
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-muted">No exchanges recorded.</td></tr>';
      return;
    }
    tbody.innerHTML = '';
    for (const r of rows) {
      const outProduct = r.out_variant?.products?.name ?? '—';
      const outVariant = formatAttrs(r.out_variant?.attributes ?? {});
      const inProduct  = r.in_variant?.products?.name  ?? '—';
      const inVariant  = formatAttrs(r.in_variant?.attributes  ?? {});
      const correction = Number(r.price_correction);
      const corrColor  = correction > 0 ? 'color:var(--color-success)' : correction < 0 ? 'color:var(--color-danger)' : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(r.exchange_date)}</td>
        <td>${outProduct}</td>
        <td>${outVariant}</td>
        <td>${inProduct}</td>
        <td>${inVariant}</td>
        <td style="text-align:center">${r.quantity}</td>
        <td style="${corrColor}">${fmt(correction)}</td>
        <td>${r.note ?? '—'}</td>
        <td>
          <button class="btn btn-danger btn-sm" data-delete-exchange="${r.id}" aria-label="Delete exchange">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    }

    tbody.querySelectorAll('[data-delete-exchange]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this exchange? This cannot be undone.')) return;
        try {
          await deleteExchange(btn.dataset.deleteExchange);
          showToast('Exchange deleted.', 'success');
          await loadHistory();
        } catch (err) {
          showToast(`Delete failed: ${err.message}`, 'error');
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-muted">Error: ${err.message}</td></tr>`;
  }
}

// Module-level submit handler reference for idempotent listener removal
let _submitHandler = null;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function init() {
  setError(null);

  const outProductSel = document.getElementById('exchange-out-product');
  const outVariantSel = document.getElementById('exchange-out-variant');
  const inProductSel  = document.getElementById('exchange-in-product');
  const inVariantSel  = document.getElementById('exchange-in-variant');
  const dateEl        = document.getElementById('exchange-date');
  const form          = document.getElementById('form-add-exchange');

  if (!form) return;

  // Default date
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // Load smart variant lists in parallel
  let soldGroups = [], stockGroups = [];
  try {
    [soldGroups, stockGroups] = await Promise.all([
      getSoldVariantsByProduct(),    // outgoing: must have been sold
      getInStockVariantsByProduct(), // incoming: must have stock > 0
    ]);
  } catch (err) {
    setError(`Could not load variants: ${err.message}`);
    return;
  }

  // Reset product selects by cloning just them (strips old change listeners, keeps form intact)
  function resetSelect(id) {
    const el = document.getElementById(id);
    if (!el) return el;
    const fresh = el.cloneNode(false); // cloneNode(false) = no children = clean empty select
    el.parentNode?.replaceChild(fresh, el);
    return fresh;
  }
  const freshOutProductSel = resetSelect('exchange-out-product');
  const freshOutVariantSel = resetSelect('exchange-out-variant');
  const freshInProductSel  = resetSelect('exchange-in-product');
  const freshInVariantSel  = resetSelect('exchange-in-variant');

  // Populate dropdowns — wire each product select to its variant select
  populateProductAndVariant(freshOutProductSel, freshOutVariantSel, soldGroups);
  populateProductAndVariant(freshInProductSel,  freshInVariantSel,  stockGroups);

  // Wire form submit — remove old listener first to stay idempotent
  if (_submitHandler) form.removeEventListener('submit', _submitHandler);

  _submitHandler = async (e) => {
    e.preventDefault();
    setError(null);

    const outVariantId = document.getElementById('exchange-out-variant')?.value;
    const inVariantId  = document.getElementById('exchange-in-variant')?.value;
    const quantity     = parseInt(document.getElementById('exchange-quantity')?.value, 10);
    const priceCorr    = parseFloat(document.getElementById('exchange-price-correction')?.value || '0');
    const exchangeDate = document.getElementById('exchange-date')?.value;
    const note         = document.getElementById('exchange-note')?.value?.trim();

    if (!outVariantId)                { setError('Please select the outgoing product variant.'); return; }
    if (!inVariantId)                 { setError('Please select the incoming product variant.');  return; }
    if (outVariantId === inVariantId) { setError('Outgoing and incoming variants must be different.'); return; }
    if (!quantity || quantity < 1)    { setError('Quantity must be at least 1.'); return; }
    if (!exchangeDate)                { setError('Please select a date.'); return; }

    // Check incoming stock covers the quantity
    const inGroup   = stockGroups.find(g => g.variants.some(v => v.id === inVariantId));
    const inVariant = inGroup?.variants.find(v => v.id === inVariantId);
    if (inVariant && inVariant.stock < quantity) {
      setError(`Not enough stock for the incoming variant. Available: ${inVariant.stock}`);
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving\u2026'; }

    try {
      await createExchange({ outVariantId, inVariantId, quantity, priceCorrection: isNaN(priceCorr) ? 0 : priceCorr, exchangeDate, note });
      showToast('Exchange recorded.', 'success');
      form.reset();
      const d = document.getElementById('exchange-date');
      if (d) d.value = new Date().toISOString().slice(0, 10);

      // Reload smart variant lists (stock has changed)
      [soldGroups, stockGroups] = await Promise.all([
        getSoldVariantsByProduct(),
        getInStockVariantsByProduct(),
      ]);
      populateProductAndVariant(document.getElementById('exchange-out-product'), document.getElementById('exchange-out-variant'), soldGroups);
      populateProductAndVariant(document.getElementById('exchange-in-product'),  document.getElementById('exchange-in-variant'),  stockGroups);

      await loadHistory();
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Exchange'; }
    }
  };

  form.addEventListener('submit', _submitHandler);

  await loadHistory();
}

export default init;
