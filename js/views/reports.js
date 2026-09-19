/**
 * Reports view — generates a daily report and downloads it as a PDF.
 *
 * HTML elements expected:
 *   #view-reports, #reports-error
 *   #report-date      (date input)
 *   #btn-load-report  (button)
 *   #btn-download-pdf (button, starts disabled)
 *   #report-content   (container)
 *
 * jsPDF must be loaded as the UMD bundle so that window.jspdf.jsPDF is available.
 *
 * Safe to call multiple times — listeners are cleaned up and re-attached on
 * each call (idempotent).
 */

import { getSalesForDate, getPurchasesForDate, getRefundsForDate, showToast } from '../db.js';

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const getView        = () => document.getElementById('view-reports');
const getErrorBanner = () => document.getElementById('reports-error');
const getDateInput   = () => /** @type {HTMLInputElement}  */ (document.getElementById('report-date'));
const getBtnLoad     = () => /** @type {HTMLButtonElement} */ (document.getElementById('btn-load-report'));
const getBtnPDF      = () => /** @type {HTMLButtonElement} */ (document.getElementById('btn-download-pdf'));
const getReportContent = () => document.getElementById('report-content');

// ---------------------------------------------------------------------------
// Module-level state (populated after a successful load)
// ---------------------------------------------------------------------------

/** @type {{ date: string, sales: any[], purchases: any[], refunds: any[] } | null} */
let reportData = null;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Format a number to two decimal places.
 * @param {number} n
 * @returns {string}
 */
function fmt(n) {
  return Number(n).toFixed(2);
}

/**
 * Convert a variant attributes object into a human-readable string.
 * @param {Record<string, unknown>} attrs
 * @returns {string}
 */
function formatAttributes(attrs) {
  if (!attrs || typeof attrs !== 'object') return '—';
  const entries = Object.entries(attrs);
  if (!entries.length) return '—';
  return entries.map(([k, v]) => `${k}: ${v}`).join(', ');
}

/**
 * Format an ISO / date-only string to a locale-friendly display.
 * Uses UTC to avoid day-shift on date-only strings.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + (dateStr.length === 10 ? 'T00:00:00Z' : ''));
  return isNaN(d.getTime())
    ? dateStr
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Error banner
// ---------------------------------------------------------------------------

/**
 * Show or clear the error banner.
 * @param {string|null} message
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
// Report HTML rendering
// ---------------------------------------------------------------------------

/**
 * Build a <table class="history-table"> element from a column definition and rows.
 * @param {string[]} headers
 * @param {(row: any) => string[]} rowMapper — returns an array of cell text/HTML strings
 * @param {any[]} rows
 * @returns {HTMLTableElement}
 */
function buildTable(headers, rowMapper, rows) {
  const table = document.createElement('table');
  table.className = 'history-table';

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr>${headers.map(h => `<th scope="col">${h}</th>`).join('')}</tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  if (rows.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = headers.length;
    td.className = 'text-muted';
    td.textContent = 'No records.';
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    for (const row of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = rowMapper(row).map(cell => `<td>${cell}</td>`).join('');
      tbody.appendChild(tr);
    }
  }
  table.appendChild(tbody);
  return table;
}

/**
 * Render the full daily report into #report-content.
 * @param {string}  dateStr
 * @param {any[]}   sales
 * @param {any[]}   purchases
 * @param {any[]}   refunds
 */
