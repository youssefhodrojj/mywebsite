/**
 * stock.js — Pure computation helpers for remaining stock.
 * No imports, no side effects.
 */

/**
 * Compute the remaining stock for a variant.
 *
 * Formula: sum(purchases[i].quantity)
 *        - sum(sales[i].quantity)
 *        + sum(corrections[i].adjustment)
 *
 * @param {Array<{quantity: number}>} purchases   - Purchase batch records
 * @param {Array<{quantity: number}>} sales        - Sale records
 * @param {Array<{adjustment: number}>} corrections - Stock correction records
 * @returns {number} Remaining stock level
 */
export function computeRemainingStock(purchases, sales, corrections) {
  const totalPurchased   = purchases.reduce((sum, p) => sum + p.quantity, 0);
  const totalSold        = sales.reduce((sum, s) => sum + s.quantity, 0);
  const totalCorrections = corrections.reduce((sum, c) => sum + c.adjustment, 0);
  return totalPurchased - totalSold + totalCorrections;
}

/**
 * Returns true when remaining stock is at or below zero (depleted or negative).
 *
 * @param {number} remainingStock
 * @returns {boolean}
 */
export function isLowStock(remainingStock) {
  return remainingStock <= 0;
}
