/**
 * Authentication module wrapping Supabase Auth.
 *
 * All functions delegate to the supabaseClient instance so the rest of the app
 * never imports supabase-js directly.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4
 */

import { supabaseClient } from './supabase.js';

/**
 * Sign in with email and password.
 *
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ user: import('@supabase/supabase-js').User | null, error: Error | null }>}
 */
export async function login(email, password) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  });

  return {
    user: data?.user ?? null,
    error: error ?? null,
  };
}

/**
 * Sign out the current user and clear the local session.
 *
 * @returns {Promise<void>}
 */
export async function logout() {
  await supabaseClient.auth.signOut();
}

/**
 * Retrieve the current active session.
 *
 * @returns {Promise<import('@supabase/supabase-js').Session | null>}
 */
export async function getSession() {
  const { data } = await supabaseClient.auth.getSession();
  return data?.session ?? null;
}

/**
 * Subscribe to authentication state changes (sign-in, sign-out, token refresh).
 *
 * The callback receives the new Session object (or null when signed out).
 * Returns the subscription object so the caller can unsubscribe when needed.
 *
 * @param {(session: import('@supabase/supabase-js').Session | null) => void} callback
 * @returns {{ data: { subscription: import('@supabase/supabase-js').Subscription } }}
 */
export function onAuthStateChange(callback) {
  return supabaseClient.auth.onAuthStateChange((_event, session) => {
    callback(session);
  });
}
