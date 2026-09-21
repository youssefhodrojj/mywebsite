/**
 * stock.js -- Pure computation helpers for remaining stock.
 * No imports, no side effects.
 */

/**
 * Compute the remaining stock for a variant.
 *
 * Formula:
 *   sum(purchases.quantity)
 *   - sum(sales.quantity)
 *   + sum(corrections.adjustment)
 *   + sum(refunds.quantity)   <-- refunds restore stock
 *
 * @param {Array<{quantity: number}>} purchases
 * @param {Array<{quantity: number}>} sales
 * @param {Array<{adjustment: number}>} corrections
 * @param {Array<{quantity: number}>} [refunds=[]]
 * @returns {number}
 */
export function computeRemainingStock(purchases, sales, corrections, refunds = []) {
  const totalPurchased   = purchases.reduce((s, p) => s + Number(p.quantity), 0);
  const totalSold        = sales.reduce((s, s2) => s + Number(s2.quantity), 0);
  const totalCorrections = corrections.reduce((s, c) => s + Number(c.adjustment), 0);
  const totalRefunded    = refunds.reduce((s, r) => s + Number(r.quantity), 0);
  return totalPurchased - totalSold + totalCorrections + totalRefunded;
}

/**
 * Returns true when remaining stock is at or below zero.
 * @param {number} remainingStock
 * @returns {boolean}
 */
export function isLowStock(remainingStock) {
  return remainingStock <= 0;
}
