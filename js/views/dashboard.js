/**
 * Dashboard view — shows live stats and a quick summary.
 */
import {
  getProducts,
  getVariantsByProduct,
  getPurchasesByVariant,
  getSalesByVariant,
  getCorrectionsByVariant,
} from '../db.js';
import { computeRemainingStock, isLowStock } from '../stock.js';

export async function init() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  // Render skeleton first
  container.innerHTML = `
    <div class="card">
      <h2>Welcome back!</h2>
      <p class="text-muted">Loading your stock summary…</p>
    </div>`;

  try {
    const products = await getProducts();

    let totalVariants = 0;
    let lowStockCount = 0;
    let totalPurchaseCost = 0;
    let totalSalesRevenue = 0;
    let totalUnitsSold = 0;

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
          totalPurchaseCost += Number(p.quantity) * Number(p.cost_price);
        }
        for (const s of sales) {
          totalSalesRevenue += Number(s.quantity) * Number(s.sell_price);
          totalUnitsSold += Number(s.quantity);
        }
      }
    }

    const netProfit = totalSalesRevenue - totalPurchaseCost;
    const profitColor = netProfit >= 0 ? 'var(--color-success)' : 'var(--color-danger)';
    const profitSign = netProfit >= 0 ? '+' : '';

    const fmt = (n) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    container.innerHTML = `
      <div class="card">
        <h2>Welcome back!</h2>
        <p class="text-muted">Here's your stock overview.</p>
      </div>

      <div class="form-row" style="flex-wrap:wrap; gap:1rem;">

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Products</p>
          <p style="font-size:2rem; font-weight:700;">${products.length}</p>
        </div>

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Variants</p>
          <p style="font-size:2rem; font-weight:700;">${totalVariants}</p>
        </div>

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Low / Out of Stock</p>
          <p style="font-size:2rem; font-weight:700; color:var(--color-danger);">${lowStockCount}</p>
        </div>

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Units Sold</p>
          <p style="font-size:2rem; font-weight:700;">${totalUnitsSold.toLocaleString()}</p>
        </div>

      </div>

      <div class="form-row" style="flex-wrap:wrap; gap:1rem; margin-top:0;">

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Total Purchase Cost</p>
          <p style="font-size:1.6rem; font-weight:700; color:var(--color-primary);">${fmt(totalPurchaseCost)}</p>
        </div>

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Total Sales Revenue</p>
          <p style="font-size:1.6rem; font-weight:700; color:var(--color-success);">${fmt(totalSalesRevenue)}</p>
        </div>

        <div class="card" style="flex:1; min-width:150px; text-align:center;">
          <p class="text-muted" style="font-size:0.78rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Net Profit</p>
          <p style="font-size:1.6rem; font-weight:700; color:${profitColor};">${profitSign}${fmt(netProfit)}</p>
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
