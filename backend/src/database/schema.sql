-- PostgreSQL Database Schema for Football Statistical Analysis Engine
-- Focused on English Premier League (EPL) and EFL Championship

CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  short_name VARCHAR(64) NOT NULL,
  code VARCHAR(8) NOT NULL,
  league VARCHAR(32) NOT NULL,
  stadium VARCHAR(128),
  city VARCHAR(64),
  logo_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fixtures (
  id VARCHAR(128) PRIMARY KEY,
  external_id VARCHAR(64),
  league VARCHAR(32) NOT NULL,
  season VARCHAR(16) NOT NULL,
  round VARCHAR(64),
  match_date DATE NOT NULL,
  kickoff_time VARCHAR(32) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'TIMED',
  home_team_id VARCHAR(64) REFERENCES teams(id),
  away_team_id VARCHAR(64) REFERENCES teams(id),
  home_score INTEGER,
  away_score INTEGER,
  ht_home_score INTEGER,
  ht_away_score INTEGER,
  venue VARCHAR(128),
  data_source VARCHAR(64),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fixture_statistics (
  fixture_id VARCHAR(128) PRIMARY KEY REFERENCES fixtures(id) ON DELETE CASCADE,
  -- All statistics are explicitly NULLABLE to distinguish missing data from 0!
  shots_home INTEGER,
  shots_away INTEGER,
  shots_on_target_home INTEGER,
  shots_on_target_away INTEGER,
  xg_home NUMERIC(5, 2),
  xg_away NUMERIC(5, 2),
  corners_home INTEGER,
  corners_away INTEGER,
  fouls_home INTEGER,
  fouls_away INTEGER,
  yellow_cards_home INTEGER,
  yellow_cards_away INTEGER,
  red_cards_home INTEGER,
  red_cards_away INTEGER,
  possession_home INTEGER,
  possession_away INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS predictions (
  id VARCHAR(128) PRIMARY KEY,
  fixture_id VARCHAR(128) REFERENCES fixtures(id) ON DELETE CASCADE,
  league VARCHAR(32) NOT NULL,
  market VARCHAR(48) NOT NULL,
  market_label VARCHAR(64) NOT NULL,
  selection VARCHAR(128) NOT NULL,
  estimated_probability NUMERIC(6, 4) NOT NULL,
  raw_probability NUMERIC(6, 4) NOT NULL,
  confidence_lower NUMERIC(6, 4),
  confidence_upper NUMERIC(6, 4),
  supporting_statistics JSONB,
  sample_size INTEGER NOT NULL,
  data_freshness_days INTEGER NOT NULL,
  risk_factors TEXT[],
  actual_outcome VARCHAR(16) DEFAULT 'PENDING',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parlays (
  id VARCHAR(128) PRIMARY KEY,
  target_legs_count INTEGER NOT NULL,
  actual_legs_count INTEGER NOT NULL,
  status VARCHAR(32) NOT NULL,
  combined_probability NUMERIC(10, 8) NOT NULL,
  compound_odds_decimal NUMERIC(10, 2) NOT NULL,
  legs JSONB NOT NULL,
  correlation_explanation TEXT,
  independence_assumptions TEXT,
  risk_warning TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS model_evaluations (
  id SERIAL PRIMARY KEY,
  overall_brier_score NUMERIC(6, 4) NOT NULL,
  overall_log_loss NUMERIC(6, 4) NOT NULL,
  overall_hit_rate NUMERIC(6, 4) NOT NULL,
  sample_count INTEGER NOT NULL,
  league_breakdown JSONB,
  market_breakdown JSONB,
  calibration_buckets JSONB,
  evaluated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_fixtures_date ON fixtures(match_date);
CREATE INDEX IF NOT EXISTS idx_fixtures_league ON fixtures(league);
CREATE INDEX IF NOT EXISTS idx_predictions_fixture ON predictions(fixture_id);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(actual_outcome);
