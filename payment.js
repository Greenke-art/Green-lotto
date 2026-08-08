const express = require("express");
const db = require("../db");
const { initiateStkPush, queryStkPushStatus } = require("../daraja");

const router = express.Router();

function generateTicketNumber() {
  const random = Math.floor(100000 + Math.random() * 900000);
  return `GL-${random}`;
}

// POST /api/payment/stkpush — trigger the M-Pesa prompt on the applicant's phone
router.post("/stkpush", async (req, res) => {
  const { applicationId } = req.body;
  if (!applicationId) return res.status(400).json({ ok: false, error: "applicationId is required" });

  const application = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(applicationId);
  if (!application) return res.status(404).json({ ok: false, error: "Application not found" });

  if (application.payment_status === "paid") {
    return res.status(400).json({ ok: false, error: "This application has already been paid for" });
  }

  const amount = parseInt(process.env.ENTRY_FEE_KES || "2000", 10);

  try {
    const result = await initiateStkPush({
      phone: application.phone,
      amount,
      accountReference: "GreenLotto",
      description: "Green Lotto Entry",
    });

    if (result.ResponseCode !== "0") {
      return res.status(400).json({ ok: false, error: result.ResponseDescription || "STK push failed" });
    }

    db.prepare(
      `UPDATE applications
       SET payment_status = 'awaiting_pin', checkout_request_id = ?, merchant_request_id = ?
       WHERE id = ?`
    ).run(result.CheckoutRequestID, result.MerchantRequestID, applicationId);

    res.json({
      ok: true,
      checkoutRequestId: result.CheckoutRequestID,
      message: "Check your phone and enter your M-Pesa PIN to complete payment.",
    });
  } catch (err) {
    console.error("STK push error:", err.response?.data || err.message);
    res.status(500).json({ ok: false, error: "Could not reach M-Pesa. Please try again." });
  }
});

// POST /api/payment/callback — Safaricom calls this with the payment result.
// This URL must be publicly reachable over HTTPS (see DARAJA_CALLBACK_URL in .env).
router.post("/callback", (req, res) => {
  const stkCallback = req.body?.Body?.stkCallback;
  if (!stkCallback) return res.status(400).json({ ok: false });

  const { CheckoutRequestID, ResultCode, ResultDesc, CallbackMetadata } = stkCallback;

  const application = db
    .prepare(`SELECT * FROM applications WHERE checkout_request_id = ?`)
    .get(CheckoutRequestID);

  if (!application) {
    // Always acknowledge Safaricom even if we can't match it, so they stop retrying.
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  }

  if (ResultCode === 0) {
    const items = CallbackMetadata?.Item || [];
    const get = (name) => items.find((i) => i.Name === name)?.Value;

    const amountPaid = get("Amount");
    const receipt = get("MpesaReceiptNumber");
    const ticketNumber = generateTicketNumber();

    db.prepare(
      `UPDATE applications
       SET payment_status = 'paid', mpesa_receipt = ?, amount_paid = ?, ticket_number = ?, paid_at = datetime('now')
       WHERE checkout_request_id = ?`
    ).run(receipt, amountPaid, ticketNumber, CheckoutRequestID);
  } else {
    // ResultCode 1032 = user cancelled, 1037 = timeout, etc.
    db.prepare(
      `UPDATE applications SET payment_status = 'failed', failure_reason = ? WHERE checkout_request_id = ?`
    ).run(ResultDesc, CheckoutRequestID);
  }

  // Safaricom just needs a 200 with this shape — it does not go to the applicant.
  res.json({ ResultCode: 0, ResultDesc: "Accepted" });
});

// GET /api/payment/status/:checkoutRequestId — frontend polls this after showing
// "check your phone", so we can show a live result without waiting on the callback alone.
router.get("/status/:checkoutRequestId", async (req, res) => {
  const application = db
    .prepare(`SELECT * FROM applications WHERE checkout_request_id = ?`)
    .get(req.params.checkoutRequestId);

  if (!application) return res.status(404).json({ ok: false, error: "Not found" });

  // If our DB is still "awaiting_pin", double check with Safaricom directly —
  // covers cases where the callback is delayed or never arrives.
  if (application.payment_status === "awaiting_pin") {
    try {
      const queryResult = await queryStkPushStatus(req.params.checkoutRequestId);
      if (queryResult.ResultCode === "0" || queryResult.ResultCode === 0) {
        // Paid — the callback should update the row shortly; report optimistically as pending confirm.
        return res.json({ ok: true, status: "confirming" });
      } else if (queryResult.ResultCode && queryResult.ResultCode !== "1037") {
        return res.json({ ok: true, status: "failed", reason: queryResult.ResultDesc });
      }
    } catch {
      // Query can 500 while the transaction is still in flight — ignore and fall through.
    }
  }

  res.json({
    ok: true,
    status: application.payment_status,
    ticketNumber: application.ticket_number,
    mpesaReceipt: application.mpesa_receipt,
    failureReason: application.failure_reason,
  });
});

module.exports = router;
