require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");

const applyRoutes = require("./routes/apply");
const paymentRoutes = require("./routes/payment");

const app = express();

app.use(
  cors({
    origin: (process.env.CORS_ORIGIN || "*").split(","),
  })
);
app.use(express.json());

app.use("/api/apply", applyRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true, service: "green-lotto-backend" }));

// Serve the frontend build in production
app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Green Lotto backend running on http://localhost:${PORT}`);
});
