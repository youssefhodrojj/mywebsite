/**
 * Dashboard view module.
 *
 * Renders a welcome screen with placeholder stat cards.
 * Will be expanded with real data once the db layer is complete.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the dashboard view.
 */
export async function init() {
  const container = document.getElementById('dashboard-content');
  if (!container) return;

  container.innerHTML = `
    <div class="card">
      <h2>Welcome back!</h2>
      <p class="text-muted">
        Use the navigation above to manage your products, record purchases and
        sales, adjust stock, and view monthly charts.
      </p>
    </div>

    <div class="form-row">
      <div class="card" style="flex:1; min-width:160px;">
        <p class="text-muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Products</p>
        <p style="font-size:1.75rem; font-weight:700;" id="dash-stat-products">—</p>
      </div>
      <div class="card" style="flex:1; min-width:160px;">
        <p class="text-muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Variants</p>
        <p style="font-size:1.75rem; font-weight:700;" id="dash-stat-variants">—</p>
      </div>
      <div class="card" style="flex:1; min-width:160px;">
        <p class="text-muted" style="font-size:0.8rem; text-transform:uppercase; letter-spacing:.05em; margin-bottom:.4rem;">Low-stock items</p>
        <p style="font-size:1.75rem; font-weight:700; color:var(--color-danger);" id="dash-stat-lowstock">—</p>
      </div>
    </div>
  `;
}

export default init;
