/**
 * Delivery Handler
 * Handles the /deliver command and delivery availability interactions
 */
import { ORDER_STATUS, DRINK_CATEGORIES, DELIVERY_DURATIONS } from '../utils/constants.js';
import { database } from '../lib/firebase.js';
import { buildDeliveryModal, buildOrderModal } from '../utils/modal-builder.js';
import { formatRunnerMessage } from '../utils/message-formatter.js';
import { KOFFEE_KARMA_CHANNEL_ID, DEVELOPER_SLACK_ID } from '../utils/config.js';
import admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

/**
 * Handle /deliver command
 * Opens a loading modal immediately, then updates it with fetched capabilities.
 */
async function handleDeliverCommand({ ack, body, client, logger }) {
    await ack(); // Acknowledge command immediately

    // <<< ADD DM Channel Check >>>
    if (body.channel_name === 'directmessage') {
      logger.warn(`User ${body.user_id} tried to use /deliver in a DM. Instructing to use channel.`);
      await client.chat.postEphemeral({
        channel: body.channel_id, // This will be the DM channel
        user: body.user_id,
        text: "COMMANDS IN THE CHANNEL, NOT HERE. USE <#C08K73A45NX|koffee-karma-sf>."
      });
      return;
    }
    // <<< END DM Channel Check >>>

    const userId = body.user_id;
    const triggerId = body.trigger_id;
    logger.info(`Received /deliver command from user ${userId}`);

    let viewId = null; // Variable to store the view ID

    try {
        // --- 1. Open a temporary "Loading" modal --- 
        const loadingView = {
            type: 'modal',
            callback_id: 'delivery_modal_submit', // Use the final callback_id
            title: { type: 'plain_text', text: 'OFFER TO DELIVER' },
            blocks: [
                {
                    type: 'section',
                    text: { type: 'plain_text', text: 'prepping your gear...' }
                }
            ]
        };

        logger.debug('Opening loading modal...');
        const openResult = await client.views.open({
            trigger_id: triggerId,
            view: loadingView
        });

        if (!openResult.ok || !openResult.view?.id) {
            throw new Error(`Failed to open loading modal: ${openResult.error || 'No view ID returned'}`);
        }
        viewId = openResult.view.id;
        logger.info(`Opened loading modal with view ID: ${viewId}`);

        // --- 2. Fetch player capabilities (can take longer now) --- 
        logger.debug(`Fetching capabilities for user ${userId}...`);
        const { player } = await database.getOrCreatePlayer(userId, client);
        const currentCapabilities = player?.capabilities || []; // Default to empty array
        logger.debug(`Fetched capabilities: ${currentCapabilities.join(',') || 'None'}`);

        // --- 3. Build the final modal view with capabilities --- 
        const finalModalView = buildDeliveryModal(currentCapabilities);

        // --- 4. Update the modal with the final view --- 
        logger.info(`Updating modal ${viewId} with final content...`);
        await client.views.update({
            view_id: viewId,
            // No hash needed if just replacing blocks/elements of the same type
            view: finalModalView 
        });
        logger.info(`Successfully updated modal ${viewId} for user ${userId}`);

    } catch (error) {
        logger.error(`Error handling /deliver command for user ${userId}:`, error);
        // Try to send an ephemeral message, include viewId if available
        const errorMsg = `Bot tripped opening delivery modal. Error: ${error.message}` + (viewId ? ` (View ID: ${viewId})` : '');
        await client.chat.postEphemeral({
            channel: body.channel_id, // Use the channel command was invoked in
            user: userId,
            text: errorMsg
        }).catch(e => logger.error('Failed to send ephemeral error for /deliver:', e));
    }
}

/**
 * Handles the submission of the delivery modal.
 */
