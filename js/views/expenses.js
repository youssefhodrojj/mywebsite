/**
 * Expenses view — record and manage business expenses.
 *
 * Two sub-tabs:
 *   1. Expenses     — record an expense (label + amount + note + date) + filterable history table
 *   2. Labels       — manage expense labels (add / delete)
 *
 * HTML elements expected in index.html:
 *   #view-expenses
 *   #expenses-error
 *   #btn-expenses-tab-list, #btn-expenses-tab-labels
 *   #expenses-tab-list, #expenses-tab-labels
 *   — Expenses tab:
 *     #expense-label-select, #expense-amount, #expense-note, #expense-date
 *     #form-add-expense
 *     #expense-filter-label, #expense-filter-date-start, #expense-filter-date-end
 *     #btn-expense-filter-apply
 *     #expense-history-body
 *   — Labels tab:
 *     #expense-label-name, #form-add-expense-label
 *     #expense-labels-list
 */

import { showToast } from '../db.js';
import { supabaseClient } from '../supabase.js';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getExpenseLabels() {
  const { data, error } = await supabaseClient
    .from('expense_labels')
    .select('id, name, created_at')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return data;
}

async function createExpenseLabel(name) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabaseClient
    .from('expense_labels')
    .insert({ user_id: userId, name })
    .select('id, name, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteExpenseLabel(id) {
  const { error } = await supabaseClient.from('expense_labels').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function getExpenses({ labelId, startDate, endDate } = {}) {
  let query = supabaseClient
    .from('expenses')
    .select(`id, amount, note, expense_date, created_at,
             expense_labels(id, name)`)
    .order('expense_date', { ascending: false })
    .order('created_at',   { ascending: false })
    .limit(200);

  if (labelId)   query = query.eq('label_id', labelId);
  if (startDate) query = query.gte('expense_date', startDate);
  if (endDate)   query = query.lte('expense_date', endDate);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

async function createExpense({ labelId, amount, note, expenseDate }) {
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) throw new Error('Not authenticated');
  const { data, error } = await supabaseClient
    .from('expenses')
    .insert({
      user_id:      userId,
      label_id:     labelId || null,
      amount,
      note:         note || null,
      expense_date: expenseDate,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

async function deleteExpense(id) {
  const { error } = await supabaseClient.from('expenses').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const getErrorBanner = () => document.getElementById('expenses-error');

function setError(msg) {
  const el = getErrorBanner();
  if (!el) return;
  if (msg) { el.textContent = msg; el.classList.add('visible'); }
  else      { el.textContent = ''; el.classList.remove('visible'); }
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d + (d.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function fmt(n) {
  return Number(n).toFixed(2);
}

// ---------------------------------------------------------------------------
// Sub-tab switching
// ---------------------------------------------------------------------------

function switchTab(active) {
  const tabs    = ['list', 'labels'];
  const btnList = document.getElementById('btn-expenses-tab-list');
  const btnLab  = document.getElementById('btn-expenses-tab-labels');
  tabs.forEach(t => {
    const panel = document.getElementById(`expenses-tab-${t}`);
    if (panel) panel.style.display = (t === active ? 'block' : 'none');
  });
  if (btnList) btnList.classList.toggle('btn-primary',   active === 'list');
  if (btnList) btnList.classList.toggle('btn-secondary', active !== 'list');
  if (btnLab)  btnLab.classList.toggle('btn-primary',    active === 'labels');
  if (btnLab)  btnLab.classList.toggle('btn-secondary',  active !== 'labels');
}

// ---------------------------------------------------------------------------
// Populate label dropdown in expense form
// ---------------------------------------------------------------------------

async function populateLabelSelect(labels) {
  const sel = document.getElementById('expense-label-select');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">-- select label --</option>';
  for (const l of labels) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    sel.appendChild(opt);
  }
  sel.value = current; // preserve selection if still valid

  // Also update the filter dropdown
  const filterSel = document.getElementById('expense-filter-label');
  if (filterSel) {
    const fc = filterSel.value;
    filterSel.innerHTML = '<option value="">-- all labels --</option>';
    for (const l of labels) {
      const opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name;
      filterSel.appendChild(opt);
    }
    filterSel.value = fc;
  }
}

// ---------------------------------------------------------------------------
// History table
// ---------------------------------------------------------------------------

async function loadHistory(filters = {}) {
  const tbody = document.getElementById('expense-history-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="text-muted">Loading…</td></tr>';
  try {
    const rows = await getExpenses(filters);
    if (rows.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No expenses found.</td></tr>';
      return;
    }
    let total = 0;
    tbody.innerHTML = '';
    for (const r of rows) {
      total += Number(r.amount);
      const labelName = r.expense_labels?.name ?? '—';
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${fmtDate(r.expense_date)}</td>
        <td>${labelName}</td>
        <td>${r.note ?? '—'}</td>
        <td style="text-align:right; color:var(--color-danger);">${fmt(r.amount)}</td>
        <td>
          <button class="btn btn-danger btn-sm" data-delete-expense="${r.id}" aria-label="Delete expense">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    }

    // Total row
    const totalTr = document.createElement('tr');
    totalTr.style.fontWeight = '700';
    totalTr.innerHTML = `
      <td colspan="3" style="text-align:right; padding-right:1rem;">Total</td>
      <td style="text-align:right; color:var(--color-danger);">${fmt(total)}</td>
      <td></td>`;
    tbody.appendChild(totalTr);

    // Wire delete buttons
    tbody.querySelectorAll('[data-delete-expense]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this expense? This cannot be undone.')) return;
        try {
          await deleteExpense(btn.dataset.deleteExpense);
          showToast('Expense deleted.', 'success');
          await loadHistory(currentFilters());
        } catch (err) {
          showToast(`Delete failed: ${err.message}`, 'error');
        }
      });
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-muted">Error: ${err.message}</td></tr>`;
  }
}

function currentFilters() {
  return {
    labelId:   document.getElementById('expense-filter-label')?.value   || undefined,
    startDate: document.getElementById('expense-filter-date-start')?.value || undefined,
    endDate:   document.getElementById('expense-filter-date-end')?.value   || undefined,
  };
}

// ---------------------------------------------------------------------------
// Labels management panel
// ---------------------------------------------------------------------------

async function loadLabelsList(labels) {
  const container = document.getElementById('expense-labels-list');
  if (!container) return;
  if (labels.length === 0) {
    container.innerHTML = '<p class="text-muted">No labels yet. Add one above.</p>';
    return;
  }
  container.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.5rem;';
  for (const l of labels) {
    const chip = document.createElement('span');
    chip.style.cssText = 'display:inline-flex; align-items:center; gap:0.4rem; background:var(--color-bg); border:1px solid var(--color-border); border-radius:999px; padding:0.25rem 0.75rem; font-size:0.875rem;';
    chip.innerHTML = `${l.name} <button data-delete-label="${l.id}" aria-label="Delete label ${l.name}" style="background:none;border:none;cursor:pointer;color:var(--color-danger);font-size:1rem;line-height:1;padding:0;">&times;</button>`;
    wrap.appendChild(chip);
  }
  container.appendChild(wrap);

  container.querySelectorAll('[data-delete-label]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm(`Delete label "${btn.closest('span').textContent.trim().replace('×','').trim()}"? Expenses using it will keep their data but lose the label link.`)) return;
      try {
        await deleteExpenseLabel(btn.dataset.deleteLabel);
        showToast('Label deleted.', 'success');
        const updated = await getExpenseLabels();
        await populateLabelSelect(updated);
        await loadLabelsList(updated);
      } catch (err) {
        showToast(`Delete failed: ${err.message}`, 'error');
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export async function init() {
  setError(null);

  const dateEl = document.getElementById('expense-date');
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }

  // Load labels
  let labels = [];
  try {
    labels = await getExpenseLabels();
    await populateLabelSelect(labels);
    await loadLabelsList(labels);
  } catch (err) {
    setError(`Could not load labels: ${err.message}`);
  }

  // Sub-tab buttons (idempotent via cloneNode)
  ['list','labels'].forEach(tab => {
    const btn = document.getElementById(`btn-expenses-tab-${tab}`);
    if (!btn) return;
    const fresh = btn.cloneNode(true);
    btn.parentNode?.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => switchTab(tab));
  });
  switchTab('list');

  // ---- Add label form ----
  const labelForm = document.getElementById('form-add-expense-label');
  if (labelForm) {
    const fresh = labelForm.cloneNode(true);
    labelForm.parentNode?.replaceChild(fresh, labelForm);
    fresh.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = document.getElementById('expense-label-name');
      const name = nameInput?.value?.trim();
      if (!name) { showToast('Label name cannot be empty.', 'error'); return; }
      const btn = fresh.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        await createExpenseLabel(name);
        showToast('Label added.', 'success');
        fresh.reset();
        const updated = await getExpenseLabels();
        await populateLabelSelect(updated);
        await loadLabelsList(updated);
      } catch (err) {
        showToast(`Failed: ${err.message}`, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Add Label'; }
      }
    });
  }

  // ---- Add expense form ----
  const expForm = document.getElementById('form-add-expense');
  if (expForm) {
    const fresh = expForm.cloneNode(true);
    expForm.parentNode?.replaceChild(fresh, expForm);
    // Re-populate label select after clone
    try {
      labels = await getExpenseLabels();
      await populateLabelSelect(labels);
    } catch (_) {}

    fresh.addEventListener('submit', async (e) => {
      e.preventDefault();
      const labelId    = document.getElementById('expense-label-select')?.value;
      const amount     = parseFloat(document.getElementById('expense-amount')?.value);
      const note       = document.getElementById('expense-note')?.value?.trim();
      const expenseDate = document.getElementById('expense-date')?.value;

      if (!labelId)                  { setError('Please select a label.'); return; }
      if (isNaN(amount) || amount <= 0) { setError('Amount must be greater than 0.'); return; }
      if (!expenseDate)              { setError('Please select a date.'); return; }
      setError(null);

      const btn = fresh.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }

      try {
        await createExpense({ labelId, amount, note, expenseDate });
        showToast('Expense recorded.', 'success');
        fresh.reset();
        document.getElementById('expense-date').value = new Date().toISOString().slice(0, 10);
        labels = await getExpenseLabels();
        await populateLabelSelect(labels);
        await loadHistory(currentFilters());
      } catch (err) {
        setError(`Failed to save: ${err.message}`);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Save Expense'; }
      }
    });
  }

  // ---- Filter ----
  const filterBtn = document.getElementById('btn-expense-filter-apply');
  if (filterBtn) {
    const fresh = filterBtn.cloneNode(true);
    filterBtn.parentNode?.replaceChild(fresh, filterBtn);
    fresh.addEventListener('click', () => loadHistory(currentFilters()));
  }

  await loadHistory();
}

export default init;
