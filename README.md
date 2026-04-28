# CM Transactional Tester — Render.com Edition

A browser-based testing tool for Campaign Monitor Transactional Emails.
Runs on Render.com (free tier) — no SMTP port blocks.

## Why Render instead of Vercel?

Vercel's serverless functions can't make outbound SMTP connections (ports 587, 465, 2525
are all blocked at the network level on the free tier). Render runs a normal Node.js
process with no such restrictions, so SMTP works correctly.

## Deploy to Render (free, ~3 minutes)

### Step 1 — Push to GitHub

1. Create a new GitHub repository (can be private)
2. Upload the contents of this folder to it
   - Easiest way: go to your new repo → "Add file" → "Upload files" → drag the folder contents in

### Step 2 — Deploy on Render

1. Go to https://render.com and sign in / create a free account
2. Click **New → Web Service**
3. Connect your GitHub account and select the repository you just created
4. Render will auto-detect Node.js. Confirm these settings:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
5. Click **Create Web Service**
6. Render builds and deploys — takes about 2 minutes
7. You'll get a URL like `https://cm-tester-xxxx.onrender.com`

> **Note:** On the free tier, Render spins down services after 15 minutes of inactivity.
> The first request after a sleep may take ~30 seconds to wake up. This is normal.

## Usage

1. Open your Render URL
2. Enter your credentials at the top (switches automatically by tab):
   - **Smart Email / Classic API tabs** → paste your CM API Key
   - **Classic SMTP tab** → paste your CM SMTP Token
     (found in your CM account under Transactional → SMTP settings)
3. Fill in the form and send

## Running Locally

```bash
npm install
npm start
# Open http://localhost:3000
```

## Project Structure

```
cm-tester-render/
├── server.js          ← Express server (API proxy + SMTP handler + static files)
├── package.json
├── public/
│   └── index.html     ← Frontend UI
└── README.md
```
