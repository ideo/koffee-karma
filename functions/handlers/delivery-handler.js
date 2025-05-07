/**
 * Delivery Handler
 * Handles the /deliver command and delivery availability interactions
 */
import { ORDER_STATUS, DRINK_CATEGORIES, DELIVERY_DURATIONS } from '../utils/constants.js';
import { database } from '../lib/firebase.js';
import { buildDeliveryModal, buildOrderModal } from '../utils/modal-builder.js';
import { formatRunnerMessage } from '../utils/message-formatter.js';
import { getConfig } from '../utils/config.js';
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
            channel: getConfig('KOFFEE_KARMA_CHANNEL_ID'),
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
            channel: getConfig('KOFFEE_KARMA_CHANNEL_ID'),
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
        const channelIdToFetch = getConfig('KOFFEE_KARMA_CHANNEL_ID');
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
     
     const rawActionValue = body.actions?.[0]?.value;
     logger.debug(`[handleCancelReadyOffer] Received raw action value: ${rawActionValue}`);
     
     let messageTs = null;
     try {
       const parsedValue = JSON.parse(rawActionValue);
       messageTs = parsedValue.messageTs; // Extract messageTs from parsed JSON
     } catch (e) { 
       logger.error(`[handleCancelReadyOffer] Failed to parse action value JSON: ${rawActionValue}`, e);
       await client.chat.postEphemeral({
           channel: userId,
           user: userId,
           text: "Bot tripped. Couldn't ID the offer to cancel."
       });
       return;
     }
     
     const channelId = body.container?.channel_id;
     
     logger.info(`User ${userId} attempting to cancel offer ${messageTs}`);

     if (!messageTs) {
        // This check should technically be redundant now if parsing succeeds, but keep as safety net
        logger.error(`Cannot cancel offer: messageTs is missing after parsing JSON.`);
        await client.chat.postEphemeral({
            channel: userId, 
            user: userId,
            text: "Bot tripped. Couldn't ID the offer to cancel."
        });
        return;
     }
     // Default to configured channel if container channel not available
     const targetChannelId = channelId || getConfig('KOFFEE_KARMA_CHANNEL_ID');

     try {
        // 1. Fetch the offer data from Firestore using messageTs as orderId
        const offerDocRef = admin.firestore().collection('orders').doc(messageTs);
        const offerDoc = await offerDocRef.get();

        if (!offerDoc.exists) {
            logger.warn(`Cannot cancel offer ${messageTs}: Offer not found in Firestore.`);
             await client.chat.postEphemeral({
                channel: userId,
                user: userId,
                text: "Can't find that offer. Maybe it expired or got claimed/scrapped."
            });
            return;
        }

        const offerData = offerDoc.data();

        // 2. Validate user is the original runner
        if (offerData.runnerId !== userId) {
            logger.warn(`User ${userId} attempted to cancel offer ${messageTs} belonging to ${offerData.runnerId}.`);
            await client.chat.postEphemeral({
                channel: body.container.channel_id, // Send ephemeral to the channel of interaction
                user: userId,
                text: "Not your offer to cancel."
            });
            return;
        }

        // 3. Validate status is 'offered'
        if (offerData.status !== ORDER_STATUS.OFFERED) {
             logger.warn(`Offer ${messageTs} is already in status ${offerData.status}, cannot cancel.`);
             await client.chat.postEphemeral({
                channel: userId,
                user: userId,
                text: "Too late. Offer isn't active anymore (status: ${offerData.status})."
            });
             // Attempt to update the message anyway to reflect the final state, in case it got stuck
             // const finalBlocks = formatRunnerMessage({ ...offerData, status: offerData.status }, offerData.messageTs);
             await client.chat.update({
                channel: targetChannelId,
                ts: messageTs,
                blocks: [], // <<< REMOVE existing blocks
                text: `Offer cancelled by ${offerData.runnerName}.` // Use full name
             }).catch(e => logger.error(`Error updating Slack message for already processed offer ${messageTs}:`, e));
            return;
        }

        // 4. Update Firestore status to CANCELLED
        await offerDocRef.update({ status: ORDER_STATUS.CANCELLED });
        logger.info(`Offer ${messageTs} status updated to CANCELLED in Firestore.`);

        // 5. Update Slack Message to simple cancelled text
        const runnerName = offerData.runnerName || userId;
        await client.chat.update({
            channel: targetChannelId,
            ts: messageTs,
            blocks: [], // <<< REMOVE existing blocks
            text: `Offer cancelled by ${runnerName}.` // Use full name
        });
        logger.info(`Updated Slack message ${messageTs} to cancelled state.`);

        // <<< CHANGE to send DM instead of ephemeral >>>
        try {
            // Format DM according to new style
            const dmText = "offer cancelled";
            await client.chat.postMessage({
                channel: userId, // Send DM to the user who cancelled
                user: userId,
                text: dmText
            });
            logger.info(`Sent offer cancellation DM to user ${userId}.`);
        } catch (dmError) {
             logger.error(`Failed to send offer cancellation DM to user ${userId}:`, dmError);
        }
        
        // 7. TODO: Cancel any scheduled timers (if separate timer mechanism used). 
        // The main timer updater should stop processing it once status is cancelled.

     } catch (error) {
        logger.error(`Error cancelling offer ${messageTs} for user ${userId}:`, error);
         await client.chat.postEphemeral({
            channel: userId, 
            user: userId,
            text: "System choked cancelling offer. Try again. Error: ${error.message}"
        });
     }
}

