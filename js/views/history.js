/**
 * history.js -- History & Backup view
 * Shows audit log and provides a JSON backup download.
 */
import { getAuditLog, exportAllData, showToast } from '../db.js';

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
    products: 'Product',
    variants: 'Variant',
    purchase_batches: 'Purchase',
    sale_records: 'Sale',
    stock_corrections: 'Correction',
    refunds: 'Refund',
  };
  return map[name] || name;
}

async function loadHistory() {
  const container = document.getElementById('history-log');
  if (!container) return;

  container.innerHTML = '<p class="text-muted">Loading...</p>';
  setErrorBanner(null);

  try {
    const entries = await getAuditLog({ limit: 100 });

    if (!entries.length) {
      container.innerHTML = '<p class="text-muted">No history yet. Actions will be logged here once you run the migration_v3.sql script in Supabase.</p>';
      return;
    }

    const rows = entries.map(e => `
      <tr>
        <td style="white-space:nowrap;">${formatDate(e.created_at)}</td>
        <td>${actionBadge(e.action)}</td>
        <td>${tableLabel(e.table_name)}</td>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--color-text-muted);">${(e.record_id ?? '').substring(0, 8)}...</td>
      </tr>
    `).join('');

    container.innerHTML = `
      <table class="history-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Action</th>
            <th>Type</th>
            <th>Record ID</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  } catch (err) {
    // Audit log table may not exist yet if migration_v3 hasn't been run
    container.innerHTML = `<p class="text-muted">History not available. Please run the migration_v3.sql script in Supabase SQL Editor first.<br><small style="color:var(--color-danger)">${err.message}</small></p>`;
  }
}

let _reloadHandler = null;
let _exportHandler = null;

export async function init() {
  setErrorBanner(null);

  // Wire reload button (idempotent)
  const reloadBtn = document.getElementById('btn-reload-history');
  if (reloadBtn) {
    if (_reloadHandler) reloadBtn.removeEventListener('click', _reloadHandler);
    _reloadHandler = () => loadHistory();
    reloadBtn.addEventListener('click', _reloadHandler);
  }

  // Wire export button (idempotent)
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

  // Load history on init
  await loadHistory();
}

export default init;
