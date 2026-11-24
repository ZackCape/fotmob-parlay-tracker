import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Collection } from 'discord.js';
import { DiscordBotService, SLASH_COMMANDS } from '../src/discord/bot.js';

vi.mock('node:timers/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:timers/promises')>(),
  setTimeout: vi.fn().mockResolvedValue(undefined),
}));

const botSource = readFileSync(resolve(__dirname, '../src/discord/bot.ts'), 'utf-8');

/**
 * Extract the top-level command-name declarations from the SlashCommandBuilder
 * array that is passed to `application.commands.set(...)`.
 *
 * Only the *command* builders are considered: option names (setName calls that
 * belong to an `.addXOption()` chain) are deliberately excluded, which is why
 * `interval`, `target` and `mode` appear more than once legitimately.
 */
function topLevelCommandNames(source: string): string[] {
  const start = source.indexOf('const commands = [');
  const end = source.indexOf('];', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  const block = source.slice(start, end);
  const names: string[] = [];

  // Walk the array counting bracket depth so that builders nested inside
  // .addStringOption(...) / .addIntegerOption(...) are not counted.
  let depth = 0;
  let sawBuilder = false;
  for (const line of block.split('\n')) {
    const before = depth;
    for (const ch of line) {
      if (ch === '[') depth++;
      else if (ch === ']') depth--;
    }
    if (/new SlashCommandBuilder\(\)/.test(line)) {
      sawBuilder = true;
      // A top-level builder is one declared at array depth 1.
      if (before === 1) sawBuilder = true;
      continue;
    }
    if (sawBuilder && before === 1) {
      const m = line.match(/setName\('([^']+)'\)/);
      if (m) {
        names.push(m[1]);
        sawBuilder = false;
      }
    }
  }
  return names;
}

describe('Discord slash command definitions', () => {
  const names = topLevelCommandNames(botSource);

  it('extracts the expected command set', () => {
    expect(names.length).toBeGreaterThan(5);
    expect(names).toContain('fixtures');
    expect(names).toContain('generateparlay');
    expect(names).toContain('help');
    expect(names).toContain('customparlay');
    expect(names).toContain('livetracking');
  });

  it('consolidates the old overlapping parlay commands into generateparlay + customparlay', () => {
    expect(names).not.toContain('parlay');
    expect(names).not.toContain('sgp');
  });

  it('has NO duplicate command names', () => {
    // Discord rejects the ENTIRE payload with APPLICATION_COMMANDS_DUPLICATE_NAME,
    // which silently disables every slash command rather than just one.
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const n of names) {
      if (seen.has(n)) dupes.push(n);
      seen.add(n);
    }
    expect(dupes, `duplicate command names: ${dupes.join(', ')}`).toEqual([]);
  });

  it('registers only slash commands Discord accepts (lowercase, no spaces, <=32 chars)', () => {
    for (const n of names) {
      expect(n, `invalid command name: ${n}`).toMatch(/^[-_\p{L}\p{N}]{1,32}$/u);
    }
  });
});

describe('Discord slash command sync', () => {
  function stubClient() {
    const setGlobal = vi.fn();
    const clearGuild = vi.fn().mockResolvedValue(undefined);
    const client = {
      application: { commands: { set: setGlobal } },
      guilds: { cache: new Map([['guild', { id: 'guild', commands: { set: clearGuild } }]]) },
    };
    const sync = () => DiscordBotService.prototype.registerSlashCommands.call({ client } as unknown as DiscordBotService);
    return { setGlobal, clearGuild, sync };
  }

  it('retries transient errors and confirms wager before clearing guild overrides', async () => {
    const { setGlobal, clearGuild, sync } = stubClient();
    const schema = SLASH_COMMANDS.map(command => command.toJSON());
    setGlobal.mockRejectedValueOnce(Object.assign(new Error('Unavailable'), { status: 503 }));
    setGlobal.mockImplementationOnce(async () => {
      expect(clearGuild).not.toHaveBeenCalled();
      return new Collection(schema.map(command => [command.name, command]));
    });

    await sync();

    expect(setGlobal).toHaveBeenCalledTimes(2);
    const [payload] = setGlobal.mock.calls[1];
    expect(payload.find((command: { name: string }) => command.name === 'wager').options.map((option: { name: string }) => option.name))
      .toEqual(['log', 'summary']);
    expect(clearGuild).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('keeps existing guild commands if Discord rejects the global schema', async () => {
    const { setGlobal, clearGuild, sync } = stubClient();
    setGlobal.mockRejectedValue(Object.assign(new Error('Invalid schema'), { status: 400 }));

    await sync();

    expect(setGlobal).toHaveBeenCalledTimes(1);
    expect(clearGuild).not.toHaveBeenCalled();
  });
});
