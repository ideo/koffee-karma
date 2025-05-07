import { db, admin } from '../lib/firebase.js';
import { app } from '../lib/slack.js';
import { formatOrderMessage } from '../lib/messages/order-message.js';
import { formatRunnerMessage } from '../utils/message-formatter.js';
import { updatePlayerKarmaBalance } from '../lib/utils.js';
import { Timestamp } from 'firebase-admin/firestore';

// Define status constants (ensure these match handler definitions)
const STATUS_ORDERED = 'ordered';
const STATUS_CLAIMED = 'claimed';
const STATUS_OFFERED = 'OFFERED'; // Assuming runner offer status
const STATUS_CANCELLED_RUNNER = 'CANCELLED_RUNNER';
const STATUS_EXPIRED = 'expired';
const STATUS_EXPIRED_CLAIMED = 'EXPIRED_CLAIMED';
const STATUS_EXPIRED_OFFER = 'EXPIRED_OFFER'; // Status for expired runner offers

/**
 * Scheduled function to update timers and process expirations for orders and offers.
 */
async function orderTimerUpdater(context) {
    app.logger.info('Running orderTimerUpdater scheduled function');
    const now = Timestamp.now();

    const ordersRef = db.collection('orders');

    try {
        // --- Process Active Timers (Update Messages) ---
        // Fetch active unclaimed orders, claimed orders, and runner offers
        const activeQuery = ordersRef.where('status', 'in', [STATUS_ORDERED, STATUS_CLAIMED, STATUS_OFFERED])
                                      .get();

        const activeSnapshot = await activeQuery;
        const updatePromises = [];

        activeSnapshot.forEach(doc => {
            const item = doc.data();
            const itemId = doc.id;
            let messagePayload = null;
            let relevantTimestamp = null;
            let isExpired = false;

            try {
                if (item.status === STATUS_ORDERED) {
                    relevantTimestamp = item.expiryTimestamp;
                    if (relevantTimestamp && relevantTimestamp <= now) {
                        isExpired = true;
                    } else {
                        // Update unclaimed order message
                        messagePayload = formatOrderMessage(item);
                    }
                } else if (item.status === STATUS_CLAIMED) {
                    relevantTimestamp = item.claimedExpiryTimestamp;
                    if (relevantTimestamp && relevantTimestamp <= now) {
                        isExpired = true;
                    } else {
                        // Update claimed order message
                        messagePayload = formatOrderMessage(item);
                    }
                } else if (item.status === STATUS_OFFERED) {
                    relevantTimestamp = item.expiryTimestamp;
                    if (relevantTimestamp && relevantTimestamp <= now) {
                        isExpired = true;
                    } else {
                        // Update runner offer message using the imported formatter
                        messagePayload = formatRunnerMessage(item, itemId);
                    }
                }

                // Only update if not expired and payload generated
                if (!isExpired && messagePayload && item.slackChannelId && item.slackMessageTs) {
                    app.logger.debug(`[orderTimerUpdater] Updating msg ${item.slackMessageTs} for item ${itemId} (${item.status})`);
                    try {
                        // Log the first few blocks if they exist
                        if (messagePayload.blocks && messagePayload.blocks.length > 0) {
                            app.logger.debug(`[orderTimerUpdater] Block 0: ${JSON.stringify(messagePayload.blocks[0])}`);
                        }
                        if (messagePayload.blocks && messagePayload.blocks.length > 1) {
                            app.logger.debug(`[orderTimerUpdater] Block 1: ${JSON.stringify(messagePayload.blocks[1])}`);
                        }
                        if (messagePayload.blocks && messagePayload.blocks.length > 2) {
                            app.logger.debug(`[orderTimerUpdater] Block 2: ${JSON.stringify(messagePayload.blocks[2])}`);
                        }
                    } catch (logError) {
                        app.logger.error('[orderTimerUpdater] Error logging block structure:', logError);
                    }
                    // <<< END LOGGING >>>

                    updatePromises.push(
                        app.client.chat.update({
                            channel: item.slackChannelId,
                            ts: item.slackMessageTs,
                            blocks: messagePayload.blocks,
                            text: messagePayload.text,
                        }).catch(err => app.logger.error(`Error updating message ${item.slackMessageTs} for item ${itemId}: ${err.message}`))
                    );
                }
            } catch (formatError) {
                app.logger.error(`Error formatting message for item ${itemId} (${item.status}): ${formatError}`);
            }
        });

        // --- Process Expirations (Keep processing expired offers) ---
        // ... (Expiration queries remain the same) ...
         // 1. Expire UNCLAIMED Orders
        const expiredUnclaimedQuery = ordersRef.where('status', '==', STATUS_ORDERED)
                                               .where('expiryTimestamp', '<=', now)
                                               .get();

        // 2. Expire CLAIMED Orders (Runner Timeout)
        const expiredClaimedQuery = ordersRef.where('status', '==', STATUS_CLAIMED)
                                             .where('claimedExpiryTimestamp', '<=', now)
                                             .get();

        // 3. Expire Runner OFFERS (Still handle expiration)
        const expiredOfferQuery = ordersRef.where('status', '==', STATUS_OFFERED)
                                           .where('expiryTimestamp', '<=', now)
                                           .get();

        const [expiredUnclaimedSnapshot, expiredClaimedSnapshot, expiredOfferSnapshot] = await Promise.all([
            expiredUnclaimedQuery,
            expiredClaimedQuery,
            expiredOfferQuery,
        ]);

        // Process expired unclaimed orders
        expiredUnclaimedSnapshot.forEach(doc => {
            const order = doc.data();
            const orderId = doc.id;
            app.logger.info(`Processing expiration for unclaimed order ${orderId}`);
            updatePromises.push(expireOrder(orderId, order, STATUS_EXPIRED, `Order \`${orderId}\` expired. Nobody claimed the order in time. Karma refunded to @${order.requesterName}.`));
        });

        // Process expired claimed orders (runner timeout)
        expiredClaimedSnapshot.forEach(doc => {
            const order = doc.data();
            const orderId = doc.id;
            app.logger.info(`Processing expiration for claimed order ${orderId} (runner timeout)`);
            updatePromises.push(expireOrder(orderId, order, STATUS_EXPIRED_CLAIMED, `Order \`${orderId}\` expired. Runner @${order.runnerName} didn't deliver in time. Karma refunded to @${order.requesterName}.`));
        });

        // Process expired runner offers (Keep this logic)
        expiredOfferSnapshot.forEach(doc => {
            const offer = doc.data();
            const offerId = doc.id;
            app.logger.info(`Processing expiration for runner offer ${offerId}`);
            updatePromises.push(expireRunnerOffer(offerId, offer)); // Separate helper for offers
        });

        await Promise.all(updatePromises);
        app.logger.info('orderTimerUpdater finished.');

    } catch (error) {
        app.logger.error(`Error in orderTimerUpdater: ${error}`);
    }
}