async function handleDeliverySubmission({ ack, body, view, client, logger }) {
    // Ack only once at the start
    await ack(); 
    // Force redeploy test 2 - Ensuring correct function call!
    const userId = body.user.id;
    logger.info(`Received delivery modal submission from user ${userId}`);

    let runnerName = userId; // Default to ID
    let messageTs = null; // To store placeholder TS

    try {
        const values = view['state']['values'];
        const capabilitiesBlock = values['capabilities_block'];
        const durationBlock = values['duration_block'];

        const selectedCapabilities = capabilitiesBlock['capabilities_select']?.selected_options?.map(opt => opt.value) || [];
        const selectedDurationMinutes = parseInt(durationBlock['duration_select']?.selected_option?.value, 10) || 10; // Default 10

        logger.debug(`Parsed submission: User=${userId}, Caps=${selectedCapabilities.join(',') || 'None'}, Duration=${selectedDurationMinutes}min`);

        if (selectedCapabilities.length === 0) {
             logger.warn(`User ${userId} submitted delivery offer with no capabilities selected.`);
             await client.chat.postEphemeral({
                channel: userId, // Send to user directly
                user: userId,
                text: "Pick at least one. Don't lie."
             });
            return; // Stop processing
        }
        
        // Fetch user info for name early for placeholder and final message
        const userInfo = await client.users.info({ user: userId });
        runnerName = userInfo.user?.real_name || userInfo.user?.profile?.display_name || userId; // Prioritize real_name

        // *** ENSURE CORRECT FUNCTION CALL IS USED ***
        // Save capabilities to Firestore (fire and forget, log errors)
        database.updatePlayerCapabilities(userId, selectedCapabilities) // Use the CORRECT function
            .then(() => logger.info(`Successfully saved capabilities for user ${userId}`))
            .catch(err => logger.error(`Failed to save capabilities for user ${userId}. Proceeding without guarantee.`, err));

        // --- Post Placeholder Message --- 
        logger.debug(`Posting placeholder message for runner offer...`);
        const placeholderResult = await client.chat.postMessage({
            channel: KOFFEE_KARMA_CHANNEL_ID.value(),
            text: `Processing ${runnerName}'s offer...`,
            blocks: [{
                type: 'section',
                text: { type: 'mrkdwn', text: `Processing ${runnerName}'s offer...` }
            }]
        });
        if (!placeholderResult.ok || !placeholderResult.ts) {
            throw new Error(`Failed to post placeholder runner message: ${placeholderResult.error}`);
        }
        messageTs = placeholderResult.ts; // Store the placeholder's TS
        logger.info(`Posted placeholder runner message with ts ${messageTs}`);
        
        // Prepare data for the *initial* message format
        const offerStartTimeMs = Date.now(); // Get current time as milliseconds
        const offerStartTimeTimestamp = Timestamp.fromMillis(offerStartTimeMs); // Convert to Firestore Timestamp
        const offerDurationMs = selectedDurationMinutes * 60 * 1000;

        const initialFormatData = {
            runnerId: userId,
            runnerName: runnerName, // Use full name
            capabilities: selectedCapabilities,
            status: ORDER_STATUS.OFFERED, // <<< Set correct initial status
            startTimestamp: offerStartTimeTimestamp, // <<< Pass Firestore Timestamp object
            durationMs: offerDurationMs, // <<< Pass duration in MS
            messageTs: messageTs // Pass the placeholder TS for button values
        };
        const finalRunnerMessageBlocks = formatRunnerMessage(initialFormatData, messageTs);

        // --- Update Placeholder with Final Message ---
        logger.info(`Updating placeholder message ${messageTs} with final runner content...`);
        const updateResult = await client.chat.update({
            channel: KOFFEE_KARMA_CHANNEL_ID.value(),
            ts: messageTs, // Use the placeholder's TS
            text: `${runnerName} is available to deliver drinks for ${selectedDurationMinutes} minutes!`, // Final fallback text
            blocks: finalRunnerMessageBlocks
        });

        if (!updateResult.ok) {
            // Log the error but maybe don't throw? The placeholder exists.
            logger.error(`Failed to update placeholder runner message ${messageTs}: ${updateResult.error}. Placeholder remains.`);
            // Consider how to handle this - maybe delete placeholder or leave as is?
            // For now, we'll proceed to log the offer data based on the placeholder ts.
        } else {
             logger.info(`Successfully updated message ${messageTs} with final runner content.`);
        }

        // <<< ADD: Fetch Channel Name >>>
        let slackChannelName = null;
        const channelIdToFetch = KOFFEE_KARMA_CHANNEL_ID.value();
        try {
            const channelInfo = await client.conversations.info({ channel: channelIdToFetch });
            if (channelInfo.ok) {
                slackChannelName = `#${channelInfo.channel.name}`; 
                logger.debug(`Fetched channel name: ${slackChannelName}`);
            } else {
                logger.warn(`Could not fetch channel info for ${channelIdToFetch}: ${channelInfo.error}`);
            }
        } catch (convError) {
            logger.error(`Error fetching channel info for ${channelIdToFetch}:`, convError);
        }
        // <<< END ADD >>>

        // Log the offer (status: 'offered') - Use the messageTs (placeholder ts)
        const expiryTimestamp = Timestamp.fromMillis(offerStartTimeMs + offerDurationMs);

        const runnerOfferData = {
            orderId: messageTs, // Use placeholder TS as unique ID for the offer
            createdAt: offerStartTimeTimestamp, // Use the timestamp from offer start
            updatedAt: FieldValue.serverTimestamp(), // Add updatedAt
            initiatedBy: 'runner',
            runnerId: userId,
            runnerName: runnerName, // Store full name
            status: ORDER_STATUS.OFFERED, // Ensure status is OFFERED here too
            capabilities: selectedCapabilities, // Store capabilities
            durationMs: offerDurationMs, // Store duration
            expiryTimestamp: expiryTimestamp, // Store calculated expiry
            slackMessageTs: messageTs, // Store the Slack message TS
            slackChannelId: channelIdToFetch, // Store the channel ID
            slackChannelName: slackChannelName // Store fetched channel name
        };

        // Use set with the messageTs as the document ID
        await admin.firestore().collection('orders').doc(messageTs).set(runnerOfferData);
        logger.info(`Runner offer ${messageTs} logged successfully to Firestore.`);

        // --- Send DM Confirmation to Runner ---
        try {
            // Format DM according to new style
            const dmText = `offer posted — you're on the clock (\`${selectedDurationMinutes}\` min)`;
            await client.chat.postMessage({
                channel: userId, // Send DM to the runner
                text: dmText
            });
            logger.info(`Sent offer confirmation DM to runner ${userId}.`);
        } catch (dmError) {
            logger.error(`Failed to send offer confirmation DM to runner ${userId}:`, dmError);
            // Non-fatal, just log it.
        }

    } catch (error) {
        logger.error(`Error handling delivery modal submission for user ${userId}:`, error);
        // Send ephemeral error message to the user
        // Ensure no references to undefined variables like capabilitiesBlockId
        await client.chat.postEphemeral({
            channel: userId, // Send to user directly
            user: userId,
            text: `Bot tripped processing your offer. Try again. Error: ${error.message}`
        }).catch(e => logger.error('Failed to send ephemeral error after delivery submission error:', e)); 
        // DO NOT call ack() here again
    }
}

