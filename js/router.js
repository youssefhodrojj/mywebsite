/**
 * Hash-based router for the Stock Management Admin Panel.
 *
 * Handles navigation between views, enforces the authentication guard
 * on all protected routes, and manages nav/logout visibility.
 *
 * Requirements: 1.6
 */

import { getSession, logout, onAuthStateChange } from './auth.js';

// ---------------------------------------------------------------------------
// Route → view-container and view-module mappings
// ---------------------------------------------------------------------------

/**
 * Maps each route fragment to the id of its view container element.
 * @type {Record<string, string>}
 */
const VIEW_IDS = {
  '/login':       'view-login',
  '/dashboard':   'view-dashboard',
  '/products':    'view-products',
  '/purchases':   'view-purchases',
  '/corrections': 'view-corrections',
  '/sales':       'view-sales',
  '/stock':       'view-stock',
  '/charts':      'view-charts',
};

/**
 * Maps each route fragment to a dynamic import of its view-init module.
 * Using dynamic import() means missing view files won't crash the router
 * at startup — failures are caught per-navigation.
 *
 * @type {Record<string, () => Promise<{ init: () => void | Promise<void> }>>}
 */
const ROUTES = {
  '/login':       () => import('./views/login.js'),
  '/dashboard':   () => import('./views/dashboard.js'),
  '/products':    () => import('./views/products.js'),
  '/purchases':   () => import('./views/purchases.js'),
  '/corrections': () => import('./views/corrections.js'),
  '/sales':       () => import('./views/sales.js'),
  '/stock':       () => import('./views/stock-view.js'),
  '/charts':      () => import('./views/charts-view.js'),
};

/** All routes that require an authenticated session. */
const PROTECTED_ROUTES = new Set(
  Object.keys(ROUTES).filter((r) => r !== '/login')
);

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

/** @type {HTMLElement[]} */
const allViewEls = () =>
  Object.values(VIEW_IDS)
    .map((id) => document.getElementById(id))
    .filter(Boolean);

/**
 * Show only the view container for the given route; hide all others.
 * @param {string} route
 */
function showView(route) {
  const targetId = VIEW_IDS[route];
  for (const el of allViewEls()) {
    if (el.id === targetId) {
      el.classList.add('active');
      el.classList.remove('hidden');
    } else {
      el.classList.remove('active');
      el.classList.add('hidden');
    }
  }
}

/**
 * Update the navigation bar visibility and active link state.
 * @param {string} route
 */
function updateNav(route) {
  const navLinks = document.getElementById('nav-links');
  const btnLogout = document.getElementById('btn-logout');
  const btnHamburger = document.getElementById('btn-hamburger');

  if (route === '/login') {
    navLinks?.classList.add('hidden');
    btnLogout?.classList.add('hidden');
    btnHamburger?.classList.add('hidden');
  } else {
    // On mobile: show hamburger, keep links collapsed by default
    // On desktop: show links directly (CSS handles display)
    navLinks?.classList.remove('hidden');
    navLinks?.classList.add('nav-collapsed'); // start collapsed on mobile
    btnLogout?.classList.remove('hidden');
    btnHamburger?.classList.remove('hidden');
    if (btnHamburger) {
      btnHamburger.setAttribute('aria-expanded', 'false');
      btnHamburger.textContent = '\u2630';
    }
  }

  // Mark the matching nav link as active
  document.querySelectorAll('#nav-links a[data-route]').forEach((link) => {
    if (link.getAttribute('data-route') === route) {
      link.classList.add('active');
    } else {
      link.classList.remove('active');
    }
  });
}

// ---------------------------------------------------------------------------
// Core navigation handler
// ---------------------------------------------------------------------------

/**
 * Resolve the route fragment from the current hash.
 * Strips the leading `#` so `#/dashboard` → `/dashboard`.
 * @returns {string}
 */
function currentRoute() {
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#/') return '';
  return hash.startsWith('#') ? hash.slice(1) : hash;
}

/**
 * Navigate to a route, updating the hash and triggering a render.
 * @param {string} route  e.g. '/login' or '/dashboard'
 */
function navigate(route) {
  window.location.hash = '#' + route;
}

/**
 * Main router handler — called on every hashchange and on initial load.
 */
async function handleRoute() {
  let route = currentRoute();

  // ---- Resolve empty / unknown routes ----
  if (!route || !ROUTES[route]) {
    const session = await getSession();
    navigate(session ? '/dashboard' : '/login');
    return;
  }

  // ---- Auth guard ----
  if (PROTECTED_ROUTES.has(route)) {
    const session = await getSession();
    if (!session) {
      navigate('/login');
      return;
    }
  }

  // ---- Show the view ----
  showView(route);
  updateNav(route);

  // ---- Load and initialise the view module ----
  try {
    const module = await ROUTES[route]();
    if (typeof module.init === 'function') {
      await module.init();
    }
  } catch (err) {
    // View module not yet implemented — silently ignore so the router remains
    // usable while view files are created incrementally.
    if (err?.message?.includes('Failed to fetch dynamically imported module') ||
        err?.message?.includes('Cannot find module') ||
        err instanceof TypeError) {
      console.warn(`[router] View module for "${route}" not found or failed to load.`, err);
    } else {
      console.error(`[router] Error initialising view "${route}":`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Logout wiring
// ---------------------------------------------------------------------------

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  await logout();
  navigate('/login');
});

// ---------------------------------------------------------------------------
// Hamburger menu toggle (mobile nav)
// ---------------------------------------------------------------------------

const _hamburgerBtn = document.getElementById('btn-hamburger');
const _navLinks = document.getElementById('nav-links');

if (_hamburgerBtn && _navLinks) {
  _hamburgerBtn.addEventListener('click', () => {
    const isCollapsed = _navLinks.classList.toggle('nav-collapsed');
    _hamburgerBtn.setAttribute('aria-expanded', String(!isCollapsed));
    _hamburgerBtn.textContent = isCollapsed ? '\u2630' : '\u2715';
  });

  // Close menu when a nav link is clicked
  _navLinks.addEventListener('click', (e) => {
    if (e.target.closest('a')) {
      _navLinks.classList.add('nav-collapsed');
      _hamburgerBtn.setAttribute('aria-expanded', 'false');
      _hamburgerBtn.textContent = '\u2630';
    }
  });
}

// ---------------------------------------------------------------------------
// Auth state listener � handles session expiry and cross-tab sign-out/sign-in
// ---------------------------------------------------------------------------

onAuthStateChange((session) => {
  const route = currentRoute();
  if (!session && route !== '/login') {
    navigate('/login');
  } else if (session && route === '/login') {
    navigate('/dashboard');
  }
});

// ---------------------------------------------------------------------------
// Event listeners � bootstrap the router
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', handleRoute);
window.addEventListener('load', handleRoute);
