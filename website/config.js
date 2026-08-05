/**
 * KQuality Cleaning Services — Site Configuration
 * ------------------------------------------------
 * This is the SINGLE point of integration between the website and the
 * existing IVNautomation production platform (n8n webhook, socials, maps).
 *
 * Do NOT hardcode these values anywhere else in the codebase.
 * Every form / link / tracker must reference window.CONFIG.
 *
 * WEBHOOK_URL: points at the "Website Quote Intake" n8n workflow
 * (workflow id nbC6TJNH2kogzvav). This is an independent intake pipeline —
 * it validates/sanitizes submissions, stores them in leads.website_quotes
 * (status pending_review), emails Michelle, and does NOT touch the CRM or
 * outbound prospecting engines. Leads are promoted to CRM manually.
 */

export const CONFIG = {
  // --- Backend integration -------------------------------------------------
  WEBHOOK_URL: "https://n8n.kqualitycleaningservices.com.au/webhook/website-quote-intake",
  CHAT_WEBHOOK_URL: "https://n8n.kqualitycleaningservices.com.au/webhook/website-chat-h7q3m2",

  // Chat widget master switch. false = widget hidden, no chat requests sent.
  // The webhook + n8n workflow above stay wired; set back to true to re-enable.
  CHAT_ENABLED: false,

  // --- Business info --------------------------------------------------------
  BUSINESS_NAME: "KQuality Cleaning Services",
  ADDRESS: "86A Tolley Rd, St Agnes SA 5096, Australia",
  PHONE: "+61 439 489 630",
  PHONE_DISPLAY: "0439 489 630",
  WEBSITE: "https://kqualitycleaningservices.com.au",
  EMAIL: "info@kqualitycleaningservices.com.au",

  // --- Social / external links ----------------------------------------------
  GOOGLE_MAPS_URL:
    "https://www.google.com/maps/search/?api=1&query=86A+Tolley+Rd+St+Agnes+SA+5096+Australia",
  GOOGLE_MAPS_EMBED_URL:
    "https://www.google.com/maps?q=86A+Tolley+Rd+St+Agnes+SA+5096+Australia&output=embed",
  FACEBOOK_URL: "https://www.facebook.com/KQualityCleaningServices",
  INSTAGRAM_URL: "",
  LINKEDIN_URL: "",

  // --- Assets ----------------------------------------------------------------
  LOGO_PATH: "./assets/logo.png?v=20260720213552",

  // --- Business hours ----------------------------------------------------
  HOURS: [
    { day: "Monday – Friday", time: "7:00 AM – 6:00 PM" },
    { day: "Saturday", time: "8:00 AM – 2:00 PM" },
    { day: "Sunday", time: "Closed (emergency requests only)" },
  ],

  // --- Trust stats ---------------------------------------------------------
  STATS: {
    FACEBOOK_FOLLOWERS: "17,000+",
    GOOGLE_RATING: "5.0",
    BASE_LOCATION: "Adelaide, SA",
  },

  // --- Analytics / tracking (leave blank until IDs are supplied) -----------
  GA4_MEASUREMENT_ID: "",
  GTM_CONTAINER_ID: "",
  FACEBOOK_PIXEL_ID: "",
};

if (typeof window !== "undefined") {
  window.CONFIG = CONFIG;
}