/**
 * Handle cancellation of a runner's own availability offer
 */
async function handleCancelReadyOffer({ ack, body, client, logger }) {
    await ack();
    const userId = body.user.id;
    const actionValue = JSON.parse(body.actions[0].value);
    const messageTs = actionValue.messageTs;
    // const channelId = actionValue.channelId; // No longer in value from latest formatRunnerMessage

    logger.info(`User ${userId} initiated cancel_ready_offer for message ${messageTs}`);

    try {
        const orderDocRef = admin.firestore().collection('orders').doc(messageTs);
        const orderDoc = await orderDocRef.get();

        if (!orderDoc.exists) {
            logger.warn(`Runner offer ${messageTs} not found in Firestore for cancellation.`);
            await client.chat.postEphemeral({
                channel: userId, // DM user
                user: userId,
                text: "Offer not found. Maybe it already expired or was actioned?"
            });
            return;
        }

        const orderData = orderDoc.data();

        // Authorization: Only the original runner can cancel their own offer
        if (orderData.runnerId !== userId) {
            logger.warn(`User ${userId} attempted to cancel offer ${messageTs} owned by ${orderData.runnerId}. Denied.`);
            await client.chat.postEphemeral({
                channel: userId, // DM user
                user: userId,
                text: "Not your offer to cancel."
            });
            return;
        }

        if (orderData.status !== ORDER_STATUS.OFFERED) {
            logger.warn(`Runner offer ${messageTs} is not in 'OFFERED' status (current: ${orderData.status}). Cannot cancel.`);
             await client.chat.postEphemeral({
                channel: userId, // DM user
                user: userId,
                text: `This offer is no longer active (status: ${orderData.status}). It may have been claimed or expired.`
            });
            return;
        }

        // Update Firestore: Mark as CANCELLED_RUNNER
        await orderDocRef.update({
            status: ORDER_STATUS.CANCELLED_RUNNER, // Use a specific status for runner cancelled offers
            updatedAt: FieldValue.serverTimestamp()
        });
        logger.info(`Runner offer ${messageTs} status updated to CANCELLED_RUNNER in Firestore.`);

        // Update Slack message to reflect cancellation
        const runnerName = orderData.runnerName || 'Unknown Runner';
        // Use punk style text
        const cancelledText = `~~ Offer from ${runnerName} cancelled ~~`;
        await client.chat.update({
            channel: orderData.slackChannelId || KOFFEE_KARMA_CHANNEL_ID.value(), // UPDATED with fallback
            ts: messageTs,
            blocks: [], // Clear blocks
            text: cancelledText
        });
        logger.info(`Slack message for runner offer ${messageTs} updated to reflect cancellation.`);

        // Send DM confirmation to the runner
        // Use punk style text
        const dmText = "Offer cancelled. You're off the hook.";
        await client.chat.postMessage({
            channel: userId,
            text: dmText
        });
        logger.info(`Sent cancellation confirmation DM to runner ${userId}.`);

    } catch (error) {
        logger.error(`Error handling cancel_ready_offer for message ${messageTs} by user ${userId}:`, error);
        await client.chat.postEphemeral({
            channel: userId, // DM User
            user: userId,
            text: `Bot tripped cancelling offer. Try again. Error: ${error.message}`
        });
    }
}