function renderReport(dateStr, sales, purchases, refunds) {
  const container = getReportContent();
  if (!container) return;

  const totalRevenue = sales.reduce((s, r) => s + Number(r.quantity) * Number(r.sell_price), 0);
  const totalCost    = purchases.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price), 0);
  const totalRefunds = refunds.reduce((s, r) => s + Number(r.quantity) * Number(r.refund_price), 0);
  const net          = totalRevenue - totalCost - totalRefunds;

  // ---- Outer card ----
  const card = document.createElement('div');
  card.className = 'card';

  // Heading
  const h2 = document.createElement('h2');
  h2.textContent = `Daily Report — ${formatDate(dateStr)}`;
  card.appendChild(h2);

  // ---- Summary cards ----
  const summary = document.createElement('div');
  summary.style.cssText = 'display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;';

  const summaryItems = [
    { label: 'Sales Revenue',  value: fmt(totalRevenue), color: 'var(--color-success)'  },
    { label: 'Purchase Cost',  value: fmt(totalCost),    color: 'var(--color-primary)'  },
    { label: 'Refunds',        value: fmt(totalRefunds), color: 'var(--color-danger)'   },
    { label: 'Net',            value: fmt(net),           color: null                   },
  ];

  for (const item of summaryItems) {
    const sc = document.createElement('div');
    sc.className = 'card';
    sc.style.cssText = 'flex:1; min-width:120px; text-align:center;';
    sc.innerHTML = `
      <p style="font-size:0.75rem; text-transform:uppercase; color:var(--color-text-muted);">${item.label}</p>
      <p style="font-size:1.5rem; font-weight:700;${item.color ? ` color:${item.color};` : ''}">${item.value}</p>`;
    summary.appendChild(sc);
  }
  card.appendChild(summary);

  // ---- Sales table ----
  const salesHeading = document.createElement('h3');
  salesHeading.style.cssText = 'margin-bottom:0.5rem;';
  salesHeading.textContent = `Sales (${sales.length})`;
  card.appendChild(salesHeading);
  card.appendChild(buildTable(
    ['Product', 'Variant', 'Qty', 'Price/unit', 'Total'],
    s => [
      s.variants?.products?.name ?? '—',
      formatAttributes(s.variants?.attributes ?? {}),
      String(s.quantity),
      fmt(Number(s.sell_price)),
      fmt(Number(s.quantity) * Number(s.sell_price)),
    ],
    sales,
  ));

  // ---- Purchases table ----
  const purchasesHeading = document.createElement('h3');
  purchasesHeading.style.cssText = 'margin:1rem 0 0.5rem;';
  purchasesHeading.textContent = `Purchases (${purchases.length})`;
  card.appendChild(purchasesHeading);
  card.appendChild(buildTable(
    ['Product', 'Variant', 'Qty', 'Cost/unit', 'Total'],
    p => [
      p.variants?.products?.name ?? '—',
      formatAttributes(p.variants?.attributes ?? {}),
      String(p.quantity),
      fmt(Number(p.cost_price)),
      fmt(Number(p.quantity) * Number(p.cost_price)),
    ],
    purchases,
  ));

  // ---- Refunds table (always shown so the count is visible) ----
  const refundsHeading = document.createElement('h3');
  refundsHeading.style.cssText = 'margin:1rem 0 0.5rem;';
  refundsHeading.textContent = `Refunds (${refunds.length})`;
  card.appendChild(refundsHeading);
  card.appendChild(buildTable(
    ['Product', 'Variant', 'Qty', 'Refund Price', 'Reason'],
    r => [
      r.variants?.products?.name ?? '—',
      formatAttributes(r.variants?.attributes ?? {}),
      String(r.quantity),
      fmt(Number(r.refund_price)),
      r.reason ?? '—',
    ],
    refunds,
  ));

  container.innerHTML = '';
  container.appendChild(card);
}

// ---------------------------------------------------------------------------
// PDF generation
// ---------------------------------------------------------------------------

/**
 * Generate and download a PDF for the currently loaded report.
 */
