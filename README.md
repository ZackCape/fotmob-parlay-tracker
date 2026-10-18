# ⚽ English Premier League & EFL Championship Football Statistical Analytics Engine

A production-grade, full-stack football statistical analysis and parlay modeling application focused **exclusively on the English Premier League (EPL) and English Football League (EFL) Championship**.

The system enables users to select **any calendar date**, ingest all available fixtures in both competitions, and analyze team form, expected goals (xG), head-to-head records, shots, corners, disciplinary records, injuries, and lineups. It runs an **explainable statistical prediction engine** using Dixon-Coles bivariate Poisson modeling and Bayesian shrinkage, and generates **5-leg, 10-leg, 15-leg, 20-leg, and 25-leg statistical parlays** with anti-correlation guarantees, without using betting odds as model inputs.

---

## 📑 Table of Contents
1. [Football API Provider Comparison & Selection](#1-football-api-provider-comparison--selection)
2. [Statistical Prediction Engine & Mathematical Model](#2-statistical-prediction-engine--mathematical-model)
3. [Statistical Parlay Engine (5 to 25 Legs)](#3-statistical-parlay-engine-5-to-25-legs)
4. [Data Integrity & Null vs Zero Policy](#4-data-integrity--null-vs-zero-policy)
5. [Modular System Architecture](#5-modular-system-architecture)
6. [Getting Started & Local Setup](#6-getting-started--local-setup)
7. [Environment Variables](#7-environment-variables)
8. [Automated Test Suite](#8-automated-test-suite)
9. [24/7 Cloud Deployment Guide](#9-247-cloud-deployment-guide)
10. [Honest List of Supported Data](#10-honest-list-of-supported-data)
11. [Statistical Risk Disclaimers](#11-statistical-risk-disclaimers)

---

## 1. Football API Provider Comparison & Selection

Before implementing the provider adapters, we compared the leading football data providers across league coverage, injuries, historical data, statistics, pricing, and rate limits:

| Feature / Metric | **API-Football (Api-Sports / RapidAPI)** | **Football-Data.org** | **Football-Data.co.uk (Open Archives)** | **TheSportsDB** | **Sportmonks / Opta** |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Premier League Coverage** | **Full** (League ID 39, live 15s updates) | **Full** (Code `PL` / ID 2021) | **Full** (30+ seasons CSV dataset `E0`) | Full (League ID 4328) | Full (Enterprise live tracking) |
| **EFL Championship Coverage** | **Full** (League ID 40, live 15s updates) | ⚠️ **Paid Only** (Restricted on Free Tier) | **Full** (30+ seasons CSV dataset `E1`) | Full (League ID 4329) | Full |
| **In-Match Stats (Shots, Corners, Fouls, Cards)** | **Complete match-level statistics** (inside/outside box, saves, passes) | Basic events only on free tier; lacks shots/corners | **Complete match stats** (HS, AS, HST, AST, HC, AC, HF, AF, HY, AY, HR, AR) | Lacks granular shots & corners | Complete tracking & event coordinates |
| **Expected Goals (xG)** | **Yes** (Native fixture statistics) | No | Historical shots/shots on target proxy | No | High-precision proprietary xG |
| **Injuries & Suspensions** | **Dedicated `/injuries` endpoint** with missing reason | No free injury feed | N/A | Basic status | Comprehensive injury feed |
| **Lineups & Formations** | **Yes** (Starting XI, tactical formation, coach) | Basic squads only | N/A | Squad list | Comprehensive player heatmaps |
| **Free Tier / Rate Limits** | **100 req/day (Free)**; 10 req/min | 10 req/min (Free) | **Unlimited (Open Data, Zero limits)** | 1 req/2 sec | Trial only (Paid enterprise) |
| **Pricing for Paid Tiers** | \$19/month (7,500 req/day) | €15 - €29/month | Free (Public archive) | \$5 - \$10/month | €100 - €1,000+/month |
| **Architectural Role in App** | **Primary Live REST Adapter** | **Secondary Fallback Adapter** | **Historical Baseline & Training Dataset** | N/A | Incompatible with open deployment |

### Selected Provider Strategy: Multi-Tier Adapter with Fallback
1. **Primary Live Adapter (`ApiFootballAdapter`)**: Connects directly to API-Football when `API_FOOTBALL_KEY` is provided. Supplies real-time fixtures, live scorelines, xG, match statistics, lineups, and injury reports.
2. **Secondary Live Adapter (`FootballDataOrgAdapter`)**: Connects to Football-Data.org as an optional provider.
3. **Verified Archive & Baseline Adapter (`VerifiedArchiveAdapter`)**: Ingests authentic historical Premier League and Championship matches with shots, shots on target, corners, fouls, cards, and xG. Ensures the application is **100% operational immediately out-of-the-box** even before external API keys are configured or when rate limits are exhausted.

---

## 2. Statistical Prediction Engine & Mathematical Model

The prediction engine strictly obeys the principle: **No betting odds as model inputs**. Model parameters are estimated solely from objective team performance:

### A. Dixon-Coles Bivariate Goal Expectancy
For Home Team $i$ and Away Team $j$:
$$\lambda_i = \mu \cdot \alpha_i \cdot \beta_j \cdot \gamma_{\text{home}}$$
$$\mu_j = \mu \cdot \alpha_j \cdot \beta_i$$
where:
- $\alpha_i$ is Team $i$'s attacking intensity relative to league baseline.
- $\beta_j$ is Team $j$'s defensive vulnerability relative to league baseline.
- $\gamma_{\text{home}}$ is the empirical home ground advantage parameter ($\approx 1.28$).
- $\mu$ is the baseline scoring rate per team per match (EPL: $\approx 1.42$, Championship: $\approx 1.30$).

### B. Low-Score Correlation Adjustment $\tau(x, y)$
In independent Poisson models, low scores ($0-0$ and $1-1$) are systematically underestimated. Dixon & Coles (1997) introduce the correlation parameter $\rho \approx -0.11$:
$$\tau_{\lambda, \mu}(x, y) = \begin{cases}
1 - \lambda \mu \rho & x=0, y=0 \\
1 + \mu \rho & x=0, y=1 \\
1 + \lambda \rho & x=1, y=0 \\
1 - \rho & x=1, y=1 \\
1 & \text{otherwise}
\end{cases}$$

The joint score probability is:
$$P(X=x, Y=y) = \tau_{\lambda, \mu}(x, y) \cdot \frac{\lambda^x e^{-\lambda}}{x!} \cdot \frac{\mu^y e^{-\mu}}{y!}$$
Normalized over an $8 \times 8$ score matrix ($0-0$ through $7-7$).

### C. Derived Market Probabilities
All markets are derived by summing joint probabilities:
- **Match Result (1X2)**: $P(\text{Home}) = \sum_{x > y} P(x, y)$, $P(\text{Draw}) = \sum_{x = y} P(x, y)$, $P(\text{Away}) = \sum_{x < y} P(x, y)$
- **Double Chance**: $1X = P(\text{Home}) + P(\text{Draw})$, $X2 = P(\text{Draw}) + P(\text{Away})$, $12 = P(\text{Home}) + P(\text{Away})$
- **Over/Under Goals**: $P(\text{Over 2.5}) = \sum_{x+y \ge 3} P(x, y)$, $P(\text{Under 2.5}) = \sum_{x+y \le 2} P(x, y)$
- **Both Teams to Score (BTTS)**: $P(\text{BTTS Yes}) = \sum_{x \ge 1, y \ge 1} P(x, y)$

### D. Empirical Bayesian Shrinkage & Uncertainty Bounds
Raw probabilities calculated on small sample sizes ($N < 15$) are shrunk towards empirical league priors:
$$p_{\text{calibrated}} = \frac{p_{\text{raw}} \cdot N + p_{\text{prior}} \cdot M}{N + M}$$
Binomial standard error confidence bounds ($95\%$ CI):
$$SE = \sqrt{\frac{p(1 - p)}{N_{\text{effective}}}}, \quad \text{CI} = \left[p - 1.96 \cdot SE, \; p + 1.96 \cdot SE\right]$$

---

## 3. Statistical Parlay Engine (5 to 25 Legs)

The application constructs **5-leg, 10-leg, 15-leg, 20-leg, and 25-leg** statistical combinations across the Premier League and Championship under rigorous constraints:

1. **Anti-Correlation Guarantee**:
   - **Strictly maximum 1 leg per fixture**: Selections from the same match are never combined. This prevents intra-match covariance (e.g. combining Home Win and Under 1.5).
   - Each leg originates from a distinct match played in a separate stadium.
2. **Strict Non-Fabrication of Selections**:
   - If a given date has fewer eligible matches than the requested leg count (e.g., only 6 matches on a Sunday when user selects 10, 15, 20, or 25 legs), **the engine never fabricates matches or duplicates selections**.
   - It outputs status `INSUFFICIENT_SELECTIONS` and returns the maximum safe independent parlay with an honest explanation banner.
3. **Combined Probability & Compound Odds**:
   $$P_{\text{combined}} = \prod_{i=1}^k P(\text{Leg}_i), \quad \text{Compound Odds} = \frac{1}{P_{\text{combined}}}$$
4. **Independence Assumption Explanation**:
   - Cross-fixture outcomes are modeled as conditionally independent given team attack/defense ratings and home field advantage.
   - External macroscopic factors (extreme nationwide winter weather disruptions, condensed fixture congestion) can introduce mild covariance.
5. **Mandatory Compound Risk Warning**:
   - Combining $25$ independent legs with $70\%$ probability each yields $(0.70)^{25} \approx 0.013\%$ joint probability ($\approx 1 \text{ in } 7,450$). Multi-leg parlays multiply risk exponentially.

---

## 4. Data Integrity & Null vs Zero Policy

To prevent misleading analytics, the engine enforces a strict schema rule:
> **Never fabricate fixtures, statistics, injuries, lineups or results. Clearly distinguish unavailable data from zero values.**

- In the database schema and TypeScript contracts, statistical fields are **strictly nullable (`number | null`)**:
  - If a future match has not taken place, its shots, corners, fouls, and xG are `null`. In the UI, they display `"N/A (Not tracked)"` or `"Data not provided"`, **never `0`**.
  - A zero value (`0`) is reserved exclusively for events that genuinely occurred zero times (e.g., a team recording 0 shots on target in a completed match).
- Unconfirmed lineups display `"Confirmed XI announced 1 hour prior to kickoff"`.

---

## 5. Modular System Architecture

```
epl-championship-analytics/
├── backend/
│   ├── src/
│   │   ├── config/env.ts              # Zod & Dotenv environment management
│   │   ├── types/football.ts          # Core TypeScript domain models
│   │   ├── data/
│   │   │   ├── authentic-teams.ts     # 20 EPL & 24 Championship clubs registry
│   │   │   ├── historical-stats.ts    # Match statistics archive (shots, xG, cards, corners)
│   │   │   └── fixtures-calendar.ts   # English fixture calendar engine
│   │   ├── providers/
│   │   │   ├── provider-interface.ts  # IFootballDataProvider contract
│   │   │   ├── api-football-adapter.ts# Live API-Football REST client
│   │   │   ├── football-data-adapter.ts# Football-Data.org client
│   │   │   ├── verified-archive-adapter.ts # Built-in verified archive & live fallback
│   │   │   └── provider-factory.ts    # Caching & provider fallback coordinator
│   │   ├── engine/
│   │   │   ├── poisson-dixon-coles.ts # Dixon-Coles goal expectancy & score matrix
│   │   │   ├── market-calculator.ts   # 1X2, Over/Under, BTTS, Double Chance derivation
│   │   │   ├── calibrator.ts          # Bayesian shrinkage & confidence intervals
│   │   │   └── evaluator.ts           # Brier score, log loss, calibration curve
│   │   ├── parlays/
│   │   │   ├── correlation-detector.ts# Anti-duplicate & correlation validator
│   │   │   └── parlay-builder.ts      # 5 - 25 leg parlay engine
│   │   ├── database/
│   │   │   ├── schema.sql             # Production PostgreSQL schema DDL
│   │   │   ├── db.ts                  # Dual-mode DB manager (PostgreSQL / SQLite fallback)
│   │   │   └── repositories.ts        # Prediction & Parlay repositories
│   │   ├── cron/scheduler.ts          # node-cron automated background sync
│   │   ├── routes/                    # Express REST endpoints (/api/*)
│   │   ├── app.ts                     # Express server configuration
│   │   └── server.ts                  # Application entrypoint
│   └── tests/                         # Vitest automated test suite
├── src/                               # Frontend React + Tailwind SPA
│   ├── components/                    # Navbar, DatePicker, FixtureCard, AnalysisModal, ParlayBuilder
│   ├── types.ts                       # Frontend API types
│   └── api.ts                         # REST client
├── Dockerfile                         # Multi-stage production container
├── docker-compose.yml                 # App + PostgreSQL 16 composition
└── render.yaml                        # 1-click cloud deployment manifest
```

---

## 6. Getting Started & Local Setup

### Prerequisites
- Node.js 20+ or 22+
- npm 10+
- Optional: PostgreSQL 15+ (local SQLite fallback activates automatically if PostgreSQL is omitted)

### Step-by-Step Installation
1. Clone the repository and navigate to the project directory:
   ```bash
   cd epl-championship-analytics
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create your `.env` configuration file:
   ```bash
   cp .env.example .env
   ```

4. Build the frontend dashboard:
   ```bash
   npm run build:frontend
   ```

5. Run unit & integration tests:
   ```bash
   npm test
   ```

6. Start the unified production server:
   ```bash
   npm start
   ```
   Open your browser at **`http://localhost:5000`** to interact with the responsive dashboard!

---

## 7. Environment Variables

Configure `.env` as needed:

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `5000` | Port for the HTTP API and dashboard server |
| `NODE_ENV` | `development` | Environment mode (`development` or `production`) |
| `DATABASE_URL` | *(Optional)* | PostgreSQL connection string (`postgresql://user:pass@host:5432/dbname`). If omitted, uses local storage fallback. |
| `DATA_PROVIDER` | `auto` | Active data provider mode: `auto`, `api-football`, `football-data`, or `verified-archive` |
| `API_FOOTBALL_KEY` | *(Optional)* | Free API key from [API-Sports](https://www.api-football.com/) or RapidAPI |
| `API_FOOTBALL_KEYS` | *(Optional)* | Comma-separated API-Football keys for automatic rotation on quota errors |
| `FOOTBALL_DATA_ORG_KEY` | *(Optional)* | Token from [Football-Data.org](https://www.football-data.org/) |
| `THE_ODDS_API_KEY` | *(Optional)* | Free key from [The Odds API](https://the-odds-api.com/). Without it the odds engine still responds but reports `odds_provider_not_configured`. |
| `THE_ODDS_API_REGIONS` | `uk` | Bookmaker regions for The Odds API (`uk`, `eu`, `us`) |
| `THE_ODDS_API_MONTHLY_LIMIT` | `500` | Monthly request budget; the engine throttles before the free quota is exhausted |
| `THE_ODDS_API_SAFETY_RESERVE` | `50` | Requests kept in reserve so live lookups never hard-fail |
| `DISCORD_BOT_TOKEN` | *(Optional)* | Discord bot token; without it the web app runs standalone |
| `REPORT_TIMEZONE` | `Africa/Harare` | Timezone for the nightly parlay report |
| `PARLAY_REPORT_CHANNEL_ID` | *(Optional)* | Discord channel for the nightly parlay report |
| `PUBLIC_URL` | `http://localhost:5000` | Public base URL used for Discord link buttons and the embedded dashboard |
| `CACHE_TTL_MINUTES` | `15` | In-memory cache duration to strictly protect API quotas |
| `SYNC_CRON_SCHEDULE` | `0 */4 * * *` | Cron schedule for background upcoming fixture refreshes |

---

## 8. Automated Test Suite

Run the Vitest test suite anytime with:
```bash
npm test
```

The test suite validates:
- **`backend/tests/engine.test.ts`**:
  - Poisson probability mass function accuracy.
  - Dixon-Coles low-score $\tau(x, y)$ adjustment boosting $0-0$ and $1-1$ frequencies.
  - Joint scoreline matrix normalization ($\sum P(x, y) = 1.0$).
  - Bayesian shrinkage toward empirical league priors on small samples.
  - Brier score and log-loss calculation on binary validation targets.
- **`backend/tests/parlay.test.ts`**:
  - Strict prevention of duplicate selections from the same fixture.
  - Assembling 5-leg, 10-leg, 15-leg, 20-leg, and 25-leg combinations.
  - Explicit reporting of `INSUFFICIENT_SELECTIONS` on scarce fixture dates without fabricating picks.
  - Compound probability multiplication and exponential tail risk calculation.
- **`backend/tests/provider.test.ts`**:
  - League filtering across Premier League and Championship.
  - Strict preservation of `null` values for unplayed match statistics (never default to `0`).
  - Comprehensive match analysis bundle integrity.

---

## 9. 24/7 Cloud Deployment Guide

The application is containerized to run continuously in the cloud without requiring your personal computer to stay powered on.

### Option A: Docker Compose (Self-Hosted / VPS)
Deploy to any Linux cloud server (DigitalOcean, AWS EC2, Hetzner, Linode) in one command:
```bash
docker compose up -d --build
```
This launches:
1. `football-analytics-db`: PostgreSQL 16 container with persistent volume and schema initialization.
2. `football-analytics-app`: Multi-stage Alpine container serving the backend REST API, automated cron refresher, and compiled React dashboard.

### Option B: Render.com (1-Click Deployment)
1. Fork or push this repository to GitHub.
2. In Render, select **Blueprints** -> **New Blueprint Instance**.
3. Select this repository. Render reads `render.yaml` and creates:
   - **`cape-predictor-db`** — a managed PostgreSQL instance (free plan, Frankfurt). Its connection string is injected into the web service as `DATABASE_URL`, so prediction and parlay history survives restarts and redeploys.
   - **`epl-championship-analytics`** — a Docker Web Service running the backend API, the Discord bot, the cron refresher and the compiled React dashboard, with health checks at `/api/system/status` and automatic restarts.
4. When Render prompts for the `sync: false` values, paste your secrets (they are never stored in the repository):
   `API_FOOTBALL_KEY`, `FOOTBALL_DATA_ORG_KEY`, `THE_ODDS_API_KEY`, `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `DISCORD_WEBHOOK_URL`, `PARLAY_REPORT_CHANNEL_ID`.
5. Set the Discord Developer Portal interactions endpoint / Activities URL to your service URL
   (`https://<service-name>.onrender.com`), and keep `PUBLIC_URL` in the blueprint in sync so link buttons resolve.

> [!IMPORTANT]
> **Free-plan caveats (be honest about them):**
> - A free Render Web Service **spins down after ~15 minutes of inactivity**, which pauses the Discord bot and live leg-hit alerts until the next request wakes it. Use a paid *Starter* instance for genuine 24/7 alerting.
> - Render's **free PostgreSQL expires after 30 days**; migrate to a paid database or export the data before then.
> - The free plan has **no persistent disk**, so the app's local JSON state under `/app/data` (`saved_parlays.json`, `user_live_subscriptions.json`, `seen_live_events.json`) is wiped on every redeploy or restart. Attach a Render disk mounted at `/app/data` (paid plans) to keep it.

### Option C: Railway.app / Fly.io
Deploy directly using the included `Dockerfile`:
```bash
# Railway
railway up

# Fly.io
fly launch
```

---

## 10. Honest List of Supported Data

| Data Feature | Supported Status | Details |
| :--- | :--- | :--- |
| **Competitions** | ✅ **Full Support** | English Premier League (20 clubs) & EFL Championship (24 clubs) ONLY. |
| **Fixture Date Range** | ✅ **Full Support** | Select any date via the calendar picker. Ingests official scheduled matches or past dates. |
| **Goals & Half-Time Scores** | ✅ **Full Support** | FT score, HT score, goals for/against averages, clean sheets, failed to score rates. |
| **Dixon-Coles Expected Goals (xG)** | ✅ **Full Support** | Team attack intensity, defense vulnerability, home advantage factor, joint scoreline heatmap. |
| **Shots & Shots on Target** | ✅ **Full Support** | Match-level shots and shots on target whenever reported by the data feed. |
| **Corners, Fouls & Cards** | ✅ **Full Support** | Corners, fouls, yellow and red cards recorded per fixture. |
| **Injuries & Suspensions** | ✅ **Full Support** | Player name, club, status (`OUT`, `DOUBTFUL`, `SUSPENDED`), and medical reason. |
| **Lineups & Formations** | ✅ **Full Support** | Starting XI, tactical formations (e.g. 4-3-3, 4-2-3-1), substitutes, and manager info. |
| **Betting Odds** | ❌ **Excluded by Design** | **Betting odds are strictly prohibited as model inputs**. Only objective performance metrics are used. |
| **Lower Tier Leagues (League 1, 2)** | ❌ **Not in Scope** | Explicitly scoped to Premier League and Championship only. |

---

## 11. Statistical Risk Disclaimers

> [!WARNING]
> **Probabilistic Modeling Disclaimer:**
> All outputs produced by this application are mathematical estimations derived from historical performance distributions and calibrated Bayesian models. **No statistical model can predict future sporting outcomes with certainty.**
>
> **Parlay Risk Multiplier:**
> Multi-leg parlays multiply risk exponentially. Even when combining high-probability statistical selections (e.g., $75\%$ per leg), a $25$-leg parlay yields an estimated combined probability of less than $0.015\%$ (approx 1 in $7,000$).
>
> **Responsible Analytics:**
> This software is created for statistical research, data analysis, and educational modeling purposes. **Predictions are never guaranteed, and parlays are never "sure wins".** Always exercise responsible judgment.
