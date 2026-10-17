import { Team, League } from '../types/football.js';

export const AUTHENTIC_EPL_TEAMS: Team[] = [
  { id: 'epl-ars', name: 'Arsenal', shortName: 'Arsenal', code: 'ARS', league: 'EPL', stadium: 'Emirates Stadium', city: 'London', logo: 'https://media.api-sports.io/football/teams/42.png' },
  { id: 'epl-avl', name: 'Aston Villa', shortName: 'Aston Villa', code: 'AVL', league: 'EPL', stadium: 'Villa Park', city: 'Birmingham', logo: 'https://media.api-sports.io/football/teams/66.png' },
  { id: 'epl-bou', name: 'AFC Bournemouth', shortName: 'Bournemouth', code: 'BOU', league: 'EPL', stadium: 'Vitality Stadium', city: 'Bournemouth', logo: 'https://media.api-sports.io/football/teams/35.png' },
  { id: 'epl-bre', name: 'Brentford', shortName: 'Brentford', code: 'BRE', league: 'EPL', stadium: 'Gtech Community Stadium', city: 'London', logo: 'https://media.api-sports.io/football/teams/55.png' },
  { id: 'epl-bha', name: 'Brighton & Hove Albion', shortName: 'Brighton', code: 'BHA', league: 'EPL', stadium: 'Amex Stadium', city: 'Falmer', logo: 'https://media.api-sports.io/football/teams/51.png' },
  { id: 'epl-che', name: 'Chelsea', shortName: 'Chelsea', code: 'CHE', league: 'EPL', stadium: 'Stamford Bridge', city: 'London', logo: 'https://media.api-sports.io/football/teams/49.png' },
  { id: 'epl-cry', name: 'Crystal Palace', shortName: 'Crystal Palace', code: 'CRY', league: 'EPL', stadium: 'Selhurst Park', city: 'London', logo: 'https://media.api-sports.io/football/teams/52.png' },
  { id: 'epl-eve', name: 'Everton', shortName: 'Everton', code: 'EVE', league: 'EPL', stadium: 'Goodison Park', city: 'Liverpool', logo: 'https://media.api-sports.io/football/teams/45.png' },
  { id: 'epl-ful', name: 'Fulham', shortName: 'Fulham', code: 'FUL', league: 'EPL', stadium: 'Craven Cottage', city: 'London', logo: 'https://media.api-sports.io/football/teams/36.png' },
  { id: 'epl-ips', name: 'Ipswich Town', shortName: 'Ipswich', code: 'IPS', league: 'EPL', stadium: 'Portman Road', city: 'Ipswich', logo: 'https://media.api-sports.io/football/teams/57.png' },
  { id: 'epl-lei', name: 'Leicester City', shortName: 'Leicester', code: 'LEI', league: 'EPL', stadium: 'King Power Stadium', city: 'Leicester', logo: 'https://media.api-sports.io/football/teams/46.png' },
  { id: 'epl-liv', name: 'Liverpool', shortName: 'Liverpool', code: 'LIV', league: 'EPL', stadium: 'Anfield', city: 'Liverpool', logo: 'https://media.api-sports.io/football/teams/40.png' },
  { id: 'epl-mci', name: 'Manchester City', shortName: 'Man City', code: 'MCI', league: 'EPL', stadium: 'Etihad Stadium', city: 'Manchester', logo: 'https://media.api-sports.io/football/teams/50.png' },
  { id: 'epl-mun', name: 'Manchester United', shortName: 'Man Utd', code: 'MUN', league: 'EPL', stadium: 'Old Trafford', city: 'Manchester', logo: 'https://media.api-sports.io/football/teams/33.png' },
  { id: 'epl-new', name: 'Newcastle United', shortName: 'Newcastle', code: 'NEW', league: 'EPL', stadium: "St James' Park", city: 'Newcastle', logo: 'https://media.api-sports.io/football/teams/34.png' },
  { id: 'epl-nfo', name: 'Nottingham Forest', shortName: "Nott'm Forest", code: 'NFO', league: 'EPL', stadium: 'City Ground', city: 'Nottingham', logo: 'https://media.api-sports.io/football/teams/65.png' },
  { id: 'epl-sou', name: 'Southampton', shortName: 'Southampton', code: 'SOU', league: 'EPL', stadium: "St Mary's Stadium", city: 'Southampton', logo: 'https://media.api-sports.io/football/teams/41.png' },
  { id: 'epl-tot', name: 'Tottenham Hotspur', shortName: 'Tottenham', code: 'TOT', league: 'EPL', stadium: 'Tottenham Hotspur Stadium', city: 'London', logo: 'https://media.api-sports.io/football/teams/47.png' },
  { id: 'epl-whu', name: 'West Ham United', shortName: 'West Ham', code: 'WHU', league: 'EPL', stadium: 'London Stadium', city: 'London', logo: 'https://media.api-sports.io/football/teams/48.png' },
  { id: 'epl-wol', name: 'Wolverhampton Wanderers', shortName: 'Wolves', code: 'WOL', league: 'EPL', stadium: 'Molineux Stadium', city: 'Wolverhampton', logo: 'https://media.api-sports.io/football/teams/39.png' },
];