function generatePDF() {
  if (!reportData) return;

  if (!window.jspdf?.jsPDF) {
    showToast('jsPDF is not available. Make sure the jsPDF CDN script is loaded.', 'error');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const { date: dateStr, sales: salesData, purchases: purchasesData, refunds: refundsData } = reportData;

  const totalRevenue = salesData.reduce((s, r)    => s + Number(r.quantity) * Number(r.sell_price),    0);
  const totalCost    = purchasesData.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price),   0);
  const totalRefunds = refundsData.reduce((s, r)  => s + Number(r.quantity) * Number(r.refund_price),  0);
  const net          = totalRevenue - totalCost - totalRefunds;

  // ---- Title ----
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Daily Report -- ' + dateStr, 14, 20);

  // ---- Summary ----
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.text('Date: '             + formatDate(dateStr), 14, 30);
  doc.text('Sales Revenue: '   + fmt(totalRevenue),    14, 38);
  doc.text('Purchase Cost: '   + fmt(totalCost),       14, 46);
  doc.text('Refunds: '         + fmt(totalRefunds),    14, 54);
  doc.text('Net: '             + fmt(net),              14, 62);

  let y = 75;

  // ---- Sales section ----
  if (salesData.length > 0) {
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Sales (' + salesData.length + ')', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    // Header row
    doc.text('Product', 14, y);
    doc.text('Variant',  65, y);
    doc.text('Qty',     120, y);
    doc.text('Price',   135, y);
    doc.text('Total',   165, y);
    y += 6;
    doc.line(14, y, 196, y);
    y += 4;
    for (const s of salesData) {
      if (y > 270) { doc.addPage(); y = 20; }
      const pname = s.variants?.products?.name ?? '';
      const vattr = formatAttributes(s.variants?.attributes ?? {});
      doc.text(pname.substring(0, 25),                                   14,  y);
      doc.text(vattr.substring(0, 25),                                    65,  y);
      doc.text(String(s.quantity),                                        120, y);
      doc.text(fmt(Number(s.sell_price)),                                 135, y);
      doc.text(fmt(Number(s.quantity) * Number(s.sell_price)),            165, y);
      y += 6;
    }
    y += 6;
  }

  // ---- Purchases section ----
  if (purchasesData.length > 0) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Purchases (' + purchasesData.length + ')', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Product', 14, y);
    doc.text('Variant',  65, y);
    doc.text('Qty',     120, y);
    doc.text('Cost',    135, y);
    doc.text('Total',   165, y);
    y += 6;
    doc.line(14, y, 196, y);
    y += 4;
    for (const p of purchasesData) {
      if (y > 270) { doc.addPage(); y = 20; }
      const pname = p.variants?.products?.name ?? '';
      const vattr = formatAttributes(p.variants?.attributes ?? {});
      doc.text(pname.substring(0, 25),                                    14,  y);
      doc.text(vattr.substring(0, 25),                                    65,  y);
      doc.text(String(p.quantity),                                        120, y);
      doc.text(fmt(Number(p.cost_price)),                                 135, y);
      doc.text(fmt(Number(p.quantity) * Number(p.cost_price)),            165, y);
      y += 6;
    }
    y += 6;
  }

  // ---- Refunds section ----
  if (refundsData.length > 0) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Refunds (' + refundsData.length + ')', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Product', 14,  y);
    doc.text('Variant',  65,  y);
    doc.text('Qty',     120,  y);
    doc.text('Price',   135,  y);
    doc.text('Reason',  165,  y);
    y += 6;
    doc.line(14, y, 196, y);
    y += 4;
    for (const r of refundsData) {
      if (y > 270) { doc.addPage(); y = 20; }
      const pname  = r.variants?.products?.name ?? '';
      const vattr  = formatAttributes(r.variants?.attributes ?? {});
      const reason = (r.reason ?? '—').substring(0, 20);
      doc.text(pname.substring(0, 25),              14,  y);
      doc.text(vattr.substring(0, 25),               65,  y);
      doc.text(String(r.quantity),                   120, y);
      doc.text(fmt(Number(r.refund_price)),           135, y);
      doc.text(reason,                               165, y);
      y += 6;
    }
  }

  doc.save('report-' + dateStr + '.pdf');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the Reports view.
 *
 * Safe to call multiple times — event listeners are cleaned up and
 * re-attached on each call (idempotent).
 */
export async function init() {
  setErrorBanner(null);

  // ---- Default date to today ----
  const dateInput = getDateInput();
  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().slice(0, 10);
  }

  // ---- Disable PDF button until a report has been loaded ----
  const btnPDF = getBtnPDF();
  if (btnPDF) btnPDF.disabled = true;

  // ---- Wire #btn-load-report (idempotent via clone-replace) ----
  const btnLoad = getBtnLoad();
  if (btnLoad) {
    const fresh = btnLoad.cloneNode(true);
    btnLoad.parentNode?.replaceChild(fresh, btnLoad);

    fresh.addEventListener('click', async () => {
      const date = getDateInput()?.value;
      if (!date) {
        showToast('Please select a date.', 'error');
        return;
      }

      setErrorBanner(null);
      fresh.disabled = true;
      fresh.textContent = 'Loading…';

      try {
        const [sales, purchases, refunds] = await Promise.all([
          getSalesForDate(date),
          getPurchasesForDate(date),
          getRefundsForDate(date),
        ]);

        reportData = { date, sales, purchases, refunds };
        renderReport(date, sales, purchases, refunds);

        const pdf = getBtnPDF();
        if (pdf) pdf.disabled = false;
      } catch (err) {
        setErrorBanner(`Failed to load report: ${err.message}`);
        showToast(`Failed to load report: ${err.message}`, 'error');
        reportData = null;
        const pdf = getBtnPDF();
        if (pdf) pdf.disabled = true;
      } finally {
        fresh.disabled = false;
        fresh.textContent = 'Load Report';
      }
    });
  }

  // ---- Wire #btn-download-pdf (idempotent via clone-replace) ----
  if (btnPDF) {
    const freshPDF = btnPDF.cloneNode(true);
    btnPDF.parentNode?.replaceChild(freshPDF, btnPDF);

    freshPDF.addEventListener('click', () => {
      generatePDF();
    });
  }
}
