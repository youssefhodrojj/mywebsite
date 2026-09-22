﻿/**
 * charts-view.js � Monthly Charts view with profit summary cards.
 */
import { getProducts, getMonthlyPurchaseSummary, getMonthlySalesSummary, getMonthlyExpenseSummary, getMonthlyPriceCorrectionSummary } from '../db.js?v=12';
import { renderUnitsChart, renderMonetaryChart, renderProfitChart } from '../charts.js?v=12';

const getErrorBanner     = () => document.getElementById('charts-error');
const getStartMonthInput = () => document.getElementById('chart-start-month');
const getEndMonthInput   = () => document.getElementById('chart-end-month');
const getProductFilter   = () => document.getElementById('chart-product-filter');
const getApplyButton     = () => document.getElementById('btn-apply-chart-filters');

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

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function subtractMonths(yyyyMm, n) {
  const [year, month] = yyyyMm.split('-').map(Number);
  const total = year * 12 + (month - 1) - n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function formatMonthLabel(isoDate) {
  const datePart = isoDate.slice(0, 7);
  const d = new Date(`${datePart}-01T00:00:00Z`);
  return isNaN(d.getTime()) ? datePart : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function fmt(n) {
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function aggregateByMonth(purchases, sales, expenses = [], priceCorrections = []) {
  const monthSet = new Set([
    ...purchases.map((r) => r.month.slice(0, 7)),
    ...sales.map((r) => r.month.slice(0, 7)),
    ...expenses.map((r) => r.month.slice(0, 7)),
    ...priceCorrections.map((r) => r.month.slice(0, 7)),
  ]);
  const sortedMonths = [...monthSet].sort();
  const buckets = new Map();
  for (const m of sortedMonths) {
    buckets.set(m, { purchasedUnits: 0, purchaseCosts: 0, soldUnits: 0, salesRevenue: 0, expenseTotal: 0, priceCorrection: 0 });
  }
  for (const row of purchases) {
    const b = buckets.get(row.month.slice(0, 7));
    if (b) { b.purchasedUnits += Number(row.total_units) || 0; b.purchaseCosts += Number(row.total_cost) || 0; }
  }
  for (const row of sales) {
    const b = buckets.get(row.month.slice(0, 7));
    if (b) { b.soldUnits += Number(row.total_units) || 0; b.salesRevenue += Number(row.total_revenue) || 0; }
  }
  for (const row of expenses) {
    const b = buckets.get(row.month.slice(0, 7));
    if (b) { b.expenseTotal += Number(row.total) || 0; }
  }
  for (const row of priceCorrections) {
    const b = buckets.get(row.month.slice(0, 7));
    if (b) { b.priceCorrection += Number(row.total) || 0; }
  }
  const labels = [], purchasedUnits = [], purchaseCosts = [], soldUnits = [], salesRevenue = [], netProfits = [], expenseTotals = [];
  for (const m of sortedMonths) {
    const b = buckets.get(m);
    labels.push(formatMonthLabel(`${m}-01T00:00:00Z`));
    purchasedUnits.push(b.purchasedUnits);
    purchaseCosts.push(b.purchaseCosts);
    soldUnits.push(b.soldUnits);
    salesRevenue.push(b.salesRevenue + b.priceCorrection);
    netProfits.push(b.salesRevenue + b.priceCorrection - b.purchaseCosts - b.expenseTotal);
    expenseTotals.push(b.expenseTotal);
  }
  return { labels, purchasedUnits, purchaseCosts, soldUnits, salesRevenue, netProfits, expenseTotals };
}

function updateSummaryCards(purchasedUnits, purchaseCosts, soldUnits, salesRevenue, expenseTotals = []) {
  const totalRevenue   = salesRevenue.reduce((s, v) => s + v, 0);
  const totalCost      = purchaseCosts.reduce((s, v) => s + v, 0);
  const totalExpenses  = expenseTotals.reduce((s, v) => s + v, 0);
  const netProfit      = totalRevenue - totalCost - totalExpenses;
  const totalSold      = soldUnits.reduce((s, v) => s + v, 0);
  const totalPurchased = purchasedUnits.reduce((s, v) => s + v, 0);

  // Gross profit = revenue - (avg cost per unit x units sold) - expenses
  const avgCost       = totalPurchased > 0 ? totalCost / totalPurchased : 0;
  const grossProfit   = totalRevenue - (avgCost * totalSold) - totalExpenses;

  const setEl = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setEl('summary-revenue',           fmt(totalRevenue));
  setEl('summary-cost',              fmt(totalCost));
  setEl('summary-units-sold',        totalSold.toLocaleString());
  setEl('summary-units-purchased',   totalPurchased.toLocaleString());
  setEl('summary-expenses',          fmt(totalExpenses));

  const profitEl = document.getElementById('summary-profit');
  if (profitEl) {
    profitEl.textContent = (netProfit >= 0 ? '+' : '') + fmt(netProfit);
    profitEl.style.color = netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  }

  const gpEl = document.getElementById('summary-gross-profit');
  if (gpEl) {
    gpEl.textContent = (grossProfit >= 0 ? '+' : '') + fmt(grossProfit);
    gpEl.style.color = grossProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
  }

  return {
    grossProfits: salesRevenue.map((r, i) => {
      const au = purchasedUnits[i] > 0 ? purchaseCosts[i] / purchasedUnits[i] : 0;
      return r - au * soldUnits[i] - (expenseTotals[i] ?? 0);
    }),
  };
}

async function fetchAndRender() {
  const startMonth = getStartMonthInput()?.value ?? '';
  const endMonth   = getEndMonthInput()?.value   ?? '';
  const productId  = getProductFilter()?.value   ?? '';

  if (!startMonth || !endMonth) { showBanner('Please select a start month and an end month.'); return; }
  if (startMonth > endMonth)    { showBanner('Start month must not be after end month.');      return; }

  clearBanner();

  try {
    const [purchaseRows, salesRows, expenseRows, correctionRows] = await Promise.all([
      getMonthlyPurchaseSummary({ startMonth, endMonth, productId: productId || undefined }),
      getMonthlySalesSummary({ startMonth, endMonth, productId: productId || undefined }),
      getMonthlyExpenseSummary({ startMonth, endMonth }).catch(() => []),
      getMonthlyPriceCorrectionSummary({ startMonth, endMonth }).catch(() => []),
    ]);

    const { labels, purchasedUnits, purchaseCosts, soldUnits, salesRevenue, netProfits, expenseTotals } =
      aggregateByMonth(purchaseRows, salesRows, expenseRows, correctionRows);

    const { grossProfits } = updateSummaryCards(purchasedUnits, purchaseCosts, soldUnits, salesRevenue, expenseTotals);
    renderUnitsChart('chart-units', labels, purchasedUnits, soldUnits);
    renderMonetaryChart('chart-monetary', labels, purchaseCosts, salesRevenue);
    renderProfitChart('chart-profit', labels, netProfits);
    renderProfitChart('chart-gross-profit', labels, grossProfits);
    renderProfitChart('chart-expenses', labels, expenseTotals);
  } catch (err) {
    showBanner(`Failed to load chart data: ${err.message}`);
  }
}

let _applyClickHandler = null;

export async function init() {
  clearBanner();

  const end   = currentMonth();
  const start = subtractMonths(end, 5);
  const startInput = getStartMonthInput();
  const endInput   = getEndMonthInput();
  if (startInput) startInput.value = start;
  if (endInput)   endInput.value   = end;

  const productFilter = getProductFilter();
  if (productFilter) {
    productFilter.innerHTML = '<option value="">-- all products --</option>';
    try {
      const products = await getProducts();
      for (const p of products) {
        const opt = document.createElement('option');
        opt.value = p.id; opt.textContent = p.name;
        productFilter.appendChild(opt);
      }
    } catch (err) {
      showBanner(`Could not load products: ${err.message}`);
    }
  }

  const applyBtn = getApplyButton();
  if (applyBtn) {
    if (_applyClickHandler) applyBtn.removeEventListener('click', _applyClickHandler);
    _applyClickHandler = () => fetchAndRender();
    applyBtn.addEventListener('click', _applyClickHandler);
  }

  await fetchAndRender();
}

export default init;
