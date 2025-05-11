/**
 * Order Handler
 * Handles the /order command and order-related interactions
 */
import { ORDER_STATUS, BONUS_CHANCES, DRINK_CATEGORIES, LOCATIONS, REPUTATION_TITLES } from '../utils/constants.js';
import { db, database, getPlayerTitle } from '../lib/firebase.js'; // Import the main DB object and getPlayerTitle
import { updatePlayerKarma, updatePlayerReputation, updatePlayerDeliveryCount, updatePlayerOrderCount } from '../utils/database.js'; // Import specific DB functions
import { buildOrderModal } from '../utils/modal-builder.js';
import { formatOrderMessage } from '../lib/messages/order-message.js';
import { 
  formatRunnerMessage,
  generateMap, 
  updateMessage,
  postMessageToDesignatedChannel 
} from '../utils/message-formatter.js';
import { DEVELOPER_SLACK_ID, KOFFEE_KARMA_CHANNEL_ID } from '../utils/config.js'; // ADD THIS
import admin from 'firebase-admin'; // Needed for Firestore serverTimestamp
import { WebClient } from '@slack/web-api'; // Added top-level import
import { Timestamp } from 'firebase-admin/firestore'; // Make sure Timestamp is required
// Dynamic imports for timer scheduler

// Define new status constants
const STATUS_CANCELLED_RUNNER = 'CANCELLED_RUNNER';
const STATUS_EXPIRED_CLAIMED = 'EXPIRED_CLAIMED';

/**
 * Calculate bonus multiplier based on defined chances.
 * @returns {number} - The bonus multiplier (1, 2, or 3).
 */
function calculateBonus() {
  const random = Math.random();
  if (random < BONUS_CHANCES.TRIPLE) {
    return 3; // 3x bonus
  } else if (random < BONUS_CHANCES.TRIPLE + BONUS_CHANCES.DOUBLE) {
    return 2; // 2x bonus
  } else {
    return 1; // 1x (no bonus)
  }
}

/**
 * Handles the 'claim_order' button interaction.
 * @param {object} payload - The action payload.
 * @param {object} client - Bolt's client instance.
 * @param {object} logger - Bolt's logger instance.
 */
export async function handleClaimOrder(payload) {
  // Destructure parameters inside the function
  const { ack, body, client, logger } = payload;

  await ack(); // Acknowledge the button click immediately
  const action = body.actions[0]; // Get the specific action that was triggered
  const orderId = action.value; // This IS the Firestore Document ID
  const clickerId = body.user.id;
  const channelId = body.container?.channel_id;
  const messageTs = body.container?.message_ts; // Keep for updating the message
  const developerSlackId = DEVELOPER_SLACK_ID.value(); // UPDATED

  logger.info(`'claim_order' action received for order ID: ${orderId} from user ${clickerId}`);

  if (!orderId || !channelId || !messageTs) {
    logger.error('Missing orderId, channelId, or messageTs in claim_order action.', { actionValue: orderId, containerTs: messageTs, channel: channelId });
    // Optionally send ephemeral error message to user
     try {
       await client.chat.postEphemeral({
         channel: channelId || clickerId, // Try channel, fallback to DM
         user: clickerId,
         text: 'Bot tripped. Couldn\'t ID the order. Bummer.'
       });
     } catch (ephemeralError) {
       logger.error('Failed to send ephemeral error message for missing IDs:', ephemeralError);
     }
    return;
  }

  try {
    // 1. Fetch Order Data using the Firestore Document ID
    logger.debug(`Fetching order data using Document ID: ${orderId}`);
    const orderData = await database.getOrderById(orderId);

    if (!orderData) {
      logger.error(`Order document not found for ID: ${orderId}`);
      await client.chat.postEphemeral({
        channel: channelId,
        user: clickerId,
        text: 'Can\'t find that order. Maybe it rotted or someone else grabbed it.'
      });
      return;
    }

    const orderDbId = orderData.id; // Already have this from getOrderById
    const orderMessageTs = orderData.slackMessageTs; // Use the TS stored in the DB
    logger.debug(`Order data found (DB ID: ${orderDbId}):`, orderData);

    // 2. Validate Status (Must be 'ordered')
    if (orderData.status !== ORDER_STATUS.ORDERED) {
      logger.warn(`User ${clickerId} tried to claim order ${orderDbId} which is already in status: ${orderData.status}`);
      let statusText = 'claimed';
      if (orderData.status === ORDER_STATUS.CANCELLED) statusText = 'cancelled';
      else if (orderData.status === ORDER_STATUS.DELIVERED) statusText = 'delivered';
      else if (orderData.status === ORDER_STATUS.EXPIRED) statusText = 'expired';
      await client.chat.postEphemeral({
        channel: channelId,
        user: clickerId,
        text: `Order\'s already ${statusText}. Too slow.`
      });
      return;
    }

    // 3. Validate Requester (Cannot claim own order, unless developer)
    if (orderData.requesterId === clickerId) {
      logger.warn(`User ${clickerId} attempted to claim their own order ${orderDbId}. Checking developer override...`);
      if (clickerId !== developerSlackId) {
        logger.warn(`Self-claim denied for user ${clickerId} (not developer ${developerSlackId}).`);
        await client.chat.postEphemeral({
          channel: channelId,
          user: clickerId,
          text: 'Can\'t claim your own order, slick.'
        });
        return;
      } else {
        logger.info(`Self-claim allowed for developer ${clickerId}. Proceeding...`);
      }
    }

    // 4. Fetch Clicker (Runner) Info using getOrCreatePlayer
    logger.debug(`Fetching player data for clicker (runner): ${clickerId}`);
    // Reuse getOrCreatePlayer to ensure the runner exists in the system and get their name
    const { player: runnerPlayer, playerRef: runnerRef } = await database.getOrCreatePlayer(clickerId, client);
    if (!runnerPlayer) {
       // This shouldn\'t happen if getOrCreatePlayer works, but handle defensively
       logger.error(`Could not get or create player for claiming user ${clickerId}.`);
       await client.chat.postEphemeral({
          channel: channelId,
          user: clickerId,
          text: 'Can\'t find your details. System glitch. Try again later.'
       });
       return;
    }
    // Use the name from the fetched player profile, fallback to ID if needed
    const runnerName = runnerPlayer.name || clickerId;
    logger.debug(`Runner identified as: ${runnerName}`);

    // 5. Update Order in Firestore using the DocumentReference
    const timeClaimed = Timestamp.now(); // Get current time as Timestamp
    const claimedExpiryTimestamp = Timestamp.fromMillis(timeClaimed.toMillis() + 10 * 60 * 1000); // Calculate 10 mins from now
    const updateData = {
      status: ORDER_STATUS.CLAIMED,
      runnerId: clickerId,
      runnerName: runnerName, // Use fetched name
      timeClaimed: timeClaimed, // Store the exact claim time
      claimedExpiryTimestamp: claimedExpiryTimestamp // Store the calculated expiry time
    };
    logger.info(`Updating order ${orderDbId} with claim data:`, updateData);
    const orderRef = admin.firestore().collection('orders').doc(orderDbId);
    await orderRef.update(updateData);
    logger.info(`Order ${orderDbId} successfully updated to CLAIMED.`);

    // 6. Prepare Updated Message Blocks
    // Fetch the latest order data *after* update to ensure we have claimedTime etc.
    // Although update doesn\'t return the new doc, we can merge locally for the formatter
    const updatedOrderData = { ...orderData, ...updateData, status: ORDER_STATUS.CLAIMED }; // Merge updates
    logger.debug('Formatting updated message for CLAIMED state...');
    // Pass the orderMessageTs fetched from DB
    const messagePayload = formatOrderMessage(updatedOrderData, orderMessageTs);

    // 7. Update Slack Message
    logger.info(`Updating Slack message ${channelId}/${orderMessageTs}`);
    await client.chat.update({
      channel: channelId,
      ts: orderMessageTs,
      blocks: messagePayload.blocks,
      text: messagePayload.text
    });
    logger.info(`Slack message ${orderMessageTs} updated successfully.`);

    // 8. TODO: Send DMs to Requester and Runner
    logger.info('Implementing DMs for claim confirmation.');
    try {
      // Use full real names fetched earlier
      const drinkName = orderData.drink || orderData.notes || 'your order'; // Use consistent variable
      const locationDisplayName = orderData.locationDisplayName || orderData.location; // Use consistent variable
      const durationMinutes = (updatedOrderData.durationMs || 600000) / 60000; // Default to 10 mins if missing
      
      // DM to Runner: Use Block Kit
      await client.chat.postMessage({
          channel: clickerId,
          blocks: [{
              type: 'section',
              text: {
                  type: 'mrkdwn',
                  text: `CLAIMED ${orderData.requesterName}\'s order: \"${drinkName}\"\n→ drop: \`${locationDisplayName}\` | time: \`${durationMinutes}\` min` 
              }
          }],
          text: `CLAIMED ${orderData.requesterName}\'s order: \"${drinkName}\"\n→ drop: ${locationDisplayName} | time: ${durationMinutes} min` // Fallback text
      });
      // DM to Requester: Use Block Kit
      await client.chat.postMessage({
          channel: orderData.requesterId,
          blocks: [{
              type: 'section',
              text: {
                  type: 'mrkdwn',
                  text: `${runnerName} claimed your order: \"${drinkName}\"\n→ en route to \`${locationDisplayName}\`` 
              }
          }],
          text: `${runnerName} claimed your order: \"${drinkName}\"\n→ en route to ${locationDisplayName}` // Fallback text
      });
      logger.info(`DMs sent successfully for order ${orderDbId}.`);
    } catch (dmError) {
       logger.error(`Failed to send claim confirmation DMs for order ${orderDbId}:`, dmError);
       // Non-fatal, log and continue. Could add ephemeral message to claimer.
    }


  } catch (error) {
    logger.error('Error handling claim_order action:', error);
    try {
      await client.chat.postEphemeral({
        channel: channelId,
        user: clickerId,
        text: `System choked trying to claim order. Try again or walk. Error: ${error.message}`
      });
    } catch (ephemeralError) {
      logger.error('Failed to send ephemeral error message after main claim error:', ephemeralError);
    }
  }
}