// Helper function to handle order expiration (both unclaimed and claimed)
async function expireOrder(orderId, orderData, newStatus, expiredMessageText) {
    app.logger.info(`Refunding ${orderData.karmaCost} karma to ${orderData.requesterId} for expired order ${orderId}`);
    const orderRef = db.collection('orders').doc(orderId);

    try {
        // 1. Refund Karma
        if (orderData.karmaCost > 0) {
            await updatePlayerKarmaBalance(orderData.requesterId, orderData.karmaCost, `Refund for expired order ${orderId}`);
        } else {
            app.logger.warn(`Skipping karma refund for expired order ${orderId} as karmaCost is ${orderData.karmaCost}`);
        }

        // 2. Update Firestore Status
        await orderRef.update({ status: newStatus });
        app.logger.info(`Order ${orderId} status updated to ${newStatus}`);

        // 3. Update Slack Message
        const expiredPayload = {
            replace_original: true,
            blocks: [{
                type: 'section',
                text: { type: 'mrkdwn', text: expiredMessageText },
            }],
            text: `Order ${orderId} expired.`
        };

        if (orderData.slackChannelId && orderData.slackMessageTs) {
            await app.client.chat.update({
                channel: orderData.slackChannelId,
                ts: orderData.slackMessageTs,
                blocks: expiredPayload.blocks,
                text: expiredPayload.text,
            });
            app.logger.info(`Slack message ${orderData.slackMessageTs} updated for expired order ${orderId}.`);
        } else {
             app.logger.warn(`Missing channel or ts for expired order ${orderId}, cannot update message.`);
        }

        // 4. Send DM to Requester
         try {
            await app.client.chat.postMessage({
                channel: orderData.requesterId,
                text: `${expiredMessageText} Your ${orderData.karmaCost} Karma points have been refunded.`, // Combine refund confirmation
            });
        } catch (dmError) {
            app.logger.error(`Failed to send expiration DM to requester ${orderData.requesterId} for order ${orderId}: ${dmError}`);
        }
        // Optionally DM runner if it was a claimed expiration?
        if (newStatus === STATUS_EXPIRED_CLAIMED && orderData.runnerId) {
             try {
                await app.client.chat.postMessage({
                    channel: orderData.runnerId,
                    text: `The delivery timer for order \`${orderId}\` expired. The order from @${orderData.requesterName} has been cancelled and their Karma refunded.`, 
                });
            } catch (dmError) {
                 app.logger.error(`Failed to send expiration DM to runner ${orderData.runnerId} for order ${orderId}: ${dmError}`);
            }
        }

    } catch (error) {
        app.logger.error(`Error expiring order ${orderId} (status ${orderData.status}): ${error}`);
        // Don't rethrow, allow other expirations to proceed
    }
}

