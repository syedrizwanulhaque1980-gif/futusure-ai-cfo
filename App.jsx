import React, { useState, useEffect } from "react";
import {
  Upload,
  MessageCircle,
  LayoutDashboard,
  Home,
  Send,
  AlertTriangle,
  CheckCircle2,
  TrendingDown,
  CreditCard,
  Receipt,
  ShieldCheck,
} from "lucide-react";

const ink = "#16233E";
const gold = "#B8862E";
const rust = "#9A3E2B";
const moss = "#3F7355";
const paper = "#F1F3F7";

// ─────────────────────────────────────────────────────────────
// CURRENCIES & PRICING PLANS
// ─────────────────────────────────────────────────────────────
// Prices are in the smallest unit's display value (not paise/cents) —
// the actual charge amounts in smallest-unit form live server-side in
// server.js (single source of truth for what gets charged).
const CURRENCIES = {
  INR: { symbol: "₹", locale: "en-IN", label: "INR (India)", gateway: "razorpay" },
  USD: { symbol: "$", locale: "en-US", label: "USD (US/Intl.)", gateway: "stripe" },
  EUR: { symbol: "€", locale: "de-DE", label: "EUR (Europe)", gateway: "stripe" },
  GBP: { symbol: "£", locale: "en-GB", label: "GBP (UK)", gateway: "stripe" },
};

function detectDefaultCurrency() {
  try {
    const locale = navigator.language || "en-IN";
    if (locale.includes("IN")) return "INR";
    if (locale.includes("GB")) return "GBP";
    if (/de|fr|it|es|nl|pt|ie|be|at/i.test(locale)) return "EUR";
    return "USD";
  } catch {
    return "INR";
  }
}

function formatPrice(amount, currency) {
  const c = CURRENCIES[currency] || CURRENCIES.INR;
  return `${c.symbol}${amount.toLocaleString(c.locale)}`;
}

const PLANS = {
  onetime: {
    id: "onetime",
    name: "One-time Analysis",
    period: "one-time",
    prices: { INR: 499, USD: 9, EUR: 9, GBP: 8 },
    features: [
      "Full AI financial analysis",
      "Health score + briefing",
      "AI CFO chat",
      "Collection reminder drafts",
      "Digital payment receipt",
    ],
  },
  monthly: {
    id: "monthly",
    name: "Monthly Subscription",
    period: "per month",
    prices: { INR: 1499, USD: 29, EUR: 27, GBP: 23 },
    features: [
      "Everything in One-time",
      "Unlimited analyses this month",
      "Priority AI processing",
      "Save multiple businesses",
      "Email receipt & invoice",
    ],
  },
  yearly: {
    id: "yearly",
    name: "Yearly Subscription",
    period: "per year",
    badge: "Save ~17%",
    prices: { INR: 14999, USD: 290, EUR: 270, GBP: 230 },
    features: [
      "Everything in Monthly",
      "2 months free vs. paying monthly",
      "Priority support",
      "Annual invoice for accounting",
    ],
  },
};

const PAID_KEY = "futusure_paid";
const RECEIPT_KEY = "futusure_receipt";
const BUSINESS_DATA_KEY = "futusure_business_data";

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPTS
// ─────────────────────────────────────────────────────────────
const SYSTEM_EXTRACT = `You are the automated financial extraction and analysis engine for an MSME AI CFO platform. No human reviews this output before the client sees it, so it must be self-contained and correct.
Given a business's financial statement (document, image, or pasted text), return ONLY a raw JSON object, no markdown fences, no prose, with this exact shape:
{
 "businessName": string,
 "score": number (0-100, financial health),
 "headline": string (max 6 words, plain language verdict),
 "summary": string (1 sentence),
 "scoreDelta": string (e.g. "+4 pts vs last period", invent a plausible one if only one period of data exists),
 "metrics": {
   "revenue": string (formatted with currency),
   "revenueNote": string,
   "netProfit": string,
   "netProfitNote": string,
   "cash": string,
   "cashNote": string,
   "receivables": string,
   "receivablesNote": string
 },
 "briefing": [ up to 3 strings, each a short AI-CFO-style observation or recommendation ],
 "aging": { "0-30": string, "31-60": string, "61-90": string, "90+": string },
 "priorityCollections": [ up to 4 objects {"name": string, "amount": string, "days": string} ]
}
If the input has too little data for a field, make a clearly labeled reasonable estimate rather than leaving it blank. Never explain your reasoning outside the JSON.`;

function buildSystemChat(data) {
  return `You are the AI CFO for ${data?.businessName || "this business"}, operating with no human financial staff behind you — you are the only source of financial answers for this client. Answer using this business's actual data:
${JSON.stringify(data)}
Rules: Answer in 2-4 sentences, plain language, specific numbers from the data above. If asked something the data can't answer, say what additional data you'd need rather than guessing.`;
}