/**
 * Handles the 'deliver_order' button interaction.
 * @param {object} payload - The action payload.
 * @param {object} client - Bolt's client instance.
 * @param {object} logger - Bolt's logger instance.
 */
export async function handleDeliverOrder({ ack, body, client, logger }) { 
  await ack(); // Acknowledge the button click immediately
  const action = body.actions[0]; // Get the specific action
  const orderId = action.value; // Firestore Document ID
  const clickerId = body.user.id; // Should be the runner
  const channelId = body.container?.channel_id;
  const messageTs = body.container?.message_ts;
  const developerSlackId = DEVELOPER_SLACK_ID.value(); // UPDATED
  
  logger.info(`'deliver_order' action received for order ID: ${orderId} from user ${clickerId}`);

  if (!orderId || !channelId || !messageTs) {
    logger.error('Missing orderId, channelId, or messageTs in deliver_order action.');
    // Send ephemeral error
    return;
  }

  const orderRef = admin.firestore().collection('orders').doc(orderId);

  try {
    // <<< Capture the result of the ACTUAL transaction >>>
    const transactionResult = await db.runTransaction(async (transaction) => {
      // 1. Get Order Data
      const orderDoc = await transaction.get(orderRef);
      if (!orderDoc.exists) {
        logger.error(`Order document not found for ID: ${orderId}`);
        throw new Error('ORDER_NOT_FOUND'); // Throw specific error for handler
      }
      const orderData = orderDoc.data();
      const orderMessageTs = orderData.slackMessageTs; // Use TS from DB

    // 2. Validate Status (Must be 'claimed')
    if (orderData.status !== ORDER_STATUS.CLAIMED) {
        logger.warn(`User ${clickerId} tried to deliver order ${orderId} not in 'claimed' status (current: ${orderData.status})`);
        throw new Error('ORDER_NOT_CLAIMED');
    }

      // 3. Validate User (Must be the assigned runner, unless developer)
    if (orderData.runnerId !== clickerId) {
        logger.warn(`User ${clickerId} attempted to deliver order ${orderId} assigned to ${orderData.runnerId}. Checking developer override...`);
        if (clickerId !== developerSlackId) {
            logger.warn(`Delivery denied for user ${clickerId} (not runner ${orderData.runnerId} or developer ${developerSlackId}).`);
            throw new Error('NOT_THE_RUNNER');
        } else {
            logger.info(`Delivery allowed for developer ${clickerId} overriding runner ${orderData.runnerId}. Proceeding...`);
        }
      }

      // 4. Fetch Runner and Requester Player Data within Transaction
      const runnerRef = db.collection('players').doc(orderData.runnerId);
      const requesterRef = db.collection('players').doc(orderData.requesterId);
      const [runnerDoc, requesterDoc] = await Promise.all([
        transaction.get(runnerRef),
        transaction.get(requesterRef)
      ]);

      if (!runnerDoc.exists) {
        logger.error(`Runner player document not found for ID: ${orderData.runnerId}`);
        throw new Error('RUNNER_NOT_FOUND');
    }
      if (!requesterDoc.exists) {
        logger.error(`Requester player document not found for ID: ${orderData.requesterId}`);
        // Don't necessarily fail the whole delivery, but log it.
        // Maybe proceed without requester reputation update? For now, throw.
        throw new Error('REQUESTER_NOT_FOUND');
      }
      const runnerData = runnerDoc.data();
      const requesterData = requesterDoc.data();

      // 5. Calculate Karma & Reputation Awards
    const bonusMultiplier = calculateBonus();
      const baseKarma = orderData.karmaCost || 0;
      const earnedKarma = baseKarma * bonusMultiplier;
      const runnerReputationGain = earnedKarma; // Runner rep = earned karma
      const requesterReputationGain = baseKarma; // Requester rep = base cost

      logger.info(`Delivery calculation for order ${orderId}: BaseKarma=${baseKarma}, BonusMult=${bonusMultiplier}, EarnedKarma=${earnedKarma}, RunnerRep+=${runnerReputationGain}, ReqRep+=${requesterReputationGain}`);

      // <<< Calculate New Titles >>>
      const newRunnerReputation = (runnerData.reputation || 0) + runnerReputationGain;
      const newRequesterReputation = (requesterData.reputation || 0) + requesterReputationGain;
      const newRunnerTitle = getPlayerTitle(newRunnerReputation);
      const newRequesterTitle = getPlayerTitle(newRequesterReputation);

      logger.info(`Title calculation: Runner ${orderData.runnerId} (${runnerData.reputation || 0} + ${runnerReputationGain} -> ${newRunnerReputation}) Title: "${newRunnerTitle}"`);
      logger.info(`Title calculation: Requester ${orderData.requesterId} (${requesterData.reputation || 0} + ${requesterReputationGain} -> ${newRequesterReputation}) Title: "${newRequesterTitle}"`);

      // 6. Prepare Firestore Updates
      const timeDelivered = admin.firestore.Timestamp.now(); // Use admin.firestore.Timestamp.now() for consistency
      const orderUpdate = {
      status: ORDER_STATUS.DELIVERED,
      timeDelivered: timeDelivered,
        bonusMultiplier: bonusMultiplier,
        updatedAt: timeDelivered // Using the same Timestamp object is fine here
      };
      const runnerUpdate = {
        karma: admin.firestore.FieldValue.increment(earnedKarma), // <<< Use admin.firestore.FieldValue >>>
        reputation: admin.firestore.FieldValue.increment(runnerReputationGain), // <<< Use admin.firestore.FieldValue >>>
        deliveriesCompletedCount: admin.firestore.FieldValue.increment(1), // <<< Use admin.firestore.FieldValue >>>
        title: newRunnerTitle,
        updatedAt: timeDelivered // Using the same Timestamp object is fine here
      };
      const requesterUpdate = {
        reputation: admin.firestore.FieldValue.increment(requesterReputationGain), // <<< Use admin.firestore.FieldValue >>>
        ordersRequestedCount: admin.firestore.FieldValue.increment(1), // <<< Use admin.firestore.FieldValue >>>
        title: newRequesterTitle,
        updatedAt: timeDelivered // Using the same Timestamp object is fine here
      };

      // 7. Perform Transaction Updates
      logger.debug(`Applying updates in transaction for order ${orderId}`);
      transaction.update(orderRef, orderUpdate);
      transaction.update(runnerRef, runnerUpdate);
      transaction.update(requesterRef, requesterUpdate);
      logger.info(`Transaction updates prepared for order ${orderId}, runner ${orderData.runnerId}, requester ${orderData.requesterId}.`);

      // Return necessary info for post-transaction actions
      return { 
          orderData: { ...orderData, ...orderUpdate }, // Merged order data
          earnedKarma,
          bonusMultiplier,
          orderMessageTs // Pass this through
      };
    }); // <<< End of the ACTUAL transaction block >>>

    // Transaction successful - Destructure results from the CAPTURED variable
    const { orderData: finalOrderData, earnedKarma, bonusMultiplier, orderMessageTs } = transactionResult;

    logger.info(`Delivery transaction for order ${orderId} completed successfully.`);

    // 8. Update Slack Message (uses finalOrderData, orderMessageTs)
    logger.info(`Updating Slack message ${channelId}/${orderMessageTs} for delivered order ${orderId}`);
    
    // <<< Add earnedKarma to the data object for the formatter >>>
    const dataForMessageFormat = { ...finalOrderData, earnedKarma: earnedKarma };
    
    const messagePayload = formatOrderMessage(dataForMessageFormat, orderMessageTs);
    await client.chat.update({
      channel: channelId,
      ts: orderMessageTs,
      blocks: messagePayload.blocks,
      text: messagePayload.text
    });
    logger.info(`Slack message ${orderMessageTs} updated for delivery.`);

    // 9. Send DMs
    logger.info(`Sending delivery confirmation DMs for order ${orderId}.`);
    // Fetch final balances AFTER transaction
    const [finalRunnerData, finalRequesterData] = await Promise.all([
        database.getPlayerBySlackId(finalOrderData.runnerId),
        database.getPlayerBySlackId(finalOrderData.requesterId)
    ]);
    const runnerBalance = finalRunnerData?.karma ?? '??';
    const runnerTitle = finalRunnerData?.title ?? ''; // Get updated title
    const requesterTitle = finalRequesterData?.title ?? ''; // Get updated title
    const requesterName = finalRequesterData?.name ?? finalOrderData.requesterId;
    const runnerName = finalRunnerData?.name ?? finalOrderData.runnerId;
    const drinkName = finalOrderData.drink || finalOrderData.notes || 'the order';
      
    // Use Block Kit for DMs
    const runnerDMBlocks = [{
              type: 'section',
              text: {
                  type: 'mrkdwn',
            text: `DELIVERED: ${requesterName}'s order (\"${drinkName}\")\n+${earnedKarma} Karma earned. ${bonusMultiplier > 1 ? `(x${bonusMultiplier} BONUS!) ` : ''}bal: ${runnerBalance}`
        }
    }];
    const requesterDMBlocks = [{
              type: 'section',
              text: {
                  type: 'mrkdwn',
            text: `DELIVERED: Your order (\"${drinkName}\") by ${runnerName}`
        }
    }];

    await client.chat.postMessage({ channel: finalOrderData.runnerId, blocks: runnerDMBlocks, text: `Delivered order, +${earnedKarma} Karma` });
    await client.chat.postMessage({ channel: finalOrderData.requesterId, blocks: requesterDMBlocks, text: `Your order was delivered by ${runnerName}` });

    // 10. Post Public Bonus Message (if applicable)
    if (bonusMultiplier > 1) {
      // <<< Updated bonus message text >>>
      const bonusMessage = `BONUS HIT: x${bonusMultiplier}. ${runnerName} scored ${earnedKarma} Karma ⚡ running for ${requesterName}.`;
      logger.info(`Posting public bonus message to ${channelId} for order ${orderId}.`);
      await client.chat.postMessage({ channel: channelId, text: bonusMessage });
    }

  } catch (error) {
    logger.error(`Error in handleDeliverOrder for order ${orderId}:`, error);
    let userMessage = 'Error delivering order. Please contact an admin.';
    if (error.message === 'ORDER_NOT_FOUND') userMessage = 'Cannot find that order.';
    else if (error.message === 'ORDER_NOT_CLAIMED') userMessage = 'Order hasn\'t been claimed yet.';
    else if (error.message === 'NOT_THE_RUNNER') userMessage = 'Only the runner who claimed this order can mark it delivered.';
    else if (error.message === 'RUNNER_NOT_FOUND') userMessage = 'Runner profile not found.';
    else if (error.message === 'REQUESTER_NOT_FOUND') userMessage = 'Requester profile not found.';

    try {
    await client.chat.postEphemeral({
        channel: channelId,
        user: clickerId,
        text: userMessage
      });
    } catch (ephemeralError) {
      logger.error('Failed to send ephemeral error for delivery failure:', ephemeralError);
    }
  }
}

