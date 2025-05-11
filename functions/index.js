console.log('[index.js] TOP LEVEL EXECUTION STARTING');

// --- RESTORE IMPORTS ---
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import bodyParser from 'body-parser';
import { onMessagePublished } from 'firebase-functions/v2/pubsub';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

// --- ADD core functions import ---
// import * as functions from 'firebase-functions'; 
// --- END ADD ---

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '.env') });

import { onRequest } from 'firebase-functions/v2/https';
import admin from 'firebase-admin';
import bolt from '@slack/bolt';
const { App, ExpressReceiver, LogLevel } = bolt;
import express from 'express';
import { SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET } from './utils/config.js';
import { logger } from './utils/logger.js';
// --- Database Imports ---
import * as database from './utils/database.js'; // Using namespace import for DB
// --- Constants Imports ---
import { 
  DRINK_CATEGORIES, 
  LOCATIONS, 
  ORDER_STATUS 
} from './utils/constants.js';
// --- Message Formatter Imports ---
import { formatOrderMessage } from './lib/messages/order-message.js'; // <<< CORRECT PATH FOR NEW FORMATTER >>>
import { formatRunnerMessage } from './utils/message-formatter.js'; // <<< ADD THIS IMPORT
import { generateMap } from './utils/message-formatter.js'; // <<< Ensure map is also imported if needed elsewhere (it was used in action handlers)

// --- Handler Imports (Import them here, but register them inside initializeSlackApp) ---
import { karmaHandler } from './handlers/karma-handler.js';
import { orderHandler } from './handlers/order-handler.js';
import { deliveryHandler, handleOpenOrderModalForRunner } from './handlers/delivery-handler.js';
import { leaderboardHandler } from './handlers/leaderboard-handler.js';
import { eventHandler } from './handlers/event-handler.js';
import { redeemHandler } from './handlers/redeem-handler.js';

// Initialize Firebase Admin SDK - THIS SHOULD BE DONE ONCE, IDEALLY IN firebase.js
// admin.initializeApp(); // <<< REMOVE THIS LINE

// --- Lazy Initialization for Slack App ---
let _slackApp;
let _expressReceiver;

