const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(body) {
  const errors = {};
  const { fullName, email, phone, nationalId, age, employmentStatus, address } = body;

  if (!fullName || fullName.trim().length < 3) errors.fullName = "Enter your full name";
  if (!email || !EMAIL_RE.test(email)) errors.email = "Enter a valid email address";
  if (!phone || !/^(\+?254|0)?7\d{8}$|^(\+?254|0)?1\d{8}$/.test(phone.replace(/\s+/g, "")))
    errors.phone = "Enter a valid Kenyan phone number";
  if (!nationalId || String(nationalId).trim().length < 5) errors.nationalId = "Enter your National ID number";
  if (!age || Number(age) < 18 || Number(age) > 100) errors.age = "You must be 18 or older to apply";
  if (!employmentStatus) errors.employmentStatus = "Select your employment status";
  if (!address || address.trim().length < 5) errors.address = "Enter your address";

  return errors;
}

// POST /api/apply — create a new application, status: pending payment
router.post("/", (req, res) => {
  const errors = validate(req.body);
  if (Object.keys(errors).length > 0) {
    return res.status(400).json({ ok: false, errors });
  }

  const { fullName, email, phone, nationalId, age, employmentStatus, address } = req.body;
  const id = uuidv4();

  db.prepare(
    `INSERT INTO applications
      (id, full_name, email, phone, national_id, age, employment_status, address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, fullName.trim(), email.trim(), phone.trim(), String(nationalId).trim(), Number(age), employmentStatus, address.trim());

  res.json({ ok: true, applicationId: id });
});

// GET /api/apply/:id — fetch an application's current state
router.get("/:id", (req, res) => {
  const row = db.prepare(`SELECT * FROM applications WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: "Application not found" });
  res.json({ ok: true, application: row });
});

module.exports = router;