export const AUTHENTIC_CHAMPIONSHIP_TEAMS: Team[] = [
  { id: 'ch-bla', name: 'Blackburn Rovers', shortName: 'Blackburn', code: 'BLA', league: 'CHAMPIONSHIP', stadium: 'Ewood Park', city: 'Blackburn', logo: 'https://media.api-sports.io/football/teams/67.png' },
  { id: 'ch-bri', name: 'Bristol City', shortName: 'Bristol City', code: 'BRI', league: 'CHAMPIONSHIP', stadium: 'Ashton Gate', city: 'Bristol', logo: 'https://media.api-sports.io/football/teams/59.png' },
  { id: 'ch-bur', name: 'Burnley', shortName: 'Burnley', code: 'BUR', league: 'CHAMPIONSHIP', stadium: 'Turf Moor', city: 'Burnley', logo: 'https://media.api-sports.io/football/teams/44.png' },
  { id: 'ch-car', name: 'Cardiff City', shortName: 'Cardiff', code: 'CAR', league: 'CHAMPIONSHIP', stadium: 'Cardiff City Stadium', city: 'Cardiff', logo: 'https://media.api-sports.io/football/teams/75.png' },
  { id: 'ch-cov', name: 'Coventry City', shortName: 'Coventry', code: 'COV', league: 'CHAMPIONSHIP', stadium: 'Coventry Building Society Arena', city: 'Coventry', logo: 'https://media.api-sports.io/football/teams/1359.png' },
  { id: 'ch-der', name: 'Derby County', shortName: 'Derby', code: 'DER', league: 'CHAMPIONSHIP', stadium: 'Pride Park Stadium', city: 'Derby', logo: 'https://media.api-sports.io/football/teams/68.png' },
  { id: 'ch-hul', name: 'Hull City', shortName: 'Hull', code: 'HUL', league: 'CHAMPIONSHIP', stadium: 'MKM Stadium', city: 'Hull', logo: 'https://media.api-sports.io/football/teams/64.png' },
  { id: 'ch-lee', name: 'Leeds United', shortName: 'Leeds', code: 'LEE', league: 'CHAMPIONSHIP', stadium: 'Elland Road', city: 'Leeds', logo: 'https://media.api-sports.io/football/teams/63.png' },
  { id: 'ch-lut', name: 'Luton Town', shortName: 'Luton', code: 'LUT', league: 'CHAMPIONSHIP', stadium: 'Kenilworth Road', city: 'Luton', logo: 'https://media.api-sports.io/football/teams/1356.png' },
  { id: 'ch-mid', name: 'Middlesbrough', shortName: 'Middlesbrough', code: 'MID', league: 'CHAMPIONSHIP', stadium: 'Riverside Stadium', city: 'Middlesbrough', logo: 'https://media.api-sports.io/football/teams/70.png' },
  { id: 'ch-mil', name: 'Millwall', shortName: 'Millwall', code: 'MIL', league: 'CHAMPIONSHIP', stadium: 'The Den', city: 'London', logo: 'https://media.api-sports.io/football/teams/60.png' },
  { id: 'ch-nor', name: 'Norwich City', shortName: 'Norwich', code: 'NOR', league: 'CHAMPIONSHIP', stadium: 'Carrow Road', city: 'Norwich', logo: 'https://media.api-sports.io/football/teams/71.png' },
  { id: 'ch-oxf', name: 'Oxford United', shortName: 'Oxford Utd', code: 'OXF', league: 'CHAMPIONSHIP', stadium: 'Kassam Stadium', city: 'Oxford', logo: 'https://media.api-sports.io/football/teams/1373.png' },
  { id: 'ch-ply', name: 'Plymouth Argyle', shortName: 'Plymouth', code: 'PLY', league: 'CHAMPIONSHIP', stadium: 'Home Park', city: 'Plymouth', logo: 'https://media.api-sports.io/football/teams/1374.png' },
  { id: 'ch-por', name: 'Portsmouth', shortName: 'Portsmouth', code: 'POR', league: 'CHAMPIONSHIP', stadium: 'Fratton Park', city: 'Portsmouth', logo: 'https://media.api-sports.io/football/teams/72.png' },
  { id: 'ch-pre', name: 'Preston North End', shortName: 'Preston', code: 'PRE', league: 'CHAMPIONSHIP', stadium: 'Deepdale', city: 'Preston', logo: 'https://media.api-sports.io/football/teams/61.png' },
  { id: 'ch-qpr', name: 'Queens Park Rangers', shortName: 'QPR', code: 'QPR', league: 'CHAMPIONSHIP', stadium: 'Loftus Road', city: 'London', logo: 'https://media.api-sports.io/football/teams/73.png' },
  { id: 'ch-shu', name: 'Sheffield United', shortName: 'Sheffield Utd', code: 'SHU', league: 'CHAMPIONSHIP', stadium: 'Bramall Lane', city: 'Sheffield', logo: 'https://media.api-sports.io/football/teams/62.png' },
  { id: 'ch-shw', name: 'Sheffield Wednesday', shortName: 'Sheffield Wed', code: 'SHW', league: 'CHAMPIONSHIP', stadium: 'Hillsborough', city: 'Sheffield', logo: 'https://media.api-sports.io/football/teams/74.png' },
  { id: 'ch-sto', name: 'Stoke City', shortName: 'Stoke', code: 'STO', league: 'CHAMPIONSHIP', stadium: 'bet365 Stadium', city: 'Stoke-on-Trent', logo: 'https://media.api-sports.io/football/teams/77.png' },
  { id: 'ch-sun', name: 'Sunderland', shortName: 'Sunderland', code: 'SUN', league: 'CHAMPIONSHIP', stadium: 'Stadium of Light', city: 'Sunderland', logo: 'https://media.api-sports.io/football/teams/76.png' },
  { id: 'ch-swa', name: 'Swansea City', shortName: 'Swansea', code: 'SWA', league: 'CHAMPIONSHIP', stadium: 'Swansea.com Stadium', city: 'Swansea', logo: 'https://media.api-sports.io/football/teams/78.png' },
  { id: 'ch-wat', name: 'Watford', shortName: 'Watford', code: 'WAT', league: 'CHAMPIONSHIP', stadium: 'Vicarage Road', city: 'Watford', logo: 'https://media.api-sports.io/football/teams/38.png' },
  { id: 'ch-wba', name: 'West Bromwich Albion', shortName: 'West Brom', code: 'WBA', league: 'CHAMPIONSHIP', stadium: 'The Hawthorns', city: 'West Bromwich', logo: 'https://media.api-sports.io/football/teams/58.png' },
];