function initializeSlackApp() {
  if (!_slackApp) {
    logger.info('[initializeSlackApp] Initializing Slack App for the first time...');
    const token = SLACK_BOT_TOKEN.value();
    const signingSecret = SLACK_SIGNING_SECRET.value();
    // const channelId = getConfig('KOFFEE_KARMA_CHANNEL_ID'); // Loaded but not directly used for App init

    if (!token || !signingSecret) {
      logger.error('🔥🔥🔥 CRITICAL: SLACK_BOT_TOKEN or SLACK_SIGNING_SECRET is missing. App cannot function correctly.');
      // In a real scenario, you might want to throw an error or prevent the app from trying to start further
      // if these are critical for any operation. For deployment analysis, this log is important.
    }

    _expressReceiver = new ExpressReceiver({
      signingSecret: signingSecret,
      logLevel: LogLevel.DEBUG // Or use getConfig for this too if needed
    });

    _slackApp = new App({
      token: token,
      receiver: _expressReceiver,
      logLevel: LogLevel.DEBUG,
      processBeforeResponse: true // Important for Cloud Functions HTTPS environment
    });

    _slackApp.use(async ({ next }) => {
      logger.debug('🚦 Bolt app.use middleware reached! Request proceeding...');
      await next();
    });

    _slackApp.error(async (error) => {
      logger.error("🔥🔥🔥 Global Bolt Error Handler Caught Error 🔥🔥🔥:");
      logger.error("Error Code:", error.code);
      logger.error("Original Error:", error.original?.message || error.original || 'N/A');
      logger.error("Full Error Stack:", error.stack);
      if (error.context) {
        logger.error("Error Context:", JSON.stringify(error.context, null, 2));
      }
      logger.error("Complete Error Object:", JSON.stringify(error, null, 2));
    });

    // --- Register Handlers with the _slackApp instance ---
    logger.info('*** Registering handlers with Slack App... ***');
    
    // Call imported handlers to register their specific commands/actions/events
    karmaHandler(_slackApp);
    orderHandler(_slackApp);
    deliveryHandler(_slackApp);
    leaderboardHandler(_slackApp);
    redeemHandler(_slackApp);
    eventHandler(_slackApp);

    // Specific actions/commands/events that might have been directly registered in index.js before
    // Ensure these are now handled within their respective handler modules OR registered here if truly global.
    // Most of these were already being delegated to specific handlers, which is good.
    // Example of a direct registration if one was missed by modular handlers:
    // _slackApp.action('some_global_action', async ({ ack }) => { await ack(); /* ... */ });

    // This specific action is kept as it's imported directly and seems intentionally separate.
    _slackApp.action('open_order_modal_for_runner', handleOpenOrderModalForRunner);
    
    // The following direct registrations are REMOVED as they are presumed to be handled
    // by the handler module calls above (e.g., orderHandler(_slackApp) should register /order).
    // If any handler module does NOT register its own commands/actions/events,
    // that module needs to be updated, or the specific registration re-added here if necessary.

    // REMOVED: _slackApp.command('/order', orderHandler.handleOrderSubmission);
    // REMOVED: _slackApp.command('/karma', karmaHandler.handleKarmaCommand);
    // REMOVED: _slackApp.command('/deliver', deliveryHandler.handleDeliverCommand);
    // REMOVED: _slackApp.command('/leaderboard', leaderboardHandler.handleLeaderboardCommand);
    // REMOVED: _slackApp.command('/redeem', redeemHandler.handleRedeemCommand);

    // REMOVED: _slackApp.action('claim_order', orderHandler.handleClaimOrder);
    // REMOVED: _slackApp.action('deliver_order', orderHandler.handleDeliverOrder);
    // REMOVED: _slackApp.action('cancel_order', orderHandler.handleCancelOrder);
    // REMOVED: _slackApp.action('cancel_claimed_order', orderHandler.handleCancelClaimedOrder);
    // REMOVED: _slackApp.action('order_now', deliveryHandler.handleOrderNowButton);
    // REMOVED: _slackApp.action('cancel_ready_offer', deliveryHandler.handleCancelReadyOffer);

    // REMOVED: _slackApp.event('member_joined_channel', eventHandler.handleMemberJoinedChannel);

    logger.info('*** Slack App and handlers registered. ***');
  }
  // Return both app and receiver as they might be needed by different parts
  return { app: _slackApp, receiver: _expressReceiver };
}
// --- End Lazy Initialization ---

const firebaseApp = express();

firebaseApp.use(bodyParser.json());
firebaseApp.use(bodyParser.urlencoded({ extended: true }));

firebaseApp.use((req, res, next) => {
  if (req.body && req.body.type === 'url_verification' && req.body.challenge) {
    logger.info('✅ Responding to Slack URL verification challenge.');
    res.status(200).send(req.body.challenge);
  } else {
    logger.debug('⏩ Verification challenge check passed, continuing...');
    next();
  }
});

firebaseApp.use((req, res, next) => {
  if (req.headers['content-type'] === 'application/x-www-form-urlencoded' &&
      req.body &&
      typeof req.body.payload === 'string') {
    try {
      logger.debug('⏩ Unpacking req.body.payload string...');
      req.body = JSON.parse(req.body.payload);
      logger.debug('✅ Successfully parsed payload string into req.body.');
    } catch (e) {
      logger.error('❌ Failed to parse req.body.payload string:', e);
    }
  } else {
    logger.debug('⏩ Payload unpacking middleware skipped.');
  }
  next();
});

firebaseApp.get('/', async (req, res) => {
  logger.info('Received GET / request, likely from warmer. Initiating 30-second delay...');
  await new Promise(resolve => setTimeout(resolve, 30000));
  logger.info('30-second delay complete. Sending 204 No Content for warmer.');
  res.status(204).send();
});

// Mount Bolt receiver using the lazily initialized receiver
firebaseApp.use('/', (req, res, next) => {
  const { receiver } = initializeSlackApp(); // Ensures app and receiver are initialized
  if (receiver && typeof receiver.requestHandler === 'function') {
    return receiver.requestHandler(req, res);
  }
  logger.error('Slack receiver is not available or not a function.');
  res.status(500).send('Internal Server Error: Slack receiver misconfiguration.');
});