/**
 * Handle the 'order_now' button press from a runner's availability message.
 * This function will open the standard order modal, but pre-fill it with the runner's information.
 */
export async function handleOpenOrderModalForRunner({ ack, body, client, action, logger }) {
    await ack();
    const requesterId = body.user.id; // The user who clicked "ORDER NOW"
    logger.info(`User ${requesterId} clicked 'order_now' button. Action value:`, action.value);

    let runnerOfferData;
    let parsedValue;

    try {
        parsedValue = JSON.parse(action.value);
        const { runnerId, messageTs } = parsedValue; // runnerId is the ID of the person offering to run

        // --- Authorization: Runner cannot order from themselves --- 
        if (requesterId === runnerId) {
            // Developer override: Check if the requester is the developer
            const developerSlackId = DEVELOPER_SLACK_ID.value(); // UPDATED
            if (requesterId === developerSlackId) {
                logger.warn(`Developer ${developerSlackId} is overriding self-order restriction for testing.`);
            } else {
                logger.warn(`Runner ${runnerId} attempted to order from their own offer. Denied.`);
                await client.chat.postEphemeral({
                    channel: requesterId,
                    user: requesterId,
                    text: "Can't order from yourself, mate."
                });
                return;
            }
        }
        // --- End Authorization ---

        // Fetch the original runner offer to ensure it's still valid
        const offerDocRef = admin.firestore().collection('orders').doc(messageTs);
        const offerDoc = await offerDocRef.get();

        if (!offerDoc.exists) {
            logger.warn(`Original runner offer ${messageTs} not found. Cannot open order modal.`);
            await client.chat.postEphemeral({
                channel: requesterId,
                user: requesterId,
                text: "That delivery offer is no longer available (not found)."
            });
            return;
        }
        runnerOfferData = offerDoc.data();

        if (runnerOfferData.status !== ORDER_STATUS.OFFERED) {
            logger.warn(`Original runner offer ${messageTs} is not in 'OFFERED' status (current: ${runnerOfferData.status}). Cannot open order modal.`);
            let statusMessage = `This delivery offer is no longer available (status: ${runnerOfferData.status}).`;
            if(runnerOfferData.status === ORDER_STATUS.CLAIMED && runnerOfferData.requesterId === requesterId){
                 statusMessage = "You've already placed an order against this offer.";
            } else if (runnerOfferData.status === ORDER_STATUS.CLAIMED){
                 statusMessage = `This delivery offer has already been claimed by <@${runnerOfferData.requesterId}>.`;
            }
            await client.chat.postEphemeral({
                channel: requesterId,
                user: requesterId,
                text: statusMessage
            });
            return;
        }

        // Extract necessary runner info from the *offer document*
        const prefillData = {
            runnerId: runnerOfferData.runnerId, // The actual runner
            runnerName: runnerOfferData.runnerName, // The actual runner's name
            runnerCapabilities: runnerOfferData.capabilities, // Runner's stated capabilities for this offer
            originalOfferMessageTs: messageTs // Store the TS of the offer message for linking
        };

        const modalView = buildOrderModal(null, null, prefillData); // Pass prefillData

        await client.views.open({
            trigger_id: body.trigger_id,
            view: modalView
        });
        logger.info(`Opened order modal for ${requesterId} against runner offer ${messageTs} by ${prefillData.runnerName}.`);

    } catch (error) {
        logger.error(`Error in handleOpenOrderModalForRunner for user ${requesterId}:`, error);
        if (error instanceof SyntaxError && action && action.value) {
             logger.error(`Potential JSON parsing error in handleOpenOrderModalForRunner. Action value: ${action.value}`);
        }
        if (parsedValue && !parsedValue.runnerId) {
            logger.error(`Missing runnerId in parsed action value in handleOpenOrderModalForRunner. Parsed value:`, parsedValue);
        }
        if (runnerOfferData && !runnerOfferData.runnerId) {
            logger.error(`Missing runnerId in runnerOfferData in handleOpenOrderModalForRunner. Offer Data:`, runnerOfferData);
        }

        await client.chat.postEphemeral({
            channel: requesterId,
            user: requesterId,
            text: `Bot tripped opening the order form for that runner. Try again. Error: ${error.message}`
        });
    }
}

