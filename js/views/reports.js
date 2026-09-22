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

import { getSalesForDate, getPurchasesForDate, getRefundsForDate, getExpensesForDate, getExchangesForDate, showToast } from '../db.js';
import { supabaseClient } from '../supabase.js';

// Helper: get avg cost per unit for each variant (all-time, not just today)
async function getVariantAvgCosts() {
  try {
    const { data, error } = await supabaseClient
      .from('purchase_batches')
      .select('variant_id, quantity, cost_price');
    if (error || !data) { console.warn('[getVariantAvgCosts] error:', error); return {}; }
    // Build map: variantId -> avg cost per unit
    const totals = {};
    for (const r of data) {
      if (!totals[r.variant_id]) totals[r.variant_id] = { totalCost: 0, totalUnits: 0 };
      totals[r.variant_id].totalCost  += Number(r.quantity) * Number(r.cost_price);
      totals[r.variant_id].totalUnits += Number(r.quantity);
    }
    const avgCosts = {};
    for (const [vid, t] of Object.entries(totals)) {
      avgCosts[vid] = t.totalUnits > 0 ? t.totalCost / t.totalUnits : 0;
    }
    return avgCosts;
    // (end of getVariantAvgCosts)
  } catch (e) {
    console.warn('[getVariantAvgCosts] exception:', e); return {};
  }
}

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
 * @param {object}  variantAvgCosts  map of variantId -> avg cost per unit (all-time)
 */
