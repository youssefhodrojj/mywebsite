/**
 * history.js -- History & Backup view
 * Shows audit log with meaningful descriptions and provides a JSON backup download.
 */
import { getAuditLog, exportAllData, showToast } from '../db.js?v=13';
import { supabaseClient } from '../supabase.js?v=13';

function setErrorBanner(message) {
  const el = document.getElementById('history-error');
  if (!el) return;
  if (message) { el.textContent = message; el.classList.add('visible'); }
  else         { el.textContent = ''; el.classList.remove('visible'); }
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? dateStr : d.toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function actionBadge(action) {
  if (action === 'INSERT') return '<span style="background:#dcfce7;color:#166534;padding:0.15rem 0.5rem;border-radius:999px;font-size:0.75rem;font-weight:600;">Created</span>';
  if (action === 'DELETE') return '<span style="background:#fef2f2;color:#991b1b;padding:0.15rem 0.5rem;border-radius:999px;font-size:0.75rem;font-weight:600;">Deleted</span>';
  return `<span style="background:#f1f5f9;color:#334155;padding:0.15rem 0.5rem;border-radius:999px;font-size:0.75rem;font-weight:600;">${action}</span>`;
}

function tableLabel(name) {
  const map = {
    products: 'Product', variants: 'Variant',
    purchase_batches: 'Purchase', sale_records: 'Sale',
    stock_corrections: 'Correction', refunds: 'Refund',
    exchanges: 'Exchange', expenses: 'Expense',
  };
  return map[name] || name;
}

function fmtAttrs(attrs) {
  if (!attrs || typeof attrs !== 'object') return '';
  return Object.entries(attrs).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function fmt(n) { return Number(n).toFixed(2); }

/**
 * Batch-fetch details for audit log entries so we can show meaningful descriptions.
 * Only INSERT entries with still-existing records will resolve to details.
 * DELETE entries will fall back to a generic description.
 */
async function fetchDetails(entries) {
  // Group record IDs by table for INSERT entries
  const byTable = {};
  for (const e of entries) {
    if (!e.record_id) continue;
    if (!byTable[e.table_name]) byTable[e.table_name] = [];
    byTable[e.table_name].push(e.record_id);
  }

  const detailMap = {}; // record_id → description string

  const fetches = [];

  // Sale records
  if (byTable.sale_records?.length) {
    fetches.push(
      supabaseClient.from('sale_records')
        .select('id, quantity, sell_price, sold_at, variants!inner(attributes, products!inner(name))')
        .in('id', byTable.sale_records)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const product = r.variants?.products?.name ?? '—';
            const variant = fmtAttrs(r.variants?.attributes ?? {});
            detailMap[r.id] = `${product}${variant ? ` (${variant})` : ''} × ${r.quantity} @ ${fmt(r.sell_price)}`;
          }
        }).catch(() => {})
    );
  }

  // Purchase batches
  if (byTable.purchase_batches?.length) {
    fetches.push(
      supabaseClient.from('purchase_batches')
        .select('id, quantity, cost_price, purchased_at, variants!inner(attributes, products!inner(name))')
        .in('id', byTable.purchase_batches)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const product = r.variants?.products?.name ?? '—';
            const variant = fmtAttrs(r.variants?.attributes ?? {});
            detailMap[r.id] = `${product}${variant ? ` (${variant})` : ''} × ${r.quantity} @ ${fmt(r.cost_price)}`;
          }
        }).catch(() => {})
    );
  }

  // Refunds
  if (byTable.refunds?.length) {
    fetches.push(
      supabaseClient.from('refunds')
        .select('id, quantity, refund_price, refunded_at, variants!inner(attributes, products!inner(name))')
        .in('id', byTable.refunds)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const product = r.variants?.products?.name ?? '—';
            const variant = fmtAttrs(r.variants?.attributes ?? {});
            detailMap[r.id] = `${product}${variant ? ` (${variant})` : ''} × ${r.quantity} @ ${fmt(r.refund_price)}`;
          }
        }).catch(() => {})
    );
  }

  // Stock corrections
  if (byTable.stock_corrections?.length) {
    fetches.push(
      supabaseClient.from('stock_corrections')
        .select('id, adjustment, cost_per_unit, corrected_at, variants!inner(attributes, products!inner(name))')
        .in('id', byTable.stock_corrections)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const product = r.variants?.products?.name ?? '—';
            const variant = fmtAttrs(r.variants?.attributes ?? {});
            const sign = Number(r.adjustment) > 0 ? '+' : '';
            detailMap[r.id] = `${product}${variant ? ` (${variant})` : ''} ${sign}${r.adjustment} units`;
          }
        }).catch(() => {})
    );
  }

  // Exchanges
  if (byTable.exchanges?.length) {
    fetches.push(
      supabaseClient.from('exchanges')
        .select(`id, quantity, price_correction,
          out_variant:out_variant_id(attributes, products!inner(name)),
          in_variant:in_variant_id(attributes, products!inner(name))`)
        .in('id', byTable.exchanges)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const outP = r.out_variant?.products?.name ?? '—';
            const outV = fmtAttrs(r.out_variant?.attributes ?? {});
            const inP  = r.in_variant?.products?.name  ?? '—';
            const inV  = fmtAttrs(r.in_variant?.attributes  ?? {});
            detailMap[r.id] = `${outP} (${outV}) → ${inP} (${inV}) × ${r.quantity}`;
          }
        }).catch(() => {})
    );
  }

  // Expenses
  if (byTable.expenses?.length) {
    fetches.push(
      supabaseClient.from('expenses')
        .select('id, amount, note, expense_labels(name)')
        .in('id', byTable.expenses)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const label = r.expense_labels?.name ?? '—';
            const note  = r.note ? ` — ${r.note}` : '';
            detailMap[r.id] = `${label}${note}: ${fmt(r.amount)}`;
          }
        }).catch(() => {})
    );
  }

  // Products
  if (byTable.products?.length) {
    fetches.push(
      supabaseClient.from('products')
        .select('id, name')
        .in('id', byTable.products)
        .then(({ data }) => {
          for (const r of data ?? []) detailMap[r.id] = r.name;
        }).catch(() => {})
    );
  }

  // Variants
  if (byTable.variants?.length) {
    fetches.push(
      supabaseClient.from('variants')
        .select('id, attributes, products!inner(name)')
        .in('id', byTable.variants)
        .then(({ data }) => {
          for (const r of data ?? []) {
            const product = r.products?.name ?? '—';
            const variant = fmtAttrs(r.attributes ?? {});
            detailMap[r.id] = `${product}${variant ? ` (${variant})` : ''}`;
          }
        }).catch(() => {})
    );
  }

  await Promise.all(fetches);
  return detailMap;
}

