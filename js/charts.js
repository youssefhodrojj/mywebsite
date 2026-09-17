/**
 * charts.js — Chart.js rendering helpers for Monthly Charts view.
 *
 * Relies on Chart.js being loaded as a UMD global (window.Chart) via
 * libs/chart.min.js. Does NOT import Chart.js as an ES module.
 *
 * A module-level Map tracks live Chart instances keyed by canvasId so
 * each canvas can be destroyed before a new chart is created, preventing
 * stale/overlapping charts.
 */

/** @type {Map<string, import('chart.js').Chart>} */
const _chartInstances = new Map();

// ── Shared colour tokens ────────────────────────────────────────────────────

const BLUE_BG     = 'rgba(37, 99, 235, 0.8)';
const BLUE_BORDER = 'rgba(37, 99, 235, 1)';
const ORANGE_BG     = 'rgba(234, 88, 12, 0.8)';
const ORANGE_BORDER = 'rgba(234, 88, 12, 1)';

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Destroy any existing Chart instance attached to `canvasId`.
 * @param {string} canvasId
 */
function _destroyExisting(canvasId) {
  const existing = _chartInstances.get(canvasId);
  if (existing) {
    existing.destroy();
    _chartInstances.delete(canvasId);
  }
}

/**
 * Build the shared Chart.js config object for a grouped bar chart.
 *
 * @param {string[]} labels        - X-axis tick labels (e.g. month strings)
 * @param {object[]} datasets      - Chart.js dataset descriptors
 * @param {string}   xAxisLabel    - Label for the x-axis
 * @param {string}   yAxisLabel    - Label for the y-axis
 * @returns {object}               - Full Chart.js configuration object
 */
function _buildBarConfig(labels, datasets, xAxisLabel, yAxisLabel) {
  return {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: xAxisLabel,
          },
        },
        y: {
          title: {
            display: true,
            text: yAxisLabel,
          },
          beginAtZero: true,
        },
      },
    },
  };
}

/**
 * Create a new Chart instance on the given canvas and store it.
 *
 * @param {string} canvasId  - `id` attribute of the target `<canvas>` element
 * @param {object} config    - Chart.js configuration object
 * @returns {object|null}    - The new Chart instance, or null on failure
 */
function _createChart(canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) {
    console.warn(`charts.js: canvas element with id "${canvasId}" not found.`);
    return null;
  }

  const chart = new window.Chart(canvas, config);
  _chartInstances.set(canvasId, chart);
  return chart;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Render (or re-render) a grouped bar chart showing units purchased vs. units
 * sold per month on the given canvas.
 *
 * Blue bars  → units purchased
 * Orange bars → units sold
 *
 * Any existing chart on `canvasId` is destroyed before the new one is created.
 *
 * @param {string}   canvasId      - `id` attribute of the target `<canvas>`
 * @param {string[]} labels        - Month labels for the x-axis (e.g. ['Jan 2024', 'Feb 2024'])
 * @param {number[]} purchasedData - Total units purchased per month
 * @param {number[]} soldData      - Total units sold per month
 * @returns {object|null}          - The Chart instance, or null if Chart.js is unavailable
 */
export function renderUnitsChart(canvasId, labels, purchasedData, soldData) {
  if (typeof window === 'undefined' || !window.Chart) {
    console.warn('charts.js: window.Chart is not defined. Make sure libs/chart.min.js is loaded before calling renderUnitsChart.');
    return null;
  }

  _destroyExisting(canvasId);

  const datasets = [
    {
      label: 'Units Purchased',
      data: purchasedData,
      backgroundColor: BLUE_BG,
      borderColor: BLUE_BORDER,
      borderWidth: 1,
    },
    {
      label: 'Units Sold',
      data: soldData,
      backgroundColor: ORANGE_BG,
      borderColor: ORANGE_BORDER,
      borderWidth: 1,
    },
  ];

  const config = _buildBarConfig(labels, datasets, 'Month', 'Units');
  return _createChart(canvasId, config);
}

/**
 * Render (or re-render) a grouped bar chart showing total purchase cost vs.
 * total sales revenue per month on the given canvas.
 *
 * Blue bars  → purchase cost
 * Orange bars → sales revenue
 *
 * Any existing chart on `canvasId` is destroyed before the new one is created.
 *
 * @param {string}   canvasId     - `id` attribute of the target `<canvas>`
 * @param {string[]} labels       - Month labels for the x-axis
 * @param {number[]} costData     - Total purchase cost per month
 * @param {number[]} revenueData  - Total sales revenue per month
 * @returns {object|null}         - The Chart instance, or null if Chart.js is unavailable
 */
export function renderMonetaryChart(canvasId, labels, costData, revenueData) {
  if (typeof window === 'undefined' || !window.Chart) {
    console.warn('charts.js: window.Chart is not defined. Make sure libs/chart.min.js is loaded before calling renderMonetaryChart.');
    return null;
  }

  _destroyExisting(canvasId);

  const datasets = [
    {
      label: 'Purchase Cost',
      data: costData,
      backgroundColor: BLUE_BG,
      borderColor: BLUE_BORDER,
      borderWidth: 1,
    },
    {
      label: 'Sales Revenue',
      data: revenueData,
      backgroundColor: ORANGE_BG,
      borderColor: ORANGE_BORDER,
      borderWidth: 1,
    },
  ];

  const config = _buildBarConfig(labels, datasets, 'Month', 'Amount');
  return _createChart(canvasId, config);
}