export const AUTHENTIC_LALIGA_TEAMS: Team[] = [
  { id: 'es-rma', name: 'Real Madrid', shortName: 'Real Madrid', code: 'RMA', league: 'LALIGA', stadium: 'Santiago Bernabéu', city: 'Madrid', logo: 'https://media.api-sports.io/football/teams/541.png' },
  { id: 'es-bar', name: 'FC Barcelona', shortName: 'Barcelona', code: 'BAR', league: 'LALIGA', stadium: 'Estadi Olímpic Lluís Companys', city: 'Barcelona', logo: 'https://media.api-sports.io/football/teams/529.png' },
  { id: 'es-atm', name: 'Atlético Madrid', shortName: 'Atlético', code: 'ATM', league: 'LALIGA', stadium: 'Civitas Metropolitano', city: 'Madrid', logo: 'https://media.api-sports.io/football/teams/530.png' },
  { id: 'es-ath', name: 'Athletic Club', shortName: 'Athletic Bilbao', code: 'ATH', league: 'LALIGA', stadium: 'San Mamés', city: 'Bilbao', logo: 'https://media.api-sports.io/football/teams/531.png' },
  { id: 'es-rso', name: 'Real Sociedad', shortName: 'Real Sociedad', code: 'RSO', league: 'LALIGA', stadium: 'Reale Arena', city: 'San Sebastián', logo: 'https://media.api-sports.io/football/teams/548.png' },
  { id: 'es-bet', name: 'Real Betis', shortName: 'Betis', code: 'BET', league: 'LALIGA', stadium: 'Benito Villamarín', city: 'Sevilla', logo: 'https://media.api-sports.io/football/teams/543.png' },
  { id: 'es-vil', name: 'Villarreal CF', shortName: 'Villarreal', code: 'VIL', league: 'LALIGA', stadium: 'Estadio de la Cerámica', city: 'Villarreal', logo: 'https://media.api-sports.io/football/teams/533.png' },
  { id: 'es-gir', name: 'Girona FC', shortName: 'Girona', code: 'GIR', league: 'LALIGA', stadium: 'Montilivi', city: 'Girona', logo: 'https://media.api-sports.io/football/teams/547.png' },
  { id: 'es-sev', name: 'Sevilla FC', shortName: 'Sevilla', code: 'SEV', league: 'LALIGA', stadium: 'Ramón Sánchez-Pizjuán', city: 'Sevilla', logo: 'https://media.api-sports.io/football/teams/536.png' },
  { id: 'es-val', name: 'Valencia CF', shortName: 'Valencia', code: 'VAL', league: 'LALIGA', stadium: 'Mestalla', city: 'Valencia', logo: 'https://media.api-sports.io/football/teams/532.png' },
];

