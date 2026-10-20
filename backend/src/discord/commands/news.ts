import { SlashCommandBuilder } from 'discord.js';

export const newsCommand = new SlashCommandBuilder()
  .setName('news')
  .setDescription('Get the latest breaking football news and team updates')
  .addStringOption(opt =>
    opt
      .setName('team')
      .setDescription('Search news for a specific team, e.g. Chelsea, Real Madrid')
      .setRequired(false)
  );

export default newsCommand;