export const slack = onRequest(
    {
        region: "us-west1",
        memory: "256MiB",
        minInstances: 1
    },
    (request, response) => {
      initializeSlackApp(); // Crucial: Ensure Slack app is initialized before firebaseApp handles request
      return firebaseApp(request, response); // Pass control to the express app
    }
);

// --- Pub/Sub Function (orderTimerUpdater) ---
// This function creates its own temporary App instance when triggered,
// which is fine as it's self-contained and only for specific client calls.
// No changes needed here for lazy loading the main 'slack' function's App.
const ORDER_TIMER_TOPIC = 'check-order-timers';

export const orderTimerUpdater = onMessagePublished(
    { topic: ORDER_TIMER_TOPIC, region: 'us-west1' },
    async (event) => {
        logger.info(`[${ORDER_TIMER_TOPIC}] Received Pub/Sub message:`, event.id);

        const tempApp = new App({ // This is fine, it's a temporary client for this job
            token: SLACK_BOT_TOKEN.value(),
            signingSecret: SLACK_SIGNING_SECRET.value(),
            logLevel: LogLevel.DEBUG
        });
        const client = tempApp.client;
        // const jobLogger = tempApp.logger; // Use the main logger or this one

        const now = new Date();
        const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
        const ordersRef = admin.firestore().collection('orders');

        logger.info(`[${ORDER_TIMER_TOPIC}] Running timer check at ${now.toISOString()}`);

        try {
            const activeUnclaimedOrdersQuery = ordersRef
                .where('status', '==', ORDER_STATUS.ORDERED)
                .where('expiryTimestamp', '>', nowTimestamp);

            const activeClaimedOrdersQuery = ordersRef
                .where('status', '==', ORDER_STATUS.CLAIMED)
                .where('claimedExpiryTimestamp', '>', nowTimestamp); // Use claimedExpiryTimestamp here

            const [activeUnclaimedSnapshot, activeClaimedSnapshot] = await Promise.all([
                activeUnclaimedOrdersQuery.get(),
                activeClaimedOrdersQuery.get()
            ]);

            logger.info(`[${ORDER_TIMER_TOPIC}] Found ${activeUnclaimedSnapshot.size} active unclaimed and ${activeClaimedSnapshot.size} active claimed orders to potentially update.`);

            const activeItemUpdatePromises = [];
            const allActiveDocs = [...activeUnclaimedSnapshot.docs, ...activeClaimedSnapshot.docs];

            allActiveDocs.forEach(doc => {
                const itemId = doc.id;
                const item = doc.data();
                logger.debug(`[Order Timer] Processing active item ${itemId} (status: ${item.status}) for message update.`);

                const orderDetails = { ...item, orderId: itemId };
                try {
                    const messagePayload = formatOrderMessage(orderDetails); // formatOrderMessage should correctly use expiryTimestamp or claimedExpiryTimestamp based on status
                    if (messagePayload && item.slackChannelId && item.slackMessageTs) {
                        logger.debug(`[Order Timer] Updating msg ${item.slackMessageTs} for order ${itemId} (${item.status})`);
                        activeItemUpdatePromises.push(
                            client.chat.update({
                                channel: item.slackChannelId,
                                ts: item.slackMessageTs,
                                blocks: messagePayload.blocks,
                                text: messagePayload.text,
                            }).catch(err => {
                                logger.error(`[Order Timer] Failed Slack update for ${itemId}:`, err);
                            })
                        );
                    } else {
                        logger.warn(`[Order Timer] Skipping Slack message update for ${itemId}: Missing payload, channelId, or slackMessageTs.`);
                    }
                } catch (error) {
                    logger.error(`[Order Timer] Error formatting message for active order ${itemId}:`, error);
                }
            });

            // --- Process Active Runner Offers --- 
            const activeOffersQuery = ordersRef
                .where('status', '==', ORDER_STATUS.OFFERED) 
                .where('initiatedBy', '==', 'runner')
                .where('expiryTimestamp', '>', nowTimestamp);
            const activeOffersSnapshot = await activeOffersQuery.get();
            logger.info(`[${ORDER_TIMER_TOPIC}] Found ${activeOffersSnapshot.size} active runner offers to potentially update.`);
            const activeOfferUpdatePromises = processActiveRunnerOffers(activeOffersSnapshot, client, logger); // Existing call, ensure this function is correct

            // --- Process Expired Orders --- 
            const expiredOrdersQuery = ordersRef
                .where('status', '==', ORDER_STATUS.ORDERED)
                .where('expiryTimestamp', '<=', nowTimestamp);
            const expiredOrdersSnapshot = await expiredOrdersQuery.get();
            logger.info(`[${ORDER_TIMER_TOPIC}] Found ${expiredOrdersSnapshot.size} expired orders to process.`);
            const expiredOrderPromises = processExpiredOrders(expiredOrdersSnapshot, client, logger);

            // --- Process Expired Runner Offers --- 
            const expiredOffersQuery = ordersRef
                .where('status', '==', ORDER_STATUS.OFFERED)
                .where('initiatedBy', '==', 'runner')
                .where('expiryTimestamp', '<=', nowTimestamp);
            const expiredOffersSnapshot = await expiredOffersQuery.get();
            logger.info(`[${ORDER_TIMER_TOPIC}] Found ${expiredOffersSnapshot.size} newly expired runner offers.`);
            const expiredOfferPromises = processExpiredRunnerOffers(expiredOffersSnapshot, client, logger);

            // --- Process Expired CLAIMED Orders --- 
            const expiredClaimedQuery = ordersRef
                .where('status', '==', ORDER_STATUS.CLAIMED)
                .where('claimedExpiryTimestamp', '<=', nowTimestamp);
            const expiredClaimedSnapshot = await expiredClaimedQuery.get();
            logger.info(`[${ORDER_TIMER_TOPIC}] Found ${expiredClaimedSnapshot.size} expired claimed orders to process.`);
            const resolvedExpiredClaimedPromises = await processExpiredClaimedOrders(expiredClaimedSnapshot, client, logger);

            // Wait for all updates and expirations to complete
            await Promise.all([
                ...activeItemUpdatePromises, // Use the new combined list for active orders/claimed items
                ...activeOfferUpdatePromises,
                ...expiredOrderPromises,
                ...expiredOfferPromises,
                ...resolvedExpiredClaimedPromises
            ]);
            logger.info(`[${ORDER_TIMER_TOPIC}] Finished processing updates and expirations.`);

        } catch (error) {
            logger.error(`[${ORDER_TIMER_TOPIC}] Error executing timer update function:`, error);
            throw error;
        }
    }
);