// ─────────────────────────────────────────────────────────────
// DEMO / SAMPLE DATA (works with zero API key)
// ─────────────────────────────────────────────────────────────
const SAMPLE_TEXT = `Sharma Textiles - Trial Balance & P&L extract, FY26
Revenue: 3,15,00,000. COGS: 2,10,00,000. Operating expenses: 68,00,000. Net Profit: 28,60,000.
Cash and bank balance: 9,20,000. Trade receivables: 37,50,000, of which 61-90 days: 6,00,000 and 90+ days: 9,50,000, 31-60 days: 8,00,000, 0-30 days: 14,00,000.
Trade payables: 18,00,000. Term loan outstanding: 22,00,000, monthly EMI 1,90,000.
Top overdue customers: Anand Traders 1.8L (94 days), Kavya Exports 1.2L (78 days), Ramesh & Co 0.9L (65 days), Sunrise Fabrics 0.7L (61 days).`;

const DEMO_DATA = {
  businessName: "Sharma Textiles",
  score: 62,
  headline: "Healthy profit, tight cash",
  summary: "Strong margins but receivables and low cash buffer create liquidity risk.",
  scoreDelta: "+3 pts vs last period",
  metrics: {
    revenue: "₹3.15 Cr",
    revenueNote: "Solid top-line for the period",
    netProfit: "₹28.6 L",
    netProfitNote: "9.1% net margin — healthy",
    cash: "₹9.2 L",
    cashNote: "Only ~1.5 months of opex cover",
    receivables: "₹37.5 L",
    receivablesNote: "41% of revenue locked in AR",
  },
  briefing: [
    "₹15.5 L is stuck in 61+ day receivables. Prioritise collection from Anand Traders and Kavya Exports this week.",
    "Cash of ₹9.2 L covers only ~1.5 months of operating expenses. Build a buffer of at least ₹20 L.",
    "Net margin of 9.1% is healthy. Protect it by avoiding deep discounts to clear old stock.",
  ],
  aging: {
    "0-30": "₹14.0 L",
    "31-60": "₹8.0 L",
    "61-90": "₹6.0 L",
    "90+": "₹9.5 L",
  },
  priorityCollections: [
    { name: "Anand Traders", amount: "₹1.8 L", days: "94 days overdue" },
    { name: "Kavya Exports", amount: "₹1.2 L", days: "78 days overdue" },
    { name: "Ramesh & Co", amount: "₹0.9 L", days: "65 days overdue" },
    { name: "Sunrise Fabrics", amount: "₹0.7 L", days: "61 days overdue" },
  ],
};

// ─────────────────────────────────────────────────────────────
// API HELPERS
// ─────────────────────────────────────────────────────────────
async function callClaude(system, messages) {
  // All Claude traffic goes through the Express proxy (/api/claude).
  // The Anthropic key never leaves the server.
  const response = await fetch("/api/claude", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system,
      messages,
      max_tokens: 1200,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    // NO_API_KEY or any other failure → frontend falls back to demo data
    const code = data.error || `HTTP_${response.status}`;
    throw new Error(code);
  }

  return data.text || "";
}

function parseJsonLoose(text) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result.split(",")[1]);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

