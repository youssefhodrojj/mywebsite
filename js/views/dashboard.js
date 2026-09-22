// v7 -- safe defaults, refunds + corrections
/**
 * Dashboard view -- uses batch queries for speed instead of nested per-variant loops.
 */
import {
  getDashboardStats,
  getMonthlySalesStats,
  getMonthlyPurchaseStats,
  getMonthlyExpenses,
  getAllTimeExpenses,
} from '../db.js';

export async function init() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  const now = new Date();
  const monthName = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  container.innerHTML = `
    <div class="card">
      <h2>Welcome back!</h2>
      <p class="text-muted" id="dash-loading">Loading...</p>
    </div>`;

  const fmt = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  try {
    // All four are independent -- run in parallel
    const [stats, monthlySales, monthlyPurchases, monthlyExpenses, allTimeExpenses] = await Promise.all([
      getDashboardStats(),
      getMonthlySalesStats(),
      getMonthlyPurchaseStats(),
      getMonthlyExpenses().catch(() => 0),
      getAllTimeExpenses().catch(() => 0),
    ]);

    // Safe defaults in case db.js returns an older shape without new fields
    const safeStats = {
      totalProducts:      stats.totalProducts      ?? 0,
      totalVariants:      stats.totalVariants       ?? 0,
      lowStockCount:      stats.lowStockCount       ?? 0,
      totalUnitsSold:     stats.totalUnitsSold      ?? 0,
      totalUnitsInStock:  stats.totalUnitsInStock   ?? 0,
      totalSalesRevenue:  stats.totalSalesRevenue   ?? 0,
      totalPurchaseCost:  stats.totalPurchaseCost   ?? 0,
      totalGrossProfit:   stats.totalGrossProfit    ?? 0,
      avgCostPerUnit:     stats.avgCostPerUnit      ?? 0,
    };
    const allTimeProfit  = safeStats.totalSalesRevenue - safeStats.totalPurchaseCost;
    const monthProfit    = monthlySales.revenue    - monthlyPurchases.cost;

    // Monthly gross profit = monthly revenue - (avg cost per unit � units sold this month)
    const monthGrossProfit = monthlySales.revenue - (safeStats.avgCostPerUnit * monthlySales.units);
    // Expenses deducted from net/gross profit
    const safeMonthExpenses   = Number(monthlyExpenses)   || 0;
    const safeAllTimeExpenses = Number(allTimeExpenses) || 0;
    const monthNetAfterExp    = monthProfit - safeMonthExpenses;
    const monthGrossAfterExp  = monthGrossProfit - safeMonthExpenses;
    const allTimeNetAfterExp  = allTimeProfit - safeAllTimeExpenses;
    const allTimeGrossAfterExp = safeStats.totalGrossProfit - safeAllTimeExpenses;

    const profitColor  = (v) => v >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const profitSign   = (v) => v >= 0 ? '+' : '';

    container.innerHTML = `
      <div class="card">
        <h2>Welcome back!</h2>
        <p class="text-muted">Here is your business overview.</p>
      </div>

      <p style="font-size:0.8rem; text-transform:uppercase; color:var(--color-text-muted); letter-spacing:0.05em; margin-bottom:0.75rem;">Inventory</p>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem; margin-bottom:1.5rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Products</p>
          <p style="font-size:2rem; font-weight:700;">${safeStats.totalProducts}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Variants</p>
          <p style="font-size:2rem; font-weight:700;">${safeStats.totalVariants}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units in Stock</p>
          <p style="font-size:2rem; font-weight:700; color:${safeStats.totalUnitsInStock > 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${safeStats.totalUnitsInStock.toLocaleString()}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Low / Out of Stock</p>
          <p style="font-size:2rem; font-weight:700; color:var(--color-danger);">${safeStats.lowStockCount}</p>
        </div>
      </div>

      <p style="font-size:0.8rem; text-transform:uppercase; color:var(--color-text-muted); letter-spacing:0.05em; margin-bottom:0.75rem;">This Month -- ${monthName}</p>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem; margin-bottom:1.5rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Sold</p>
          <p style="font-size:2rem; font-weight:700;">${monthlySales.units}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Purchased</p>
          <p style="font-size:2rem; font-weight:700;">${monthlyPurchases.units}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Revenue</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-success);">${fmt(monthlySales.revenue)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Purchase Cost</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-primary);">${fmt(monthlyPurchases.cost)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Net Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${profitColor(monthProfit)};">${profitSign(monthProfit)}${fmt(monthProfit)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Gross Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${profitColor(monthGrossProfit)};" title="Revenue minus cost of units sold">${profitSign(monthGrossProfit)}${fmt(monthGrossProfit)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Expenses</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-danger);">${fmt(safeMonthExpenses)}</p>
        </div>
      </div>

      <p style="font-size:0.8rem; text-transform:uppercase; color:var(--color-text-muted); letter-spacing:0.05em; margin-bottom:0.75rem;">All Time</p>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Sold (net)</p>
          <p style="font-size:2rem; font-weight:700;">${safeStats.totalUnitsSold.toLocaleString()}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Revenue (net)</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-success);">${fmt(safeStats.totalSalesRevenue)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Cost (net)</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-primary);">${fmt(safeStats.totalPurchaseCost)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Net Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${profitColor(allTimeProfit)};">${profitSign(allTimeProfit)}${fmt(allTimeProfit)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Gross Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${profitColor(safeStats.totalGrossProfit)};" title="Revenue minus cost of units actually sold">${profitSign(safeStats.totalGrossProfit)}${fmt(safeStats.totalGrossProfit)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Expenses</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-danger);">${fmt(safeAllTimeExpenses)}</p>
        </div>
      </div>`;

  } catch (err) {
    container.innerHTML = `
      <div class="card">
        <h2>Welcome back!</h2>
        <p class="text-muted">Could not load stats: ${err.message}</p>
      </div>`;
  }
}

export default init;
