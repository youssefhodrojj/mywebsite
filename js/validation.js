/**
 * validation.js
 *
 * Pure validation functions with no side effects and no imports.
 * Each function returns { valid: boolean, errors: string[] }.
 *
 * Validates: Requirements 2.7, 2.8, 3.4, 3.5, 5.4, 5.5
 */

/**
 * Validates a purchase batch submission.
 * - quantity must be a positive integer (> 0, whole number)
 * - costPrice must be >= 0 (numeric)
 *
 * @param {{ quantity: any, costPrice: any }} params
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validatePurchaseBatch({ quantity, costPrice }) {
  const errors = [];

  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    errors.push('Quantity must be a positive whole number.');
  }

  if (typeof costPrice !== 'number' || isNaN(costPrice) || costPrice < 0) {
    errors.push('Cost price must be a number greater than or equal to zero.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a sale record submission.
 * - quantity must be a positive integer (> 0, whole number)
 * - sellPrice must be >= 0 (numeric)
 *
 * @param {{ quantity: any, sellPrice: any }} params
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSaleRecord({ quantity, sellPrice }) {
  const errors = [];

  if (
    typeof quantity !== 'number' ||
    !Number.isInteger(quantity) ||
    quantity <= 0
  ) {
    errors.push('Quantity must be a positive whole number.');
  }

  if (typeof sellPrice !== 'number' || isNaN(sellPrice) || sellPrice < 0) {
    errors.push('Sell price must be a number greater than or equal to zero.');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a stock correction submission.
 * - adjustment must be a non-zero integer (positive or negative, but not 0)
 *
 * @param {{ adjustment: any }} params
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateStockCorrection({ adjustment }) {
  const errors = [];

  if (
    typeof adjustment !== 'number' ||
    !Number.isInteger(adjustment) ||
    adjustment === 0
  ) {
    errors.push('Adjustment must be a non-zero integer (positive or negative).');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates a product name against a list of existing names.
 * - name must be a non-empty string after trimming
 * - name must not match any existing name (case-insensitive)
 *
 * @param {string} name
 * @param {string[]} existingNames
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateProductName(name, existingNames) {
  const errors = [];

  if (typeof name !== 'string' || name.trim().length === 0) {
    errors.push('Product name must be a non-empty string.');
  } else {
    const normalised = name.trim().toLowerCase();
    const isDuplicate = existingNames.some(
      (existing) => existing.trim().toLowerCase() === normalised
    );
    if (isDuplicate) {
      errors.push('A product with this name already exists.');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates variant attributes against a list of existing variants.
 * - attributes must be a non-empty plain object (at least one key-value pair)
 * - No existing variant may be deeply equal to attributes (all key-value pairs must match)
 *
 * @param {object} attributes
 * @param {object[]} existingVariants  Array of existing attributes objects to compare against
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateVariantAttributes(attributes, existingVariants) {
  const errors = [];

  if (
    attributes === null ||
    typeof attributes !== 'object' ||
    Array.isArray(attributes) ||
    Object.keys(attributes).length === 0
  ) {
    errors.push('Variant attributes must be a non-empty object with at least one key-value pair.');
    // Cannot check for duplicates without a valid attributes object
    return { valid: false, errors };
  }

  const isDuplicate = existingVariants.some((existing) =>
    _deepEqualObjects(attributes, existing)
  );

  if (isDuplicate) {
    errors.push('A variant with these attributes already exists for this product.');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deep-equality check for two plain objects (non-recursive beyond one level
 * is sufficient for flat attribute maps, but this handles nested objects too).
 *
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
function _deepEqualObjects(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (a === null || b === null) return a === b;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  return keysA.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && _deepEqualObjects(a[key], b[key])
  );
}
