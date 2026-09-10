/**
 * Futusure AI CFO – Express server
 * Razorpay-only (domestic + international)
 * Claude proxy + payment verification
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import Stripe from "stripe";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;

// Stripe is optional at boot — if the key isn't set, the international
// (USD/EUR/GBP) checkout routes respond with a clear config error instead
// of crashing the server, so Razorpay/INR keeps working either way.
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

app.use(cors({ origin: true }));
app.use(express.json({ limit: "25mb" }));

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

// ── Plans (single source of truth) ────────────────────────────
const PLANS = {
  onetime: {
    name: "One-time Analysis",
    amounts: { INR: 49900, USD: 900, EUR: 900, GBP: 800 }, // in smallest unit
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

// Simple in-memory store for verified payments (replace with DB later)
const verifiedPayments = new Map();

// ── Health ────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    hasStripe: Boolean(process.env.STRIPE_SECRET_KEY),
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  });
});

// ── Create Razorpay Order (works for all currencies) ──────────
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

// ── Verify Razorpay Payment ───────────────────────────────────
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

  // Store verified payment (in production use a real database)
  verifiedPayments.set(razorpay_payment_id, {
    orderId: razorpay_order_id,
    plan,
    verifiedAt: new Date().toISOString(),
  });

  res.json({
    verified: true,
    paymentId: razorpay_payment_id,
    orderId: razorpay_order_id,
    plan,
    planName: PLANS[plan]?.name,
  });
});

// ── Create Stripe Checkout Session (USD/EUR/GBP — international) ──
app.post("/api/create-checkout-session", paymentLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "STRIPE_NOT_CONFIGURED",
      message: "Add STRIPE_SECRET_KEY on the server.",
    });
  }

  const { plan, currency = "usd" } = req.body || {};
  const selected = PLANS[plan];
  const curUpper = (currency || "usd").toUpperCase();
  const curLower = curUpper.toLowerCase();

  if (!selected || !selected.amounts[curUpper]) {
    return res.status(400).json({ error: "Invalid plan or unsupported currency." });
  }

  // NOTE: this creates a one-off Checkout Session for every plan, same
  // as the Razorpay flow. For true auto-renewing monthly/yearly billing,
  // switch "mode" to "subscription" with pre-created recurring Stripe
  // Price IDs and add a webhook (see README note below).
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: curLower,
            product_data: { name: `Futusure AI CFO — ${selected.name}` },
            unit_amount: selected.amounts[curUpper],
          },
          quantity: 1,
        },
      ],
      success_url: `${CLIENT_URL}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/`,
      metadata: { plan, product: "Futusure AI CFO", currency: curUpper },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "STRIPE_SESSION_ERROR", message: err.message });
  }
});

// ── Verify Stripe Checkout Session (on return from Stripe) ────────
app.get("/api/verify-checkout-session", paymentLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: "STRIPE_NOT_CONFIGURED" });
  }

  const { session_id } = req.query;
  if (!session_id) {
    return res.status(400).json({ error: "MISSING_SESSION_ID" });
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);

    if (session.payment_status !== "paid") {
      return res.json({ verified: false });
    }

    const plan = session.metadata?.plan;

    // Store verified payment (in production use a real database)
    verifiedPayments.set(session_id, {
      plan,
      verifiedAt: new Date().toISOString(),
    });

    res.json({
      verified: true,
      plan,
      planName: PLANS[plan]?.name,
      amount: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    console.error("Stripe verify error:", err);
    res.status(500).json({ error: "STRIPE_VERIFY_ERROR", message: err.message });
  }
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
  console.log(`  API key loaded: ${process.env.ANTHROPIC_API_KEY ? "yes" : "NO – demo mode"}`);
  console.log(`  Razorpay: ${process.env.RAZORPAY_KEY_ID ? "configured" : "NOT configured"}`);
  console.log(`  Stripe:   ${process.env.STRIPE_SECRET_KEY ? "configured" : "NOT configured (USD/EUR/GBP checkout will fail)"}`);
  console.log(`  Health: http://localhost:${PORT}/api/health\n`);
});