// ─────────────────────────────────────────────────────────────
// UI PRIMITIVES
// ─────────────────────────────────────────────────────────────
function LedgerRow({ label, value, sub, tone }) {
  const color = tone === "bad" ? rust : tone === "good" ? moss : ink;
  return (
    <div
      className="flex items-center justify-between py-3 border-b"
      style={{ borderColor: "#D8DCE4" }}
    >
      <div>
        <div className="text-sm" style={{ color: ink }}>
          {label}
        </div>
        {sub && (
          <div className="text-xs mt-0.5" style={{ color: "#7A8296" }}>
            {sub}
          </div>
        )}
      </div>
      <div className="text-sm font-medium tabular-nums" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function ScoreDial({ score }) {
  const r = 54;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const color = score >= 70 ? moss : score >= 45 ? gold : rust;
  return (
    <svg width="140" height="140" viewBox="0 0 140 140">
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke="#E2E5EC"
        strokeWidth="10"
      />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={color}
        strokeWidth="10"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text
        x="70"
        y="66"
        textAnchor="middle"
        fontSize="30"
        fontWeight="600"
        fill={ink}
        fontFamily="'Fraunces', serif"
      >
        {score}
      </text>
      <text x="70" y="86" textAnchor="middle" fontSize="11" fill="#7A8296">
        out of 100
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  // 0 = consent, 1 = upload, 2 = loading
  const [stage, setStage] = useState(0);
  const [consented, setConsented] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [error, setError] = useState(null);

  const runExtraction = async (content) => {
    setStage(2);
    setError(null);
    try {
      const text = await callClaude(SYSTEM_EXTRACT, [
        { role: "user", content },
      ]);
      const parsed = parseJsonLoose(text);
      onDone(parsed);
    } catch (e) {
      // If no API key or any failure → fall back to rich demo data
      console.warn("Extraction fell back to demo data:", e.message);
      setTimeout(() => onDone(DEMO_DATA), 900);
    }
  };

  const handleFile = async (file) => {
    if (!file) return;
    const isPdf = file.type === "application/pdf";
    const isImage = file.type.startsWith("image/");
    try {
      if (isPdf || isImage) {
        const b64 = await fileToBase64(file);
        const block = isPdf
          ? {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: b64,
              },
            }
          : {
              type: "image",
              source: {
                type: "base64",
                media_type: file.type,
                data: b64,
              },
            };
        runExtraction([
          block,
          {
            type: "text",
            text: "Extract and analyze this business's financial statement per the system instructions.",
          },
        ]);
      } else {
        const text = await file.text();
        runExtraction(
          `Financial statement (raw export):\n${text}\n\nExtract and analyze per the system instructions.`
        );
      }
    } catch (e) {
      setError("Couldn't read that file. Try a PDF, image, or CSV.");
      setStage(1);
    }
  };

  return (
    <div
      className="flex flex-col h-full px-6 pt-14 pb-8"
      style={{ background: paper }}
    >
      <div className="text-xs tracking-wide" style={{ color: gold }}>
        FUTUSURE BUSINESS SOLUTION
      </div>
      <h1
        className="mt-2 text-3xl leading-tight"
        style={{ color: ink, fontFamily: "'Fraunces', serif" }}
      >
        Know what your
        <br />
        books aren't telling you.
      </h1>
      <p className="mt-3 text-sm" style={{ color: "#5B6478" }}>
        Upload your P&amp;L and Balance Sheet. An AI reads it, scores your
        business, and briefs you — no analyst, no back-and-forth.
      </p>

      {/* ── Stage 0: Consent ─────────────────────────────── */}
      {stage === 0 && (
        <div className="mt-8 flex-1 flex flex-col">
          <div
            className="rounded-lg p-4 text-sm leading-relaxed"
            style={{ background: "#FFFFFF", border: "1px solid #E2E5EC", color: ink }}
          >
            <div className="font-medium mb-2">Consent to process your financial data</div>
            <p className="text-xs" style={{ color: "#5B6478" }}>
              By continuing, you agree that Futusure AI CFO may:
            </p>
            <ul className="mt-2 text-xs space-y-1.5" style={{ color: "#5B6478" }}>
              <li>• Read and extract key numbers from documents you upload</li>
              <li>• Use AI to analyse business health, generate a score & briefing</li>
              <li>• Answer questions about your numbers in the AI CFO chat</li>
              <li>• Draft collection reminder messages for your review</li>
            </ul>
            <p className="mt-3 text-xs" style={{ color: "#5B6478" }}>
              We use this data only for the above purposes. You can request deletion at any time.
            </p>
          </div>

          <label className="mt-4 flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={consented}
              onChange={(e) => setConsented(e.target.checked)}
              className="mt-1 w-4 h-4 accent-[#B8862E]"
            />
            <span className="text-xs leading-snug" style={{ color: ink }}>
              I have read and agree to the processing of my financial data as described above.
            </span>
          </label>

          <button
            className="mt-2 text-xs underline self-start"
            style={{ color: "#8890A0" }}
            onClick={() => setShowPrivacy(!showPrivacy)}
          >
            {showPrivacy ? "Hide Privacy Notice" : "View Privacy Notice"}
          </button>

          {showPrivacy && (
            <div
              className="mt-3 rounded-lg p-3 text-[11px] leading-relaxed overflow-y-auto max-h-40"
              style={{ background: "#FFFFFF", border: "1px solid #E2E5EC", color: "#5B6478" }}
            >
              <strong style={{ color: ink }}>Privacy Notice</strong>
              <br /><br />
              <strong>What we collect:</strong> Financial statements you upload and the numbers our AI extracts.
              <br /><br />
              <strong>Why:</strong> To provide automated analysis, scoring, briefings, chat answers and reminder drafts.
              <br /><br />
              <strong>AI processing:</strong> Documents are processed by AI. Outputs should be reviewed by you.
              <br /><br />
              <strong>Retention:</strong> Data is kept while your session/account is active. You can request deletion anytime.
              <br /><br />
              <strong>Your rights:</strong> Access, correction or deletion — email privacy@futusure.com.
              <br /><br />
              We do not sell your data or use it for marketing without separate consent.
            </div>
          )}

          <button
            className="mt-6 w-full py-3 rounded-md text-sm font-medium disabled:opacity-40"
            style={{ background: consented ? gold : "#C7CCD8", color: "#FFFFFF" }}
            disabled={!consented}
            onClick={() => setStage(1)}
          >
            Continue
          </button>
        </div>
      )}

      {/* ── Stage 1: Upload ──────────────────────────────── */}
      {stage === 1 && (
        <div className="mt-10 flex-1 flex flex-col justify-center">
          <label
            className="border-2 border-dashed rounded-lg flex flex-col items-center justify-center py-10 cursor-pointer"
            style={{ borderColor: "#C7CCD8" }}
          >
            <Upload size={28} color={gold} />
            <span className="mt-3 text-sm font-medium" style={{ color: ink }}>
              Upload P&amp;L or Balance Sheet
            </span>
            <span className="mt-1 text-xs" style={{ color: "#8890A0" }}>
              PDF, image, or CSV export
            </span>
            <input
              type="file"
              className="hidden"
              accept=".pdf,image/*,.csv,.xlsx,.txt"
              onChange={(e) => handleFile(e.target.files[0])}
            />
          </label>
          <button
            className="mt-4 text-xs underline self-center"
            style={{ color: "#8890A0" }}
            onClick={() =>
              runExtraction(
                `${SAMPLE_TEXT}\n\nExtract and analyze per the system instructions.`
              )
            }
          >
            Try with sample data instead
          </button>
          {error && (
            <div className="mt-4 text-xs text-center" style={{ color: rust }}>
              {error}
            </div>
          )}
          <p className="mt-6 text-[11px] text-center" style={{ color: "#A0A6B4" }}>
            Demo mode works offline. Add ANTHROPIC_API_KEY on the server for live AI.
          </p>
        </div>
      )}

      {/* ── Stage 2: Loading ─────────────────────────────── */}
      {stage === 2 && (
        <div className="mt-10 flex-1 flex flex-col items-center justify-center">
          <div className="text-sm mb-4" style={{ color: "#5B6478" }}>
            AI is reading your statement…
          </div>
          <div
            className="w-full max-w-xs h-1.5 rounded-full overflow-hidden"
            style={{ background: "#E2E5EC" }}
          >
            <div
              className="h-full rounded-full animate-pulse"
              style={{ width: "70%", background: gold }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function HomeScreen({ data }) {
  return (
    <div
      className="px-5 pt-6 pb-4 overflow-y-auto h-full"
      style={{ background: paper }}
    >
      <div className="text-xs" style={{ color: "#8890A0" }}>
        Good morning
      </div>
      <h1
        className="text-xl mt-0.5"
        style={{ color: ink, fontFamily: "'Fraunces', serif" }}
      >
        {data.businessName}
      </h1>

      <div
        className="mt-5 rounded-lg p-5 flex items-center gap-4"
        style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
      >
        <ScoreDial score={data.score} />
        <div>
          <div className="text-sm font-medium" style={{ color: ink }}>
            {data.headline}
          </div>
          {data.scoreDelta && (
            <div className="text-xs mt-1" style={{ color: moss }}>
              {data.scoreDelta}
            </div>
          )}
          <div className="text-xs mt-2" style={{ color: "#5B6478" }}>
            {data.summary}
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-xs tracking-wide" style={{ color: "#8890A0" }}>
          AI BRIEFING
        </div>
        <div
          className="mt-2 rounded-lg p-4"
          style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
        >
          {(data.briefing || []).map((b, i) => (
            <div
              key={i}
              className={`flex gap-2 items-start ${i > 0 ? "mt-3" : ""}`}
            >
              {i === 0 ? (
                <AlertTriangle
                  size={16}
                  color={rust}
                  className="mt-0.5 shrink-0"
                />
              ) : i === 1 ? (
                <TrendingDown
                  size={16}
                  color={gold}
                  className="mt-0.5 shrink-0"
                />
              ) : (
                <CheckCircle2
                  size={16}
                  color={moss}
                  className="mt-0.5 shrink-0"
                />
              )}
              <p className="text-sm" style={{ color: ink }}>
                {b}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6">
        <div className="text-xs tracking-wide" style={{ color: "#8890A0" }}>
          KEY METRICS
        </div>
        <div
          className="mt-1 rounded-lg px-4"
          style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
        >
          <LedgerRow
            label="Revenue"
            value={data.metrics?.revenue}
            sub={data.metrics?.revenueNote}
            tone="good"
          />
          <LedgerRow
            label="Net Profit"
            value={data.metrics?.netProfit}
            sub={data.metrics?.netProfitNote}
            tone="good"
          />
          <LedgerRow
            label="Cash on Hand"
            value={data.metrics?.cash}
            sub={data.metrics?.cashNote}
            tone="bad"
          />
          <LedgerRow
            label="Receivables"
            value={data.metrics?.receivables}
            sub={data.metrics?.receivablesNote}
            tone="bad"
          />
        </div>
      </div>
    </div>
  );
}

function ChatScreen({ data }) {
  const [messages, setMessages] = useState([
    {
      from: "ai",
      text: `I'm your AI CFO for ${data.businessName}. Ask me anything about your numbers.`,
    },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (!input.trim() || sending) return;
    const question = input;
    const next = [...messages, { from: "user", text: question }];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const apiMessages = next.map((m) => ({
        role: m.from === "user" ? "user" : "assistant",
        content: m.text,
      }));
      const reply = await callClaude(buildSystemChat(data), apiMessages);
      setMessages((m) => [...m, { from: "ai", text: reply }]);
    } catch (e) {
      // Smart offline answers based on the loaded data
      let offlineReply =
        "I couldn't reach the live model just now. Here's what I can see from your current numbers: ";
      const q = question.toLowerCase();
      if (q.includes("cash") || q.includes("liquidity")) {
        offlineReply = `Your cash position is ${data.metrics?.cash}. ${data.metrics?.cashNote}. The biggest drag is the ${data.aging?.["90+"]} sitting in 90+ day receivables.`;
      } else if (q.includes("receivable") || q.includes("collect") || q.includes("overdue")) {
        offlineReply = `You have ${data.metrics?.receivables} in receivables. Priority targets: ${data.priorityCollections?.map((c) => `${c.name} (${c.amount})`).join(", ")}.`;
      } else if (q.includes("profit") || q.includes("margin")) {
        offlineReply = `Net profit stands at ${data.metrics?.netProfit}. ${data.metrics?.netProfitNote}.`;
      } else {
        offlineReply = `Based on the latest extract: Score ${data.score}/100 — ${data.headline}. ${data.summary}`;
      }
      setMessages((m) => [...m, { from: "ai", text: offlineReply }]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full" style={{ background: paper }}>
      <div
        className="px-5 pt-6 pb-3"
        style={{ borderBottom: "1px solid #E2E5EC", background: "#FFFFFF" }}
      >
        <div className="text-xs" style={{ color: "#8890A0" }}>
          Ask anything
        </div>
        <h1
          className="text-lg"
          style={{ color: ink, fontFamily: "'Fraunces', serif" }}
        >
          AI CFO
        </h1>
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.from === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className="max-w-[80%] rounded-lg px-4 py-2.5 text-sm"
              style={{
                background: m.from === "user" ? ink : "#FFFFFF",
                color: m.from === "user" ? "#FFFFFF" : ink,
                border: m.from === "user" ? "none" : "1px solid #E2E5EC",
              }}
            >
              {m.text}
            </div>
          </div>
        ))}
        {sending && (
          <div className="text-xs" style={{ color: "#8890A0" }}>
            AI CFO is thinking…
          </div>
        )}
      </div>
      <div
        className="px-4 py-3 flex gap-2"
        style={{ borderTop: "1px solid #E2E5EC", background: "#FFFFFF" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Why did my cash reduce?"
          className="flex-1 text-sm px-3 py-2 rounded-md outline-none"
          style={{ background: paper, color: ink }}
        />
        <button
          onClick={send}
          className="w-9 h-9 rounded-md flex items-center justify-center shrink-0"
          style={{ background: gold }}
        >
          <Send size={16} color="#FFFFFF" />
        </button>
      </div>
    </div>
  );
}

function AutoReminder({ overdue, businessName }) {
  const [state, setState] = useState("idle"); // idle | drafting | done
  const [drafts, setDrafts] = useState([]);

  const draftAll = async () => {
    if (overdue.length === 0) return;
    setState("drafting");
    try {
      const text = await callClaude(
        `You are drafting overdue-payment reminder messages on behalf of ${businessName}, sent with no human review. Tone: polite, firm, brief, WhatsApp-appropriate. Return ONLY a JSON array of strings, one drafted message per customer, in the same order given, each under 40 words, each mentioning the customer by name and the amount/days overdue.`,
        [{ role: "user", content: JSON.stringify(overdue) }]
      );
      setDrafts(parseJsonLoose(text));
      setState("done");
    } catch (e) {
      // Offline drafts
      const offline = overdue.map(
        (o) =>
          `Hi ${o.name}, gentle reminder that payment of ${o.amount} is now ${o.days}. Kindly arrange settlement at the earliest. – ${businessName}`
      );
      setDrafts(offline);
      setState("done");
    }
  };

  return (
    <div className="mt-3">
      <button
        className="w-full py-3 rounded-md text-sm font-medium"
        style={{
          background: "#FFFFFF",
          color: ink,
          border: `1px solid ${ink}`,
        }}
        onClick={draftAll}
        disabled={state === "drafting"}
      >
        {state === "drafting"
          ? "AI is drafting reminders…"
          : "Auto-draft collection reminders"}
      </button>
      {state === "done" && (
        <div className="mt-3 space-y-2">
          {drafts.map((d, i) => (
            <div
              key={i}
              className="rounded-lg p-3 text-xs"
              style={{
                background: "#FFFFFF",
                border: "1px solid #E2E5EC",
                color: ink,
              }}
            >
              {d}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BusinessScreen({ data }) {
  const aging = data.aging || {};
  const overdue = data.priorityCollections || [];
  return (
    <div
      className="px-5 pt-6 pb-4 overflow-y-auto h-full"
      style={{ background: paper }}
    >
      <h1
        className="text-lg"
        style={{ color: ink, fontFamily: "'Fraunces', serif" }}
      >
        Business
      </h1>

      <div className="mt-5 text-xs tracking-wide" style={{ color: "#8890A0" }}>
        RECEIVABLES AGING
      </div>
      <div
        className="mt-1 rounded-lg px-4"
        style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
      >
        <LedgerRow label="0–30 days" value={aging["0-30"] || "—"} />
        <LedgerRow label="31–60 days" value={aging["31-60"] || "—"} />
        <LedgerRow
          label="61–90 days"
          value={aging["61-90"] || "—"}
          tone="bad"
        />
        <LedgerRow
          label="90+ days"
          value={aging["90+"] || "—"}
          tone="bad"
        />
      </div>

      <div className="mt-6 text-xs tracking-wide" style={{ color: "#8890A0" }}>
        PRIORITY COLLECTIONS
      </div>
      <div
        className="mt-1 rounded-lg px-4"
        style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
      >
        {overdue.length === 0 && (
          <div className="py-3 text-sm" style={{ color: "#8890A0" }}>
            No overdue accounts identified.
          </div>
        )}
        {overdue.map((o, i) => (
          <LedgerRow
            key={i}
            label={o.name}
            sub={o.days}
            value={o.amount}
            tone="bad"
          />
        ))}
      </div>
      <AutoReminder overdue={overdue} businessName={data.businessName} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// PAYMENT + RECEIPT SCREENS
// ─────────────────────────────────────────────────────────────
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function PlansScreen({ onPaid, onSkipDemo }) {
  const [currency, setCurrency] = useState(detectDefaultCurrency());
  const [processing, setProcessing] = useState(null); // planId currently being paid for
  const [error, setError] = useState(null);

  const gateway = CURRENCIES[currency].gateway;

  // ── INR: Razorpay Checkout, then SERVER-SIDE signature verification.
  // Access is only unlocked after /api/verify-payment confirms the
  // signature — the client never gets to just declare "I paid".
  const payWithRazorpay = async (planId) => {
    setProcessing(planId);
    setError(null);
    try {
      const orderRes = await fetch("/api/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId }),
      });
      const order = await orderRes.json();
      if (!orderRes.ok) throw new Error(order.message || order.error || "Could not start payment");

      const scriptOk = await loadRazorpayScript();
      if (!scriptOk) throw new Error("Could not load payment gateway. Check your connection.");

      const rzp = new window.Razorpay({
        key: order.keyId,
        amount: order.amount,
        currency: order.currency,
        name: "Futusure AI CFO",
        description: order.planName,
        order_id: order.orderId,
        theme: { color: "#B8862E" },
        handler: async (response) => {
          try {
            const verifyRes = await fetch("/api/verify-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...response, plan: planId }),
            });
            const verify = await verifyRes.json();
            if (!verify.verified) throw new Error("Payment could not be verified.");

            const receipt = {
              planId,
              planName: order.planName,
              amount: order.amount / 100,
              currency: order.currency,
              paymentId: verify.paymentId,
              orderId: verify.orderId,
              date: new Date().toISOString(),
              status: "paid",
              method: "Razorpay",
            };
            localStorage.setItem(PAID_KEY, JSON.stringify({ plan: planId, ...receipt }));
            localStorage.setItem(RECEIPT_KEY, JSON.stringify(receipt));
            onPaid(receipt);
          } catch (e) {
            setError(e.message || "Payment could not be verified. If money was deducted, contact support.");
          } finally {
            setProcessing(null);
          }
        },
        modal: { ondismiss: () => setProcessing(null) },
      });
      rzp.on("payment.failed", () => {
        setError("Payment failed. Please try again.");
        setProcessing(null);
      });
      rzp.open();
    } catch (e) {
      setError(e.message);
      setProcessing(null);
    }
  };

  // ── International: Stripe Checkout (redirect). Confirmation happens
  // via /api/verify-checkout-session on return, backed by a webhook
  // server-side for the durable record — see server.js.
  const payWithStripe = async (planId) => {
    setProcessing(planId);
    setError(null);
    try {
      const res = await fetch("/api/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planId, currency: currency.toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.message || data.error || "Could not start checkout");
      window.location.href = data.url;
    } catch (e) {
      setError(e.message);
      setProcessing(null);
    }
  };

  const handlePay = (planId) => (gateway === "razorpay" ? payWithRazorpay(planId) : payWithStripe(planId));

  return (
    <div className="flex flex-col h-full px-5 pt-10 pb-6 overflow-y-auto" style={{ background: paper }}>
      <div className="flex items-center justify-between">
        <div className="text-xs tracking-wide" style={{ color: gold }}>
          CHOOSE YOUR PLAN
        </div>
        <select
          value={currency}
          onChange={(e) => setError(null) || setCurrency(e.target.value)}
          className="text-xs rounded-md px-2 py-1"
          style={{ border: "1px solid #E2E5EC", color: ink, background: "#FFFFFF" }}
        >
          {Object.entries(CURRENCIES).map(([code, c]) => (
            <option key={code} value={code}>{c.label}</option>
          ))}
        </select>
      </div>
      <h1 className="mt-1 text-2xl" style={{ color: ink, fontFamily: "'Fraunces', serif" }}>
        Unlock full AI CFO
      </h1>
      <p className="mt-2 text-sm" style={{ color: "#5B6478" }}>
        {gateway === "razorpay"
          ? "Pay securely via Razorpay. Money goes to Futusure Business Solutions Pvt Ltd (CA account)."
          : "Pay securely via Stripe. Cards from anywhere in the world are accepted."}
      </p>

      <div className="mt-6 space-y-4">
        {Object.values(PLANS).map((plan) => {
          const priceLabel = formatPrice(plan.prices[currency], currency);
          const isProcessing = processing === plan.id;
          return (
            <div
              key={plan.id}
              className="rounded-lg p-4"
              style={{
                background: "#FFFFFF",
                border: plan.id === "monthly" ? `2px solid ${gold}` : "1px solid #E2E5EC",
              }}
            >
              {(plan.id === "monthly" || plan.badge) && (
                <div className="text-[10px] font-medium mb-1" style={{ color: gold }}>
                  {plan.id === "monthly" ? "BEST VALUE" : plan.badge}
                </div>
              )}
              <div className="flex items-baseline justify-between">
                <div className="font-medium" style={{ color: ink }}>{plan.name}</div>
                <div>
                  <span className="text-xl font-semibold" style={{ color: ink }}>{priceLabel}</span>
                  <span className="text-xs ml-1" style={{ color: "#8890A0" }}>{plan.period}</span>
                </div>
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs" style={{ color: "#5B6478" }}>
                    <CheckCircle2 size={14} color={moss} className="mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <button
                className="mt-4 w-full py-2.5 rounded-md text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: plan.id === "monthly" ? gold : ink, color: "#FFFFFF" }}
                disabled={processing !== null}
                onClick={() => handlePay(plan.id)}
              >
                <CreditCard size={16} />
                {isProcessing ? "Processing…" : `Pay ${priceLabel} via ${gateway === "razorpay" ? "Razorpay" : "Stripe"}`}
              </button>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mt-4 text-xs text-center" style={{ color: rust }}>
          {error}
        </div>
      )}

      <button
        className="mt-6 text-xs underline self-center"
        style={{ color: "#8890A0" }}
        onClick={onSkipDemo}
      >
        Continue with free sample data instead
      </button>
    </div>
  );
}

function ReceiptScreen({ receipt, onContinue }) {
  const dateStr = receipt?.date
    ? new Date(receipt.date).toLocaleString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

  return (
    <div className="flex flex-col h-full px-5 pt-12 pb-6" style={{ background: paper }}>
      <div className="flex flex-col items-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ background: "#E8F5EE" }}
        >
          <ShieldCheck size={28} color={moss} />
        </div>
        <h1 className="mt-4 text-xl" style={{ color: ink, fontFamily: "'Fraunces', serif" }}>
          Payment Successful
        </h1>
        <p className="mt-1 text-sm" style={{ color: "#5B6478" }}>
          Thank you. Your receipt is below.
        </p>
      </div>

      <div
        className="mt-8 rounded-lg p-5"
        style={{ background: "#FFFFFF", border: "1px solid #E2E5EC" }}
      >
        <div className="flex items-center gap-2 mb-4">
          <Receipt size={18} color={gold} />
          <span className="text-sm font-medium" style={{ color: ink }}>Payment Receipt</span>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Plan</span>
            <span style={{ color: ink }}>{receipt?.planName || "—"}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Amount</span>
            <span className="font-medium" style={{ color: ink }}>
              {receipt?.amount != null
                ? formatPrice(receipt.amount, (receipt.currency || "INR").toUpperCase())
                : "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Payment ID</span>
            <span className="text-xs font-mono" style={{ color: ink }}>
              {receipt?.paymentId || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Order ID</span>
            <span className="text-xs font-mono" style={{ color: ink }}>
              {receipt?.orderId || "—"}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Date</span>
            <span style={{ color: ink }}>{dateStr}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: "#8890A0" }}>Status</span>
            <span style={{ color: moss }}>{receipt?.status || "paid"}</span>
          </div>
        </div>

        <div className="mt-5 pt-4 border-t text-[11px]" style={{ borderColor: "#E2E5EC", color: "#8890A0" }}>
          Futusure Business Solution<br />
          Payment processed securely via Razorpay<br />
          This is a computer-generated receipt.
        </div>
      </div>

      <button
        className="mt-8 w-full py-3 rounded-md text-sm font-medium"
        style={{ background: gold, color: "#FFFFFF" }}
        onClick={onContinue}
      >
        Continue to AI CFO
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState("loading"); // loading | plans | receipt | onboarding | app
  const [receipt, setReceipt] = useState(null);
  const [businessData, setBusinessDataState] = useState(null);
  const [tab, setTab] = useState("home");

  // Persist extracted business data on this device so a refresh doesn't
  // throw away the user's uploaded financial statement. This is a
  // stop-gap: it's still per-browser, not synced across devices, and
  // not a substitute for real accounts + a backend database if this
  // needs to support multiple users/devices per business.
  const setBusinessData = (data) => {
    setBusinessDataState(data);
    try {
      if (data) localStorage.setItem(BUSINESS_DATA_KEY, JSON.stringify(data));
      else localStorage.removeItem(BUSINESS_DATA_KEY);
    } catch {
      // localStorage can fail (private browsing, quota) — data still
      // works for this session via React state, just won't survive a refresh.
    }
  };

  useEffect(() => {
    const finishStripeReturn = async () => {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get("session_id");
      if (!sessionId) return false;

      try {
        const res = await fetch(`/api/verify-checkout-session?session_id=${encodeURIComponent(sessionId)}`);
        const data = await res.json();
        // Clean the URL regardless of outcome so a refresh doesn't re-trigger this
        window.history.replaceState({}, "", window.location.pathname);
        if (data.verified) {
          const receiptObj = {
            planId: data.plan,
            planName: PLANS[data.plan]?.name,
            amount: (data.amount || 0) / 100,
            currency: data.currency,
            paymentId: sessionId,
            orderId: sessionId,
            date: new Date().toISOString(),
            status: "paid",
            method: "Stripe",
          };
          localStorage.setItem(PAID_KEY, JSON.stringify({ plan: data.plan, ...receiptObj }));
          localStorage.setItem(RECEIPT_KEY, JSON.stringify(receiptObj));
          setReceipt(receiptObj);
          setStep("receipt");
          return true;
        }
      } catch {
        // fall through to normal plans/onboarding check below
      }
      return false;
    };

    const init = async () => {
      const handledStripeReturn = await finishStripeReturn();
      if (handledStripeReturn) return;

      try {
        const saved = localStorage.getItem(PAID_KEY);
        const savedReceipt = localStorage.getItem(RECEIPT_KEY);
        const savedBusinessData = localStorage.getItem(BUSINESS_DATA_KEY);
        if (savedBusinessData) setBusinessDataState(JSON.parse(savedBusinessData));

        if (saved) {
          if (savedReceipt) setReceipt(JSON.parse(savedReceipt));
          setStep(savedBusinessData ? "app" : "onboarding");
        } else {
          setStep("plans");
        }
      } catch {
        setStep("plans");
      }
    };

    init();
  }, []);

  if (step === "loading") {
    return (
      <div
        className="w-full max-w-sm mx-auto h-[720px] rounded-2xl overflow-hidden shadow-lg flex items-center justify-center"
        style={{ background: paper, fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <div className="text-sm" style={{ color: "#8890A0" }}>Loading…</div>
      </div>
    );
  }

  if (step === "plans") {
    return (
      <div
        className="w-full max-w-sm mx-auto h-[720px] rounded-2xl overflow-hidden shadow-lg"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <PlansScreen
          onPaid={(r) => {
            setReceipt(r);
            setStep("receipt");
          }}
          onSkipDemo={() => {
            // Free sample path – go straight to onboarding with sample
            setStep("onboarding");
          }}
        />
      </div>
    );
  }

  if (step === "receipt") {
    return (
      <div
        className="w-full max-w-sm mx-auto h-[720px] rounded-2xl overflow-hidden shadow-lg"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <ReceiptScreen
          receipt={receipt}
          onContinue={() => setStep("onboarding")}
        />
      </div>
    );
  }

  if (!businessData) {
    return (
      <div
        className="w-full max-w-sm mx-auto h-[720px] rounded-2xl overflow-hidden shadow-lg"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <Onboarding onDone={(d) => setBusinessData(d)} />
      </div>
    );
  }

  const screens = {
    home: <HomeScreen data={businessData} />,
    chat: <ChatScreen data={businessData} />,
    business: <BusinessScreen data={businessData} />,
  };

  const tabs = [
    { id: "home", label: "Home", icon: Home },
    { id: "chat", label: "AI CFO", icon: MessageCircle },
    { id: "business", label: "Business", icon: LayoutDashboard },
  ];

  return (
    <div
      className="w-full max-w-sm mx-auto h-[720px] rounded-2xl overflow-hidden shadow-lg flex flex-col"
      style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
    >
      <div className="flex-1 overflow-hidden">{screens[tab]}</div>
      <div
        className="flex"
        style={{ background: "#FFFFFF", borderTop: "1px solid #E2E5EC" }}
      >
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex flex-col items-center py-2.5 gap-1"
            >
              <Icon size={20} color={active ? ink : "#B0B6C2"} />
              <span
                className="text-[10px]"
                style={{ color: active ? ink : "#B0B6C2" }}
              >
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