function renderReport(dateStr, sales, purchases, refunds, variantAvgCosts = {}, expenses = [], exchanges = []) {
  const container = getReportContent();
  if (!container) return;

  const totalRevenue = sales.reduce((s, r) => s + Number(r.quantity) * Number(r.sell_price), 0);
  const totalCost    = purchases.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price), 0);
  const totalRefunds = refunds.reduce((s, r) => s + Number(r.quantity) * Number(r.refund_price), 0);
  const net          = totalRevenue - totalCost - totalRefunds - totalExpenses;
  const totalExpenses = expenses.reduce((s, r) => s + Number(r.amount), 0);

  // Gross Profit = (sell_price - avg_cost) x net_qty per variant
  // net_qty = qty_sold - qty_refunded so a full refund cancels the sale entirely
  // Uses ALL-TIME avg cost per variant, not today's purchase cost
  const refundedQty = {};
  for (const r of refunds) {
    refundedQty[r.variant_id] = (refundedQty[r.variant_id] ?? 0) + Number(r.quantity);
  }
  const grossProfit = sales.reduce((s, r) => {
    const vid     = r.variant_id;
    const avgCost = variantAvgCosts[vid] ?? 0;
    const netQty  = Number(r.quantity) - (refundedQty[vid] ?? 0);
    const contrib = (Number(r.sell_price) - avgCost) * Math.max(0, netQty);
    return s + contrib;
  }, 0) - totalExpenses;
  const grossProfitColor = grossProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';

  // ---- Outer card ----
  const card = document.createElement('div');
  card.className = 'card';

  // Heading
  const h2 = document.createElement('h2');
  h2.textContent = `Daily Report \u25c6 ${formatDate(dateStr)}`;
  card.appendChild(h2);

  // ---- Summary cards ----
  const summary = document.createElement('div');
  summary.style.cssText = 'display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1rem;';

  const summaryItems = [
    { label: 'Sales Revenue',  value: fmt(totalRevenue),   color: 'var(--color-success)'  },
    { label: 'Purchase Cost',  value: fmt(totalCost),      color: 'var(--color-primary)'  },
    { label: 'Refunds',        value: fmt(totalRefunds),   color: 'var(--color-danger)'   },
    { label: 'Expenses',       value: fmt(totalExpenses),  color: 'var(--color-warning)'  },
    { label: 'Net',            value: fmt(net),             color: null                   },
    { label: 'Gross Profit',   value: fmt(grossProfit),    color: grossProfitColor        },
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

  // ---- Expenses table ----
  const expensesHeading = document.createElement('h3');
  expensesHeading.style.cssText = 'margin:1rem 0 0.5rem;';
  expensesHeading.textContent = `Expenses (${expenses.length})`;
  card.appendChild(expensesHeading);
  card.appendChild(buildTable(
    ['Label', 'Note', 'Amount'],
    r => [
      r.expense_labels?.name ?? '—',
      r.note ?? '—',
      fmt(Number(r.amount)),
    ],
    expenses,
  ));

  // ---- Exchanges table ----
  const exchangesHeading = document.createElement('h3');
  exchangesHeading.style.cssText = 'margin:1rem 0 0.5rem;';
  exchangesHeading.textContent = `Exchanges (${exchanges.length})`;
  card.appendChild(exchangesHeading);
  card.appendChild(buildTable(
    ['Out product', 'Out variant', 'In product', 'In variant', 'Qty', 'Price correction', 'Note'],
    r => [
      r.out_variant?.products?.name ?? '—',
      formatAttributes(r.out_variant?.attributes ?? {}),
      r.in_variant?.products?.name ?? '—',
      formatAttributes(r.in_variant?.attributes ?? {}),
      String(r.quantity),
      fmt(Number(r.price_correction)),
      r.note ?? '—',
    ],
    exchanges,
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

  const { date: dateStr, sales: salesData, purchases: purchasesData, refunds: refundsData, variantAvgCosts: avgCosts = {}, expenses: expensesData = [], exchanges: exchangesData = [] } = reportData;

  const totalRevenue = salesData.reduce((s, r)    => s + Number(r.quantity) * Number(r.sell_price),    0);
  const totalCost    = purchasesData.reduce((s, r) => s + Number(r.quantity) * Number(r.cost_price),   0);
  const totalRefunds = refundsData.reduce((s, r)  => s + Number(r.quantity) * Number(r.refund_price),  0);
  const totalExpenses = expensesData.reduce((s, r) => s + Number(r.amount), 0);
  const net          = totalRevenue - totalCost - totalRefunds - totalExpenses;

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
  doc.text('Expenses: '        + fmt(totalExpenses),   14, 62);
  doc.text('Net: '             + fmt(net),              14, 70);
  const pdfRefundedQty = {};
  for (const r of refundsData) {
    pdfRefundedQty[r.variant_id] = (pdfRefundedQty[r.variant_id] ?? 0) + Number(r.quantity);
  }
  const gpPDF = salesData.reduce((s, r) => {
    const avgCost = avgCosts[r.variant_id] ?? 0;
    const netQty  = Number(r.quantity) - (pdfRefundedQty[r.variant_id] ?? 0);
    return s + (Number(r.sell_price) - avgCost) * Math.max(0, netQty);
  }, 0) - totalExpenses;
  doc.text('Gross Profit: '   + fmt(gpPDF),             14, 78);

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

  // ---- Expenses section ----
  if (expensesData.length > 0) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Expenses (' + expensesData.length + ')', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Label',  14,  y);
    doc.text('Note',   80,  y);
    doc.text('Amount', 165, y);
    y += 6;
    doc.line(14, y, 196, y);
    y += 4;
    for (const r of expensesData) {
      if (y > 270) { doc.addPage(); y = 20; }
      const lname = (r.expense_labels?.name ?? '—').substring(0, 30);
      const enote = (r.note ?? '—').substring(0, 30);
      doc.text(lname,                    14,  y);
      doc.text(enote,                    80,  y);
      doc.text(fmt(Number(r.amount)),    165, y);
      y += 6;
    }
    y += 6;
  }

  // ---- Exchanges section ----
  if (exchangesData.length > 0) {
    if (y > 250) { doc.addPage(); y = 20; }
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Exchanges (' + exchangesData.length + ')', 14, y);
    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Out',       14,  y);
    doc.text('In',        90,  y);
    doc.text('Qty',      150,  y);
    doc.text('Correction',165, y);
    y += 6;
    doc.line(14, y, 196, y);
    y += 4;
    for (const r of exchangesData) {
      if (y > 270) { doc.addPage(); y = 20; }
      const outName = ((r.out_variant?.products?.name ?? '') + ' ' + formatAttributes(r.out_variant?.attributes ?? {})).substring(0, 35);
      const inName  = ((r.in_variant?.products?.name  ?? '') + ' ' + formatAttributes(r.in_variant?.attributes  ?? {})).substring(0, 35);
      doc.text(outName,                        14,  y);
      doc.text(inName,                         90,  y);
      doc.text(String(r.quantity),             150, y);
      doc.text(fmt(Number(r.price_correction)),165, y);
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
        const [sales, purchases, refunds, variantAvgCosts, expenses, exchanges] = await Promise.all([
          getSalesForDate(date),
          getPurchasesForDate(date),
          getRefundsForDate(date),
          getVariantAvgCosts(),
          getExpensesForDate(date).catch(() => []),
          getExchangesForDate(date).catch(() => []),
        ]);

        reportData = { date, sales, purchases, refunds, variantAvgCosts, expenses, exchanges };
        renderReport(date, sales, purchases, refunds, variantAvgCosts, expenses, exchanges);

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
