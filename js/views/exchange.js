/**
 * Exchange view — swap one variant for another.
 *
 * Stock effect:
 *   - out_variant stock decreases by quantity (customer returns it)
 *   - in_variant  stock decreases by quantity (we give them the new one)
 *
 * Sales records are NOT modified. An optional price_correction is recorded
 * (positive = customer pays more, negative = we refund the difference).
 *
 * HTML elements expected in index.html:
 *   #view-exchange
 *   #exchange-error
 *   #exchange-out-product, #exchange-out-variant
 *   #exchange-in-product,  #exchange-in-variant
 *   #exchange-quantity, #exchange-price-correction, #exchange-date, #exchange-note
 *   #form-add-exchange
 *   #exchange-history-body
 */

import { getProducts, getVariantsByProduct, showToast } from '../db.js';
import { supabaseClient } from '../supabase.js';

// ---------------------------------------------------------------------------
// DB helpers (local — not exported, exchange is self-contained)
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
// Populate product/variant dropdowns
// ---------------------------------------------------------------------------

async function populateProductSelect(selectEl) {
  selectEl.innerHTML = '<option value="">-- select product --</option>';
  const products = await getProducts();
  for (const p of products) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.name;
    selectEl.appendChild(opt);
  }
  return products;
}

async function populateVariantSelect(selectEl, productId) {
  selectEl.innerHTML = '<option value="">-- select variant --</option>';
  if (!productId) return;
  const variants = await getVariantsByProduct(productId);
  for (const v of variants) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = formatAttrs(v.attributes);
    selectEl.appendChild(opt);
  }
}

// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------

async function loadHistory() {
  const tbody = document.getElementById('exchange-history-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="text-muted">Loading…</td></tr>';
  try {
    const rows = await getExchanges();
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No exchanges recorded.</td></tr>';
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

    // Wire delete buttons
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
    tbody.innerHTML = `<tr><td colspan="8" class="text-muted">Error: ${err.message}</td></tr>`;
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function init() {
  setError(null);

  const form  = document.getElementById('form-add-exchange');
  const dateEl = document.getElementById('exchange-date');
  if (!form) return;

  // Default date
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // Populate both product dropdowns in parallel
  try {
    await Promise.all([
      populateProductSelect(document.getElementById('exchange-out-product')),
      populateProductSelect(document.getElementById('exchange-in-product')),
    ]);
  } catch (err) {
    setError(`Could not load products: ${err.message}`);
  }

  // Wire out-product -> out-variant cascade
  // Use cloneNode only on the select that needs it; re-look up variant select by id at event time
  const outProd = document.getElementById('exchange-out-product');
  const freshOutProd = outProd.cloneNode(true);
  outProd.parentNode?.replaceChild(freshOutProd, outProd);
  await populateProductSelect(freshOutProd).catch(() => {});
  freshOutProd.addEventListener('change', () => {
    populateVariantSelect(document.getElementById('exchange-out-variant'), freshOutProd.value);
  });

  const inProd = document.getElementById('exchange-in-product');
  const freshInProd = inProd.cloneNode(true);
  inProd.parentNode?.replaceChild(freshInProd, inProd);
  await populateProductSelect(freshInProd).catch(() => {});
  freshInProd.addEventListener('change', () => {
    populateVariantSelect(document.getElementById('exchange-in-variant'), freshInProd.value);
  });

  // Wire form submit (idempotent)
  const freshForm = form.cloneNode(true);
  form.parentNode?.replaceChild(freshForm, form);

  freshForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    setError(null);

    const outVariantId = document.getElementById('exchange-out-variant')?.value;
    const inVariantId  = document.getElementById('exchange-in-variant')?.value;
    const quantity     = parseInt(document.getElementById('exchange-quantity')?.value, 10);
    const priceCorr    = parseFloat(document.getElementById('exchange-price-correction')?.value || '0');
    const exchangeDate = document.getElementById('exchange-date')?.value;
    const note         = document.getElementById('exchange-note')?.value?.trim();

    if (!outVariantId)              { setError('Please select the outgoing product variant.'); return; }
    if (!inVariantId)               { setError('Please select the incoming product variant.');  return; }
    if (outVariantId === inVariantId) { setError('Outgoing and incoming variants must be different.'); return; }
    if (!quantity || quantity < 1)  { setError('Quantity must be at least 1.'); return; }
    if (!exchangeDate)              { setError('Please select a date.'); return; }

    const submitBtn = freshForm.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving\u2026'; }

    try {
      await createExchange({ outVariantId, inVariantId, quantity, priceCorrection: isNaN(priceCorr) ? 0 : priceCorr, exchangeDate, note });
      showToast('Exchange recorded.', 'success');
      freshForm.reset();
      const d = document.getElementById('exchange-date');
      if (d) d.value = new Date().toISOString().slice(0, 10);
      // Re-populate products after reset
      await Promise.all([
        populateProductSelect(document.getElementById('exchange-out-product')),
        populateProductSelect(document.getElementById('exchange-in-product')),
      ]).catch(() => {});
      await loadHistory();
    } catch (err) {
      setError(`Failed to save: ${err.message}`);
    } finally {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Save Exchange'; }
    }
  });

  await loadHistory();
}

export default init;
