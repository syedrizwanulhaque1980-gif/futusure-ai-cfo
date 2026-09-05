# Futusure AI CFO

**100% AI-driven financial intelligence for MSMEs — zero manpower required.**

Upload a P&L / Balance Sheet → AI extracts numbers → scores the business → briefs the owner → answers questions → drafts collection reminders.

---

## Phase 1 – Launch the Web App (Recommended first)

### Option A: Deploy on Railway (Easiest – recommended)

1. Create a free account at [railway.app](https://railway.app)
2. Click **New Project** → **Deploy from GitHub** (or upload the folder)
3. Add these environment variables in Railway:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-your-key-here
   RAZORPAY_KEY_ID=rzp_live_xxxxxxxx
   RAZORPAY_KEY_SECRET=your_razorpay_secret
   ```
4. Set the **Start Command** to:
   ```
   npm run build && npm start
   ```
5. Railway will give you a public URL (example: `https://futusure-ai-cfo.up.railway.app`)

That’s it. Your app is live.

**Pricing built-in:**
- One-time Analysis → ₹499
- Monthly Subscription → ₹1,499
- Digital payment receipt after successful payment
- Money settles to your Razorpay-linked CA / business account

### Option B: Deploy on Render

1. Go to [render.com](https://render.com) → New → Web Service
2. Connect the repo or upload the code
3. **Build Command:** `npm install && npm run build`
4. **Start Command:** `npm start`
5. Add environment variables: `ANTHROPIC_API_KEY`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`
6. Deploy

### Option C: Test locally before deploying

```bash
npm install
npm run build
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open http://localhost:3001

---

## Demo Mode (works without API key)

Even without `ANTHROPIC_API_KEY` the app works using the built-in sample data (Sharma Textiles). Users can experience the full product immediately.

---

## What is already included

- Consent screen (DPDP-ready)
- Privacy Notice
- AI extraction + scoring + briefing
- AI CFO chat
- Auto-draft collection reminders
- Offline demo fallback
- Express proxy (API key stays on server only)

---

## Project Structure

```
futusure-ai-cfo/
├── server.js          ← Express (API proxy + serves frontend)
├── src/App.jsx        ← Full product UI
├── .env.example
├── package.json
└── README.md
```

---

## Next Steps after Phase 1

1. Share the live link with early users
2. Collect feedback
3. Later → add Capacitor for Play Store / App Store (Phase 2)

---

Built for Futusure Business Solution.