async function loadHistory() {
  const container = document.getElementById('history-log');
  if (!container) return;

  container.innerHTML = '<p class="text-muted">Loading...</p>';
  setErrorBanner(null);

  try {
    const entries = await getAuditLog({ limit: 100 });

    if (!entries.length) {
      container.innerHTML = '<p class="text-muted">No history yet.</p>';
      return;
    }

    // Fetch details for all entries in parallel batch queries
    const detailMap = await fetchDetails(entries);

    const rows = entries.map(e => {
      const detail  = detailMap[e.record_id];
      const typeLabel = tableLabel(e.table_name);
      let description;

      if (detail) {
        description = detail;
      } else if (e.action === 'DELETE') {
        description = `<span style="color:var(--color-text-muted);font-style:italic;">Record no longer in database</span>`;
      } else {
        description = `<span style="color:var(--color-text-muted);font-style:italic;">—</span>`;
      }

      return `
        <tr>
          <td style="white-space:nowrap;">${formatDate(e.created_at)}</td>
          <td>${actionBadge(e.action)}</td>
          <td><span style="font-weight:600;">${typeLabel}</span></td>
          <td>${description}</td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Type</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

  } catch (err) {
    container.innerHTML = `<p class="text-muted">History not available.<br><small style="color:var(--color-danger)">${err.message}</small></p>`;
  }
}

let _reloadHandler = null;
let _exportHandler = null;

export async function init() {
  setErrorBanner(null);

  const reloadBtn = document.getElementById('btn-reload-history');
  if (reloadBtn) {
    if (_reloadHandler) reloadBtn.removeEventListener('click', _reloadHandler);
    _reloadHandler = () => loadHistory();
    reloadBtn.addEventListener('click', _reloadHandler);
  }

  const exportBtn = document.getElementById('btn-export-json');
  if (exportBtn) {
    if (_exportHandler) exportBtn.removeEventListener('click', _exportHandler);
    _exportHandler = async () => {
      exportBtn.disabled = true;
      exportBtn.textContent = 'Exporting...';
      try {
        const data = await exportAllData();
        const json = JSON.stringify(data, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = `stockadmin-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Backup downloaded', 'success');
      } catch (err) {
        showToast(`Export failed: ${err.message}`);
      } finally {
        exportBtn.disabled = false;
        exportBtn.textContent = 'Download Backup (JSON)';
      }
    };
    exportBtn.addEventListener('click', _exportHandler);
  }

  await loadHistory();
}

export default init;
