/**
 * Leaderboard Handler
 * Handles the /leaderboard command
 */
import { logger } from '../utils/logger.js';
import { getLeaderboard } from '../utils/database.js';
import { formatLeaderboard } from '../utils/message-formatter.js';
import { KOFFEE_KARMA_CHANNEL_ID } from '../utils/config.js';

export const leaderboardHandler = (app) => {
  app.command('/leaderboard', async ({ ack, body, client, logger }) => {
    // Acknowledge the command immediately
    await ack();

    // <<< ADD DM Channel Check >>>
    if (body.channel_name === 'directmessage') {
      logger.warn(`User ${body.user_id} tried to use /leaderboard in a DM. Instructing to use channel.`);
      await client.chat.postEphemeral({
        channel: body.channel_id, // This will be the DM channel
        user: body.user_id,
        text: "COMMANDS IN THE CHANNEL, NOT HERE. USE <#C08K73A45NX|koffee-karma-sf>."
      });
      return;
    }
    // <<< END DM Channel Check >>>

    logger.info(`Received /leaderboard command from user ${body.user_id}`);

    // Post placeholder message immediately
    try {
      await client.chat.postEphemeral({
        channel: body.channel_id, // Send to the channel command was used in
        user: body.user_id,
        text: "Fetching the rep wall..."
      });
    } catch (placeholderError) {
      logger.error('Failed to send /leaderboard placeholder message:', placeholderError);
      // Continue processing even if placeholder fails
    }

    const channelId = KOFFEE_KARMA_CHANNEL_ID.value();

    try {
      // Fetch top players using the imported function
      const topPlayers = await getLeaderboard(5); // CALL the imported function directly

      // Format the leaderboard message
      const leaderboardBlocks = formatLeaderboard(topPlayers);

      // Post the public message
      await client.chat.postMessage({
        channel: channelId,
        blocks: leaderboardBlocks,
        text: "Koffee Karma Leaderboard" // Fallback text
      });
      logger.info(`Posted leaderboard to channel ${channelId}`);

    } catch (error) {
      logger.error('Error handling /leaderboard command:', error);
      await client.chat.postEphemeral({
        channel: channelId, // Post error in the main channel ephemerally
        user: body.user_id,
        text: `System choked fetching the leaderboard. Try again. Error: ${error.message}`
      });
    }
  });

  console.log("✅ Leaderboard handler registered command: /leaderboard");
}; 