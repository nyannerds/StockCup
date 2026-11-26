/* StockCup household sync settings. Leave blank to use StockCup on one device only.
   To enable sync, create a free Supabase project, run supabase/schema.sql, enable anonymous sign-ins,
   then paste the Project URL and the public "anon" key below (Project Settings -> API).
   The anon key is meant to be public: access is protected by row-level security in the database.
   NEVER put the service_role key here. See README -> Household sync. */
window.STOCKCUP_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