// --- Helper function to process active runner offers ---
function processActiveRunnerOffers(snapshot, client, logger) {
    const promises = [];
    snapshot.forEach(doc => {
        const offerId = doc.id;
        const offerData = doc.data();
        if (!offerData.slackChannelId || !offerData.slackMessageTs || !offerData.createdAt || !offerData.durationMs) {
            logger.warn(`[Runner Timer] Skipping active offer ${offerId} due to missing fields (checked slackChannelId, slackMessageTs, createdAt, durationMs).`);
            return;
        }
        const formatData = { 
            runnerId: offerData.runnerId || 'Unknown', // Default if missing
            runnerName: offerData.runnerName || 'Unknown Runner',
            capabilities: offerData.capabilities || [],
            startTimestamp: offerData.createdAt, // <<< FIX: Pass the Timestamp object directly
            durationMs: offerData.durationMs, 
            status: offerData.status, // Pass current status
            messageTs: offerData.slackMessageTs // Pass messageTs for button value
        };
        const updatedBlocks = formatRunnerMessage(formatData, offerData.slackMessageTs);
        promises.push(
            client.chat.update({
                channel: offerData.slackChannelId,
                ts: offerData.slackMessageTs,
                blocks: updatedBlocks,
                text: `Runner ${formatData.runnerName} is still available.` // Use formatted name
            }).catch(error => logger.error(`[Runner Timer] Failed update for active offer ${offerId} (${offerData.slackMessageTs}):`, error))
        );
    });
    return promises;
}

// --- Helper function to process expired orders ---

// <<< DEFINE formatExpiredOrderMessage HELPER >>>
function formatExpiredOrderMessage(orderData, refundMessage) {
  // Use punk style text, use full names
  const requesterName = orderData.requesterName || 'UNKNOWN';
  const runnerName = orderData.runnerName || 'UNKNOWN';
  let finalMessage = '';

  if (orderData.status === ORDER_STATUS.EXPIRED_CLAIMED) {
    finalMessage = `🚫 Runner ${runnerName} missed their mark on an order.${refundMessage.toUpperCase()}`;
  } else { // Default EXPIRED (unclaimed)
    finalMessage = `☠ An order rotted. No one stepped up.${refundMessage.toUpperCase()}`;
  }
  return finalMessage;
}

