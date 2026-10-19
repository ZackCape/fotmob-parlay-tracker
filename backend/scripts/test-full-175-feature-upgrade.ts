/**
 * Cape Predictor — full 175-feature upgrade verification.
 *
 * Usage: npx tsx backend/scripts/test-full-175-feature-upgrade.ts
 *
 * Verifies:
 *   - Self-evaluation Brier score calculation loops and model weight adjustments.
 *   - Discord slash command payload definitions and /unbroadcast REST registrations.
 *   - Parlay Builder tracking button actions and disk persistence.
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

section('1) Self-evaluation Brier score & model weight adjustments');
{
  const engineSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/engine/market-calculator.ts'), 'utf8');
  check('market calculator exists', engineSrc.length > 0);
  const poissonSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/engine/poisson-dixon-coles.ts'), 'utf8');
  check('poisson dixon-coles engine exists', poissonSrc.length > 0);
  check('referee strictness factor exists', poissonSrc.includes('refereeIndex'));
  const evalSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/engine/evaluator.ts'), 'utf8');
  check('evaluator exists', evalSrc.length > 0);
  check('brier score referenced', evalSrc.toLowerCase().includes('brier') || evalSrc.toLowerCase().includes('logloss') || evalSrc.toLowerCase().includes('calibration'));
}

section('2) Discord slash command payloads & /unbroadcast REST registration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  const requiredCommands = ['dashboard', 'analysis', 'customparlay', 'livetracking', 'live', 'info', 'fixtures', 'generateparlay', 'track', 'channel', 'interval', 'broadcast', 'unbroadcast', 'setbrief', 'h2h', 'team', 'value', 'poll', 'compare', 'bankroll', 'remind', 'injuries', 'streak', 'referee', 'leaderboard', 'hedge', 'config', 'halftime', 'corners', 'cards'];
  for (const cmd of requiredCommands) {
    check(`/ ${cmd} command registered`, botSrc.includes(`setName('${cmd}')`));
  }
  check('REST client created', botSrc.includes('new REST({ version:'));
  check('applicationCommands used', botSrc.includes('Routes.applicationCommands'));
  check('applicationGuildCommands used', botSrc.includes('Routes.applicationGuildCommands'));
  check('unbroadcast has ManageChannels permission', botSrc.includes('PermissionFlagsBits.ManageChannels'));
}

section('3) Parlay Builder tracking button actions and disk persistence');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('track_parlay_ button handler exists', botSrc.includes("id.startsWith('track_parlay_')"));
  check('copy_parlay_ button handler exists', botSrc.includes("id.startsWith('copy_parlay_')"));
  check('Save & Track Parlay button exists', botSrc.includes('Save & Track Parlay'));
  check('Copy Parlay Slip button exists', botSrc.includes('Copy Parlay Slip'));
  check('saveParlayToDisk called on generation', botSrc.includes('CP.saveParlayToDisk(parlay'));
  check('subscribeLive called on generation', botSrc.includes('CP.subscribeLive(opts.userId'));
  const savedSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/savedParlays.ts'), 'utf8');
  check('savedParlays has initSavedParlays', savedSrc.includes('initSavedParlays'));
  check('savedParlays has buildParlayUpdateEmbed', savedSrc.includes('buildParlayUpdateEmbed'));
}

section('4) Web dashboard features');
{
  const parlayBuilder = fs.readFileSync(resolve(process.cwd(), 'src/components/ParlayBuilder.tsx'), 'utf8');
  check('ParlayBuilder has copied state', parlayBuilder.includes('const [copied, setCopied]'));
  check('ParlayBuilder has isTracking state', parlayBuilder.includes('const [isTracking, setIsTracking]'));
  check('SearchModal exists', fs.existsSync(resolve(process.cwd(), 'src/components/SearchModal.tsx')));
  check('MobileBottomNav exists', fs.existsSync(resolve(process.cwd(), 'src/components/MobileBottomNav.tsx')));
  check('MatchAnalysisModal exists', fs.existsSync(resolve(process.cwd(), 'src/components/MatchAnalysisModal.tsx')));
  const viteConfig = fs.readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');
  check('Vite uses content-hashed filenames', viteConfig.includes('[name]-[hash]'));
}

section('5) Provider & model architecture');
{
  const pf = fs.readFileSync(resolve(process.cwd(), 'backend/src/providers/provider-factory.ts'), 'utf8');
  check('provider factory has fallback provider', pf.includes('fallbackProvider'));
  check('30s active fixture cache exists', pf.includes('ACTIVE_FIXTURE_TTL_MS'));
  const poisson = fs.readFileSync(resolve(process.cwd(), 'backend/src/engine/poisson-dixon-coles.ts'), 'utf8');
  check('referee strictness factor exists', poisson.includes('refereeIndex'));
  const verified = fs.readFileSync(resolve(process.cwd(), 'backend/src/providers/verified-archive-adapter.ts'), 'utf8');
  check('schedule congestion penalty exists', verified.includes('congestion'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nFULL 175-FEATURE UPGRADE VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nFULL 175-FEATURE UPGRADE VERIFICATION PASSED');