export const AUTHENTIC_LIGUE1_TEAMS: Team[] = [
  { id: 'fr-psg', name: 'Paris Saint-Germain', shortName: 'PSG', code: 'PSG', league: 'LIGUE1', stadium: 'Parc des Princes', city: 'Paris', logo: 'https://media.api-sports.io/football/teams/85.png' },
  { id: 'fr-mon', name: 'AS Monaco', shortName: 'Monaco', code: 'ASM', league: 'LIGUE1', stadium: 'Stade Louis II', city: 'Monaco', logo: 'https://media.api-sports.io/football/teams/91.png' },
  { id: 'fr-mar', name: 'Olympique de Marseille', shortName: 'Marseille', code: 'OM', league: 'LIGUE1', stadium: 'Stade Vélodrome', city: 'Marseille', logo: 'https://media.api-sports.io/football/teams/81.png' },
  { id: 'fr-lil', name: 'Lille OSC', shortName: 'Lille', code: 'LOSC', league: 'LIGUE1', stadium: 'Decathlon Arena', city: 'Lille', logo: 'https://media.api-sports.io/football/teams/79.png' },
  { id: 'fr-lyo', name: 'Olympique Lyonnais', shortName: 'Lyon', code: 'OL', league: 'LIGUE1', stadium: 'Groupama Stadium', city: 'Lyon', logo: 'https://media.api-sports.io/football/teams/80.png' },
  { id: 'fr-len', name: 'RC Lens', shortName: 'Lens', code: 'RCL', league: 'LIGUE1', stadium: 'Stade Bollaert-Delelis', city: 'Lens', logo: 'https://media.api-sports.io/football/teams/116.png' },
  { id: 'fr-nic', name: 'OGC Nice', shortName: 'Nice', code: 'OGCN', league: 'LIGUE1', stadium: 'Allianz Riviera', city: 'Nice', logo: 'https://media.api-sports.io/football/teams/84.png' },
  { id: 'fr-ren', name: 'Stade Rennais', shortName: 'Rennes', code: 'SRFC', league: 'LIGUE1', stadium: 'Roazhon Park', city: 'Rennes', logo: 'https://media.api-sports.io/football/teams/94.png' },
];

