/**
 * Futusure AI CFO – Express server
 * Razorpay-only (domestic + international)
 * Includes webhook payment verification
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;

// ── Simple in-memory store for verified payments ──────────────
// In production → replace with PostgreSQL / MongoDB / Redis
const verifiedPayments = new Map(); // key = payment_id

// ── Plans (single source of truth) ────────────────────────────
const PLANS = {
  onetime: {
    name: "One-time Analysis",
    amounts: { INR: 49900, USD: 900, EUR: 900, GBP: 800 },
  },
  monthly: {
    name: "Monthly Subscription",
    amounts: { INR: 149900, USD: 2900, EUR: 2700, GBP: 2300 },
  },
  yearly: {
    name: "Yearly Subscription",
    amounts: { INR: 1499900, USD: 29000, EUR: 27000, GBP: 23000 },
  },
};

// ── Rate limiting ─────────────────────────────────────────────
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many AI requests. Try again later." },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many payment attempts. Try again later." },
});

// ── IMPORTANT: Webhook needs RAW body ─────────────────────────
// This must come BEFORE express.json()
app.post(
  "/api/razorpay-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("RAZORPAY_WEBHOOK_SECRET is not set");
      return res.status(503).send("Webhook not configured");
    }

    const signature = req.headers["x-razorpay-signature"];
    if (!signature) {
      return res.status(400).send("Missing signature");
    }

    // Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", webhookSecret)
      .update(req.body)
      .digest("hex");

    if (expectedSignature !== signature) {
      console.warn("Invalid Razorpay webhook signature");
      return res.status(400).send("Invalid signature");
    }

    let event;
    try {
      event = JSON.parse(req.body.toString());
    } catch (err) {
      console.error("Failed to parse webhook body:", err);
      return res.status(400).send("Invalid JSON");
    }

    const eventType = event.event;
    console.log("Razorpay webhook received:", eventType);

    // Handle successful payment
    if (eventType === "payment.captured" || eventType === "order.paid") {
      const payment = event.payload?.payment?.entity;
      const order = event.payload?.order?.entity;

      if (payment && payment.status === "captured") {
        const paymentId = payment.id;
        const orderId = payment.order_id;
        const amount = payment.amount;
        const currency = payment.currency;
        const plan = payment.notes?.plan || order?.notes?.plan || "onetime";

        // Store as verified
        verifiedPayments.set(paymentId, {
          orderId,
          plan,
          amount,
          currency,
          verifiedAt: new Date().toISOString(),
          source: "webhook",
        });

        console.log(`✅ Payment verified via webhook: ${paymentId} | Plan: ${plan}`);
      }
    }

    // Always respond 200 so Razorpay doesn't retry unnecessarily
    res.status(200).json({ status: "ok" });
  }
);

// Now enable JSON body parser for other routes
app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

// ── Health ────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    hasWebhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  });
});

// ── Create Razorpay Order ─────────────────────────────────────
app.post("/api/create-order", paymentLimiter, async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: "RAZORPAY_NOT_CONFIGURED",
      message: "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.",
    });
  }

  const { plan, currency = "INR" } = req.body || {};
  const selected = PLANS[plan];
  const cur = (currency || "INR").toUpperCase();

  if (!selected || !selected.amounts[cur]) {
    return res.status(400).json({ error: "Invalid plan or unsupported currency." });
  }

  try {
    const auth = Buffer.from(`\( {keyId}: \){keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: selected.amounts[cur],
        currency: cur,
        receipt: `fs_\( {plan}_ \){Date.now()}`,
        notes: {
          plan,
          product: "Futusure AI CFO",
          currency: cur,
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Razorpay order error:", data);
      return res.status(response.status).json({ error: "ORDER_FAILED", details: data });
    }

    res.json({
      orderId: data.id,
      amount: data.amount,
      currency: data.currency,
      keyId,
      plan,
      planName: selected.name,
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({ error: "ORDER_ERROR", message: err.message });
  }
});

// ── Client-side Verify (still useful for immediate UX) ────────
app.post("/api/verify-payment", paymentLimiter, (req, res) => {
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = req.body || {};

  if (!keySecret) {
    return res.status(503).json({ error: "RAZORPAY_NOT_CONFIGURED" });
  }

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: "MISSING_FIELDS" });
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`\( {razorpay_order_id}| \){razorpay_payment_id}`)
    .digest("hex");

  const valid = expected === razorpay_signature;

  if (!valid) {
    console.warn("Razorpay signature mismatch");
    return res.status(400).json({ error: "SIGNATURE_INVALID", verified: false });
  }

  // Also store it (webhook will also store it – this is for faster UX)
  verifiedPayments.set(razorpay_payment_id, {
    orderId: razorpay_order_id,
    plan,
    verifiedAt: new Date().toISOString(),
    source: "client",
  });

  res.json({
    verified: true,
    paymentId: razorpay_payment_id,
    orderId: razorpay_order_id,
    plan,
    planName: PLANS[plan]?.name,
  });
});

// ── Check if a payment is already verified (used by frontend) ─
app.get("/api/payment-status/:paymentId", (req, res) => {
  const record = verifiedPayments.get(req.params.paymentId);
  if (record) {
    return res.json({ verified: true, ...record });
  }
  res.json({ verified: false });
});

// ── Claude Proxy ──────────────────────────────────────────────
app.post("/api/claude", aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "NO_API_KEY",
      message: "ANTHROPIC_API_KEY is not set on the server.",
    });
  }

  const { system, messages, max_tokens = 1200 } = req.body || {};

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
        max_tokens,
        system: system || undefined,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Anthropic error:", data);
      return res.status(response.status).json({ error: "CLAUDE_API_ERROR", details: data });
    }

    const text = (data.content || []).map((b) => b.text || "").join("\n");
    res.json({ text, raw: data });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({ error: "PROXY_ERROR", message: err.message });
  }
});

// ── Serve frontend ────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.join(__dirname, "dist");

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).end();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n  Futusure AI CFO running on http://localhost:${PORT}`);
  console.log(`  Claude API: ${process.env.ANTHROPIC_API_KEY ? "loaded" : "NO – demo mode"}`);
  console.log(`  Razorpay: ${process.env.RAZORPAY_KEY_ID ? "configured" : "NOT configured"}`);
  console.log(`  Webhook: ${process.env.RAZORPAY_WEBHOOK_SECRET ? "configured" : "NOT configured"}`);
  console.log(`  Health: http://localhost:${PORT}/api/health\n`);
});