/**
 * Handles the 'cancel_order' button interaction.
 * @param {object} payload - The action payload.
 * @param {object} client - Bolt's client instance.
 * @param {object} logger - Bolt's logger instance.
 */
export async function handleCancelOrder({ ack, body, client, logger }) {
  await ack();
  const action = body.actions[0]; // Get the specific action that was triggered
  const orderId = action.value; // This IS the Firestore Document ID
  const clickerId = body.user.id;
  const channelId = body.container?.channel_id;
  const messageTs = body.container?.message_ts; // Keep for updating the message

  logger.info(`'cancel_order' action received for order ID: ${orderId} from user ${clickerId}`);

  if (!orderId) {
    logger.error('Missing orderId in cancel_order action value.');
    await client.chat.postEphemeral({
        channel: channelId || clickerId, 
        user: clickerId,
        text: 'Bot tripped. Couldn\'t ID order to cancel.'
    }).catch(e => logger.error('Ephemeral error failed:', e));
    return;
  }

  try {
    // 1. Fetch Order Data using the new getOrderById function
    logger.debug(`[cancel_order] Fetching order data using Document ID: ${orderId}`);
    const orderData = await database.getOrderById(orderId);

    if (!orderData) { // Check if orderData is null (not found)
      logger.error(`Order ${orderId} not found for cancellation.`);
      await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Can\'t find that order. Maybe it rotted or got claimed/scrapped.' });
      return;
    }

    // Now orderData contains the order details (or was null if not found)
    logger.debug(`[cancel_order] Order data found:`, orderData);

    // 2. Validate Status (Must be 'ordered')
    if (orderData.status !== ORDER_STATUS.ORDERED) {
      logger.warn(`User ${clickerId} tried to cancel order ${orderId} which is already in status: ${orderData.status}`);
      await client.chat.postEphemeral({
        channel: channelId || clickerId,
        user: clickerId,
        text: 'Too late, order isn\'t pending anymore.'
      });
      return;
    }

    // 3. Validate Requester
    if (orderData.requesterId !== clickerId) {
      logger.warn(`User ${clickerId} attempted to cancel order ${orderId} requested by ${orderData.requesterId}.`);
      await client.chat.postEphemeral({
        channel: channelId || clickerId,
        user: clickerId,
        text: 'Not your order to cancel.'
      });
      return;
    }

    // 4. Update Order Status in Firestore using the database utility function
    logger.info(`Updating order ${orderId} status to CANCELLED.`);
    const updateSuccess = await database.updateOrder(orderId, {
      status: ORDER_STATUS.CANCELLED,
      updatedAt: admin.firestore.FieldValue.serverTimestamp() // Use server timestamp
    });
    
    if (!updateSuccess) {
        logger.error(`[cancel_order] Failed to update order status for ${orderId} via database.updateOrder.`);
        // Throw an error or send an ephemeral message? Send ephemeral for now.
        await client.chat.postEphemeral({
            channel: channelId || clickerId,
            user: clickerId,
            text: 'System choked trying to cancel. Try again or walk. Error: An error occurred while trying to cancel the order.'
        });
        return; // Stop processing if status update fails
    }
    logger.info(`Order ${orderId} successfully updated to CANCELLED.`);

    // 5. Refund Karma Balance
    if (orderData.karmaCost && orderData.karmaCost > 0) {
      logger.info(`Refunding ${orderData.karmaCost} karma to user ${clickerId} for cancelled order ${orderId}.`);
      const refundSuccess = await updatePlayerKarma(clickerId, orderData.karmaCost);
      if (!refundSuccess) {
        logger.error(`Failed to refund karma for cancelled order ${orderId}.`);
        // Continue to update message, but maybe log error more prominently
      }
    } else {
      logger.warn(`No karma cost found or karma cost is zero for cancelled order ${orderId}, skipping refund.`);
    }

    // 6. Update Slack Message
    if (channelId && messageTs) { // Ensure we have the message coordinates
        logger.info(`Updating Slack message ${channelId}/${messageTs} to reflect cancellation.`);
        const requesterNameToUse = orderData.requesterName || clickerId; // Fallback to clickerId if name missing
        // <<< Updated cancellation message text >>>
        const finalMessageText = `✖ Scrapped by ${requesterNameToUse}. Karma refunded.`; 
        await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: [], // Remove blocks
            text: finalMessageText
        });
        logger.info(`Slack message ${messageTs} updated successfully for cancellation.`);
    } else {
        logger.warn(`Could not update Slack message for cancelled order ${orderId} due to missing channelId or messageTs.`);
    }

    // 7. Send DM Confirmation
    try {
        const refundAmount = orderData.karmaCost || 0;
        let newBalance = '???'; // Default if fetch fails
        // Fetch updated player data to get the new balance
        try {
            const updatedPlayerData = await database.getPlayerBySlackId(clickerId);
            if (updatedPlayerData) {
                // Use karma field
                newBalance = updatedPlayerData.karma ?? '???'; 
            }
        } catch (fetchError) {
            logger.error(`[cancel_order] Failed to fetch updated player data for ${clickerId}:`, fetchError);
        }

        // Format DM according to the new style
        // Removed orderId, added backticks
        const dmText = `✖ ORDER SCRAPPED\n\`${refundAmount}\` Karma refunded. balance: \`${newBalance}\``; // Use literal newline

        // Use Block Kit
        await client.chat.postMessage({
            channel: clickerId,
            blocks: [{
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: dmText // Use the constructed string with literal newline
                }
            }],
            text: dmText // Fallback text
        });
        logger.info(`Cancellation DM sent to ${clickerId}.`);
    } catch (dmError) {
        logger.error(`Failed to send cancellation DM for order ${orderId}:`, dmError);
    }

  } catch (error) {
    logger.error(`Error handling cancel_order action for order ID ${orderId}:`, error);
    await client.chat.postEphemeral({
        channel: channelId || clickerId,
        user: clickerId,
        text: `System choked trying to cancel. Try again or walk. Error: ${error.message}`
    }).catch(e => logger.error('Ephemeral error failed:', e));
  }
}