// Helper function to handle runner offer expiration
async function expireRunnerOffer(offerId, offerData) {
    app.logger.info(`Runner offer ${offerId} status updated to ${STATUS_EXPIRED_OFFER}`);
    const offerRef = db.collection('orders').doc(offerId);
     try {
         // 1. Update Firestore Status
        await offerRef.update({ status: STATUS_EXPIRED_OFFER }); // Use a specific expired status for offers
        app.logger.info(`Runner offer ${offerId} status updated to ${STATUS_EXPIRED_OFFER}`);

        // 2. Update Slack Message
         const expiredMessage = `Runner @${offerData.runnerName}'s offer to deliver has expired.`;
         const expiredPayload = {
            replace_original: true,
            blocks: [{
                type: 'section',
                text: { type: 'mrkdwn', text: expiredMessage },
            }],
            text: expiredMessage
        };
         if (offerData.slackChannelId && offerData.slackMessageTs) {
            await app.client.chat.update({
                channel: offerData.slackChannelId,
                ts: offerData.slackMessageTs,
                blocks: expiredPayload.blocks,
                text: expiredPayload.text,
            });
            app.logger.info(`Slack message ${offerData.slackMessageTs} updated for expired offer ${offerId}.`);
        } else {
             app.logger.warn(`Missing channel or ts for expired offer ${offerId}, cannot update message.`);
        }

        // 3. Optionally DM the runner?
         try {
            await app.client.chat.postMessage({
                channel: offerData.runnerId,
                text: `Your offer to deliver \`${offerId}\` has expired and is no longer visible.`, 
            });
        } catch (dmError) {
            app.logger.error(`Failed to send expiration DM to runner ${offerData.runnerId} for offer ${offerId}: ${dmError}`);
        }

     } catch (error) {
        app.logger.error(`Error expiring runner offer ${offerId}: ${error}`);
     }
}

export { orderTimerUpdater }; 