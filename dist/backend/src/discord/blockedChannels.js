/**
 * Discord Channel Blocklist & Quarantine
 *
 * Prevents unintended, ghost, or invalid channel broadcasts. Any channel ID listed
 * here is permanently blocked across all transports:
 * - Startup channel configuration
 * - Discord slash command linking (/channel, /broadcast)
 * - Automated 5m/15m/hourly periodic briefings
 * - Steam alerts & instant alerts
 * - Live match tracking and event notifications (goals, cards, halftime)
 * - Saved parlay updates and cashout tracking
 */
export const BLOCKED_CHANNEL_IDS = new Set([
    '1526530756870934570',
]);
/**
 * Returns true if a given channelId is null, undefined, or matches any blocked channel ID.
 */
export function isChannelBlocked(channelId) {
    if (!channelId)
        return false;
    return BLOCKED_CHANNEL_IDS.has(String(channelId).trim());
}
