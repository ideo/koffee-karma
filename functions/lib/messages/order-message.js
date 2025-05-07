import { formatTimeRemaining } from '../utils.js';
import { generateMap } from '../../utils/message-formatter.js';
import { Timestamp } from 'firebase-admin/firestore';
import { ORDER_STATUS } from '../../utils/constants.js';

const ORDER_PROGRESS_BAR_LENGTH = 10;
const LEFT_COL_WIDTH = 50; // Correct: 50 chars
const RIGHT_COL_WIDTH = 28; // <<< ADJUSTED WIDTH TO 28 >>>
const TOTAL_WIDTH = LEFT_COL_WIDTH + 2 + RIGHT_COL_WIDTH; // Include 2 spaces between columns

// ADAPTED formatDetailsBlockLines (returns array of lines)
function formatDetailsBlockLines(order) {
    let lines = [];
    const contentWidth = LEFT_COL_WIDTH - 4; // Width inside pipes (now 46)
    const isGift = order.requesterId !== order.recipientId;
    const recipientText = isGift ? `${order.recipientName.toUpperCase()} (GIFT)` : `${order.requesterName.toUpperCase()} (SELF)`;
    const notes = (order.notes || 'NONE').toUpperCase();

    // Reverting label style
    const formatLine = (label, value) => {
        const paddedLabel = label.toUpperCase().padEnd(14, ' ');
        const truncatedValue = String(value).length > (contentWidth - 15) ? String(value).substring(0, contentWidth - 16) + '…' : String(value);
        return `| ${paddedLabel}${truncatedValue.toUpperCase().padEnd(contentWidth - paddedLabel.length, ' ')} |`;
    };

    lines.push(`| ${'DROP ID:'.padEnd(14, ' ')}${(order.slackMessageTs || order.orderId || 'Pending...').toUpperCase().padEnd(contentWidth-14, ' ')} |`); // Reverting pending state
    lines.push(formatLine('FROM:', order.requesterName));
    lines.push(formatLine('TO:', recipientText));
    lines.push(formatLine('CATEGORY:', order.category));
    lines.push(formatLine('DRINK:', order.drink));
    lines.push(formatLine('LOCATION:', order.locationDisplayName || order.location));
    lines.push(formatLine('NOTES:', notes));
    lines.push(formatLine('BASE REWARD:', `${order.karmaCost} KARMA`)); // Reverting label and removing emoji
    return lines;
}

