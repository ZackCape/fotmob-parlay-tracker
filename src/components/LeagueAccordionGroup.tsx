import React, { useState } from 'react';
import { Fixture, League } from '../types';
import { CapeMatchRow } from './CapeMatchRow';
import { ChevronDown, ChevronRight, Trophy } from 'lucide-react';
import { LeagueFlag } from './LeagueFlag';
import { leagueCountryLabel } from '../utils/leagueFlags';

interface LeagueAccordionGroupProps {
  fixtures: Fixture[];
  onSelectFixture: (fixture: Fixture) => void;
  selectedLeagueFilter: string;
}

interface LeagueMeta {
  name: string;
  country: string;
}

const LEAGUE_META: Record<League, LeagueMeta> = {
  EPL: { name: 'Premier League', country: 'England' },
  CHAMPIONS_LEAGUE: { name: 'Champions League', country: 'Europe' },
  LALIGA: { name: 'LaLiga', country: 'Spain' },
  SERIE_A: { name: 'Serie A', country: 'Italy' },
  LIGUE1: { name: 'Ligue 1', country: 'France' },
  EUROPA_LEAGUE: { name: 'Europa League', country: 'Europe' },
  CONFERENCE_LEAGUE: { name: 'Conference League', country: 'Europe' },
  CHAMPIONSHIP: { name: 'Championship', country: 'England' },
  BUNDESLIGA: { name: 'Bundesliga', country: 'Germany' },
  BUNDESLIGA2: { name: 'Bundesliga 2', country: 'Germany' },
};

const LEAGUE_ORDER: League[] = [
  'SERIE_A',
  'BUNDESLIGA',
  'BUNDESLIGA2',
  'EPL',
  'CHAMPIONS_LEAGUE',
  'LALIGA',
  'LIGUE1',
  'EUROPA_LEAGUE',
  'CONFERENCE_LEAGUE',
  'CHAMPIONSHIP',
];

export const LeagueAccordionGroup: React.FC<LeagueAccordionGroupProps> = ({
  fixtures,
  onSelectFixture,
  selectedLeagueFilter,
}) => {
  // Keep track of collapsed league sections (default all expanded)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggleCollapse = (leagueId: string) => {
    setCollapsed(prev => ({ ...prev, [leagueId]: !prev[leagueId] }));
  };

  // Group fixtures by league
  const grouped = fixtures.reduce<Record<string, Fixture[]>>((acc, f) => {
    if (!acc[f.league]) acc[f.league] = [];
    acc[f.league].push(f);
    return acc;
  }, {});

  // Determine which leagues to display based on selected filter
  const visibleLeagues = LEAGUE_ORDER.filter(league => {
    if (selectedLeagueFilter !== 'ALL' && selectedLeagueFilter !== league) return false;
    return grouped[league] && grouped[league].length > 0;
  });

  if (visibleLeagues.length === 0) {
    return (
      <div className="bg-[#16181d] border border-[#252932] rounded-2xl p-8 text-center text-[#8c92a4]">
        <Trophy className="w-10 h-10 mx-auto mb-2 text-[#8c92a4]/40" />
        <p className="text-sm font-semibold text-white">No verified fixtures available</p>
        <p className="text-xs mt-1">The configured football providers did not return verified matches for this date. Try another date or check provider/API quota status.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibleLeagues.map(league => {
        const leagueFixtures = grouped[league] || [];
        const meta = LEAGUE_META[league] || { name: league, country: leagueCountryLabel(league) };
        const isCollapsed = !!collapsed[league];

        return (
          <div
            key={league}
            className="bg-[#16181d] border border-[#252932] rounded-2xl overflow-hidden shadow-lg"
          >
            {/* League Accordion Header */}
            <div
              onClick={() => toggleCollapse(league)}
              className="group flex items-center justify-between px-4 py-3 bg-[#1c1f26]/80 hover:bg-[#1c1f26] border-b border-[#252932] cursor-pointer transition-colors"
            >
              <div className="flex items-center space-x-2.5">
                <LeagueFlag league={league} className="w-6 h-[18px]" />
                <div>
                  <span className="text-xs font-bold text-white uppercase tracking-wider">
                    {meta.country} - {meta.name}
                  </span>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-[#252932] text-[#8c92a4]">
                  {leagueFixtures.length}
                </span>
                {isCollapsed ? (
                  <ChevronRight className="w-4 h-4 text-[#8c92a4]" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-[#8c92a4]" />
                )}
              </div>
            </div>

            {/* Match Rows */}
            {!isCollapsed && (
              <div className="divide-y divide-[#252932]/70">
                {leagueFixtures.map(fixture => (
                  <CapeMatchRow
                    key={fixture.id}
                    fixture={fixture}
                    onSelect={onSelectFixture}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
