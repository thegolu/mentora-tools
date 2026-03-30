/**
 * OPTION A — Local / self-hosted (copy to config.js, never commit it)
 * -----------------------------------------------------------------------
 * config.js is in .gitignore. Fill in your Supabase project credentials.
 * Without credentials, all data is stored only in the browser (localStorage).
 */
window.__MENTORAL_CONFIG__ = {
  supabaseUrl: "",      // e.g. "https://abcxyz.supabase.co"
  supabaseAnonKey: "",  // Project Settings → API → anon public key
};

/**
 * OPTION B — Netlify snippet injection (no config.js file needed in repo)
 * -----------------------------------------------------------------------
 * In Netlify dashboard → Site settings → Build & deploy → Post processing
 * → Snippet injection → "Before </head>" → paste the block below (filled in):
 *
 * <script>
 *   window.__MENTORAL_CONFIG__ = {
 *     supabaseUrl: "https://abcxyz.supabase.co",
 *     supabaseAnonKey: "eyJhbG..."
 *   };
 * </script>
 *
 * This runs before app.js loads so credentials are available immediately.
 *
 * OPTION C — Cloudflare Pages / Vercel HTML transform
 * -----------------------------------------------------------------------
 * Same idea: inject the <script> block above into index.html via the
 * platform's "HTML rewrite" or "snippet" feature, or add a minimal
 * _worker.js / edge function that rewrites the page with the block injected.
 */
