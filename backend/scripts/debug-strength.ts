import { EspnAdapter } from '../src/providers/espn-adapter.js';
import { estimateTeamStrengths, sampleFromResults } from '../src/utils/teamStrength.js';

async function main() {
  const a = new EspnAdapter();
  const ids = ['401878771', '401879262', '401884769'];
  for (const id of ids) {
    const st = await a.getMatchStats(id);
    console.log(`\n=== event ${id} ===`);
    if (!st) { console.log('  getMatchStats -> null'); continue; }
    console.log('  form.home      :', JSON.stringify(st.form.home));
    console.log('  form.away      :', JSON.stringify(st.form.away));
    console.log('  recentGoals.home:', JSON.stringify(st.recentGoals?.home));
    console.log('  recentGoals.away:', JSON.stringify(st.recentGoals?.away));
    console.log('  xg             :', st.statistics?.xgHome, '/', st.statistics?.xgAway);
    const s = estimateTeamStrengths({
      league: 'EPL',
      homeRecent: sampleFromResults(st.recentGoals?.home),
      awayRecent: sampleFromResults(st.recentGoals?.away),
      homeXg: st.statistics?.xgHome ?? null,
      awayXg: st.statistics?.xgAway ?? null,
    });
    console.log('  strengths      :', JSON.stringify(s));
  }
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });