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
import { getConfig } from './utils/config.js';
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

// <<< ADD FIREBASE ADMIN INITIALIZATION >>>
if (admin.apps.length === 0) {
  admin.initializeApp();
  logger.info('Firebase Admin SDK initialized.');
} else {
  logger.debug('Firebase Admin SDK already initialized.');
}

// Force Firestore client initialization at load time
// await getFirestore(); // <<< REMOVE this as well, firebase.js handles db init
// console.log('[index.js] Firestore client initialization awaited.');

const token = getConfig('SLACK_BOT_TOKEN');
const signingSecret = getConfig('SLACK_SIGNING_SECRET');
const channelId = getConfig('KOFFEE_KARMA_CHANNEL_ID');
// ... (validation logic)
const expressReceiver = new ExpressReceiver({
  signingSecret: signingSecret,
  logLevel: LogLevel.DEBUG
});
const app = new App({
  token: token,
  receiver: expressReceiver,
  logLevel: LogLevel.DEBUG, 
  processBeforeResponse: true
});
app.use(async ({ next }) => {
  console.log('🚦 Bolt app.use middleware reached! Request proceeding...');
  await next();
});
app.error(async (error) => {
  // Log the entire error object structure
  console.error("🔥🔥🔥 Global Bolt Error Handler Caught Error 🔥🔥🔥:");
  console.error("Error Code:", error.code); // e.g., slack_bolt_error_code
  console.error("Original Error:", error.original?.message || error.original || 'N/A'); // Underlying error if available
  console.error("Full Error Stack:", error.stack);
  // Log context if available (may not be present for all errors)
  if (error.context) {
      console.error("Error Context:", JSON.stringify(error.context, null, 2));
  }
  // Log the entire error object just in case
  console.error("Complete Error Object:", JSON.stringify(error, null, 2));
});

const firebaseApp = express();

// Add body-parser middleware first to handle different content types
firebaseApp.use(bodyParser.json()); // For Slack challenge (application/json)
firebaseApp.use(bodyParser.urlencoded({ extended: true })); // For interactive components (application/x-www-form-urlencoded)

// <<< ADD Middleware for Slack URL Verification Challenge >>>
firebaseApp.use((req, res, next) => {
  if (req.body && req.body.type === 'url_verification' && req.body.challenge) {
    console.log('✅ Responding to Slack URL verification challenge.');
    res.status(200).send(req.body.challenge);
  } else {
    // Not a verification request, continue to next middleware
    console.log('⏩ Verification challenge check passed, continuing...');
    next();
  }
});

// Middleware to unpack stringified payload (if necessary, runs AFTER verification check)
firebaseApp.use((req, res, next) => {
  // Check if the content type is urlencoded and if payload exists as a string
  if (req.headers['content-type'] === 'application/x-www-form-urlencoded' && 
      req.body && 
      typeof req.body.payload === 'string') {
    try {
      console.log('⏩ Unpacking req.body.payload string...');
      req.body = JSON.parse(req.body.payload);
      console.log('✅ Successfully parsed payload string into req.body.');
    } catch (e) {
      console.error('❌ Failed to parse req.body.payload string:', e);
      // Don't halt execution, maybe Bolt can still handle it
    }
  } else {
      console.log('⏩ Payload unpacking middleware skipped (not urlencoded or payload not a string).');
  }
  next(); // Pass control to the next middleware (Bolt receiver)
});

// <<< ADD Handler for Warming Pings >>>
firebaseApp.get('/', async (req, res) => {
  console.log('Received GET / request, likely from warmer. Initiating 30-second delay...');
  
  // Introduce a 30-second delay
  await new Promise(resolve => setTimeout(resolve, 30000)); // 30,000 milliseconds = 30 seconds
  
  console.log('30-second delay complete. Sending 204 No Content for warmer.');
  res.status(204).send(); 
});

// Mount Bolt receiver AFTER the GET handler and unpacking middleware
firebaseApp.use('/', expressReceiver.requestHandler.bind(expressReceiver));

// --- RESTORE MAIN EXPORT using v2 onRequest with options ---
export const slack = onRequest(
    { 
        region: "us-west1", 
        memory: "256MiB",    // <<< Updated memory to 512MiB >>>
        minInstances: 1
    },
    firebaseApp // Pass the express app as the handler
); 

// --- COMMENT OUT MINIMAL HANDLER EXPORT ---
// export const slack = onRequest(
//     { region: "us-west1" }, 
//     (req, res) => { ... }
// );

// --- RESTORE HANDLER IMPORT/REGISTRATION --- 
console.log('*** Importing handlers... ***');
import { karmaHandler } from './handlers/karma-handler.js';
import { orderHandler } from './handlers/order-handler.js';
import { deliveryHandler, handleOpenOrderModalForRunner } from './handlers/delivery-handler.js';
import { leaderboardHandler } from './handlers/leaderboard-handler.js';
import { eventHandler } from './handlers/event-handler.js';
import { redeemHandler } from './handlers/redeem-handler.js';

karmaHandler(app); // Handles /karma
orderHandler(app); // Should handle /order, claim, cancel, deliver, order_modal view, location_select action
deliveryHandler(app); // Should handle /deliver, order_now, cancel_ready_offer, delivery_modal view
leaderboardHandler(app);
redeemHandler(app);
eventHandler(app);

// TODO: Implement handlers for /leaderboard, /redeem, and member_joined_channel event
// Placeholder text for when these are added:

