/**
 * Karma Handler
 * Handles the /karma command for checking a user's karma
 */
import { database } from '../lib/firebase.js';

export const karmaHandler = (app) => {
  /**
   * Handle /karma command
   */
  app.command('/karma', async ({ ack, body, client, logger }) => {
    try {
      // 1. Acknowledge the command immediately
      await ack();

      // <<< ADD DM Channel Check >>>
      if (body.channel_name === 'directmessage') {
        logger.warn(`User ${body.user_id} tried to use /karma in a DM. Instructing to use channel.`);
        await client.chat.postEphemeral({
          channel: body.channel_id, // This will be the DM channel
          user: body.user_id,
          text: "COMMANDS IN THE CHANNEL, NOT HERE. USE <#C08K73A45NX|koffee-karma-sf>."
        });
        return;
      }
      // <<< END DM Channel Check >>>

      // <<< ADD PLACEHOLDER MESSAGE >>>
      try {
          await client.chat.postEphemeral({
              channel: body.channel_id,
              user: body.user_id,
              text: "Grabbing your stats..."
          });
      } catch (placeholderError) {
          logger.error('Failed to send /karma placeholder message:', placeholderError);
          // Continue processing even if placeholder fails
      }
      // <<< END PLACEHOLDER MESSAGE >>>

      const userId = body.user_id;

      // 2. Fetch player data using the imported database object
      const { player: playerData, isNew } = await database.getOrCreatePlayer(userId, client);

      // Log the fetched data for debugging
      logger.debug(`[Karma Command] Fetched playerData for ${userId}:`, JSON.stringify(playerData));

      if (!playerData) {
          // 3. Post error message directly if player not found
          await client.chat.postEphemeral({
              channel: body.channel_id,
              user: body.user_id,
              text: "Can't find your profile. Weird."
          });
          logger.warn(`Could not find player data for user ${userId} in /karma.`);
          return;
      }

      // 4. Get values (or default)
      const playerTitle = playerData.title;
      const karma = playerData.karma ?? 0;
      const reputation = playerData.reputation ?? 0;

      // 5. Format and post the final message directly
      const titleText = playerTitle ? playerTitle.toUpperCase() : 'UNKNOWN';
      const messageText = `karma: \`${karma}\` / reputation: \`${reputation}\` / title: \`${titleText}\``;

      await client.chat.postEphemeral({
          channel: body.channel_id,
          user: body.user_id,
          text: messageText,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: messageText,
              }
            }
          ]
      });
      logger.info(`Posted /karma stats directly for user ${userId}.`);

    } catch (error) {
      logger.error('Error handling /karma command:', error);
      const errorText = `System choked checking stats. Try again. Error: ${error.message}`;

      // 6. Post error message directly if an error occurs
      try {
        await client.chat.postEphemeral({ channel: body.channel_id, user: body.user_id, text: errorText });
      } catch (ephemeralError) {
        logger.error('Failed to send ephemeral error message during /karma catch block:', ephemeralError);
      }
    }
  });

  console.log("✅ Karma handler registered command: /karma");
}; 