export const AUTHENTIC_EUROPEAN_TEAMS: Team[] = [
  { id: 'eu-bay', name: 'FC Bayern München', shortName: 'Bayern Munich', code: 'BAY', league: 'CHAMPIONS_LEAGUE', stadium: 'Allianz Arena', city: 'Munich', logo: 'https://media.api-sports.io/football/teams/157.png' },
  { id: 'eu-dor', name: 'Borussia Dortmund', shortName: 'Dortmund', code: 'BVB', league: 'CHAMPIONS_LEAGUE', stadium: 'Signal Iduna Park', city: 'Dortmund', logo: 'https://media.api-sports.io/football/teams/165.png' },
  { id: 'eu-lev', name: 'Bayer 04 Leverkusen', shortName: 'Leverkusen', code: 'B04', league: 'CHAMPIONS_LEAGUE', stadium: 'BayArena', city: 'Leverkusen', logo: 'https://media.api-sports.io/football/teams/168.png' },
  { id: 'eu-int', name: 'Inter Milan', shortName: 'Inter', code: 'INT', league: 'CHAMPIONS_LEAGUE', stadium: 'San Siro', city: 'Milan', logo: 'https://media.api-sports.io/football/teams/505.png' },
  { id: 'eu-juv', name: 'Juventus', shortName: 'Juventus', code: 'JUV', league: 'CHAMPIONS_LEAGUE', stadium: 'Allianz Stadium', city: 'Turin', logo: 'https://media.api-sports.io/football/teams/496.png' },
  { id: 'eu-mil', name: 'AC Milan', shortName: 'AC Milan', code: 'ACM', league: 'CHAMPIONS_LEAGUE', stadium: 'San Siro', city: 'Milan', logo: 'https://media.api-sports.io/football/teams/489.png' },
  { id: 'eu-ata', name: 'Atalanta BC', shortName: 'Atalanta', code: 'ATA', league: 'EUROPA_LEAGUE', stadium: 'Gewiss Stadium', city: 'Bergamo', logo: 'https://media.api-sports.io/football/teams/499.png' },
  { id: 'eu-rom', name: 'AS Roma', shortName: 'Roma', code: 'ROM', league: 'EUROPA_LEAGUE', stadium: 'Stadio Olimpico', city: 'Rome', logo: 'https://media.api-sports.io/football/teams/497.png' },
  { id: 'eu-spo', name: 'Sporting CP', shortName: 'Sporting CP', code: 'SCP', league: 'CHAMPIONS_LEAGUE', stadium: 'Estádio José Alvalade', city: 'Lisbon', logo: 'https://media.api-sports.io/football/teams/228.png' },
  { id: 'eu-ben', name: 'SL Benfica', shortName: 'Benfica', code: 'BEN', league: 'CHAMPIONS_LEAGUE', stadium: 'Estádio da Luz', city: 'Lisbon', logo: 'https://media.api-sports.io/football/teams/211.png' },
  { id: 'eu-aja', name: 'AFC Ajax', shortName: 'Ajax', code: 'AJX', league: 'EUROPA_LEAGUE', stadium: 'Johan Cruyff Arena', city: 'Amsterdam', logo: 'https://media.api-sports.io/football/teams/194.png' },
  { id: 'eu-fio', name: 'ACF Fiorentina', shortName: 'Fiorentina', code: 'FIO', league: 'CONFERENCE_LEAGUE', stadium: 'Stadio Artemio Franchi', city: 'Florence', logo: 'https://media.api-sports.io/football/teams/502.png' },
  { id: 'eu-bet', name: 'Real Betis', shortName: 'Real Betis', code: 'BET', league: 'CONFERENCE_LEAGUE', stadium: 'Benito Villamarín', city: 'Seville', logo: 'https://media.api-sports.io/football/teams/543.png' },
  { id: 'eu-oly', name: 'Olympiacos FC', shortName: 'Olympiacos', code: 'OLY', league: 'EUROPA_LEAGUE', stadium: 'Karaiskakis Stadium', city: 'Piraeus', logo: 'https://media.api-sports.io/football/teams/553.png' },
];

