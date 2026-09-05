/**
 * Futusure AI CFO – Express proxy for Claude
 * Keeps the Anthropic API key server-side. Never expose it to the browser.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node server.js
 *   or put the key in a .env file and run: npm run server
 */

import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true })); // allow Vite dev server + production origins
app.use(express.json({ limit: "25mb" })); // PDFs / images as base64 can be large

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY),
    hasRazorpay: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-20250514",
  });
});

// ── Create Razorpay Order ────────────────────────────────────
app.post("/api/create-order", async (req, res) => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return res.status(503).json({
      error: "RAZORPAY_NOT_CONFIGURED",
      message: "Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.",
    });
  }

  const { plan } = req.body || {};
  // plan: "onetime" | "monthly"
  const plans = {
    onetime: { amount: 49900, name: "One-time Analysis", description: "Futusure AI CFO – One-time usage" },
    monthly: { amount: 149900, name: "Monthly Subscription", description: "Futusure AI CFO – Monthly Plan" },
  };

  const selected = plans[plan];
  if (!selected) {
    return res.status(400).json({ error: "Invalid plan. Use 'onetime' or 'monthly'." });
  }

  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const response = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        amount: selected.amount, // in paise
        currency: "INR",
        receipt: `fs_${plan}_${Date.now()}`,
        notes: {
          plan,
          product: "Futusure AI CFO",
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

app.post("/api/claude", async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.status(503).json({
      error: "NO_API_KEY",
      message:
        "ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.",
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
      return res.status(response.status).json({
        error: "CLAUDE_API_ERROR",
        details: data,
      });
    }

    // Return the same shape the frontend expects
    const text = (data.content || []).map((b) => b.text || "").join("\n");
    res.json({ text, raw: data });
  } catch (err) {
    console.error("Proxy error:", err);
    res.status(500).json({
      error: "PROXY_ERROR",
      message: err.message || "Failed to reach Claude",
    });
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
  // SPA fallback – all non-API routes go to index.html
  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return res.status(404).end();
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`\n  Futusure AI CFO running on http://localhost:${PORT}`);
  console.log(
    `  API key loaded: ${process.env.ANTHROPIC_API_KEY ? "yes" : "NO – demo mode only"}`
  );
  console.log(`  Health check: http://localhost:${PORT}/api/health\n`);
});