// ADAPTED formatStatusBlockLines (returns array of lines)
function formatStatusBlockLines(order) {
    let statusLine1 = '';
    let statusLine2 = '';
    let statusLine3 = `| ${'-'.repeat(LEFT_COL_WIDTH - 4)} |`; 
    let statusLine4 = '';
    const contentWidth = LEFT_COL_WIDTH - 4; // 46 chars

    switch (order.status) {
        case 'ordered':
        case 'OFFERED_CLAIMED':
            const claimTimestamp = order.expiryTimestamp instanceof Timestamp ? order.expiryTimestamp : Timestamp.fromMillis(Date.now() + (order.durationMs || 600000));
            const createdAtMillis = order.createdAt instanceof Timestamp ? order.createdAt.toMillis() : Date.now(); 
            const claimTimeRemaining = formatTimeRemaining(order.createdAt, (claimTimestamp.toMillis() - createdAtMillis), 'CLAIM', ORDER_PROGRESS_BAR_LENGTH);
            // Ensure 50 chars total width - Revised formatting
            const statusLabel = 'STATUS:       '; // 16 chars
            const statusValue = 'UNCLAIMED';     // 9 chars
            statusLine1 = `| ${statusLabel.toUpperCase()}${statusValue.toUpperCase().padEnd(contentWidth - statusLabel.length, ' ')} |`; // Pad value to fill remaining space (46 - 16 = 30)
            statusLine2 = `| ${claimTimeRemaining.padEnd(contentWidth, ' ')} |`;
            const claimText = '↓ CLICK BUTTON TO CLAIM THIS ORDER ↓'.toUpperCase(); // Reverted text
            const claimPad = Math.floor((contentWidth - claimText.length) / 2);
            statusLine4 = `| ${' '.repeat(claimPad)}${claimText}${' '.repeat(contentWidth - claimPad - claimText.length)} |`;
            break;
        case 'claimed':
            const claimedExpiryTimestampMs = order.claimedExpiryTimestamp?.toMillis();
            const timeClaimedMs = order.timeClaimed?.toMillis();
            const nowMs = Date.now();

            const timeClaimedTimestamp = order.timeClaimed instanceof Timestamp ? order.timeClaimed : null;

            if (!claimedExpiryTimestampMs || !timeClaimedMs || !timeClaimedTimestamp) {
                console.warn("[formatStatusBlockLines] Missing claimedExpiryTimestamp, timeClaimedMs, or invalid timeClaimed Timestamp for 'claimed' order:", order.id);
                statusLine1 = `| STATUS:       CLAIMED                          |`; 
                statusLine2 = `| RUNNER:       ${(order.runnerName || 'UNKNOWN').toUpperCase().padEnd(contentWidth - 16, ' ')} |`;
                statusLine3 = `| Error calculating timer...                     |`;
                statusLine4 = `| -                                              |`; 
                break; 
            }

            let totalDurationMs = claimedExpiryTimestampMs - timeClaimedMs;
            const elapsedMs = nowMs - timeClaimedMs;
            const remainingMs = Math.max(0, claimedExpiryTimestampMs - nowMs);

            if (totalDurationMs <= 0) {
                 console.warn("[formatStatusBlockLines] Calculated totalDurationMs <= 0 for 'claimed' order:", order.id, {claimedExpiryTimestampMs, timeClaimedMs});
                 totalDurationMs = 10 * 60 * 1000; // Fallback to 10 mins
            }

            const progress = Math.max(0, Math.min(1, 1 - (elapsedMs / totalDurationMs))); 

            // Format time remaining text using the UTILITY function
            const timeText = formatTimeRemaining(timeClaimedTimestamp, totalDurationMs, 'deliver', ORDER_PROGRESS_BAR_LENGTH); 

            // REVERTED FORMATTING FOR 'CLAIMED'
            const runnerNameUpper = (order.runnerName || 'UNKNOWN').toUpperCase(); // Reverted fallback
            const statusText = `STATUS:       CLAIMED BY ${runnerNameUpper}`; // Reverted text
            statusLine1 = `| ${statusText.padEnd(contentWidth, ' ')} |`; // Pad correctly

            // Line 2: Progress bar and time remaining text
            statusLine2 = `| ${timeText.padEnd(contentWidth, ' ')} |`; // Already contains bar

            // Line 3: Separator
            statusLine3 = `| ${'-'.repeat(contentWidth)} |`; // Use contentWidth for dashes

            // Line 4: Centered instruction text
            const deliverText = '↓ MARK AS DELIVERED ONCE ORDER IS DROPPED ↓'.toUpperCase(); // Reverted text
            const deliverPad = Math.floor((contentWidth - deliverText.length) / 2);
            statusLine4 = `| ${' '.repeat(deliverPad)}${deliverText}${' '.repeat(contentWidth - deliverPad - deliverText.length)} |`;
            break;
        case 'delivered':
            // Reverting delivered status lines
            const delRunnerNameShort = (order.runnerName || 'UNKNOWN').toUpperCase().padEnd(15, ' ').substring(0, 15); 
            const fixedTextDelivered = 'STATUS:       DELIVERED BY '; // Reverted text, removed emoji
            const paddingDelivered = Math.max(0, contentWidth - fixedTextDelivered.length - delRunnerNameShort.length);
            statusLine1 = `| ${fixedTextDelivered}${delRunnerNameShort}${' '.repeat(paddingDelivered)} |`;
            
            // Line 2: Separator
            statusLine2 = `| ${'-'.repeat(contentWidth)} |`; 
            
            // --- Line 3: Requester Info (Reverted style) ---
            const requesterNameShort = (order.requesterName || 'UNKNOWN').split(' ')[0].toUpperCase();
            const karmaCostVal = order.karmaCost || 0;
            const requesterRepGain = karmaCostVal; // Reputation gain = base cost
            const requesterText = `${requesterNameShort} SPENT ${karmaCostVal} KARMA (+${requesterRepGain} REPUTATION)`;
            const requesterPad = Math.max(0, Math.floor((contentWidth - requesterText.length) / 2));
            statusLine3 = `| ${' '.repeat(requesterPad)}${requesterText}${' '.repeat(Math.max(0, contentWidth - requesterPad - requesterText.length))} |`;

            // --- Line 4: Runner Info (Reverted style) ---
            const runnerNameShort = (order.runnerName || 'UNKNOWN').split(' ')[0].toUpperCase();
            const earnedKarmaVal = order.earnedKarma || order.karmaCost || 0; 
            const runnerRepGain = earnedKarmaVal; // Reputation gain = earned karma
            const runnerText = `${runnerNameShort} EARNED ${earnedKarmaVal} KARMA (+${runnerRepGain} REPUTATION)`;
            const runnerPad = Math.max(0, Math.floor((contentWidth - runnerText.length) / 2));
            statusLine4 = `| ${' '.repeat(runnerPad)}${runnerText}${' '.repeat(Math.max(0, contentWidth - runnerPad - runnerText.length))} |`;
            break;
        default:
            statusLine1 = `| STATUS:       UNKNOWN${' '.repeat(contentWidth-19)} |`;
            statusLine2 = `| ${' '.repeat(contentWidth)} |`;
            const defaultText = 'CONTACT ADMIN FOR ASSISTANCE'.toUpperCase();
            const defaultPad = Math.max(0, Math.floor((contentWidth - defaultText.length) / 2));
            statusLine4 = `| ${' '.repeat(defaultPad)}${defaultText}${' '.repeat(Math.max(0, contentWidth-defaultPad-defaultText.length))} |`;
    }
    // Return only the 4 lines
    return [statusLine1, statusLine2, statusLine3, statusLine4];
}

