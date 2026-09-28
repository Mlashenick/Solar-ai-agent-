# Solar AI Agent

AI lead qualification and outreach for residential solar (PPA / lease, California — Riverside County focus).
It texts or emails opted-in homeowners, qualifies them with Claude, scores them 0–100, books consultations,
honors STOP requests, and syncs every lead to HubSpot.

No dependencies — plain Node 20.12+.

## Features
- **Claude-powered conversations** — one question at a time across 9 criteria (homeowner, property type, utility, bill, roof, shade, credit comfort, decision makers, appointment)
- **SMS (Twilio) and email (SendGrid)**, including inbound SMS replies via webhook
- **HubSpot sync** — upserts the contact, sets lead status, attaches a qualification note
- **Compliance guardrails** — outreach only to leads with consent, STOP/opt-out handling, contact hours (default 9am–6pm Pacific)
- **Dashboard** — pipeline table, conversation view, reply simulator, campaign runner (password protected)
- **Dry-run mode** — any service without keys just logs instead of sending; 61 fictional demo leads are never contacted

## Run locally
```bash
cp .env.example .env   # fill in what you have
npm start              # http://localhost:3000  (user: anything, password: DASHBOARD_PASSWORD)
```

## Deploy on Render
1. Render → **New → Blueprint** → pick this repo (uses `render.yaml`), or **New → Web Service** with start command `npm start`.
2. Add your keys under **Environment** (see `.env.example`). Set `PUBLIC_URL` to your Render URL.
3. The persistent disk at `data/` keeps leads across restarts (requires a paid instance).
4. In Twilio → your phone number → **A message comes in** → Webhook `https://YOUR-APP.onrender.com/webhooks/twilio/sms` (HTTP POST).

## Before texting real people
- Only contact people who gave **prior express written consent** (TCPA). Tick the consent box when adding a lead.
- Register your Twilio number for **A2P 10DLC**; unregistered traffic gets blocked.
- Get lead data from licensed, consent-based lead providers.

## API
| Method | Path | Purpose |
|---|---|---|
| GET | /api/status | Integration status |
| GET/POST | /api/leads | List / add leads |
| POST | /api/leads/:id/start | Send first message `{channel: "sms"\|"email"}` |
| POST | /api/leads/:id/simulate | Pretend the lead replied `{body}` |
| POST | /api/leads/:id/sync | Push to HubSpot |
| POST | /api/campaign | Contact new leads `{channel, limit}` |
| POST | /webhooks/twilio/sms | Twilio inbound SMS |
