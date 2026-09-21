// Paste the Google Apps Script Web App URL here after you deploy Code.gs
// (Deploy > New deployment > Web app > copy the URL ending in /exec).
// Until you do, the site runs on the bundled sample snapshot in data.js.
const API_URL = "https://script.google.com/macros/s/AKfycbynDtwo6vgkGGmVI1hsAyJk-aq_9-m3gvzpFJ3304k_BAmF51MZimg7xWfwcuYxk2pS/exec";

// Optional: shown as an "Open Google Sheet" link in Settings. Safe to leave
// as-is or replace with your own sheet's URL.
const SHEET_URL = "https://docs.google.com/spreadsheets/d/1OSKJYMr4HOmDbWK04OQKHn2ojbnBLpUtKmlzSANwAks/edit";

// Accounts allowed to log into the site (shown on a login screen before the
// app loads). Add/edit username-password pairs here — and copy the SAME
// list into the APP_USERS map in apps-script/Code.gs, so the backend
// rejects requests that don't carry a valid login, not just the front end.
// IMPORTANT: this is a plain static file — anyone who can view this site's
// source (or the GitHub repo it's built from) can read these values. It
// stops casual visitors and keeps the Apps Script API from being pulled
// directly by someone who only has the link, but it is not real security
// against a technically determined person. Don't reuse a password you use
// anywhere else.
const APP_USERS = [
  { username: "admin", password: "admin2026" }
];
