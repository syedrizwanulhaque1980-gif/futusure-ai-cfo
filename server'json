/**
 * Futusure AI CFO – Express proxy for Claude + Payments
 * Keeps the Anthropic key, Razorpay secret, and Stripe secret server-side.
 * Never expose these to the browser.
 *
 * Usage:
 *   Fill in .env (see .env.example), then:
 *   npm run server   (dev)   or   npm start   (prod, after `npm run build`)
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const CLIENT_URL = process.env.CLIENT_URL || `http://localhost:${PORT}`;

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

app.use(cors({ origin: true }));

// Stripe webhook needs the RAW body, so it must be registered BEFORE express.json()
app.post(
  "/api/stripe-webhook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
      return res.status(503).send("Stripe not configured");
    }
    let event;
    try {
      const sig = req.headers["stripe-signature"];
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      // ── Persist this event in your DB, keyed by session.id ──
      // This is the durable, trustworthy source of "this person paid."
      // Client-side confirmation (below) is only for immediate UX;
      // this webhook is what should actually unlock/renew access.
      console.log("Stripe payment confirmed:", session.id, session.metadata);
    }

    res.json({ received: true });
  }
);

app.use(express.json({ limit: "25mb" })); // PDFs / images as base64 can be large

// ── Rate limiting ─────────────────────────────────────────────
// Protects the Anthropic bill and the payment endpoints from abuse.
// NOTE: in multi-instance/production deployments, back this with a shared
// store (e.g. Redis) instead of the default in-memory store, since each
// server instance would otherwise track its own limits independently.
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 30, // 30 AI calls/hour per IP — tune to your real usage patterns
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many AI requests. Try again later." },
});

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many payment attempts. Try again later." },
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    hasStripe: Boolean(process.env.STRIPE_SECRET_KEY),
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  });
});

// ── Plans (single source of truth, server-side) ──────────────
// Amounts are in the smallest currency unit (paise for INR, cents for USD/EUR/GBP).
const PLANS = {
  onetime: { name: "One-time Analysis", inr: 49900, usd: 900, eur: 900, gbp: 800 },
  monthly: { name: "Monthly Subscription", inr: 149900, usd: 2900, eur: 2700, gbp: 2300 },
  yearly: { name: "Yearly Subscription", inr: 1499900, usd: 29000, eur: 27000, gbp: 23000 },
};

// ── Razorpay: Create Order (INR) ──────────────────────────────
app.post("/api/create-order", paymentLimiter, async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: "RAZORPAY_NOT_CONFIGURED",
      message: "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.",
    });
  }

  const { plan } = req.body || {};
  const selected = PLANS[plan];
  if (!selected) {
    return res.status(400).json({ error: "Invalid plan. Use 'onetime', 'monthly', or 'yearly'." });
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        amount: selected.inr, // paise
        currency: "INR",
        receipt: `fs_${plan}_${Date.now()}`,
        notes: { plan, product: "Futusure AI CFO" },
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

// ── Razorpay: Verify Payment (THIS is what makes the paywall real) ──
// Razorpay Checkout returns razorpay_order_id, razorpay_payment_id, and
// razorpay_signature to the browser after a successful payment. The
// signature is an HMAC-SHA256 of "order_id|payment_id" signed with your
// key secret. If it doesn't match, the "payment" was never actually made
// through Razorpay — never trust the client's word alone.
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
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  const valid = expected === razorpay_signature;

  if (!valid) {
    console.warn("Razorpay signature mismatch — rejecting unverified payment claim.");
    return res.status(400).json({ error: "SIGNATURE_INVALID", verified: false });
  }

  // ── Persist { razorpay_payment_id, plan, verified: true, paidAt } to your DB here,
  // keyed by user/account — this is the durable record that grants access,
  // not anything the client stores itself.
  res.json({
    verified: true,
    paymentId: razorpay_payment_id,
    orderId: razorpay_order_id,
    plan,
    planName: PLANS[plan]?.name,
  });
});

// ── Stripe: Checkout Session (international currencies) ──────
app.post("/api/create-checkout-session", paymentLimiter, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({
      error: "STRIPE_NOT_CONFIGURED",
      message: "Add STRIPE_SECRET_KEY on the server.",
    });
  }

  const { plan, currency = "usd" } = req.body || {};
  const selected = PLANS[plan];
  const cur = currency.toLowerCase();
  if (!selected || !selected[cur]) {
    return res.status(400).json({ error: "Invalid plan or unsupported currency." });
  }

  try {
    const isRecurring = plan === "monthly" || plan === "yearly";
    const session = await stripe.checkout.sessions.create({
      mode: isRecurring ? "subscription" : "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: cur,
            product_data: { name: `Futusure AI CFO – ${selected.name}` },
            unit_amount: selected[cur],
            ...(isRecurring && {
              recurring: { interval: plan === "yearly" ? "year" : "month" },
            }),
          },
          quantity: 1,
        },
      ],
      metadata: { plan },
      success_url: `${CLIENT_URL}/?session_id={CHECKOUT_SESSION_ID}&plan=${plan}`,
      cancel_url: `${CLIENT_URL}/?checkout=cancelled`,
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error("Stripe session error:", err);
    res.status(500).json({ error: "STRIPE_ERROR", message: err.message });
  }
});

// ── Stripe: Verify a Checkout Session after redirect back ────
app.get("/api/verify-checkout-session", async (req, res) => {
  if (!stripe) return res.status(503).json({ error: "STRIPE_NOT_CONFIGURED" });
  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: "MISSING_SESSION_ID" });

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const paid = session.payment_status === "paid" || session.status === "complete";
    res.json({
      verified: paid,
      plan: session.metadata?.plan,
      amount: session.amount_total,
      currency: session.currency,
    });
  } catch (err) {
    res.status(500).json({ error: "STRIPE_VERIFY_ERROR", message: err.message });
  }
});

// ── Claude proxy (rate-limited) ───────────────────────────────
app.post("/api/claude", aiLimiter, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "NO_API_KEY",
      message: "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.",
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
    res.status(500).json({ error: "PROXY_ERROR", message: err.message || "Failed to reach Claude" });
  }
});

// ── Serve the built React app in production ──────────────────
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

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
  console.log(`  API key loaded: ${process.env.ANTHROPIC_API_KEY ? "yes" : "NO – demo mode only"}`);
  console.log(`  Razorpay: ${process.env.RAZORPAY_KEY_ID ? "configured" : "NOT configured"}`);
  console.log(`  Stripe: ${process.env.STRIPE_SECRET_KEY ? "configured" : "NOT configured"}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health\n`);
});