/**
 * Handles the submission of the order modal (both standard and runner-targeted).
 */
async function handleOrderSubmission({ ack, body, view, client, logger }) {
    // <<< REMOVE immediate ack >>>
    // await ack(); 
    logger.info('[handleOrderSubmission] View submission received.');
    
    const requesterId = body.user.id;
    const channelIdFromConfig = KOFFEE_KARMA_CHANNEL_ID.value(); // UPDATED
    // const triggerId = body.trigger_id; // No longer using trigger_id for context

    // --- Determine Flow Type Based on private_metadata --- 
    let isTargetedOrder = false;
    let targetRunnerId = null;
    let originalRunnerMessageTs = null;
    let channelIdFromMetadata = null; 
    let runnerNameFromMetadata = null; // Added to pass to order creation if needed

    logger.debug('[handleOrderSubmission] Checking view.private_metadata...');
    if (view.private_metadata && view.private_metadata !== '{}') { // Check if metadata exists and is not empty json string
        logger.debug(`[handleOrderSubmission] Raw private_metadata received: ${view.private_metadata}`);
        try {
            const metadata = JSON.parse(view.private_metadata);
            logger.debug('[handleOrderSubmission] Parsed metadata:', metadata);
            // Check if parsed object has all required fields
            if (metadata.targetRunnerId && metadata.originalRunnerMessageTs && metadata.originatingChannelId) { 
                isTargetedOrder = true;
                targetRunnerId = metadata.targetRunnerId;
                originalRunnerMessageTs = metadata.originalRunnerMessageTs;
                channelIdFromMetadata = metadata.originatingChannelId;
                runnerNameFromMetadata = metadata.runnerName; // Get runner name if passed
                logger.info(`[handleOrderSubmission] Detected TARGETED order via metadata. Runner: ${targetRunnerId}, Offer TS: ${originalRunnerMessageTs}, Channel: ${channelIdFromMetadata}`);
            } else {
                 logger.debug(`[handleOrderSubmission] Metadata parsed, but missing required keys. Found: targetRunnerId=${!!metadata.targetRunnerId}, originalRunnerMessageTs=${!!metadata.originalRunnerMessageTs}, originatingChannelId=${!!metadata.originatingChannelId}`);
                 // Assume standard order if keys missing
                 isTargetedOrder = false; 
            }
        } catch (e) {
            logger.error('[handleOrderSubmission] Error parsing private_metadata:', e);
            // Proceed as standard order if metadata is invalid
            isTargetedOrder = false;
        }
    } else {
        logger.debug(`[handleOrderSubmission] No valid private_metadata found in view. Assuming STANDARD order.`);
        isTargetedOrder = false;
    }
    
    // Define common block/action IDs
    const categoryBlockId = 'category_block';
    const categoryActionId = 'drink_category_select';
    const drinkBlockId = 'drink_block';
    const drinkActionId = 'drink_input';
    const locationBlockId = 'location_block';
    const locationActionId = 'location_select';
    const recipientBlockId = 'recipient_block';
    const recipientActionId = 'recipient_select';
    const notesBlockId = 'notes_block';
    const notesActionId = 'notes_input';

    // Extract common modal values
    const stateValues = view.state.values;
    const selectedCategory = stateValues[categoryBlockId]?.[categoryActionId]?.selected_option?.value;
    const drinkDetails = stateValues[drinkBlockId]?.[drinkActionId]?.value || '';
    const selectedLocation = stateValues[locationBlockId]?.[locationActionId]?.selected_option?.value;
    const recipientSlackId = stateValues[recipientBlockId]?.[recipientActionId]?.selected_user || null;
    const notes = stateValues[notesBlockId]?.[notesActionId]?.value || '';
    
    // --- Targeted Order Flow --- 
    if (isTargetedOrder) {
        logger.info(`[handleOrderSubmission-Targeted] Processing order from ${requesterId} for runner ${targetRunnerId}`);
        try {
            // 1. Fetch Runner Offer Status IMMEDIATELY
            // Use getFirestore() directly as db might not be initialized here if called separately
            const offerRef = admin.firestore().collection('orders').doc(originalRunnerMessageTs); 
            const offerDoc = await offerRef.get();

            // Check if the offer exists and is still in the 'offered' state
            if (!offerDoc.exists || offerDoc.data().status !== ORDER_STATUS.OFFERED) { // Use ORDER_STATUS.OFFERED
                logger.warn(`[handleOrderSubmission-Targeted] Runner offer ${originalRunnerMessageTs} is not available (Status: ${offerDoc.data()?.status || 'Non-existent'}).`);
                
                // <<< ACK HERE for failure case (no response_action needed, just close modal) >>>
                await ack(); 
                
                await client.chat.postEphemeral({
                    channel: channelIdFromMetadata || channelIdFromConfig, // Use metadata channel, fallback to config
                    user: requesterId,
                    text: 'Offer gone. Too slow or already claimed.'
                });
                return; // Stop processing
            }
            const offerData = offerDoc.data();

            // 2. Parse Modal Data (already done above)

            // 3. Runner Capability Validation 
            const runnerData = await database.getPlayerBySlackId(targetRunnerId);
            if (!runnerData) {
                 // ACK first, then throw for logging/handling if needed
                await ack();
                throw new Error(`Could not find runner data for ${targetRunnerId} during submission validation.`);
            }
            const runnerCapabilities = runnerData.capabilities || [];
            if (!selectedCategory || !runnerCapabilities.includes(selectedCategory)) { // Also check if category is selected at all
                logger.warn(`[handleOrderSubmission-Targeted] Validation FAILED: Runner ${targetRunnerId} cannot make category ${selectedCategory}.`);
                
                // --- <<< RE-INSERTED ACK WITH UPDATE ACTION >>> ---
                const errorText = `🚫 Selected runner cannot make ${DRINK_CATEGORIES[selectedCategory]?.name || selectedCategory}. Pick something else.`;
                let blocksToUpdate = JSON.parse(JSON.stringify(view.blocks)); 
                // Clear previous error if any
                blocksToUpdate = blocksToUpdate.filter(b => b.block_id !== 'category_error_block');
                // Find category block and insert error context below it
                const categoryBlockIndex = blocksToUpdate.findIndex(b => b.block_id === categoryBlockId);
                if (categoryBlockIndex !== -1) {
                   blocksToUpdate.splice(categoryBlockIndex + 1, 0, { type: 'context', block_id: 'category_error_block', elements: [{ type: 'mrkdwn', text: errorText }] });
                } else {
                   // Fallback: Add error at the top if block not found
                   blocksToUpdate.unshift({ type: 'context', block_id: 'category_error_block', elements: [{ type: 'mrkdwn', text: errorText }] });
                }

                await ack({
                   response_action: 'update', 
                   view: {
                       type: 'modal',
                       title: view.title,
                       submit: view.submit, 
                       close: view.close,
                       private_metadata: view.private_metadata, // Keep metadata
                       callback_id: view.callback_id, 
                       blocks: blocksToUpdate // Send updated blocks with error
                   }
                });
                logger.info('[handleOrderSubmission-Targeted] Acknowledged with capability validation error update (modal remains open).');
                // --- <<< END RE-INSERTED ACK >>> ---
                
                // Processing stops here
                return; 
            }
            logger.info('[handleOrderSubmission-Targeted] Capability validation passed.');

            // --- Validation Passed - Ack to close modal before background processing --- 
            await ack(); // <<< ACK HERE for success case (close modal) >>>
            logger.info('[handleOrderSubmission-Targeted] Validation passed, view acknowledged (modal will close).');
            
            // --- Start Background Processing (Targeted) --- 
            // 4. Fetch Requester Info & Check Karma
            const { player: requesterPlayer, playerRef: requesterRef } = await database.getOrCreatePlayer(requesterId, client);
            if (!requesterPlayer) throw new Error(`Could not get or create player for requester ${requesterId}`);
            const requesterRealName = requesterPlayer.name || requesterId;
            const currentKarma = requesterPlayer.karma; 
            const karmaCost = DRINK_CATEGORIES[selectedCategory]?.cost || 2;

            // Check Karma Balance!
            if (currentKarma < karmaCost) {
                logger.warn(`[handleOrderSubmission-Targeted] User ${requesterId} has insufficient karma (${currentKarma}) for order costing ${karmaCost}.`);
                // Don't ack here (already done)
                await client.chat.postEphemeral({
                    channel: channelIdFromMetadata || channelIdFromConfig,
                    user: requesterId,
                    text: `Not enough Karma. You got ${currentKarma} ⚡, need ${karmaCost} ⚡. Burn it, you earn it.`
                });
                // Optional: Could try to update the runner offer message back to OFFERED? Or leave as is.
                return; 
            }
            
            // 5. Determine Recipient ID and Name
            let finalRecipientId = requesterId;
            let finalRecipientName = requesterRealName; 
            if (recipientSlackId && recipientSlackId !== requesterId) {
                try {
                    const recipientInfo = await client.users.info({ user: recipientSlackId });
                    if (recipientInfo.ok) {
                        finalRecipientId = recipientSlackId;
                        finalRecipientName = recipientInfo.user?.real_name || recipientInfo.user?.name || recipientSlackId;
                    } else { logger.warn(`[handleOrderSubmission-Targeted] Could not fetch recipient info for ${recipientSlackId}: ${recipientInfo.error}. Defaulting to requester.`); }
                } catch (userFetchError) { logger.warn(`[handleOrderSubmission-Targeted] Error fetching recipient info for ${recipientSlackId}: ${userFetchError.message}. Defaulting to requester.`); }
            }

            // 6. Deduct Karma from Requester
            const karmaUpdateSuccess = await updatePlayerKarma(requesterId, -karmaCost); 
            logger.info(`[handleOrderSubmission-Targeted] Deducted ${karmaCost} karma balance from ${requesterId}.`);

            // 7. Update the RUNNER OFFER document to CLAIMED status
            // <<< GET current time and calculate claimed expiry >>>
            const timeClaimed = Timestamp.now(); 
            const claimedExpiryTimestamp = Timestamp.fromMillis(timeClaimed.toMillis() + 10 * 60 * 1000); // 10 mins from now
            
            const updateData = {
                status: ORDER_STATUS.CLAIMED, // Change offer to claimed
                requesterId: requesterId,
                requesterName: requesterRealName,
                recipientId: finalRecipientId,
                recipientName: finalRecipientName,
                category: selectedCategory,
                drink: drinkDetails,
                location: selectedLocation, // Store location from order modal
                notes: notes,
                karmaCost: karmaCost,
                timeClaimed: timeClaimed, // <<< Use the actual Timestamp object
                claimedExpiryTimestamp: claimedExpiryTimestamp, // <<< ADD the expiry timestamp
                // Keep original runnerId, runnerName, createdAt (offer time), expiryTimestamp from the offer
            };
            logger.info(`[handleOrderSubmission-Targeted] Updating runner offer ${originalRunnerMessageTs} to CLAIMED with order details:`, updateData);
            await offerRef.update(updateData); // Update the *offer* document
            logger.info(`[handleOrderSubmission-Targeted] Runner offer ${originalRunnerMessageTs} successfully updated to CLAIMED.`);

            // 8. Format Updated Message for the *Original Runner Offer Message*
            // Fetch the *updated* offer data to ensure we have the server timestamp for timeClaimed if needed
            const updatedOfferDoc = await offerRef.get();
            const updatedOfferData = updatedOfferDoc.exists ? { id: updatedOfferDoc.id, ...updatedOfferDoc.data() } : { ...offerData, ...updateData }; // Fallback to merged data

            logger.debug('[handleOrderSubmission-Targeted] Formatting updated message for CLAIMED state (from offer)...');
            // <<< Use formatOrderMessage for consistency >>>
            const messagePayload = formatOrderMessage(updatedOfferData, originalRunnerMessageTs); 

            // 9. Update Slack Message (the original runner offer message)
            logger.info(`[handleOrderSubmission-Targeted] Updating Slack message ${channelIdFromMetadata}/${originalRunnerMessageTs}`);
            await client.chat.update({
                channel: channelIdFromMetadata,
                ts: originalRunnerMessageTs,
                blocks: messagePayload.blocks, // <<< Use blocks from formatOrderMessage
                text: messagePayload.text // <<< Use text from formatOrderMessage
            });
            logger.info(`[handleOrderSubmission-Targeted] Slack message ${originalRunnerMessageTs} updated successfully.`);

            // 10. Send DMs 
            logger.info('[handleOrderSubmission-Targeted] Sending DMs for claim confirmation.');
            try {
                const runnerIdForDM = updatedOfferData.runnerId || targetRunnerId;
                const runnerNameForDM = updatedOfferData.runnerName || runnerNameFromMetadata || runnerIdForDM;
                const locationDisplayName = LOCATIONS[updatedOfferData.location] || updatedOfferData.location; // Use display name from constants, fallback to ID
                const drinkNameForDM = updatedOfferData.drink || updatedOfferData.notes || 'the requested item'; // Use drink/notes, fallback
                const requesterNameForDM = updatedOfferData.requesterName || requesterId; // Get requester name
                
                // DM to Runner: Use Block Kit
                await client.chat.postMessage({
                    channel: runnerIdForDM,
                    blocks: [{
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `${requesterNameForDM} ordered through your offer\ndeliver \"${drinkNameForDM}\" → drop: \`${locationDisplayName}\``
                        }
                    }],
                    text: `${requesterNameForDM} ordered through your offer\ndeliver \"${drinkNameForDM}\" → drop: \`${locationDisplayName}\`` // Fallback text
                });
                // DM to Requester: Use Block Kit
                await client.chat.postMessage({
                    channel: requesterId,
                    blocks: [{
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: `${runnerNameForDM} claimed your order: \"${drinkNameForDM}\"\n→ en route to \`${locationDisplayName}\``
                        }
                    }],
                    text: `${runnerNameForDM} claimed your order: \"${drinkNameForDM}\"\n→ en route to \`${locationDisplayName}\`` // Fallback text
                });
                logger.info(`[handleOrderSubmission-Targeted] DMs sent successfully for claimed offer ${originalRunnerMessageTs}.`);
            } catch (dmError) {
               logger.error(`[handleOrderSubmission-Targeted] Failed to send claim confirmation DMs for offer ${originalRunnerMessageTs}:`, dmError);
            }

        } catch (error) {
            logger.error('[handleOrderSubmission-Targeted] Error processing targeted order submission:', error);
             // Don't ack here (already done or implicitly handled on throw)
            await client.chat.postEphemeral({
                channel: channelIdFromMetadata || channelIdFromConfig, // Use metadata channel if available
                user: requesterId,
                text: `System choked on targeted order. Try again or walk. Error: ${error.message}`
            });
        }

    // --- Standard Order Flow --- 
    } else { 
        logger.info(`[handleOrderSubmission-Standard] Processing standard order from ${requesterId}`);
        try {
            // --- 1. Standard Validation ---
            let errorsExist = false;
            let blocksToUpdate = JSON.parse(JSON.stringify(view.blocks));
            // Clear previous errors
            blocksToUpdate = blocksToUpdate.filter(b => b.block_id !== 'category_error_block' && b.block_id !== 'location_error_block');
            
            const categoryErrorText = '△ Please select a drink category.';
            const locationErrorText = '△ Please select your location.';

            // Check Category
            if (!selectedCategory) {
                errorsExist = true;
                const categoryBlockIndex = blocksToUpdate.findIndex(b => b.block_id === categoryBlockId);
                if (categoryBlockIndex !== -1) {
                    blocksToUpdate.splice(categoryBlockIndex + 1, 0, { type: 'context', block_id: 'category_error_block', elements: [{ type: 'mrkdwn', text: categoryErrorText }] });
                }
            }

            // Check Location
            if (!selectedLocation) {
                errorsExist = true;
                const locationBlockIndex = blocksToUpdate.findIndex(b => b.block_id === locationBlockId);
                if (locationBlockIndex !== -1) {
                    blocksToUpdate.splice(locationBlockIndex + 1, 0, { type: 'context', block_id: 'location_error_block', elements: [{ type: 'mrkdwn', text: locationErrorText }] });
                }
            }

            // --- Handle Validation Outcome --- 
            if (errorsExist) {
                logger.warn('[handleOrderSubmission-Standard] Validation failed.');
                // <<< ACK HERE with update action for validation error >>>
                await ack({
                    response_action: 'update', 
                    view: {
                        type: 'modal',
                        title: view.title,
                        submit: view.submit, 
                        close: view.close,
                        private_metadata: view.private_metadata, // Pass metadata even if empty
                        callback_id: view.callback_id, 
                        blocks: blocksToUpdate
                    }
                });
                 logger.info('[handleOrderSubmission-Standard] Acknowledged with validation error update.');
                return; // Stop processing
            }

            // --- Validation Passed - Ack to close modal before background processing --- 
            await ack(); // <<< ACK HERE for success case (close modal) >>>
            logger.info('[handleOrderSubmission-Standard] Validation passed, view acknowledged (modal will close).');

            // --- Start Background Processing (Standard) --- 
            let placeholderTs = null;
            let placeholderChannel = null;
            let orderDetailsForDb = {}; // Object to build for Firestore
            let orderDbId = null; // Firestore auto-generated ID
            let karmaCost = 0; // Define karmaCost for scope
            let finalOrderData = {}; // <<< DECLARE finalOrderData HERE in higher scope

            // --- 2. Post Placeholder Message ---
            try {
                // REMOVED: const requesterNameToUse = (await database.getPlayerBySlackId(requesterId))?.name || requesterId; // Fetch name for placeholder
                const placeholderResult = await client.chat.postMessage({
                    channel: channelIdFromConfig, // Post to the main channel
                    text: `⏳ ORDER INCOMING... STANDBY.` 
                    // No blocks needed for the placeholder
                });

                if (!placeholderResult.ok) {
                     throw new Error(`Failed to post placeholder message: ${placeholderResult.error}`);
                }
                placeholderTs = placeholderResult.ts;
                placeholderChannel = placeholderResult.channel;
                logger.info(`[handleOrderSubmission-Standard] Posted placeholder message: ${placeholderChannel}/${placeholderTs}`);

            } catch (placeholderError) {
                logger.error('[handleOrderSubmission-Standard] CRITICAL: Failed to post placeholder message:', placeholderError);
                 await client.chat.postEphemeral({
                     channel: channelIdFromConfig, // Still need channel context
                     user: requesterId,
                     text: `🔥 Apologies, there was an error initiating your order request. Please try again. (Error: ${placeholderError.message})`
                 });
                 return; // Stop processing if placeholder fails
            }

            // --- 3. Process Order (Fetch info, Check Karma, DB operations) ---
            try {
                 // Fetch Requester Info & Karma
                const { player: requesterPlayer, playerRef: requesterRef } = await database.getOrCreatePlayer(requesterId, client);
                if (!requesterPlayer) throw new Error(`Could not get or create player for requester ${requesterId}`);
                const requesterRealName = requesterPlayer.name || requesterId;
                const currentKarma = requesterPlayer.karma; 
                karmaCost = DRINK_CATEGORIES[selectedCategory]?.cost || 2; 
                logger.info(`[handleOrderSubmission-Standard] Requester ${requesterId} karma: ${currentKarma}, Order cost: ${karmaCost}`);

                 // Check Karma Balance
                if (currentKarma < karmaCost) {
                    logger.warn(`[handleOrderSubmission-Standard] User ${requesterId} has insufficient karma (${currentKarma}) for order costing ${karmaCost}.`);
                    // <<< DELETE the public placeholder message >>>
                    if (placeholderChannel && placeholderTs) {
                        try {
                            await client.chat.delete({
                        channel: placeholderChannel,
                                ts: placeholderTs
                            });
                            logger.info(`[handleOrderSubmission-Standard] Deleted placeholder message ${placeholderChannel}/${placeholderTs} due to insufficient karma.`);
                        } catch (deleteError) {
                            logger.error(`[handleOrderSubmission-Standard] Failed to delete placeholder message ${placeholderChannel}/${placeholderTs}:`, deleteError);
                            // Continue to send ephemeral error even if delete fails
                        }
                    }
                    await client.chat.postEphemeral({ // Send ephemeral
                        channel: channelIdFromConfig, 
                        user: requesterId,
                        text: `😟 Sorry, you don\'t have enough Karma (${currentKarma}) to place this order (cost: ${karmaCost}).`
                    });
                    return; 
                }

                // Fetch Channel Name with added logging
                let slackChannelName = null;
                try {
                    logger.debug(`[handleOrderSubmission-Standard] Fetching channel info for: ${channelIdFromConfig}`);
                    const channelInfo = await client.conversations.info({ channel: channelIdFromConfig });
                    logger.debug('[handleOrderSubmission-Standard] conversations.info response:', JSON.stringify(channelInfo)); // Log the full response
                    if (channelInfo.ok && channelInfo.channel?.name) {
                        slackChannelName = `#${channelInfo.channel.name}`;
                        logger.info(`[handleOrderSubmission-Standard] Successfully fetched channel name: ${slackChannelName}`);
                    } else {
                        logger.warn(`[handleOrderSubmission-Standard] Could not fetch channel name. OK: ${channelInfo.ok}, Error: ${channelInfo.error}, Channel Name: ${channelInfo.channel?.name}`);
                    }
                } catch (convError) {
                    logger.error(`[handleOrderSubmission-Standard] Error during client.conversations.info for ${channelIdFromConfig}:`, convError);
                }

                // --- ADDED BACK: Determine Recipient ID and Name ---
                // Extract recipientSlackId from modal values (done earlier, ensure it's available here)
                // const recipientSlackId = stateValues[recipientBlockId]?.[recipientActionId]?.selected_user || null;
                // Need to re-extract or pass it down if scope changed. Assuming stateValues is still accessible:
                const recipientSlackId = view.state.values[recipientBlockId]?.[recipientActionId]?.selected_user || null;
                
                let finalRecipientId = requesterId;
                let finalRecipientName = requesterRealName; 
                if (recipientSlackId && recipientSlackId !== requesterId) {
                    logger.info(`[handleOrderSubmission-Standard] Order is a gift for ${recipientSlackId}. Fetching recipient info...`);
                    try {
                        const recipientInfo = await client.users.info({ user: recipientSlackId });
                        if (recipientInfo.ok) {
                            finalRecipientId = recipientSlackId;
                            finalRecipientName = recipientInfo.user?.real_name || recipientInfo.user?.name || recipientSlackId;
                            logger.info(`[handleOrderSubmission-Standard] Recipient info fetched: ${finalRecipientName} (${finalRecipientId})`);
                        } else { 
                            logger.warn(`[handleOrderSubmission-Standard] Could not fetch recipient info for ${recipientSlackId}: ${recipientInfo.error}. Defaulting to requester.`); 
                            // Keep finalRecipientId/Name as the requester
                        }
                    } catch (userFetchError) { 
                        logger.warn(`[handleOrderSubmission-Standard] Error fetching recipient info for ${recipientSlackId}: ${userFetchError.message}. Defaulting to requester.`); 
                         // Keep finalRecipientId/Name as the requester
                    }
                } else {
                    logger.info(`[handleOrderSubmission-Standard] Order is for self (${requesterId}).`);
                }
                // --- END ADDED BACK --- 

                // Deduct Karma from Requester
                 const karmaUpdateSuccess = await updatePlayerKarma(requesterId, -karmaCost);
                 logger.info(`[handleOrderSubmission-Standard] Deducted ${karmaCost} karma from ${requesterId}.`);

                // Create Order Document
                 const orderTimestamp = admin.firestore.FieldValue.serverTimestamp();
                 const durationMs = 10 * 60 * 1000; // Default 10 minutes
                 const expiryTimestampJSDate = new Date(Date.now() + durationMs); 
                 
                 orderDetailsForDb = {
                    orderId: '', // Will be set to doc ID after creation
                    requesterId: requesterId,
                    requesterName: requesterRealName,
                    runnerId: null, // Not claimed yet
                    runnerName: null, 
                    // Use the determined recipient info
                    recipientId: finalRecipientId, 
                    recipientName: finalRecipientName,
                    initiatedBy: 'requester', 
                    category: selectedCategory,
                    drink: drinkDetails,
                    location: selectedLocation,
                    locationDisplayName: LOCATIONS[selectedLocation]?.name || selectedLocation, // Add display name
                    notes: notes,
                    karmaCost: karmaCost,
                    status: ORDER_STATUS.ORDERED, 
                    bonusMultiplier: 1, 
                    slackMessageTs: placeholderTs, 
                    slackChannelId: channelIdFromConfig,
                    slackChannelName: slackChannelName,
                    timeClaimed: null,
                    timeDelivered: null,
                    durationMs: durationMs, 
                    expiryTimestamp: expiryTimestampJSDate 
                    // Firestore adds createdAt/updatedAt via createOrder
                };

                logger.debug('[handleOrderSubmission-Standard] Creating order document with data:', orderDetailsForDb);
                const newOrderRef = await database.createOrder(orderDetailsForDb); 
                orderDbId = newOrderRef.id; 
                
                await newOrderRef.update({ orderId: orderDbId }); 
                
                logger.info(`[handleOrderSubmission-Standard] Order document ${orderDbId} created successfully.`);
                
                // --- FETCH the created document to get server timestamps --- 
                const createdOrderDoc = await newOrderRef.get();
                if (!createdOrderDoc.exists) {
                    throw new Error(`Failed to fetch newly created order document ${orderDbId}`);
                }
                // Assign to the higher-scoped variable
                finalOrderData = createdOrderDoc.data(); 
                
                // Ensure essential fields are present after fetch
                if (!finalOrderData.createdAt || !finalOrderData.expiryTimestamp) {
                     console.error('[handleOrderSubmission-Standard] Fetched order data missing createdAt or expiryTimestamp!', finalOrderData);
                     finalOrderData.createdAt = finalOrderData.createdAt || Timestamp.now(); 
                     finalOrderData.expiryTimestamp = finalOrderData.expiryTimestamp || Timestamp.fromDate(expiryTimestampJSDate); 
                }
                
            } catch (dbError) {
                 logger.error('[handleOrderSubmission-Standard] Error during Firestore operations:', dbError);
                 await client.chat.update({ // Update placeholder on DB Error
                     channel: placeholderChannel,
                     ts: placeholderTs,
                     text: `🔥 ORDER FAILED <@${requesterId}>. SYSTEM GLITCH. TELL AN ADMIN.`
                 }).catch(updateErr => logger.error('[handleOrderSubmission-Standard] Failed to update placeholder on DB error:', updateErr));
                 await client.chat.postEphemeral({
                     channel: channelIdFromConfig,
                     user: requesterId,
                     text: `🔥 Sorry, an internal error occurred while processing your order (${dbError.message}). Your karma was likely deducted but the order failed. Please contact an admin.`
                 });
                 return; // Stop processing
            }

            // --- 4. Update Slack Message with Final Formatted Order --- 
            try {
                logger.debug('[handleOrderSubmission-Standard] Formatting final order message using fetched data...');
                
                // Create a temporary object mapping createdAt to startTimestamp
                const dataForFormatter = {
                    ...finalOrderData, // Spread the existing order data
                    startTimestamp: finalOrderData.createdAt // Map createdAt to startTimestamp
                };
                
                // Call formatOrderMessage with the modified data and the DB ID
                const messagePayload = formatOrderMessage(dataForFormatter, orderDbId);
                
                // Validate the payload structure minimally
                if (!messagePayload || !Array.isArray(messagePayload.blocks) || !messagePayload.text) {
                    throw new Error('formatOrderMessage did not return a valid structure with blocks array and text.');
                }

                logger.info(`[handleOrderSubmission-Standard] Updating placeholder message ${placeholderChannel}/${placeholderTs} with final order details...`);
                const updateResult = await client.chat.update({
                    channel: placeholderChannel,
                    ts: placeholderTs,
                    blocks: messagePayload.blocks, 
                    text: messagePayload.text 
                });
                logger.info(`[handleOrderSubmission-Standard] Slack message ${placeholderTs} updated successfully with final order.`);

                // --- Update Firestore with final message TS --- 
                if (updateResult.ok && updateResult.ts) {
                    await database.updateOrder(orderDbId, { 
                        slackMessageTs: updateResult.ts, 
                        slackChannelId: updateResult.channel
                    });
                    logger.info(`[handleOrderSubmission-Standard] Successfully linked order ${orderDbId} with final Slack info ${updateResult.channel}/${updateResult.ts}.`);
                } else {
                     logger.error(`[handleOrderSubmission-Standard] Slack update succeeded but response missing ts/channel. Cannot link DB accurately for order ${orderDbId}. Update Result:`, updateResult);
                }

                // <<< ADD DM Confirmation to Requester >>>
                try {
                    const confirmationText = `Your order is live in <#${finalOrderData.slackChannelId}>.`; // REMOVED !
                    await client.chat.postMessage({
                        channel: finalOrderData.requesterId, // Use finalOrderData
                        text: `Your order is live in ${finalOrderData.slackChannelName || '#unknown-channel'}.`, // Fallback text + REMOVED !
                        blocks: [{
                            type: 'section',
                            text: { type: 'mrkdwn', text: confirmationText }
                        }]
                    });
                    logger.info(`Sent order confirmation DM to requester ${finalOrderData.requesterId}`);
                } catch (dmError) {
                    logger.error(`Failed to send order confirmation DM to ${finalOrderData.requesterId}:`, dmError);
                    // Do not re-throw, failure to DM should not break the order flow
                }
                // <<< END DM Confirmation >>>

            } catch (slackUpdateError) {
                logger.error('[handleOrderSubmission-Standard] CRITICAL: Failed to update placeholder message with final order blocks:', slackUpdateError);
                const orderIdForError = orderDbId || 'Unknown'; 
                await client.chat.postEphemeral({
                    channel: channelIdFromConfig,
                    user: requesterId, 
                    text: `😬 Your order was created (ID: ${orderIdForError}), but there was an error updating the Slack message. Please check the channel or contact an admin. Error: ${slackUpdateError.message}`
                });
            }

        } catch (error) {
             logger.error('[handleOrderSubmission-Standard] Unhandled error processing standard order submission:', error);
             // Ack may or may not have happened depending on where error occurred.
             // Try to send an ephemeral message if possible.
             try {
                 await client.chat.postEphemeral({
                     channel: channelIdFromConfig, // Use config channel ID
                     user: requesterId,
                     text: `System choked processing order. Try again or walk. Error: ${error.message}`
                 });
             } catch (ephemeralError) {
                  logger.error('[handleOrderSubmission-Standard] Failed to send ephemeral error after main standard order error:', ephemeralError);
             }
        }
    } // End else (Standard Order Flow)
} // End handleOrderSubmission

