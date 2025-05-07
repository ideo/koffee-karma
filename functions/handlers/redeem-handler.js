/**
 * Redeem Handler
 * Handles the /redeem command for redeeming bonus Karma codes
 */
import admin from 'firebase-admin';
// import axios from 'axios'; // No longer needed
import { getOrCreatePlayer, redeemCode, updatePlayerKarma } from '../utils/database.js';
import { logger } from '../utils/logger.js';
import { db } from '../lib/firebase.js';

export const redeemHandler = (app) => {
  /**
   * Handle /redeem command
   * Allows users to redeem bonus Karma codes
   */
  app.command('/redeem', async ({ command, ack, respond, client, logger }) => {
    logger.debug('Incoming /redeem command object:', JSON.stringify(command, null, 2));
    // const responseUrl = command.response_url; // No longer needed for axios

    await ack();

    // <<< ADD DM Channel Check >>>
    if (command.channel_name === 'directmessage') {
      logger.warn(`User ${command.user_id} tried to use /redeem in a DM. Instructing to use channel.`);
      // Using client.chat.postEphemeral directly as respond() might be used later for placeholder.
      await client.chat.postEphemeral({
        channel: command.channel_id, // This will be the DM channel
        user: command.user_id,
        text: "COMMANDS IN THE CHANNEL, NOT HERE. USE <#C08K73A45NX|koffee-karma-sf>."
      });
      return;
    }
    // <<< END DM Channel Check >>>

    const userId = command.user_id;
    const providedUserName = command.user_name; // User name from command payload (fallback)
    const channelId = command.channel_id;

    // <<< Fetch User's Real Name >>>
    let userRealName = providedUserName; // Default to command user_name
    try {
      logger.debug(`Fetching Slack user info for ${userId}`);
      const userInfo = await client.users.info({ user: userId });
      if (userInfo.ok && userInfo.user?.real_name) {
        userRealName = userInfo.user.real_name;
        logger.info(`Fetched real name for ${userId}: ${userRealName}`);
      } else {
        logger.warn(`Could not fetch real_name for ${userId}. Falling back to user_name. Error: ${userInfo.error}`);
      }
    } catch (slackError) {
      logger.error(`Error calling client.users.info for ${userId} during redeem:`, slackError);
      // Fallback to providedUserName already handled by initialization
    }
    // <<< End Fetch User's Real Name >>>

    // Placeholder message logic (currently commented out, but keep name fetch before it)
    try {
      await respond({
        response_type: 'ephemeral',
        text: "CHECKING THE LEDGER..."
      });
    } catch (error) {
      logger.error(`Error sending initial ephemeral message for /redeem: ${error}`);
      // Don't stop execution if this fails, proceed with redemption logic
    }

    // Rename userName variable to avoid confusion with fetched real name
    // const userName = command.user_name; // Removed
    const providedCode = command.text.trim().toUpperCase();

    logger.info(`User ${userRealName} (${userId}) attempting to redeem code: '${providedCode}'`);

    if (!providedCode) {
      try {
        // <<< Use client.chat.postEphemeral for missing code >>>
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: "CODE MISSING. Usage: /redeem YOUR-CODE-HERE"
        });
        logger.warn(`Redeem attempt by ${userId} failed: No code provided.`);
      } catch (error) {
        logger.error(`Error sending ephemeral message for missing code: ${error}`);
      }
      return;
    }

    const codeRef = db.collection('redemptionCodes').doc(providedCode);
    const playerRef = db.collection('players').doc(userId);

    try {
      const awardedKarma = await db.runTransaction(async (transaction) => {
        const codeDoc = await transaction.get(codeRef);

        // 1. Validation: Code Existence
        if (!codeDoc.exists) {
          logger.warn(`Redeem attempt by ${userId} failed: Code '${providedCode}' not found.`);
          throw new Error("That code doesn't seem to exist. Check for typos? 🤔");
        }

        const codeData = codeDoc.data();
        const now = admin.firestore.Timestamp.now();

        // 2. Validation: Active From
        if (codeData.activeFrom && codeData.activeFrom > now) {
          logger.warn(`Redeem attempt by ${userId} failed: Code '${providedCode}' not yet active.`);
          throw new Error("Hold your horses! That code isn't active just yet.");
        }

        // 3. Validation: Expires At
        if (codeData.expiresAt && codeData.expiresAt < now) {
          logger.warn(`Redeem attempt by ${userId} failed: Code '${providedCode}' has expired.`);
          throw new Error("Too slow! That code has expired. 💀");
        }

        // 4. Validation: Max Redemptions
        if (codeData.redeemedCount >= codeData.maxRedemptions) {
          logger.warn(`Redeem attempt by ${userId} failed: Code '${providedCode}' max redemptions reached.`);
          throw new Error("This code has reached its maximum redemption limit. Bummer.");
        }

        // 5. Validation: Per User Limit
        const userRedemptionCount = codeData.redeemers.filter(r => r.userId === userId).length;
        const perUserLimit = codeData.perUserLimit || 1; // Default to 1 if not set
        if (userRedemptionCount >= perUserLimit) {
          logger.warn(`Redeem attempt by ${userId} failed: User already redeemed '${providedCode}' ${userRedemptionCount}/${perUserLimit} times.`);
          throw new Error("Looks like you've already used this code the maximum number of times allowed.");
        }

        // --- If all validations pass --- 
        logger.info(`Validation passed for code '${providedCode}' by user ${userId}. Proceeding with redemption.`);

        const playerDoc = await transaction.get(playerRef);
        let playerData;
        if (!playerDoc.exists) {
          logger.info(`Player ${userId} not found, creating new player document.`);
          playerData = {
            userId: userId,
            name: userRealName,
            karma: 0, // Initial karma
            reputation: 0,
            ordersRequestedCount: 0,
            deliveriesCompletedCount: 0,
            title: 'Newcomer', // Default title or fetch from constants
            capabilities: [],
            createdAt: now,
            updatedAt: now
          };
          transaction.set(playerRef, playerData); // Set the new player data in the transaction
        } else {
          playerData = playerDoc.data();
        }

        const newRedeemer = {
          userId: userId,
          name: userRealName,
          timestamp: now
        };

        // Update Code Document
        transaction.update(codeRef, {
          redeemedCount: admin.firestore.FieldValue.increment(1),
          redeemers: admin.firestore.FieldValue.arrayUnion(newRedeemer),
          updatedAt: now
        });

        // Update Player Document
        const karmaToAward = codeData.karmaValue;
        transaction.update(playerRef, {
          karma: admin.firestore.FieldValue.increment(karmaToAward),
          updatedAt: now
        });

        logger.info(`Transaction prepared for code '${providedCode}' redemption by ${userId}. Awarding ${karmaToAward} Karma.`);
        return karmaToAward;
      });

      // Transaction successful
      const playerDocAfter = await playerRef.get(); // Get updated player data
      const finalKarma = playerDocAfter.data().karma;

      logger.info(`Successfully redeemed code '${providedCode}' for user ${userId}. Awarded ${awardedKarma} Karma. New total: ${finalKarma}`);

      // <<< Use client.chat.postEphemeral for Success Message >>>
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: `Ledger updated. \`${providedCode}\` burned for ${awardedKarma} Karma ⚡. Balance: ${finalKarma}`
      });

    } catch (error) {
      // Handle errors (including validation errors thrown inside the transaction)
      logger.error(`Error during redemption transaction for code '${providedCode}' by user ${userId}: ${error.message}`);
      try {
        // <<< Use client.chat.postEphemeral for Error Message >>>
        await client.chat.postEphemeral({
          channel: channelId,
          user: userId,
          text: `REJECTED: ${error.message}`
        });
      } catch (postError) {
        logger.error(`Failed to post final ephemeral error message: ${postError}`);
      }
    }
  });

  console.log('✅ Redeem handler registered command: /redeem');
}; 