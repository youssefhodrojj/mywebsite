// v2 -- units fix
/**
 * Dashboard view -- shows live all-time stats and this-month stats.
 */
import {
  getProducts,
  getVariantsByProduct,
  getPurchasesByVariant,
  getSalesByVariant,
  getCorrectionsByVariant,
  getMonthlySalesStats,
  getMonthlyPurchaseStats,
} from '../db.js';
import { computeRemainingStock, isLowStock } from '../stock.js';

export async function init() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  const now = new Date();
  const monthName = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  container.innerHTML = `
    <div class="card">
      <h2>Welcome back!</h2>
      <p class="text-muted">Loading your stock summary...</p>
    </div>`;

  const fmt = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  try {
    // Load all data in parallel
    const [products, monthlySales, monthlyPurchases] = await Promise.all([
      getProducts(),
      getMonthlySalesStats(),
      getMonthlyPurchaseStats(),
    ]);

    let totalVariants = 0;
    let lowStockCount = 0;
    let allTimePurchaseCost = 0;
    let allTimeSalesRevenue = 0;
    let allTimeUnitsSold = 0;

    for (const product of products) {
      const variants = await getVariantsByProduct(product.id);
      totalVariants += variants.length;

      for (const variant of variants) {
        const [purchases, sales, corrections] = await Promise.all([
          getPurchasesByVariant(variant.id),
          getSalesByVariant(variant.id),
          getCorrectionsByVariant(variant.id),
        ]);

        const remaining = computeRemainingStock(purchases, sales, corrections);
        if (isLowStock(remaining)) lowStockCount++;

        for (const p of purchases) {
          allTimePurchaseCost += Number(p.quantity) * Number(p.cost_price);
        }
        for (const s of sales) {
          allTimeSalesRevenue += Number(s.quantity) * Number(s.sell_price);
          allTimeUnitsSold += Number(s.quantity);
        }
      }
    }

    const allTimeProfit = allTimeSalesRevenue - allTimePurchaseCost;
    const allTimeProfitColor = allTimeProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const allTimeProfitSign = allTimeProfit >= 0 ? '+' : '';

    const monthProfit = monthlySales.revenue - monthlyPurchases.cost;
    const monthProfitColor = monthProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const monthProfitSign = monthProfit >= 0 ? '+' : '';

    container.innerHTML = `
      <div class="card">
        <h2>Welcome back!</h2>
        <p class="text-muted">Here is your business overview.</p>
      </div>

      <!-- Inventory stats -->
      <h2 class="view-title" style="font-size:1rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">Inventory</h2>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem; margin-bottom:1.5rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Products</p>
          <p style="font-size:2rem; font-weight:700;">${products.length}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Variants</p>
          <p style="font-size:2rem; font-weight:700;">${totalVariants}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Low / Out of Stock</p>
          <p style="font-size:2rem; font-weight:700; color:var(--color-danger);">${lowStockCount}</p>
        </div>
      </div>

      <!-- This month -->
      <h2 class="view-title" style="font-size:1rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">This Month -- ${monthName}</h2>
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
          <p style="font-size:1.5rem; font-weight:700; color:${monthProfitColor};">${monthProfitSign}${fmt(monthProfit)}</p>
        </div>
      </div>

      <!-- All time -->
      <h2 class="view-title" style="font-size:1rem; color:var(--color-text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.75rem;">All Time</h2>
      <div class="form-row" style="flex-wrap:wrap; gap:1rem;">
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Sold</p>
          <p style="font-size:2rem; font-weight:700;">${allTimeUnitsSold.toLocaleString()}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Total Revenue</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-success);">${fmt(allTimeSalesRevenue)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Total Cost</p>
          <p style="font-size:1.5rem; font-weight:700; color:var(--color-primary);">${fmt(allTimePurchaseCost)}</p>
        </div>
        <div class="card" style="flex:1; min-width:130px; text-align:center; margin-bottom:0;">
          <p class="text-muted" style="font-size:0.75rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Net Profit</p>
          <p style="font-size:1.5rem; font-weight:700; color:${allTimeProfitColor};">${allTimeProfitSign}${fmt(allTimeProfit)}</p>
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