function processExpiredOrders(snapshot, client, logger) {
    const promises = [];
    snapshot.forEach(async (doc) => {
        const orderData = doc.data();
        const orderId = doc.id;

        // Skip processing if already expired or in another non-refundable state
        if (orderData.status !== ORDER_STATUS.ORDERED) {
            logger.warn(`[Order Timer] Skipping order ${orderId} as it's not in 'ordered' status (current: ${orderData.status}).`);
            return; // Skip this iteration
        }
        logger.info(`[Order Timer] Expiring order ${orderId} (${orderData.slackMessageTs})`);
        const updateData = {
            status: ORDER_STATUS.EXPIRED, // Use correct constant
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Handle karma refund separately after order update
        let refundAmount = 0;
        if (orderData.requesterId && orderData.karmaCost > 0) {
            refundAmount = orderData.karmaCost;
        }

        try {
            // First, update the order status using the CORRECT function
            // <<< FIX: Use database.updateOrder instead of database.updateOrderStatus >>>
            await database.updateOrder(orderId, updateData);
            logger.info(`[Order Timer] Updated order ${orderId} status to EXPIRED.`);

            // Second, if applicable, attempt the refund
            let refundSuccess = true;
            let refundMessage = '';
            if (refundAmount > 0) {
                // FIX: Update logging/messages
                logger.info(`[Order Timer] Attempting refund of ${refundAmount} karma to ${orderData.requesterId} for expired order ${orderId}.`);
                try {
                    refundSuccess = await database.updatePlayerKarma(orderData.requesterId, refundAmount);
                    refundMessage = refundSuccess
                        ? ` YOUR ${refundAmount} KARMA HAS BEEN REFUNDED.` // Uppercase
                        : ` THERE WAS AN ISSUE REFUNDING YOUR ${refundAmount} KARMA. PLEASE CONTACT AN ADMIN.`; // Uppercase
                    logger.info(`[Order Timer] Karma refund ${refundSuccess ? 'successful' : 'failed'} for order ${orderId}.`);
                } catch (refundError) {
                    refundSuccess = false;
                    logger.error(`[Order Timer] Error refunding karma for order ${orderId}:`, refundError);
                    refundMessage = ` AN ERROR OCCURRED WHILE TRYING TO REFUND YOUR ${refundAmount} KARMA. PLEASE CONTACT AN ADMIN.`; // Uppercase
                }
            }

            // Third, update the Slack message
            // <<< FIX: Pass orderId to formatExpiredOrderMessage >>>
            const finalMessage = formatExpiredOrderMessage({ ...orderData, orderId: orderId }, refundMessage); // Pass ID
            if (orderData.slackChannelId && orderData.slackMessageTs) { // Check coords
                await client.chat.update({
                    channel: orderData.slackChannelId,
                    ts: orderData.slackMessageTs,
                    blocks: [],
                    text: finalMessage
                });
                logger.info(`[Order Timer] Updated Slack message ${orderData.slackMessageTs} for expired order ${orderId}.`);
            } else {
                logger.warn(`[Order Timer] Could not update Slack message for expired order ${orderId}: Missing channel or ts.`);
            }

            // Fourth, if applicable, notify the recipient via DM
            if (orderData.requesterId && refundAmount > 0) { // Notify requester
                logger.info(`[Order Timer] Notifying requester ${orderData.requesterId} about expired order ${orderId}.`);
                
                let newBalance = '???'; // Default if fetch fails
                // Fetch updated player data to get the new balance
                // Only do this if the refund was potentially successful (even if updatePlayerKarma returned false)
                if (refundSuccess !== false) { // Attempt fetch if refund didn't error out
                    try {
                        const updatedPlayerData = await database.getPlayerBySlackId(orderData.requesterId);
                        if (updatedPlayerData) {
                            newBalance = updatedPlayerData.karma;
                        }
                    } catch (fetchError) {
                        logger.error(`[Order Timer - Expired] Failed to fetch updated player data for ${orderData.requesterId}:`, fetchError);
                    }
                }
                
                // Format DM according to the punk style
                const dmText = `✖ ORDER scrapped.\n${refundAmount} Karma refunded. balance: ${newBalance}`;

                await client.chat.postMessage({
                    channel: orderData.requesterId, // DM the Requester
                    text: dmText // Use the new formatted message
                });
            }

        } catch (error) {
            logger.error(`[Order Timer] Error during expiration chain for order ${orderId} (${orderData.slackMessageTs || 'No TS'}):`, error);
        }
    });
    return promises;
}

// --- Helper function to process expired runner offers ---
async function processExpiredRunnerOffers(snapshot, client, logger) {
    const updatePromises = [];
    const batch = admin.firestore().batch(); // Create a batch for Firestore updates

    snapshot.forEach(doc => {
        const offerId = doc.id;
        const offerData = doc.data();
        // Use requesterId as runnerId for offers, and requesterName as runnerName
        const { slackMessageTs, slackChannelId, requesterId, requesterName = 'Unknown Runner' } = offerData; 

        logger.info(`[Order Timer] Processing EXPIRED runner offer ID: ${offerId} by ${requesterName} (${requesterId})`);

        // Update Firestore
        const orderDocRef = admin.firestore().collection('orders').doc(offerId);
        batch.update(orderDocRef, {
            status: ORDER_STATUS.EXPIRED_OFFER,
            updatedAt: admin.firestore.Timestamp.now()
        });

        // Update Public Slack message
        if (slackMessageTs && slackChannelId) {
            const publicExpiredText = `⌛ Offer from ${requesterName} expired.`; // Use requesterName as runner's name
            const expiredMessage = {
                channel: slackChannelId,
                ts: slackMessageTs,
                blocks: [], // Empty blocks to clear previous content
                text: publicExpiredText
            };
            updatePromises.push(
                client.chat.update(expiredMessage)
                .then(() => logger.info(`[Order Timer] Updated Slack message for expired runner offer ${offerId}`))
                .catch(err => logger.error(`[Order Timer] Error updating Slack message for expired runner offer ${offerId}:`, err))
            );
        } else {
            logger.warn(`[Order Timer] Missing slackMessageTs or slackChannelId for expired runner offer ${offerId}. Cannot update public message.`);
        }

        // Send DM to the runner (who is the requesterId for an offer)
        if (requesterId) {
            const punkDmText = `⌛ OFFER expired.\ntime ran out.`;
            const dmMessage = {
                channel: requesterId, 
                text: punkDmText,
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: punkDmText
                        }
                    }
                ]
            };
            updatePromises.push(
                client.chat.postMessage(dmMessage)
                .then(() => logger.info(`[Order Timer] Sent DM to runner ${requesterId} for expired offer ${offerId}`))
                .catch(err => logger.error(`[Order Timer] Error sending DM to runner ${requesterId} for expired offer ${offerId}:`, err))
            );
        } else {
            logger.warn(`[Order Timer] Missing requesterId for expired runner offer ${offerId}. Cannot send DM.`);
        }
    });

    if (snapshot.size > 0) {
        updatePromises.push(
            batch.commit()
            .then(() => logger.info(`[Order Timer] Firestore batch commit successful for ${snapshot.size} expired runner offers.`))
            .catch(err => logger.error('[Order Timer] Firestore batch commit failed for expired runner offers:', err))
        );
    }
    return Promise.all(updatePromises);
}

