/* StockCup household sync settings. Leave blank to use StockCup on one device only.
   To enable sync, create a free Supabase project, run supabase/schema.sql, enable anonymous sign-ins,
   then paste the Project URL and the public key (the "publishable" key, or the older "anon" key) below
   (Project Settings -> API Keys).
   These two values are meant to be public: access is protected by row-level security in the database.
   NEVER put the service_role / secret key here. See README -> Household sync. */
window.STOCKCUP_CONFIG = {
  SUPABASE_URL: 'https://xfncfzirydbmpbrgtmdx.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_feZCe29qSHWJhYQa4SUaig_vPsp7U1w'
};