// /leaderboard - Fetch players sorted by reputation, format and post
// Expected output format: 
/*
Top 5 Freaks:
1. [NAME] - [REPUTATION] Rep 🔊 ([TITLE])
2. [NAME] - [REPUTATION] Rep 🔊 ([TITLE])
...
*/

// /redeem <code> - Validate code, update DB, send ephemeral confirmation
// Success: `✅ Code [CODE] redeemed. +[X] Karma ⚡ added.`
// Error (Invalid): `⛔ Code [CODE] is garbage.`
// Error (Expired/Used): `⛔ Code [CODE] already burned.`

// event member_joined_channel - Post welcome, DM tutorial
// Public channel message: `🕵 [USER FULL NAME] dropped into the pit` // Use full name
// DM Text: `Welcome to Koffee Karma. Burn Karma ⚡ Deliver drinks ☕ Build Rep 🔊 Top names live on /leaderboard. No gods. No heroes. Just caffeine.`

console.log('*** Handlers imported and registered ***');

// --- REMOVE VIEW/ACTION REGISTRATIONS THAT SHOULD BE IN OTHER HANDLERS ---
// View Submissions / Interactions - These should be handled within orderHandler and deliveryHandler
// app.view('order_modal', viewHandler.handleOrderModalSubmission); 
// app.view('delivery_modal', viewHandler.handleDeliveryModalSubmission); 
// app.action('location_select', viewHandler.handleLocationSelect); 

// === Button Actions ===
// ... other button actions registered within specific handlers ...
app.action('open_order_modal_for_runner', handleOpenOrderModalForRunner); // Keep this if it's separate

// Slash Commands
app.command('/order', orderHandler.handleOrderSubmission);
app.command('/karma', karmaHandler.handleKarmaCommand);
app.command('/deliver', deliveryHandler.handleDeliverCommand);
app.command('/leaderboard', leaderboardHandler.handleLeaderboardCommand);
app.command('/redeem', redeemHandler.handleRedeemCommand);

// Button Actions
app.action('claim_order', orderHandler.handleClaimOrder);
app.action('deliver_order', orderHandler.handleDeliverOrder);
app.action('cancel_order', orderHandler.handleCancelOrder); 
app.action('cancel_claimed_order', orderHandler.handleCancelClaimedOrder);
app.action('order_now', deliveryHandler.handleOrderNowButton);
app.action('cancel_ready_offer', deliveryHandler.handleCancelReadyOffer);

// Events
app.event('member_joined_channel', eventHandler.handleMemberJoinedChannel); // Planned

console.log('*** index.js restored version finished executing global scope ***');

// ==========================================================================
// === Pub/Sub Triggered Function for Timer Updates/Expiration ===
// ==========================================================================

const ORDER_TIMER_TOPIC = 'check-order-timers'; // Define topic name

// Add region to orderTimerUpdater export
export const orderTimerUpdater = onMessagePublished(
    { topic: ORDER_TIMER_TOPIC, region: 'us-west1' }, 
    async (event) => {
        console.log(`[${ORDER_TIMER_TOPIC}] Received Pub/Sub message:`, event.id);
        
        const tempApp = new App({
            token: getConfig('SLACK_BOT_TOKEN'),
            signingSecret: getConfig('SLACK_SIGNING_SECRET'),
            logLevel: LogLevel.DEBUG 
        });
        const client = tempApp.client;
        const logger = tempApp.logger; 

        const now = new Date();
        const nowTimestamp = admin.firestore.Timestamp.fromDate(now);
        const ordersRef = admin.firestore().collection('orders'); // Base collection ref

        logger.info(`[${ORDER_TIMER_TOPIC}] Running timer check at ${now.toISOString()}`);

        try {
            // --- Process Active Orders (Unclaimed and Claimed) with correct timestamps ---
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
function processExpiredRunnerOffers(snapshot, client, logger) {
    const promises = [];
    snapshot.forEach(doc => {
        const offerId = doc.id;
        const offerData = doc.data();
        if (!offerData.slackChannelId || !offerData.slackMessageTs || !offerData.createdAt || !offerData.durationMs) {
            logger.warn(`[Runner Timer] Skipping formatting for expired offer ${offerId} due to potentially missing fields (checked slackChannelId, slackMessageTs, createdAt, durationMs). Will still attempt update.`);
            // Don't return here, still attempt the basic update below
        }
        logger.info(`[Runner Timer] Expiring runner offer ${offerId} (${offerData.slackMessageTs})`);
        promises.push(
            doc.ref.update({ status: ORDER_STATUS.EXPIRED_OFFER }) // <<< Use EXPIRED_OFFER constant
                .then(() => {
                    // <<< REMOVED call to formatRunnerMessage and block generation >>>
                    const runnerName = offerData.runnerName || 'Unknown Runner';
                    // Use punk style text, use full name
                    const expiredText = `⌛ Offer from ${runnerName} expired.`;
                    logger.info(`[Runner Timer] Updating Slack message ${offerData.slackMessageTs} for expired offer ${offerId}.`);
                    return client.chat.update({
                        channel: offerData.slackChannelId,
                        ts: offerData.slackMessageTs,
                        blocks: [], // <<< SEND EMPTY BLOCKS to remove old content
                        text: expiredText // <<< SEND SIMPLE TEXT
                    });
                })
                .catch(error => logger.error(`[Runner Timer] Error during expiration chain for offer ${offerId} (${offerData.slackMessageTs}):`, error))
        );
    });
    return promises;
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