/**
 * Login view module.
 *
 * Wires the login form (already rendered in index.html) to the auth module.
 * Handles form submission, loading state, success navigation, and error
 * display — without revealing which credential field was incorrect.
 *
 * Requirements: 1.1, 1.2, 1.3
 */

import { login } from '../auth.js';

// ---------------------------------------------------------------------------
// DOM element references (resolved lazily inside init so the module can be
// imported before the DOM is fully ready)
// ---------------------------------------------------------------------------

/** @returns {HTMLFormElement} */
const getForm     = () => /** @type {HTMLFormElement} */ (document.getElementById('form-login'));
const getEmail    = () => /** @type {HTMLInputElement} */ (document.getElementById('login-email'));
const getPassword = () => /** @type {HTMLInputElement} */ (document.getElementById('login-password'));
const getErrorEl  = () => document.getElementById('login-error');
const getSubmitBtn = () => /** @type {HTMLButtonElement} */ (document.getElementById('btn-login-submit'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Show the error banner with the given message.
 * @param {string} message
 */
function showError(message) {
  const el = getErrorEl();
  if (!el) return;
  el.textContent = message;
  el.classList.add('visible');
}

/**
 * Clear and hide the error banner.
 */
function clearError() {
  const el = getErrorEl();
  if (!el) return;
  el.textContent = '';
  el.classList.remove('visible');
}

/**
 * Put the submit button into a loading/disabled state.
 * @param {HTMLButtonElement} btn
 */
function setLoading(btn) {
  btn.disabled = true;
  btn.dataset.originalText = btn.textContent ?? 'Sign in';
  btn.textContent = 'Signing in…';
}

/**
 * Restore the submit button to its original state.
 * @param {HTMLButtonElement} btn
 */
function clearLoading(btn) {
  btn.disabled = false;
  btn.textContent = btn.dataset.originalText ?? 'Sign in';
}

// ---------------------------------------------------------------------------
// Submit handler (kept as a module-level variable so it can be removed and
// re-attached on repeated init() calls, preventing duplicate listeners)
// ---------------------------------------------------------------------------

/** @type {((e: SubmitEvent) => void) | null} */
let _submitHandler = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the login view.
 *
 * Safe to call multiple times — each call removes the previous event listener
 * before attaching a fresh one (idempotent).
 */
export async function init() {
  const form = getForm();
  if (!form) return;

  // Remove any previously attached handler to avoid duplicates
  if (_submitHandler) {
    form.removeEventListener('submit', _submitHandler);
  }

  // Clear any leftover error from a previous visit
  clearError();

  _submitHandler = async (/** @type {SubmitEvent} */ e) => {
    e.preventDefault();

    const email    = getEmail()?.value.trim() ?? '';
    const password = getPassword()?.value ?? '';
    const btn      = getSubmitBtn();

    // Clear previous errors on each new submission attempt
    clearError();

    if (btn) setLoading(btn);

    try {
      const { error } = await login(email, password);

      if (error) {
        // Display a generic message — never reveal which field is wrong (Req 1.3)
        showError('Invalid credentials. Please try again.');
      } else {
        // Success — navigate to the dashboard (Req 1.2)
        window.location.hash = '#/dashboard';
      }
    } catch {
      showError('Invalid credentials. Please try again.');
    } finally {
      if (btn) clearLoading(btn);
    }
  };

  form.addEventListener('submit', _submitHandler);
}

export default init;
