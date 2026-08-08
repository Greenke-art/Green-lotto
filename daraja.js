const axios = require("axios");

const BASE_URL =
  process.env.DARAJA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Fetches (and caches) an OAuth access token from Safaricom.
 * Tokens are valid for 1 hour; we refresh a minute early to be safe.
 */
async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) {
    return cachedToken;
  }

  const key = process.env.DARAJA_CONSUMER_KEY;
  const secret = process.env.DARAJA_CONSUMER_SECRET;
  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");

  const { data } = await axios.get(
    `${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` } }
  );

  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (parseInt(data.expires_in, 10) - 60) * 1000;
  return cachedToken;
}

/**
 * Converts a Kenyan phone number in any common format to the
 * 2547XXXXXXXX / 2541XXXXXXXX format Safaricom requires.
 */
function normalizePhone(rawPhone) {
  let phone = String(rawPhone).replace(/\s+/g, "").replace(/^\+/, "");

  if (phone.startsWith("0")) {
    phone = "254" + phone.slice(1);
  } else if (phone.startsWith("7") || phone.startsWith("1")) {
    phone = "254" + phone;
  }

  if (!/^254(7|1)\d{8}$/.test(phone)) {
    throw new Error("Invalid Kenyan phone number format");
  }
  return phone;
}

function buildPassword(shortcode, passkey, timestamp) {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}

function buildTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

/**
 * Triggers an STK Push (Lipa Na M-Pesa Online) prompt on the
 * applicant's own phone. The applicant enters their M-Pesa PIN
 * on their device, in the native M-Pesa menu — never on our site.
 */
async function initiateStkPush({ phone, amount, accountReference, description }) {
  const token = await getAccessToken();
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const timestamp = buildTimestamp();
  const password = buildPassword(shortcode, passkey, timestamp);
  const normalizedPhone = normalizePhone(phone);

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: "CustomerPayBillOnline",
    Amount: amount,
    PartyA: normalizedPhone,
    PartyB: shortcode,
    PhoneNumber: normalizedPhone,
    CallBackURL: process.env.DARAJA_CALLBACK_URL,
    AccountReference: accountReference.slice(0, 12),
    TransactionDesc: description.slice(0, 13),
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpush/v1/processrequest`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data; // { MerchantRequestID, CheckoutRequestID, ResponseCode, ... }
}

/**
 * Actively queries Safaricom for the result of an STK push,
 * used as a fallback if the callback hasn't arrived yet.
 */
async function queryStkPushStatus(checkoutRequestId) {
  const token = await getAccessToken();
  const shortcode = process.env.DARAJA_SHORTCODE;
  const passkey = process.env.DARAJA_PASSKEY;
  const timestamp = buildTimestamp();
  const password = buildPassword(shortcode, passkey, timestamp);

  const payload = {
    BusinessShortCode: shortcode,
    Password: password,
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  const { data } = await axios.post(
    `${BASE_URL}/mpesa/stkpushquery/v1/query`,
    payload,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  return data;
}

module.exports = { initiateStkPush, queryStkPushStatus, normalizePhone };