/**
 * Handle runner cancelling a claimed order
 * Action ID: cancel_claimed_order
 * (Note: This function might belong in order-handler.js if it refunds karma)
 */
async function handleCancelClaimedOrderRunner(payload) {
  // TODO: Implement logic similar to handleCancelClaimedOrder in order-handler,
  // but ensure it doesn't refund karma if that's handled elsewhere.
  // It should update the order status and the Slack message.
  const { ack, body, client, logger } = payload;
  await ack();
  const orderId = body.actions[0]?.value; // Get Firestore DB ID from button value
  const clickerId = body.user.id;
  const channelId = body.container?.channel_id;
  const messageTs = body.container?.message_ts;

  logger.info(`[handleCancelClaimedOrderRunner] Received for order ${orderId} from ${clickerId}`);

  if (!orderId || !channelId || !messageTs) {
      logger.error('[handleCancelClaimedOrderRunner] Missing IDs.');
      await client.chat.postEphemeral({ channel: channelId || clickerId, user: clickerId, text: 'Bot spazzed. Cannot cancel.' });
      return;
  }

  // ... (Fetch order, validate status is CLAIMED, validate clicker is RUNNER) ...

  // Update order status (e.g., to CANCELLED_RUNNER)
  // Update Slack message
  // Send DMs (confirming cancellation to runner, notifying requester)
  logger.warn('[handleCancelClaimedOrderRunner] NOT FULLY IMPLEMENTED YET!');
}

// Register handlers
export const deliveryHandler = (app) => {
    app.command('/deliver', handleDeliverCommand);
    app.view('delivery_modal_submit', handleDeliverySubmission);
    app.action('cancel_ready_offer', handleCancelReadyOffer);
    app.action('open_order_modal_for_runner', handleOpenOrderModalForRunner);
    // Add other delivery-related action handlers if needed
}; 