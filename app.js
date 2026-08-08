// Point this at wherever the backend is running.
const API_BASE = window.location.origin.includes("localhost")
  ? "http://localhost:4000/api"
  : "/api";

const views = {
  intro: document.getElementById("view-intro"),
  form: document.getElementById("view-form"),
  payment: document.getElementById("view-payment"),
  waiting: document.getElementById("view-waiting"),
  success: document.getElementById("view-success"),
  failed: document.getElementById("view-failed"),
};

let state = {
  applicationId: null,
  phone: null,
  checkoutRequestId: null,
  pollTimer: null,
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.remove("active"));
  views[name].classList.add("active");
}

// ---- Step 1 -> 2 ----
document.getElementById("btn-start").addEventListener("click", () => showView("form"));

// ---- Step 2: submit application ----
const form = document.getElementById("application-form");
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearErrors();

  const payload = {
    fullName: form.fullName.value.trim(),
    email: form.email.value.trim(),
    phone: form.phone.value.trim(),
    nationalId: form.nationalId.value.trim(),
    age: form.age.value,
    employmentStatus: form.employmentStatus.value,
    address: form.address.value.trim(),
  };

  if (!document.getElementById("agree").checked) {
    setFormError("Please accept the entry terms to continue.");
    return;
  }

  const btn = document.getElementById("btn-continue-payment");
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    const res = await fetch(`${API_BASE}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!data.ok) {
      showFieldErrors(data.errors || {});
      setFormError("Please fix the highlighted fields.");
      return;
    }

    state.applicationId = data.applicationId;
    state.phone = payload.phone;
    document.getElementById("bp-name").textContent = payload.fullName;
    showView("payment");
  } catch (err) {
    setFormError("Couldn't reach the server. Check your connection and try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Continue to payment →";
  }
});

function setFormError(msg) {
  document.getElementById("form-error").textContent = msg;
}
function clearErrors() {
  document.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  setFormError("");
}
function showFieldErrors(errors) {
  Object.entries(errors).forEach(([field, msg]) => {
    const el = document.querySelector(`[data-error="${field}"]`);
    if (el) el.textContent = msg;
  });
}

// ---- Step 3: trigger STK push ----
document.getElementById("btn-pay").addEventListener("click", async () => {
  const btn = document.getElementById("btn-pay");
  btn.disabled = true;
  btn.textContent = "Sending prompt…";
  document.getElementById("payment-error").textContent = "";

  try {
    const res = await fetch(`${API_BASE}/payment/stkpush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ applicationId: state.applicationId }),
    });
    const data = await res.json();

    if (!data.ok) {
      document.getElementById("payment-error").textContent = data.error || "Payment could not be started.";
      return;
    }

    state.checkoutRequestId = data.checkoutRequestId;
    document.getElementById("waiting-phone").textContent = state.phone;
    showView("waiting");
    startPolling();
  } catch (err) {
    document.getElementById("payment-error").textContent = "Couldn't reach the server. Try again.";
  } finally {
    btn.disabled = false;
    btn.textContent = "Send M-Pesa prompt";
  }
});

// ---- Step 4: poll for payment result ----
function startPolling() {
  let attempts = 0;
  const maxAttempts = 30; // ~90s at 3s intervals

  state.pollTimer = setInterval(async () => {
    attempts += 1;
    try {
      const res = await fetch(`${API_BASE}/payment/status/${state.checkoutRequestId}`);
      const data = await res.json();

      if (data.status === "paid") {
        clearInterval(state.pollTimer);
        document.getElementById("bp-ticket").textContent = data.ticketNumber;
        document.getElementById("bp-ticket-stub").textContent = data.ticketNumber;
        document.getElementById("bp-receipt").textContent = data.mpesaReceipt || "—";
        showView("success");
      } else if (data.status === "failed") {
        clearInterval(state.pollTimer);
        document.getElementById("failed-reason").textContent =
          data.failureReason || "The M-Pesa request wasn't completed. You can try again.";
        showView("failed");
      }
      // "awaiting_pin" or "confirming" -> keep polling
    } catch {
      // transient network error — keep trying
    }

    if (attempts >= maxAttempts) {
      clearInterval(state.pollTimer);
      document.getElementById("waiting-note").textContent =
        "This is taking longer than usual. If you completed the payment, refresh in a moment.";
    }
  }, 3000);
}

// ---- Step 6: retry after failure ----
document.getElementById("btn-retry").addEventListener("click", () => {
  showView("payment");
});