// ADAPTED formatTitleBlockLines (returns array of lines)
function formatTitleBlockLines(orderStatus) {
    let titleText = '';
     switch (orderStatus) {
        case 'ordered':
        case 'OFFERED_CLAIMED': 
            titleText = 'DRINK ORDER – UNCLAIMED'; break;
        case 'claimed': titleText = 'DRINK ORDER – CLAIMED'; break;
        case 'delivered': titleText = 'DRINK ORDER – DELIVERED'; break;
        // Reverting titles - removing specific cancelled/expired cases
        default: titleText = 'DRINK ORDER – COMPLETED'; // Reverted default
    }
    const contentWidth = LEFT_COL_WIDTH - 4; // 46 chars
    const upperTitleText = titleText.toUpperCase();
    const titlePad = Math.floor((contentWidth - upperTitleText.length) / 2);
    const paddedTitle = `${ ' '.repeat(titlePad)}${upperTitleText}${' '.repeat(contentWidth - titlePad - upperTitleText.length)}`;
    return [
        `+${'-'.repeat(LEFT_COL_WIDTH - 2)}+`,
        `| ${paddedTitle} |`,
        `+${'-'.repeat(LEFT_COL_WIDTH - 2)}+`
    ];
}

// --- Define Right Column Content ---
// CORRECTED for RIGHT_COL_WIDTH = 28
const mapTitleLines = [
    `+${'-'.repeat(RIGHT_COL_WIDTH - 2)}+`, // 26 dashes
    `| ${'LION MAP'.padStart(Math.floor((RIGHT_COL_WIDTH - 4 - 8) / 2) + 8).padEnd(RIGHT_COL_WIDTH - 4)} |`, // Reverted title, Content width 24
    `+${'-'.repeat(RIGHT_COL_WIDTH - 2)}+`
];

// CORRECTED for RIGHT_COL_WIDTH = 28
const messageLegendLines = [
    // No extra top border
    `| ${'✗ = DRINK LOCATION'.toUpperCase().padEnd(RIGHT_COL_WIDTH - 4)} |`, // Reverted legend
    `| ${'☕ = CAFÉ'.toUpperCase().padEnd(RIGHT_COL_WIDTH - 4)} |`, // Reverted legend
    `| ${'▯ = ELEVATOR'.toUpperCase().padEnd(RIGHT_COL_WIDTH - 4)} |`, // Reverted legend
    `| ${'≋ = BATHROOM'.toUpperCase().padEnd(RIGHT_COL_WIDTH - 4)} |`, // Reverted legend
    `+${'-'.repeat(RIGHT_COL_WIDTH - 2)}+` // Bottom border (26 dashes)
];

