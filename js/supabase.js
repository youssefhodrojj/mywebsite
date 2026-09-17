// Supabase client initialisation
// The UMD bundle exposes `supabase` on the global scope when loaded via <script>,
// but for ES module usage we reference the global set by the UMD bundle loaded
// as a <script> tag in index.html before this module is imported.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// supabase-js UMD bundle attaches itself to window.supabase
const { createClient } = window.supabase;

export const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