export const ALL_AUTHENTIC_TEAMS: Team[] = [
  ...AUTHENTIC_EPL_TEAMS,
  ...AUTHENTIC_CHAMPIONSHIP_TEAMS,
  ...AUTHENTIC_LALIGA_TEAMS,
  ...AUTHENTIC_LIGUE1_TEAMS,
  ...AUTHENTIC_EUROPEAN_TEAMS,
];

const COMMON_ALIASES: Record<string, string> = {
  'paris sg': 'fr-psg',
  'psg': 'fr-psg',
  'paris': 'fr-psg',
  'man city': 'epl-mci',
  'manchester city': 'epl-mci',
  'man utd': 'epl-mun',
  'man united': 'epl-mun',
  'manchester united': 'epl-mun',
  'athletic bilbao': 'es-ath',
  'athletic club': 'es-ath',
  'atletico madrid': 'es-atm',
  'atlético madrid': 'es-atm',
  'atletico': 'es-atm',
  'real madrid': 'es-rma',
  'barcelona': 'es-bar',
  'fc barcelona': 'es-bar',
  'bayern': 'eu-bay',
  'bayern munich': 'eu-bay',
  'dortmund': 'eu-dor',
  'borussia dortmund': 'eu-dor',
  'inter': 'eu-int',
  'inter milan': 'eu-int',
  'milan': 'eu-mil',
  'ac milan': 'eu-mil',
  'sporting': 'eu-spo',
  'sporting cp': 'eu-spo',
  'benfica': 'eu-ben',
  'ajax': 'eu-aja',
  'fiorentina': 'eu-fio',
  'juventus': 'eu-juv',
  'roma': 'eu-rom',
  'as roma': 'eu-rom',
  'spurs': 'epl-tot',
  'tottenham': 'epl-tot',
  'wolves': 'epl-wol',
  'west ham': 'epl-whu',
  'newcastle': 'epl-new',
  'aston villa': 'epl-avl',
  'bournemouth': 'epl-bou',
  'brighton': 'epl-bha',
  'crystal palace': 'epl-cry',
  'nottingham': 'epl-nfo',
  'notts forest': 'epl-nfo',
};

function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics / accents
    .replace(/\b(fc|cf|afc|sc|osc|bkt|ea sports)\b/gi, '')
    .replace(/[^a-z0-9]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function findTeamByIdOrName(query: string): Team | undefined {
  if (!query) return undefined;
  const qRaw = query.toLowerCase().trim();
  const qNorm = normalizeString(query);

  // 1. Direct ID match
  const byId = ALL_AUTHENTIC_TEAMS.find(t => t.id.toLowerCase() === qRaw);
  if (byId) return byId;

  // 2. Direct alias match
  if (COMMON_ALIASES[qRaw]) {
    const aliased = ALL_AUTHENTIC_TEAMS.find(t => t.id === COMMON_ALIASES[qRaw]);
    if (aliased) return aliased;
  }
  if (COMMON_ALIASES[qNorm]) {
    const aliased = ALL_AUTHENTIC_TEAMS.find(t => t.id === COMMON_ALIASES[qNorm]);
    if (aliased) return aliased;
  }

  // 3. Exact normalized name or shortName match
  const exact = ALL_AUTHENTIC_TEAMS.find(
    t => normalizeString(t.name) === qNorm ||
         normalizeString(t.shortName) === qNorm ||
         t.code.toLowerCase() === qRaw
  );
  if (exact) return exact;

  // 4. Substring inclusion
  const partial = ALL_AUTHENTIC_TEAMS.find(
    t => {
      const tNorm = normalizeString(t.name);
      const sNorm = normalizeString(t.shortName);
      return (tNorm.length > 3 && (tNorm.includes(qNorm) || qNorm.includes(tNorm))) ||
             (sNorm.length > 3 && (sNorm.includes(qNorm) || qNorm.includes(sNorm)));
    }
  );
  return partial;
}