/**
 * Handle /order command
 * Opens modal for placing an order
 */
export const orderHandler = (app) => {
  app.command('/order', async ({ ack, body, client, logger }) => {
    try {
      // Acknowledge the command request
      await ack();

      // <<< ADD DM Channel Check >>>
      if (body.channel_name === 'directmessage') {
        logger.warn(`User ${body.user_id} tried to use /order in a DM. Instructing to use channel.`);
        await client.chat.postEphemeral({
          channel: body.channel_id, // This will be the DM channel
          user: body.user_id,
          text: "COMMANDS IN THE CHANNEL, NOT HERE. USE <#C08K73A45NX|koffee-karma-sf>."
        });
        return;
      }
      // <<< END DM Channel Check >>>

      // Capture originating channel info
      const originatingChannelId = body.channel_id;
      const originatingChannelName = body.channel_name;
      logger.info(`Received /order from channel: ${originatingChannelName} (${originatingChannelId})`);

      // Open the order modal, passing channel info
      const modal = buildOrderModal({}, null, null, originatingChannelId, originatingChannelName);

      await client.views.open({
        trigger_id: body.trigger_id,
        view: modal
      });
    } catch (error) {
      logger.error('Error handling /order command:', error); // Use logger
      // Optionally send ephemeral error message
      try {
        await client.chat.postEphemeral({
            channel: body.channel_id,
            user: body.user_id,
            text: `Sorry, there was an error opening the order modal: ${error.message}`
        });
      } catch (ephemeralError) {
        logger.error('Failed to send ephemeral error message:', ephemeralError);
      }
    }
  });

  // Register Action Handlers
  app.action('claim_order', handleClaimOrder);
  app.action('cancel_order', handleCancelOrder);
  app.action('deliver_order', handleDeliverOrder);

  // Register generic view submission handler
  app.view('koffee_request_modal', handleOrderSubmission);

  // <<< ADDED location_select handler >>>
  // Handle location selection in the modal
  app.action('location_select', async ({ ack, body, client, logger }) => {
    await ack();
    const selectedLocation = body.actions[0].selected_option.value;
    const viewId = body.view.id;
    const currentView = body.view; // Get the current view object
    const originalPrivateMetadata = currentView.private_metadata; // Get existing metadata

    logger.info(`Location selected: ${selectedLocation}`);

    try {
      // Remove existing location error block if present
      const blocksWithoutError = currentView.blocks.filter(block => block.block_id !== 'location_error_block');

      // Find the map block and update its text
      const mapBlockIndex = blocksWithoutError.findIndex(block => block.block_id === 'map_block');
      const newMapText = generateMap(selectedLocation, { includeLegend: true }); // Generate map with legend

      let updatedBlocks = [...blocksWithoutError];
      if (mapBlockIndex !== -1) {
        updatedBlocks[mapBlockIndex] = {
          ...updatedBlocks[mapBlockIndex], // Keep existing block properties
          text: { type: 'mrkdwn', text: `\`\`\`${newMapText}\`\`\`` },
        };
      } else {
        logger.warn('Map block not found in modal view, cannot update.');
      }

      // Construct the updated view payload PRESERVING METADATA
      const updatedView = {
        view_id: viewId,
        view: { 
          type: currentView.type,
          title: currentView.title,
          submit: currentView.submit,
          close: currentView.close,
          callback_id: currentView.callback_id, // Preserve original callback_id
          private_metadata: originalPrivateMetadata, // <<< Preserve original metadata
          blocks: updatedBlocks, 
        },
      };

      await client.views.update(updatedView);
      logger.info(`Modal view ${viewId} updated successfully for location ${selectedLocation}.`);
    } catch (error) {
      logger.error(`Error updating modal view ${viewId} for location selection:`, error);
    }
  });

  // <<< ADDED drink_category_select handler >>>
  // Handle category selection (clears error)
  app.action('drink_category_select', async ({ ack, body, client, logger }) => {
    await ack();
    const viewId = body.view.id;
    const currentView = body.view;
    const originalPrivateMetadata = currentView.private_metadata; // Get existing metadata

    logger.info('[drink_category_select] Action received. Attempting ack and error clear.');
    
    try {
        // Filter out BOTH potential error blocks
        const originalBlockCount = currentView.blocks.length;
        const blocksWithoutError = currentView.blocks.filter(block => 
            block.block_id !== 'category_error_block' && 
            block.block_id !== 'category_runner_error_block' // <<< ADDED runner error block ID
        );
        const blocksChanged = blocksWithoutError.length < originalBlockCount;

        // Only update if an error block was actually removed
        if (blocksChanged) {
             const updatedViewPayload = {
                view_id: viewId,
                view: {
                    type: currentView.type,
                    title: currentView.title,
                    submit: currentView.submit,
                    close: currentView.close,
                    callback_id: currentView.callback_id, // Preserve original callback_id
                    private_metadata: originalPrivateMetadata, // <<< Preserve original metadata
                    blocks: blocksWithoutError,
                 },
             };
             logger.debug(`[drink_category_select] Calling views.update for view ${viewId} to remove errors.`);
             await client.views.update(updatedViewPayload);
             logger.info(`[drink_category_select] Successfully called views.update to clear errors for view ${viewId}.`);
        } else {
             logger.debug('[drink_category_select] No error blocks found to remove, or blocks unchanged.');
        }
    } catch(error) {
         logger.error('[drink_category_select] Error updating view to clear category error:', error);
    }
  });

  // <<< ADDED cancel_claimed_order handler >>>
  // Handle runner cancelling a claimed order
  app.action('cancel_claimed_order', handleCancelClaimedOrder);
};

