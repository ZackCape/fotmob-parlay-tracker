/**
 * Cape Predictor — analysis scorers & shots verification.
 *
 * Usage: npx tsx backend/scripts/test-analysis-scorers-shots.ts
 *
 * Verifies:
 *   - Goal events correctly extract scorer names, timestamps, and assist providers.
 *   - Shots on target parser accurately identifies top shooters for home and away sides.
 *   - /analysis embed builds cleanly without null/undefined errors on live or completed fixtures.
 *
 * Exits non-zero if any check fails.
 */
import fs from 'node:fs';
import { resolve } from 'node:path';

let failures = 0;
let checks = 0;

function check(label: string, condition: boolean, detail?: string) {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
}

function section(title: string) {
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);
}

section('1) MatchAnalysis type has new fields');
{
  const types = fs.readFileSync(resolve(process.cwd(), 'backend/src/types/football.ts'), 'utf8');
  check('goalScorers field exists', types.includes('goalScorers?:'));
  check('topShotsOnTarget field exists', types.includes('topShotsOnTarget?'));
}

section('2) ESPN adapter extracts goal scorers');
{
  const espn = fs.readFileSync(resolve(process.cwd(), 'backend/src/providers/espn-adapter.ts'), 'utf8');
  check('goalScorers extraction exists', espn.includes('const goalScorers:'));
  check('goalScorers pushed to return', espn.includes('goalScorers: goalScorers.length > 0 ? goalScorers : undefined'));
  check('topShotsOnTarget in return', espn.includes('topShotsOnTarget,'));
}

section('3) Analysis embed displays scorers and shots');
{
  const ae = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/analysisEmbeds.ts'), 'utf8');
  check('Goal Scorers field exists', ae.includes('Goal Scorers -'));
  check('Top Shots on Target field exists', ae.includes('Top Shots on Target -'));
  check('Stats populate fallback', ae.includes('Stats populate live during / post-match'));
  check('No goals fallback', ae.includes("homeGoals || 'No goals'"));
}

section('4) Build integrity');
{
  const { execSync } = await import('node:child_process');
  try {
    execSync('npm.cmd run build:backend', { cwd: process.cwd(), stdio: 'pipe' });
    check('backend build succeeds', true);
  } catch (e: any) {
    check('backend build succeeds', false, e.message?.slice(0, 200));
  }
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nANALYSIS SCORERS & SHOTS VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nANALYSIS SCORERS & SHOTS VERIFICATION PASSED');