const commandLines = [
     `| ${'/ORDER        PLACE AN ORDER'.toUpperCase().padEnd(LEFT_COL_WIDTH - 4)} |`, // Reverted command descriptions
     `| ${'/DELIVER      DELIVER ORDERS'.toUpperCase().padEnd(LEFT_COL_WIDTH - 4)} |`,
     `| ${'/KARMA        CHECK YOUR KARMA'.toUpperCase().padEnd(LEFT_COL_WIDTH - 4)} |`,
     `| ${'/LEADERBOARD  TOP KARMA EARNERS'.toUpperCase().padEnd(LEFT_COL_WIDTH - 4)} |`,
     // Removed redeem command line
     // Bottom border added later in assembly
];

// --- Helper function to generate buttons (ensure it's defined or imported) ---
// Assuming generateButtons exists as defined previously
function generateButtons(order) {
    const buttons = [];
    order = order || {}; // Add default empty object
    order.orderId = order.orderId || 'UNKNOWN_ID'; // Add default order ID
    switch (order.status) {
        case 'ordered':
        case 'OFFERED_CLAIMED': // Allow claiming runner offers
            buttons.push(
                { type: 'button', text: { type: 'plain_text', text: 'CLAIM', emoji: false }, style: 'primary', action_id: 'claim_order', value: order.orderId }, // Use reference text, no emoji
                { type: 'button', text: { type: 'plain_text', text: 'CANCEL ORDER', emoji: false }, style: 'danger', action_id: 'cancel_order', value: order.orderId } // Use reference text, no emoji
            );
            break;
        case 'claimed':
            buttons.push(
                { type: 'button', text: { type: 'plain_text', text: 'MARK DELIVERED', emoji: false }, style: 'primary', action_id: 'deliver_order', value: order.orderId }, // Use reference text, no emoji
                { type: 'button', text: { type: 'plain_text', text: 'CANCEL DELIVERY', emoji: false }, style: 'danger', action_id: 'cancel_claimed_order', value: order.orderId } // Use reference text, no emoji
            );
            break;
            // No buttons for terminal states
    }
    if (buttons.length > 0) {
        return { type: 'actions', elements: buttons };
    }
    return null;
}

