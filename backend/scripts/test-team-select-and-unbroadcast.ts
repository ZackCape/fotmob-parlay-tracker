/**
 * Cape Predictor — team select & unbroadcast verification.
 *
 * Usage: npx tsx backend/scripts/test-team-select-and-unbroadcast.ts
 *
 * Verifies:
 *   1. Interactive /team dropdown menu generation (league -> team -> profile).
 *   2. Guild command registration payload includes /unbroadcast.
 *   3. Frontend ParlayBuilder layout fix.
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

section('1) Interactive /team dropdown flow');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('team command accepts optional name param', botSrc.includes("setName('name')") && botSrc.includes("setRequired(false)"));
  check('team_league_select handler exists', botSrc.includes("id === 'team_league_select'"));
  check('team_select handler exists', botSrc.includes("id === 'team_select'"));
  check('StringSelectMenuBuilder imported', botSrc.includes('StringSelectMenuBuilder'));
  check('ackInteraction used for deferral', botSrc.includes("CP.ackInteraction(interaction, { ephemeral: true })"));
}

section('2) Guild command registration');
{
  const botSrc = fs.readFileSync(resolve(process.cwd(), 'backend/src/discord/bot.ts'), 'utf8');
  check('applicationGuildCommands used', botSrc.includes('Routes.applicationGuildCommands'));
  check('applicationCommands used (global)', botSrc.includes('Routes.applicationCommands'));
  check('unbroadcast in command definitions', botSrc.includes("setName('unbroadcast')"));
  check('ManageChannels permission set', botSrc.includes('PermissionFlagsBits.ManageChannels'));
  check('REST client created', botSrc.includes('new REST({ version:'));
}

section('3) ParlayBuilder layout fix');
{
  const src = fs.readFileSync(resolve(process.cwd(), 'src/components/ParlayBuilder.tsx'), 'utf8');
  check('flex-wrap wrapper exists', src.includes('flex flex-wrap items-center gap-2 sm:gap-3'));
  check('Track Parlay button uses emerald styling', src.includes('bg-emerald-500 hover:bg-emerald-400 text-slate-950'));
  check('Active tracking state exists', src.includes('Live Tracking Active'));
  check('isTracking state declared', src.includes('const [isTracking, setIsTracking] = useState<boolean>(false)'));
}

section('SUMMARY');
console.log(`checks run : ${checks}`);
console.log(`failures   : ${failures}`);
if (failures > 0) { console.error(`\nTEAM SELECT & UNBROADCAST VERIFICATION FAILED (${failures} check(s))`); process.exit(1); }
console.log('\nTEAM SELECT & UNBROADCAST VERIFICATION PASSED');
