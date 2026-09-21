// v3 -- fast batch queries
/**
 * Dashboard view -- uses batch queries for speed instead of nested per-variant loops.
 */
import {
  getDashboardStats,
  getMonthlySalesStats,
  getMonthlyPurchaseStats,
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
    // All three are independent -- run in parallel
    const [stats, monthlySales, monthlyPurchases] = await Promise.all([
      getDashboardStats(),
      getMonthlySalesStats(),
      getMonthlyPurchaseStats(),
    ]);

    const allTimeProfit  = stats.totalSalesRevenue - stats.totalPurchaseCost;
    const monthProfit    = monthlySales.revenue    - monthlyPurchases.cost;

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
          <p style="font-size:2rem; font-weight:700;">${stats.totalProducts}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Variants</p>
          <p style="font-size:2rem; font-weight:700;">${stats.totalVariants}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Low / Out of Stock</p>
          <p style="font-size:2rem; font-weight:700; color:var(--color-danger);">${stats.lowStockCount}</p>
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
      </div>

      <p style="font-size:0.8rem; text-transform:uppercase; color:var(--color-text-muted); letter-spacing:0.05em; margin-bottom:0.75rem;">All Time</p>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Sold (net)</p>
          <p style="font-size:2rem; font-weight:700;">${stats.totalUnitsSold.toLocaleString()}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units in Stock</p>
          <p style="font-size:2rem; font-weight:700; color:${stats.totalUnitsInStock > 0 ? 'var(--color-success)' : 'var(--color-danger)'};">${stats.totalUnitsInStock.toLocaleString()}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Revenue (net)</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-success);">${fmt(stats.totalSalesRevenue)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Cost (net)</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-primary);">${fmt(stats.totalPurchaseCost)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Net Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${profitColor(allTimeProfit)};">${profitSign(allTimeProfit)}${fmt(allTimeProfit)}</p>
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
