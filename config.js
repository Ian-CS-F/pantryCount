// Public Supabase settings. The publishable key is safe to ship in a web page:
// the database only answers pantry_* functions, and each one checks the household key,
// which lives in the link you share (after the #), never in this repo.
window.PANTRY_CONFIG = {
  supabaseUrl: "https://tejqxvipwmiahnsbjgvk.supabase.co",
  publishableKey: "sb_publishable_a3-uccVPw5KnBLPXKiHM8A_Q8MDMdBL",
  locations: ["Pantry", "Fridge", "Freezer", "Garage", "Other"]
};
