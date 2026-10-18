import React from 'react';
import { leagueFlagEmoji, leagueFlagUrl } from '../utils/leagueFlags';

interface LeagueFlagProps {
  /** League id, e.g. `EPL`, `LALIGA`, `CHAMPIONS_LEAGUE`. */
  league: string;
  /** Tailwind size classes for the chip. Defaults to the sidebar's 20×15. */
  className?: string;
}

/**
 * National flag chip for a league.
 *
 * Renders a crisp flagcdn.com image layered over the league's emoji, so an
 * offline or blocked CDN still shows a recognisable glyph instead of a
 * broken-image icon. Keeps the dashboard's dark styling with a subtle ring and
 * a hover scale inherited from the parent `group`.
 */
export const LeagueFlag: React.FC<LeagueFlagProps> = ({ league, className = 'w-5 h-[15px]' }) => {
  const url = leagueFlagUrl(league);
  const emoji = leagueFlagEmoji(league);

  if (!url) {
    return (
      <span
        className={`${className} inline-flex shrink-0 items-center justify-center text-sm leading-none`}
        aria-hidden="true"
      >
        {emoji}
      </span>
    );
  }

  return (
    <span className={`${className} relative inline-flex shrink-0 items-center justify-center`}>
      <span className="absolute text-sm leading-none" aria-hidden="true">
        {emoji}
      </span>
      <img
        src={url}
        alt={`${league} flag`}
        width={20}
        height={15}
        loading="lazy"
        decoding="async"
        className="relative h-full w-full rounded-[3px] object-cover ring-1 ring-black/40 shadow-sm transition-transform duration-150 group-hover:scale-105"
        onError={(e) => {
          // Reveal the emoji fallback beneath instead of a broken image.
          e.currentTarget.style.visibility = 'hidden';
        }}
      />
    </span>
  );
};