/**
 * Handle runner cancelling a claimed order.
 * Action ID: cancel_claimed_order
 */
async function handleCancelClaimedOrder(payload) {
  const { ack, body, client, logger } = payload;
  await ack();

  const action = body.actions[0];
  const orderId = action.value; // Firestore Document ID
  const clickerId = body.user.id;
  const channelId = body.container?.channel_id;
  const messageTs = body.container?.message_ts;

  logger.info(`[handleCancelClaimedOrder] Received for order ${orderId} from user ${clickerId}`);

  if (!orderId || !channelId || !messageTs) {
    logger.error('[handleCancelClaimedOrder] Missing orderId, channelId, or messageTs.', { orderId, channelId, messageTs });
    await client.chat.postEphemeral({ channel: channelId || clickerId, user: clickerId, text: 'Bot spazzed. Couldn\'t ID the order to cancel.' });
    return;
  }

  try {
    const orderData = await database.getOrderById(orderId);
    const orderDbId = orderData?.id; // Use the ID returned by getOrderById

    if (!orderData || !orderDbId) {
      logger.error(`[handleCancelClaimedOrder] Order document not found for ID: ${orderId}`);
      await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Order not found. Maybe it was already dealt with?' });
      return;
    }
     logger.debug(`[handleCancelClaimedOrder] Order data found:`, orderData);


    // Validate Status & User
    if (orderData.status !== ORDER_STATUS.CLAIMED) {
      logger.warn(`User ${clickerId} tried to cancel order ${orderDbId} which is not 'claimed' (status: ${orderData.status})`);
      await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Can only cancel a claimed order you are running.' });
      return;
    }
    if (orderData.runnerId !== clickerId) {
      // If the clicker is not the runner, check if they are the requester
      if (orderData.requesterId === clickerId) {
        logger.warn(`Requester ${clickerId} tried to use 'CANCEL DELIVERY' on their own claimed order ${orderDbId}.`);
        await client.chat.postEphemeral({
            channel: channelId, 
            user: clickerId,
            text: "ORDER CLAIMED. Can't scrap it now. Wait for your runner or ping 'em."
        });
      } else {
        // Clicker is neither the runner nor the requester
        logger.warn(`User ${clickerId} (not runner or requester) tried to cancel order ${orderDbId} they are not running (runner: ${orderData.runnerId})`);
        await client.chat.postEphemeral({ 
            channel: channelId, 
            user: clickerId, 
            text: 'Not your delivery to cancel.' 
        });
      }
      return;
    }

    // Update Firestore Order Status & Refund Karma to Requester
    const requesterId = orderData.requesterId;
    const karmaCost = orderData.karmaCost;
    logger.info(`[handleCancelClaimedOrder] Updating order ${orderDbId} to ${STATUS_CANCELLED_RUNNER}, refunding ${karmaCost} karma to requester ${requesterId}`);

    const orderRef = admin.firestore().collection('orders').doc(orderDbId);
    const orderUpdatePromise = orderRef.update({ status: STATUS_CANCELLED_RUNNER });
    // Refund karma atomically to the *requester*
    const refundPromise = updatePlayerKarma(requesterId, karmaCost); // Pass positive value

    const [orderUpdateResult, refundResult] = await Promise.allSettled([orderUpdatePromise, refundPromise]);
    let refundSuccess = false;

    if (orderUpdateResult.status === 'rejected') {
      logger.error(`[handleCancelClaimedOrder] Failed to update order ${orderDbId} status:`, orderUpdateResult.reason);
      await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Failed to update the order status. Contact admin.' });
      return; // Stop if order update fails
    } else {
        logger.info(`[handleCancelClaimedOrder] Order ${orderDbId} status updated successfully.`);
    }

    if (refundResult.status === 'rejected') {
      logger.error(`[handleCancelClaimedOrder] Failed to refund karma to requester ${requesterId} for order ${orderDbId}:`, refundResult.reason);
      await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Failed to refund karma to the requester. Please notify them and contact an admin.' }); // REMOVED !
      // Don't set refundSuccess to true, but continue to update message
    } else {
      refundSuccess = refundResult.value; // Assuming updatePlayerKarma returns true/false
      if (refundSuccess) {
        logger.info(`[handleCancelClaimedOrder] Karma refund successful for requester ${requesterId}.`);
      } else {
        logger.warn(`[handleCancelClaimedOrder] Karma refund function returned false for order ${orderDbId}, requester ${requesterId}. DB inconsistency?`);
        await client.chat.postEphemeral({ channel: channelId, user: clickerId, text: 'Karma refund processed for requester, but there might be an issue with their account. Notify admin.' });
      }
    }


    // Update Slack Message
    // Use the reference style for runner cancellation message, using full name
    const runnerNameToUse = orderData.runnerName || clickerId; // Fallback to clickerId if name missing
    // Construct the final message text, adding refund info conditionally
    let finalMessageText = `⚠ ${runnerNameToUse} bailed on your order`;
    if (refundSuccess && karmaCost > 0) {
        finalMessageText += `\n\`${karmaCost}\` Karma refunded.`; // Use literal newline
    } else if (!refundSuccess && karmaCost > 0) {
        finalMessageText += `\nISSUE REFUNDING \`${karmaCost}\` KARMA. CHECK WITH ADMIN.`; // Use literal newline
    }

    // Use Block Kit for the final message
    logger.info(`[handleCancelClaimedOrder] Updating Slack message ${channelId}/${messageTs} to cancelled state.`);
    try {
        await client.chat.update({
            channel: channelId,
            ts: messageTs,
            blocks: [], // Remove blocks for cancelled state
            text: finalMessageText // Use the constructed text
        });
        logger.info(`[handleCancelClaimedOrder] Slack message ${messageTs} updated successfully.`);
    } catch (slackError) {
        logger.error(`[handleCancelClaimedOrder] Failed to update Slack message for cancelled order:`, slackError);
        // Fallback ephemeral if update fails
        const orderIdForError = orderDbId || 'Unknown'; 
        await client.chat.postEphemeral({
            channel: channelId,
            user: clickerId, 
            text: `😬 Order cancelled, but failed to update the main message. Order ID: ${orderIdForError}. Error: ${slackError.message}`
        }).catch(ephemError => logger.error('[handleCancelClaimedOrder] Failed to send fallback ephemeral error:', ephemError));
    }

    // Send DMs
    // DM to Runner
    try {
        const runnerDMText = `⚠ you bailed on an order\nrep not earned. thread's broken.`; // Literal newline
        await client.chat.postMessage({
            channel: clickerId,
            blocks: [{
                type: 'section',
                text: { type: 'mrkdwn', text: runnerDMText }
            }],
            text: runnerDMText // Fallback
        });
    } catch (dmError) {
        logger.error(`[handleCancelClaimedOrder] Failed to send DM to runner ${clickerId}:`, dmError);
    }

    // DM to Requester
    if (requesterId) {
        try {
            // Use the finalMessageText constructed earlier which already includes refund status
            await client.chat.postMessage({
                channel: requesterId,
                blocks: [{
                    type: 'section',
                    text: { type: 'mrkdwn', text: finalMessageText } 
                }],
                text: finalMessageText // Fallback
            });
        } catch (dmError) {
             logger.error(`[handleCancelClaimedOrder] Failed to send DM to requester ${requesterId}:`, dmError);
        }
    }

  } catch (error) {
    logger.error(`Error handling cancel_claimed_order action for order ${orderId}:`, error);
    await client.chat.postEphemeral({
        channel: channelId,
        user: clickerId,
        text: `System choked trying to cancel. Try again or walk. Error: ${error.message}`
    }).catch(e => logger.error('Ephemeral error failed:', e));
  }
}