/**
 * Handle the 'Order Now' button click from a runner availability message.
 * Opens a loading modal, fetches data, then updates the modal.
 */
export async function handleOpenOrderModalForRunner({ ack, body, client, logger }) {
    // --- ACKNOWLEDGE IMMEDIATELY --- 
    await ack(); 
    
    const action = body.actions[0];
    const userId = body.user.id; // User clicking 'ORDER NOW'
    const triggerId = body.trigger_id; // <<< USE THIS to open modal

    // Extract runner info from the button's value
    let runnerInfo = {};
    try {
        runnerInfo = JSON.parse(action.value); 
    } catch (e) {
        logger.error('[handleOpenOrderModalForRunner] Failed to parse runner info from action value:', action.value, e);
        await client.chat.postEphemeral({
            channel: body.channel.id,
            user: userId,
            text: 'Bot tripped. Couldn\'t read runner info.'
        });
        return;
    }

    const { runnerId, runnerName, messageTs, channelId, capabilities } = runnerInfo;
    logger.info(`[handleOpenOrderModalForRunner] User ${userId} clicked ORDER NOW for runner ${runnerId} (${runnerName}) from offer ${messageTs}`);

    // Prevent runner from ordering from themselves, unless developer
    const developerSlackId = getConfig('DEVELOPER_SLACK_ID'); // Get developer ID
    if (userId === runnerId && userId !== developerSlackId) { // Add developer check
        logger.warn(`Runner ${userId} tried to order from their own offer. DENIED (not developer).`); // Updated log
        await client.chat.postEphemeral({
            channel: channelId, 
            user: userId,
            text: 'Can\'t order from yourself, chief.'
        });
        return;
    } else if (userId === runnerId && userId === developerSlackId) {
        logger.info(`Developer ${userId} attempting to order from own offer. ALLOWED.`); // Log override
    }

    try {
        // Build the order modal, passing runner info in private_metadata
        const metadata = {
            targetRunnerId: runnerId,
            runnerName: runnerName, // <<< Pass runner name
            originalRunnerMessageTs: messageTs,
            channelId: channelId
        };
        // Pass runner capabilities to filter category dropdown
        const modalView = buildOrderModal({}, null, capabilities, channelId, 'Unknown', metadata);

        logger.debug(`[handleOpenOrderModalForRunner] Opening modal for user ${userId} with trigger_id: ${triggerId}`);
        const result = await client.views.open({
            trigger_id: triggerId, // Use the trigger_id from the payload
            view: modalView
        });
        logger.info(`[handleOpenOrderModalForRunner] Modal opened successfully: ${result.ok}`);

    } catch (error) {
        logger.error(`[handleOpenOrderModalForRunner] Error opening modal for runner ${runnerId}:`, error);
        let errorText = 'Bot tripped opening order modal.';
        if (error.data?.error === 'exchanged_trigger_id' || error.message.includes('trigger_id')) {
             errorText = 'Took too long to respond. Try clicking ORDER NOW again.';
        } else if (error.data?.error) {
            errorText += ` Error: ${error.data.error}`;
        } else {
            errorText += ` Error: ${error.message}`;
        }
        
        await client.chat.postEphemeral({
            channel: channelId, // Use channel from parsed metadata
            user: userId,
            text: errorText
        }).catch(ephemError => logger.error('[handleOpenOrderModalForRunner] Failed to send ephemeral error:', ephemError));
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