// --- Helper function to process expired CLAIMED orders ---
async function processExpiredClaimedOrders(snapshot, client, logger) {
    const promises = [];
    snapshot.forEach(async (doc) => {
        const orderData = doc.data();
        const orderId = doc.id;
        const { requesterId, runnerId, karmaCost, slackChannelId, slackMessageTs, runnerName = 'Unknown Runner' } = orderData;

        logger.info(`[Order Timer] Expiring CLAIMED order ${orderId} (${slackMessageTs}) - Runner timeout.`);
        
        const updateData = {
            status: ORDER_STATUS.EXPIRED_CLAIMED,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        };

        // Handle karma refund to requester
        let refundAmount = 0;
        if (requesterId && karmaCost > 0) {
            refundAmount = karmaCost;
        }

        try {
            // 1. Update the order status
            await database.updateOrder(orderId, updateData);
            logger.info(`[Order Timer] Updated claimed order ${orderId} status to EXPIRED_CLAIMED.`);

            // 2. Attempt refund to requester
            let refundSuccess = true;
            let refundMessage = '';
            if (refundAmount > 0) {
                logger.info(`[Order Timer] Attempting refund of ${refundAmount} karma to requester ${requesterId} for expired claimed order ${orderId}.`);
                try {
                    refundSuccess = await database.updatePlayerKarma(requesterId, refundAmount);
                    refundMessage = refundSuccess
                        ? ` YOUR ${refundAmount} KARMA HAS BEEN REFUNDED.`
                        : ` THERE WAS AN ISSUE REFUNDING YOUR ${refundAmount} KARMA. PLEASE CONTACT AN ADMIN.`;
                    logger.info(`[Order Timer] Karma refund to requester ${refundSuccess ? 'successful' : 'failed'} for order ${orderId}.`);
                } catch (refundError) {
                    refundSuccess = false;
                    logger.error(`[Order Timer] Error refunding karma to requester for expired claimed order ${orderId}:`, refundError);
                    refundMessage = ` AN ERROR OCCURRED WHILE TRYING TO REFUND YOUR ${refundAmount} KARMA. PLEASE CONTACT AN ADMIN.`;
                }
            }

            // 3. Update the Slack message (Use helper function)
            const finalMessage = formatExpiredOrderMessage({ ...orderData, status: ORDER_STATUS.EXPIRED_CLAIMED, orderId: orderId }, refundMessage);
            if (slackChannelId && slackMessageTs) {
                await client.chat.update({
                    channel: slackChannelId,
                    ts: slackMessageTs,
                    blocks: [],
                    text: finalMessage.toUpperCase()
                });
                logger.info(`[Order Timer] Updated Slack message ${slackMessageTs} for expired claimed order ${orderId}.`);
            } else {
                logger.warn(`[Order Timer] Could not update Slack message for expired claimed order ${orderId}: Missing channel or ts.`);
            }

            // 4. Send DMs
            // Use punk style text and full names
            let requesterNameToUse = '???';
            let newBalance = '???';
            // Fetch requester data for name and updated balance
            if (requesterId) {
                 try {
                     const updatedPlayerData = await database.getPlayerBySlackId(requesterId);
                     if (updatedPlayerData) {
                         requesterNameToUse = updatedPlayerData.name || requesterId;
                         newBalance = updatedPlayerData.karma;
                     } else {
                         requesterNameToUse = requesterId; // Fallback if fetch fails
                     }
                 } catch (fetchError) {
                     logger.error(`[Order Timer - Expired Claimed] Failed to fetch updated player data for ${requesterId}:`, fetchError);
                     requesterNameToUse = requesterId; // Fallback
                 }
            }
            
            // Runner Name - Use from orderData or fallback
            const runnerNameToUseForDM = orderData.runnerName || runnerId;
            const refundAmountForDM = karmaCost || 0;

            // Format DMs
            const runnerDMText = `⚠ you missed the mark on an order.\nrep not earned. thread's broken.`;
            let requesterDMText = `⚠ runner ${runnerNameToUseForDM} timed out on your order.`;
            if (refundAmountForDM > 0) { // Add refund info if applicable
                 requesterDMText += `\nkarma refunded to ${requesterNameToUse} (${refundAmountForDM})`;
                 // Optionally add balance if desired, although not in example
            }
            
            // Send DMs
            if (requesterId) {
                promises.push(client.chat.postMessage({ channel: requesterId, text: requesterDMText }).catch(e => logger.error(`Failed DM to requester ${requesterId} for expired claimed order ${orderId}:`, e)));
            }
            if (runnerId) {
                promises.push(client.chat.postMessage({ channel: runnerId, text: runnerDMText }).catch(e => logger.error(`Failed DM to runner ${runnerId} for expired claimed order ${orderId}:`, e)));
            }

        } catch (error) {
            logger.error(`[Order Timer] Error during expiration chain for claimed order ${orderId} (${slackMessageTs || 'No TS'}):`, error);
        }
    });
    return promises;
}

console.log('*** index.js global scope finished processing (lazy init for Slack App configured) ***');