// --- Main Formatting Function ---
function formatOrderMessage(order) {
    // Handle cancelled/expired first (return simple block)
    // <<< ADD CANCELLED_RUNNER to this check >>>
    if (['cancelled', 'expired', ORDER_STATUS.CANCELLED_RUNNER, ORDER_STATUS.EXPIRED_CLAIMED].includes(order?.status)) { // Optional chaining
        // Determine the actor based on the status
        let actorName = 'UNKNOWN';
        let actionText = 'CANCELLED';
        let reasonText = '';

        if (order.status === ORDER_STATUS.CANCELLED) { // Original requester cancel
            actorName = (order.requesterName || 'REQUESTER').toUpperCase();
        } else if (order.status === ORDER_STATUS.CANCELLED_RUNNER) {
            actorName = (order.runnerName || 'RUNNER').toUpperCase();
        } else if (order.status === ORDER_STATUS.EXPIRED) {
            actionText = 'EXPIRED';
            reasonText = 'NOBODY CLAIMED THE ORDER IN TIME.';
            actorName = (order.requesterName || 'REQUESTER').toUpperCase(); // For refund message
        } else if (order.status === ORDER_STATUS.EXPIRED_CLAIMED) {
            actionText = 'EXPIRED';
            reasonText = `RUNNER @${(order.runnerName || 'UNKNOWN').toUpperCase()} DIDN'T DELIVER IN TIME.`;
            actorName = (order.requesterName || 'REQUESTER').toUpperCase(); // For refund message
        }
        
        // Reverting construction of message text
        let text = '';
        if (actionText === 'CANCELLED') {
            text = `ORDER \`${order.orderId || '[MISSING ID]'}\` WAS CANCELLED BY @${actorName}.`;
        } else { // EXPIRED
            text = `ORDER \`${order.orderId || '[MISSING ID]'}\` EXPIRED. ${reasonText} KARMA REFUNDED TO @${actorName}.`;
        }
        text = text.toUpperCase(); // Ensure consistent case

        // Return simple block with reverted text construction
        return {
            replace_original: true,
            blocks: [{ type: 'section', text: { type: 'mrkdwn', text: text } }],
            text: `ORDER ${order.orderId || '[MISSING ID]'} ${order.status.toUpperCase()}.`
        };
    }

    // --- Generate all content parts as arrays of strings ---
    // Add basic validation/defaults for order object
    order = order || {};
    order.status = order.status || 'ordered'; // Default status if missing
    order.category = order.category || 'UNKNOWN';
    order.location = order.location || 'UNKNOWN';
    order.karmaCost = order.karmaCost || 0;
    order.createdAt = order.createdAt || Timestamp.now(); // Fallback for createdAt
    // Ensure requesterName and recipientId exist for gift check
    order.requesterName = order.requesterName || 'Unknown';
    order.recipientId = order.recipientId || order.requesterId;
    order.recipientName = order.recipientName || order.requesterName;


    const titleL = formatTitleBlockLines(order.status);
    const detailsL = formatDetailsBlockLines(order);
    const statusL = formatStatusBlockLines(order); // Gets 4 lines, NO bottom border
    const commandsL = commandLines;

    let mapContent = '';
    try {
        mapContent = generateMap(order.location, { includeLegend: false }) || '';
        if (!mapContent) throw new Error('generateMap returned empty string');
    } catch (mapError) {
        console.error(`Error generating map for location '${order.location}':`, mapError);
        const errorMapLines = [
             `+${'-'.repeat(RIGHT_COL_WIDTH - 2)}+`,
             `| ${'MAP GEN ERROR'.toUpperCase().padStart(Math.floor((RIGHT_COL_WIDTH - 4 - 13)/2)+13).padEnd(RIGHT_COL_WIDTH - 4)} |`,
             `+${'-'.repeat(RIGHT_COL_WIDTH - 2)}+`
        ];
        mapContent = errorMapLines.join('\n');
    }
    const mapL = mapContent.split('\n');
    const legendL = messageLegendLines;

    // --- Combine Left and Right Columns Line by Line ---
    const combinedLines = [];
    const leftBorder = `+${'-'.repeat(LEFT_COL_WIDTH - 2)}+`; // Reusable border (48 dashes)
    // statusL is now just 4 lines. Add border AFTER statusL
    const leftLines = [...titleL, ...detailsL, leftBorder, ...statusL, leftBorder, ...commandsL, leftBorder];

    // rightLines correctly excludes mapTitleL
    const rightLines = [...mapL, ...legendL];

    const totalLines = Math.max(leftLines.length, rightLines.length);

    for (let i = 0; i < totalLines; i++) {
        const leftLine = leftLines[i] || '';
        const rightLine = rightLines[i] || '';
        // Pad lines AFTER retrieving them to ensure correct width
        const paddedLeft = leftLine.padEnd(LEFT_COL_WIDTH, ' ');
        const paddedRight = rightLine.padEnd(RIGHT_COL_WIDTH, ' ');
        combinedLines.push(`${paddedLeft}  ${paddedRight}`);
    }

    // --- Final Assembly ---
    const finalContentString = combinedLines.join('\n');
    const mainBlock = {
        type: 'section',
        text: {
            type: 'mrkdwn',
            text: `\`\`\`\n${finalContentString}\n\`\`\``
        }
    };

    const buttonBlock = generateButtons(order);
    const blocks = [mainBlock];
    if (buttonBlock) {
        blocks.push(buttonBlock);
    }

    // Return the complete Slack message payload
    return {
        replace_original: true,
        blocks: blocks,
        text: `ORDER FROM ${order.requesterName.toUpperCase()}: ${order.drink.toUpperCase()}` // Fallback text
    };
}

// Ensure the export is present (it should be if using ESM consistently)
export { formatOrderMessage }; 