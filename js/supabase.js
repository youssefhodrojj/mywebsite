// Supabase client initialisation
// The UMD bundle sets window.supabase to the full module object.
// createClient lives directly on that object.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// The supabase-js UMD bundle exposes itself as window.supabase
// which has createClient as a direct property.
const createClient = window.supabase?.createClient;

if (!createClient) {
  console.error('[supabase.js] window.supabase.createClient not found. Check that the CDN script loaded before this module.');
}

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
