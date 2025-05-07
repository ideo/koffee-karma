/**
 * Utility functions for formatting Slack Block Kit messages
 */
import { ORDER_STATUS, LOCATIONS, DRINK_CATEGORIES } from './constants.js';
import { getConfig } from './config.js'; // Import shared config getter
import path from 'path'; // Needed for map generation file path
import fs from 'fs';     // Needed for map generation file read
import { fileURLToPath } from 'url'; // Needed for __dirname in ESM
import { Timestamp } from 'firebase-admin/firestore'; // <<< ADD Timestamp import HERE
import { formatTimeRemaining as formatTimeRemainingUtil } from '../lib/utils.js'; // <<< IMPORT the correct function

// Equivalent to __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Format a timer countdown text and progress bar
 * @param {FirebaseFirestore.Timestamp | null} startTime - Timestamp when the timer started (e.g., createdAt, timeClaimed)
 * @param {number} durationMs - Total duration in milliseconds
 * @param {'claim' | 'deliver'} timerType - Type of timer ('claim' for order, 'deliver' for claimed)
 * @param {number} barLength - The desired length of the progress bar
 * @returns {string} - Combined timer text and progress bar string
 */
export function formatTimeRemaining(startTime, durationMs, timerType, barLength = 10) { 
    if (!(startTime instanceof Timestamp)) { 
        console.error('[formatTimeRemaining] Invalid startTime provided, not a Firestore Timestamp:', startTime);
        return `[${ '!'.repeat(barLength) }] TIMER ERROR`.padEnd(barLength + 17);
    }
    if (typeof durationMs !== 'number' || durationMs <= 0) {
        console.error('[formatTimeRemaining] Invalid durationMs provided:', durationMs);
        return `[${ '!'.repeat(barLength) }] TIMER ERROR`.padEnd(barLength + 17);
    }
    
    const nowMs = Date.now();
    const startMs = startTime.toMillis();
    const elapsedMs = nowMs - startMs;
    const remainingMs = Math.max(0, durationMs - elapsedMs);
    
    // Calculate progress (0 to 1), where 1 means time is up
    const progress = Math.min(1, Math.max(0, elapsedMs / durationMs)); 
    
    // Calculate filled/empty chars for the bar (█ = filled, ░ = empty)
    // Bar empties over time, so filled represents remaining time
    const filledChars = Math.max(0, Math.round((1 - progress) * barLength));
    const emptyChars = Math.max(0, barLength - filledChars);
    const progressBar = '█'.repeat(filledChars) + '░'.repeat(emptyChars);

    // Calculate remaining minutes, rounding UP
    const remainingMinutes = Math.ceil(remainingMs / 60000); 
    
    let timeText = '';
    if (remainingMs <= 0) {
        timeText = timerType === 'claim' ? ' CLAIM EXPIRED' : ' DELIVERY EXPIRED'; 
    } else {
        timeText = ` ${remainingMinutes} MIN${remainingMinutes !== 1 ? 'S' : ''} TO ${timerType.toUpperCase()} ORDER`;
    }

    // Combine bar and text, ensuring correct padding/length
    const combined = `[${progressBar}]${timeText}`;
    // Pad the combined string to a consistent length if needed (e.g., barLength + 2 + text length estimate)
    // Example padding: padEnd(barLength + 2 + 25) - adjust 25 based on max expected text length
    return combined; // Return the combined string
}

/**
 * Create the header text with emoji based on order status
 * @param {string} status - The order status
 * @returns {string} - Formatted header text
 */
function createStatusHeader(status) {
  switch (status) {
    case ORDER_STATUS.ORDERED:
      return '📬 *New Order Received!* Claim it to earn Karma.';
    case ORDER_STATUS.OFFERED:
      return '🏃‍♂️ *Runner Available!* Place an order directly.';
    case ORDER_STATUS.CLAIMED:
      return '🏃 *Order Claimed!* Delivery in progress...';
    case ORDER_STATUS.DELIVERED:
      return '✅ *Order Delivered!* Enjoy!';
    case ORDER_STATUS.EXPIRED:
      return '⌛ *Order Expired* This order is no longer available.';
    case ORDER_STATUS.CANCELLED:
      return '❌ *Order Cancelled*';
    case ORDER_STATUS.FAILED:
      return '🔥 *Order Failed* Something went wrong.';
    default:
      return '❓ *Unknown Status*';
  }
}

/**
 * Format the order message blocks.
 * @param {Object} orderDetails - The order data, potentially including runnerTotalKarma.
 * @param {string} orderId - The order ID (usually messageTs).
 * @returns {Array} - Array of Slack Block Kit blocks.
 */
export function formatOrderMessage(orderDetails, orderId) {
  console.log('[formatOrderMessage] Received orderDetails:', JSON.stringify(orderDetails, null, 2));
  console.log(`[formatOrderMessage] Received orderId: ${orderId}`);
  
  const { 
    requesterName = 'Unknown', 
    runnerName = 'N/A',
    recipientName = 'Unknown',
    drink = 'Unknown Drink',
    notes,
    karmaCost = 0,
    status = ORDER_STATUS.FAILED,
    bonusMultiplier = 1,
    startTimestamp, // Provided for timer calculation
    durationMs,     // Provided for timer calculation
    location,       // <<< Use the location key (e.g., '4d')
    runnerTotalKarma 
  } = orderDetails;

  const displayOrderId = orderId || 'PENDING...'; 
  // <<< Look up display name using the location key >>>
  const locationName = LOCATIONS[location]?.name || location || 'Unknown Location'; // Use key if name missing

  // --- Calculate Timer/Status --- 
  let statusText = status ? status.toUpperCase() : 'PENDING'; 
  let progressBar = '[                   ]'; 
  let isOrderActive = (status === ORDER_STATUS.ORDERED);

  console.log(`[formatOrderMessage] Check: isOrderActive=${isOrderActive}, status=${status}, startTimestamp=${startTimestamp}, durationMs=${durationMs}`);

  let statusLabel = 'STATUS:';
  let statusValue = status ? status.toUpperCase() : 'PENDING'; // Default status text
  let secondStatusLine = progressBar; // Default to progress bar
  let instructionLine = '↓ CLICK BELOW TO CLAIM THIS ORDER ↓'; // Default instruction
  let handledLinesInCase = false; // Flag for special formatting
  let deliveredByLine = ''; // Specific line for delivered status
  let karmaLine = '';       // Specific line for karma earned/total

  if (isOrderActive && startTimestamp && durationMs) {
    console.log(`[formatOrderMessage] Condition TRUE. Calling formatTimeRemainingUtil.`);
    const timerType = (status === ORDER_STATUS.ORDERED) ? 'claim' : 'deliver'; // Default to 'claim' for active orders
    const barLengthForOrder = 20; // Matches '[-------------------]' static bar length
    const timerString = formatTimeRemainingUtil(startTimestamp, durationMs, timerType, barLengthForOrder);

    // Parse the result string (e.g., "[████░░░░░░] 5 MINS TO CLAIM ORDER")
    const barMatch = timerString.match(/\[(.*?)\]/);
    const textMatch = timerString.match(/\](.*)/);
    const progressBarText = barMatch ? barMatch[1] : '!'.repeat(barLengthForOrder); // Fallback
    const timeText = textMatch ? textMatch[1].trim() : 'TIMER ERROR'; // Fallback

    // Check if expired based on text content (simplest way)
    const isExpired = timeText.includes('EXPIRED');

    // Update statusValue and secondStatusLine using parsed parts
    statusValue = isExpired ? 'EXPIRED' : timeText.replace(` TO ${timerType.toUpperCase()} ORDER`, ' LEFT TO CLAIM'); // Adapt text
    secondStatusLine = isExpired ? '[        EXPIRED        ]' : `[${progressBarText}]`; // Use parsed bar

    if (isExpired) {
      isOrderActive = false; // Update flag if timer expired during formatting
      status = ORDER_STATUS.EXPIRED; // Treat as expired for subsequent logic - this ensures correct buttons/header
      // Status text already set above, adjust instruction
      secondStatusLine = 'THIS ORDER WAS NOT CLAIMED';
      instructionLine = 'ORDER EXPIRED';
    }
  } else {
     // Handle final states explicitly
     progressBar = '[-------------------]'; // Use a static bar graphic for these
     secondStatusLine = progressBar; // Default second line to static bar unless overridden
     switch(status) {
        case ORDER_STATUS.CLAIMED:
            statusValue = `CLAIMED BY ${runnerName}`;
            secondStatusLine = 'WAITING TO BE DELIVERED';
            instructionLine = '↓ CLICK BELOW ONCE ORDER IS DELIVERED ↓';
            break;
        case ORDER_STATUS.DELIVERED:
            // --- Set specific lines for DELIVERED state --- 
            statusValue = 'COMPLETED';
            deliveredByLine = `DELIVERED BY ${runnerName}`;
            let earnedText = `+${(karmaCost || 0) * (bonusMultiplier || 1)} KARMA EARNED`;
            if (bonusMultiplier > 1) {
                earnedText += ` (${bonusMultiplier}x BONUS!)`;
            }
            if (runnerTotalKarma !== null && runnerTotalKarma !== undefined) {
                earnedText += ` — TOTAL: ${runnerTotalKarma}`;
            }
            karmaLine = earnedText; // Store the final karma text
            handledLinesInCase = true; // Mark that lines will be added manually later
            // No need to set secondStatusLine or instructionLine here anymore
            break;
        // --- Add cases for CANCELLED and EXPIRED to set their text --- 
        case ORDER_STATUS.CANCELLED:
            statusValue = 'CANCELLED';
            secondStatusLine = 'BY REQUESTER';
            instructionLine = 'KARMA REFUNDED (IF APPLICABLE)';
            break;
        case ORDER_STATUS.EXPIRED:
             statusValue = 'EXPIRED';
             secondStatusLine = 'NOT CLAIMED IN TIME';
             instructionLine = 'KARMA REFUNDED (IF APPLICABLE)';
             break;
        default:
            // Use the initial status text or handle other cases for any unexpected status
            statusValue = status ? status.toUpperCase() : 'PENDING';
            secondStatusLine = '[ UNKNOWN STATUS ]';
            instructionLine = 'STATUS UNKNOWN';
            break;
     }
  }

  // --- Generate Left Column (Order Details) ---
  const leftColWidth = 50; 
  const leftColLines = [];
  
  // Helper to add lines to the left column
  const addLeftColLine = (label, value) => {
    // Use formatAsciiLineWrap to handle wrapping correctly
    leftColLines.push(...formatAsciiLineWrap(label, value || '-', leftColWidth));
  };
  // Helper for full-width centered lines (like borders/instructions)
  const addFullWidthLineCentered = (content) => {
      const contentStr = String(content || '').toUpperCase(); // Ensure uppercase
      const contentWidth = leftColWidth - 4; // Width inside pipes
      const paddingNeeded = Math.max(0, contentWidth - contentStr.length);
      const leftPad = Math.floor(paddingNeeded / 2);
      const rightPad = Math.ceil(paddingNeeded / 2);
      // Pad content and add pipes, ensuring total width is correct
      leftColLines.push((`| ${' '.repeat(leftPad)}${contentStr}${' '.repeat(rightPad)} |`).substring(0, leftColWidth));
  }

  // Add Top Border and Header
  leftColLines.push('+------------------------------------------------+'); 
  addFullWidthLineCentered('☠ DRINK ORDER ☠');
  leftColLines.push('+------------------------------------------------+');

  // Add Order Details
  addLeftColLine('DROP ID:', displayOrderId);
  addLeftColLine('FROM:', requesterName);
  addLeftColLine('TO:', recipientName + (orderDetails.requesterId !== orderDetails.recipientId ? ' (GIFT)' : ' (SELF)'));
  addLeftColLine('DRINK:', drink);
  addLeftColLine('LOCATION:', locationName);
  addLeftColLine('NOTES:', notes || 'NONE');

  // Add Separator
  leftColLines.push('+------------------------------------------------+'); 

  // Add Reward Line
  addLeftColLine('REWARD:', `${karmaCost} KARMA`);

  // --- Add Status/Timer/Instruction Lines --- 
  if (handledLinesInCase) { // Specifically for DELIVERED
    addLeftColLine(statusLabel, statusValue);      // STATUS: COMPLETED
    addLeftColLine('', deliveredByLine);          //         DELIVERED BY RUNNER
    addFullWidthLineCentered('-'.repeat(leftColWidth - 4)); // HR
    addFullWidthLineCentered(karmaLine);                 // Centered karma line
    addFullWidthLineCentered('-'.repeat(leftColWidth - 4)); // HR
  } else { // For all other statuses (ORDERED, CLAIMED, CANCELLED, EXPIRED, etc.)
    addLeftColLine(statusLabel, statusValue);      // Status line (e.g., STATUS: CLAIMED BY...)
    addLeftColLine('', secondStatusLine);         // Second line (e.g., progress bar or WAITING...)
    addFullWidthLineCentered('-'.repeat(leftColWidth - 4)); 
    addFullWidthLineCentered(instructionLine);         // Instruction line (e.g., CLICK BELOW...)
    addFullWidthLineCentered('-'.repeat(leftColWidth - 4));
  }
  // --- End Status/Timer/Instruction Lines --- 

  // --- Generate Right Column (Map) --- 
  const mapText = generateMap(location, { includeLegend: false });

  // --- Define Legend Lines (content only, uppercase) --- 
  const legendWidth = 28; 
  const legendContentWidth = legendWidth - 4; 
  const legendContentLines = [
      "✗ = DRINK LOCATION",       
      "☕ = CAFÉ",                
      "▯ = ELEVATOR",            
      "≋ = BATHROOM"
  ].map(line => line.toUpperCase()); 
  
  // Define legend WITH borders (used later)
  const legendBorder = "+--------------------------+"; 
  const legendLinesWithBorder = legendContentLines.map(l => `| ${l.padEnd(legendContentWidth)} |`).concat([legendBorder]);

  // --- Define Command List (content only, uppercase) --- 
  const commandContentWidth = leftColWidth - 4; 
  const commandContentLines = [
      "/ORDER        PLACE AN ORDER",
      "/DELIVER      DELIVER ORDERS",
      "/KARMA        CHECK YOUR KARMA",
      "/LEADERBOARD  TOP KARMA EARNERS"
  ].map(line => line.toUpperCase()); 

  // Define commands WITH borders (used later)
  const commandBorder = '+------------------------------------------------+'; 
  const commandLinesWithBorder = [commandBorder].concat(commandContentLines.map(l => `| ${l.padEnd(commandContentWidth)} |`)).concat([commandBorder]);

  // --- Merge ALL sections line by line --- 
  const finalLines = [];
  const leftBlockHeight = leftColLines.length; // Height of details box ONLY
  const mapHeight = mapText.split('\n').length;
  const commandHeight = commandLinesWithBorder.length; // Use height WITH borders
  const legendHeight = legendLinesWithBorder.length; // Use height WITH borders
  const totalHeight = Math.max(leftBlockHeight + commandHeight, mapHeight + legendHeight);

  for (let i = 0; i < totalHeight; i++) {
    let leftPart = ' '.repeat(leftColWidth); // Default empty space
    // Add Order Details section
    if (i < leftBlockHeight) {
      leftPart = leftColLines[i];
    } 
    // Add Command List section AFTER order details
    else if (i >= leftBlockHeight && i < leftBlockHeight + commandHeight) {
      leftPart = commandLinesWithBorder[i - leftBlockHeight];
    }
    
    let rightPart = ' '.repeat(legendWidth); // Default empty space
    // Add Map section
    if (i < mapHeight) {
      rightPart = mapText.split('\n')[i];
    } 
    // Add Legend section AFTER map
    else if (i >= mapHeight && i < mapHeight + legendHeight) {
      rightPart = legendLinesWithBorder[i - mapHeight];
    }

    finalLines.push(leftPart + '  ' + rightPart);
  }

  // --- Wrap and Create Blocks --- 
  const asciiMessage = "```" + `\n${finalLines.join('\n')}\n` + "```"; 
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${createStatusHeader(status)}*`,
      },
    },
    {
      type: 'divider',
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: asciiMessage,
      },
    },
    // --- Add dynamic actions block here ---
  ];

  // --- Dynamically Add Action Buttons ---
  const actionElements = [];
  if (status === ORDER_STATUS.ORDERED) {
    actionElements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '✅ Claim Order',
        emoji: true,
      },
      style: 'primary',
      value: orderId, // Pass orderId for identification
      action_id: 'claim_order',
    });
    actionElements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '❌ Cancel Order',
        emoji: true,
      },
      style: 'danger',
      value: orderId,
      action_id: 'cancel_order',
    });
  } else if (status === ORDER_STATUS.CLAIMED) {
    actionElements.push({
      type: 'button',
      text: {
        type: 'plain_text',
        text: '🚚 Mark as Delivered',
        emoji: true,
      },
      style: 'primary',
      value: orderId,
      action_id: 'deliver_order', // Action ID for marking delivered
    });
     // Add Cancel button for claimed state ONLY if the runner needs it (future enhancement?)
     // Consider adding a cancel button for the *runner* if they claimed by mistake?
     // For now, only 'Mark as Delivered' for claimed state.
  } 
  // For DELIVERED, CANCELLED, EXPIRED - no buttons are added.

  if (actionElements.length > 0) {
    blocks.push({
      type: 'actions',
      elements: actionElements,
    });
  }
  // <<< Log final blocks >>>
  console.log('[formatOrderMessage] Generated Blocks:', JSON.stringify(blocks, null, 2));

  return blocks; // Return the full block kit array
}

/**
 * Helper function to wrap text for ASCII art block with word wrap and indentation
 * @param {string} label - The label (e.g., "RUNNER:")
 * @param {string} value - The value string to wrap
 * @param {number} totalWidth - The total width of the block (e.g., 42)
 * @param {number} valueStartColumn - The column where the value should start (1-indexed)
 * @returns {string[]} - Array of formatted lines
 */
function formatAsciiLineWrap(label, value, totalWidth, valueStartColumn = 16) {
  const lines = [];
  const labelPart = `| ${label.toUpperCase()}`.padEnd(valueStartColumn -1).substring(0, valueStartColumn -1);
  const valueIndentString = ' '.repeat(valueStartColumn - 2); 
  // Reduce max width by 1 to ensure at least one space before the closing '|'
  const valueMaxWidth = totalWidth - valueStartColumn - 2; 

  if (valueMaxWidth <= 0) {
      console.error('[formatAsciiLineWrap] Calculated valueMaxWidth is not positive!');
      const errorLine = (labelPart + ' '.padEnd(totalWidth - labelPart.length - 1) + '|').substring(0, totalWidth);
      return [errorLine];
  }

  let remainingValue = String(value || '').toUpperCase().trim();
  let firstLine = true;

  while (remainingValue.length > 0) {
    let lineValuePart;
    // Check if the remaining value fits OR if the first word itself is longer than the max width
    if (remainingValue.length <= valueMaxWidth || remainingValue.indexOf(' ') === -1 || remainingValue.split(' ')[0].length > valueMaxWidth) {
      // If it fits OR if the first word is too long, take the whole chunk up to max width
      lineValuePart = remainingValue.substring(0, valueMaxWidth);
      remainingValue = remainingValue.substring(lineValuePart.length).trimStart(); // Trim space for next line
    } else {
      // Find the last space WITHIN the allowed width
      let wrapIndex = remainingValue.lastIndexOf(' ', valueMaxWidth); 
      // If lastIndexOf returns 0 or -1 (no space found within limit), we should NOT break mid-word unless the word itself is too long (handled above)
      // This case means the first word is shorter than max width, but the second word pushes it over.
      // We need to find the first space instead if lastIndexOf fails gracefully.
      if (wrapIndex <= 0) { 
          wrapIndex = remainingValue.indexOf(' '); // Find the first space to break after the first word
          // If even the first space is beyond max width, something is wrong, but default to max width break
          if (wrapIndex === -1 || wrapIndex > valueMaxWidth) { 
              wrapIndex = valueMaxWidth;
          }
      }
      lineValuePart = remainingValue.substring(0, wrapIndex).trimEnd();
      remainingValue = remainingValue.substring(wrapIndex).trimStart();
    }

    let line;
    if (firstLine) {
      // Combine, pad with spaces to ensure 1 space before pipe, add pipe, truncate
      line = (`${labelPart} ${lineValuePart}`).padEnd(totalWidth - 1) + '|';
      firstLine = false;
    } else {
      // Indent, pad, add pipe, truncate
      line = (`| ${valueIndentString}${lineValuePart}`).padEnd(totalWidth - 1) + '|';
    }
    lines.push(line.substring(0, totalWidth)); 
  }

  if (lines.length === 0) {
     // Pad empty value correctly
     const emptyLine = (`${labelPart} ${ ''.padEnd(valueMaxWidth)}`).padEnd(totalWidth - 1) + '|';
     lines.push(emptyLine.substring(0, totalWidth));
  }
  return lines;
}

/**
 * Format the runner availability message blocks.
 * @param {Object} runnerData - The runner offer data.
 * @param {string} messageTs - The message timestamp (used as ID).
 * @returns {Array} - Array of Slack Block Kit blocks.
 */
export function formatRunnerMessage(runnerData, messageTs) {
  console.log('[formatRunnerMessage] Received runnerData:', JSON.stringify(runnerData, null, 2));
  console.log(`[formatRunnerMessage] Received messageTs: ${messageTs}`);
  
  const {
    runnerId = 'UNKNOWN',
    runnerName = 'Unknown Runner',
    capabilities = [], // Array of keys like ['TEA', 'DRIP']
    status = ORDER_STATUS.FAILED,
    startTimestamp, // Expecting Firestore Timestamp
    durationMs,     // Expecting number
  } = runnerData || {}; // Default to empty object if runnerData is null/undefined

  const displayMessageTs = messageTs || 'PENDING...';

  // --- NEW: Calculate CAN MAKE and CAN'T MAKE lists --- 
  const allCategoryKeys = Object.keys(DRINK_CATEGORIES);
  
  // Get display names for selected capabilities
  const canMakeNames = capabilities
      .map(key => DRINK_CATEGORIES[key]?.name || key) // Get name, fallback to key
      .sort(); // Sort alphabetically for consistency
  const canMakeString = canMakeNames.length > 0 ? canMakeNames.join(', ') : 'N/A';
  
  // Determine which category keys were *not* selected
  const cantMakeKeys = allCategoryKeys.filter(key => !capabilities.includes(key));
  
  // Get display names for unselected capabilities
  const cantMakeNames = cantMakeKeys
      .map(key => DRINK_CATEGORIES[key]?.name || key) // Get name, fallback to key
      .sort(); // Sort alphabetically
  const cantMakeString = cantMakeNames.length > 0 ? cantMakeNames.join(', ') : 'NONE'; // Use NONE if list is empty
  // --- END NEW --- 

  // Format Duration (Keep for timer logic, but don't display directly in this line anymore)
  const durationMinutes = durationMs ? Math.round(durationMs / 60000) : 0;
  // const durationText = durationMinutes > 0 ? `${durationMinutes} MINUTES` : 'Indefinite'; // No longer needed for display line

  // --- Calculate Timer/Status (Keep existing timer logic) ---
  let statusText = status ? status.toUpperCase() : 'PENDING';
  let progressBar = '[                   ]'; // 20 spaces for default width
  let isOfferActive = (status === ORDER_STATUS.OFFERED);
  let timerString = ''; // Initialize timer string
  let timeTextLine = ''; // <<< DECLARE HERE
  let progressBarLine = ''; // <<< DECLARE HERE
  let instructionLine = ''; // <<< DECLARE HERE (for consistency)
  
  if (isOfferActive && startTimestamp && durationMs) {
    console.log(`[formatRunnerMessage] Condition TRUE. Calling formatTimeRemainingUtil.`);
    const barLengthForRunner = 20; 
    // Call the imported utility function
    timerString = formatTimeRemainingUtil(startTimestamp, durationMs, 'offer', barLengthForRunner); 

    // Simple check if expired based on returned string
    const isExpired = timerString.includes('EXPIRED');
    if (isExpired) {
        isOfferActive = false;
        statusText = 'EXPIRED_OFFER'; // Update status text
        status = ORDER_STATUS.EXPIRED_OFFER; // Update status for button logic
        // Revert static strings for expired state
        timeTextLine = "OFFER EXPIRED";
        progressBarLine = "[-------- EXPIRED --------]"; 
        instructionLine = "THIS OFFER IS NO LONGER AVAILABLE";
    } else {
        // Revert parsing logic and line generation
        const barMatch = timerString.match(/\[(.*?)\]/);
        const textMatch = timerString.match(/\s*(\d+)\s*(MINS?)/); // Extract minutes
        
        progressBarLine = barMatch ? `[${barMatch[1]}]` : `[${'-'.repeat(barLengthForRunner)}]`; // Extracted bar or default
        const minutes = textMatch ? parseInt(textMatch[1], 10) : 0;
        timeTextLine = `TIME LEFT ON SHIFT: ${minutes} MINUTE${minutes !== 1 ? 'S' : ''}`;
        instructionLine = "↓ CLICK BELOW TO PLACE AN ORDER ↓"; // Reverted instruction
    }
  } else {
      // Revert final state handling for runner offers
      switch (status) {
          case ORDER_STATUS.CLAIMED: 
              timeTextLine = "OFFER CLAIMED";
              progressBarLine = "[------ CLAIMED ------]"; 
              instructionLine = "THIS OFFER HAS BEEN CLAIMED";
              isOfferActive = false; 
              break;
          case ORDER_STATUS.CANCELLED: // Reverted from CANCELLED_RUNNER for this logic block if necessary
              timeTextLine = "OFFER CANCELLED";
              progressBarLine = "[----- CANCELLED -----]";
              instructionLine = "THIS OFFER WAS CANCELLED BY RUNNER";
              isOfferActive = false;
              break;
          case ORDER_STATUS.EXPIRED_OFFER:
              timeTextLine = "OFFER EXPIRED";
              progressBarLine = "[------ EXPIRED ------]";
              instructionLine = "THIS OFFER IS NO LONGER AVAILABLE";
              isOfferActive = false;
              break;
          default:
              timeTextLine = `STATUS: ${statusText}`;
              progressBarLine = "[----- UNKNOWN -----]";
              instructionLine = "OFFER STATUS UNKNOWN";
              isOfferActive = false;
              break;
      }
      timerString = `${progressBarLine} ${timeTextLine}`; 
  }
  
  // --- ASCII Art Formatting (50 Chars Wide) --- 
  const totalWidth = 50;
  const lines = [];
  const valueStartCol = 16; // Column where values start

  // Helper for centered lines 
  const addFullWidthLineCentered = (content) => {
      const contentStr = String(content || '').toUpperCase(); // Ensure uppercase
      const contentWidth = totalWidth - 4; // Width inside pipes
      const paddingNeeded = Math.max(0, contentWidth - contentStr.length);
      const leftPad = Math.floor(paddingNeeded / 2);
      const rightPad = Math.ceil(paddingNeeded / 2);
      lines.push((`| ${' '.repeat(leftPad)}${contentStr}${' '.repeat(rightPad)} |`).substring(0, totalWidth));
  }

  // Build the ASCII block content
  const border = '+' + '-'.repeat(totalWidth - 2) + '+';
  const innerSeparator = '|' + '-'.repeat(totalWidth - 2) + '|'; // Separator for inside sections

  lines.push(border);
  // Revert the header line
  const specialHeader = 'DRINK RUNNER AVAILABLE'; // Ensure no symbols here
  const headerTotalWidth = 50; // Set correct width to 50
  const headerPaddingNeeded = Math.max(0, headerTotalWidth - 2 - specialHeader.length);
  const headerLeftPad = Math.floor(headerPaddingNeeded / 2);
  const headerRightPad = Math.ceil(headerPaddingNeeded / 2);
  lines.push(`|${' '.repeat(headerLeftPad)}${specialHeader}${' '.repeat(headerRightPad)}|`.substring(0, headerTotalWidth)); 
  lines.push(border);
  
  // Use formatAsciiLineWrap for Runner, Can Make, Can't Make
  lines.push(...formatAsciiLineWrap('RUNNER:', runnerName, totalWidth, valueStartCol));
  lines.push(...formatAsciiLineWrap('CAN MAKE:', canMakeString, totalWidth, valueStartCol)); // Use new canMakeString
  lines.push(...formatAsciiLineWrap('CAN\'T MAKE:', cantMakeString, totalWidth, valueStartCol)); // ADD new cantMakeString line (Escape apostrophe)
  lines.push(border);

  // --- Add Timer/Status Lines --- 
  // Keep existing logic for adding timer/status lines
  addFullWidthLineCentered(timeTextLine); // Add the time text line
  addFullWidthLineCentered(progressBarLine); // Add the progress bar line
  lines.push(innerSeparator); // Add separator after status
  addFullWidthLineCentered(instructionLine); // Add the instruction line
  lines.push(border); // Final border

  // Combine lines into a single string for the code block
  const asciiBlock = `\`\`\`\n${lines.join('\n')}\n\`\`\``;

  // --- Build Action Buttons --- 
  const actions = [];
  if (isOfferActive) {
    // Pass necessary info for targeted order
    const orderNowValue = JSON.stringify({ 
        runnerId: runnerId, 
        runnerName: runnerName,
        messageTs: messageTs,
        channelId: runnerData.slackChannelId || getConfig('KOFFEE_KARMA_CHANNEL_ID'),
        capabilities: capabilities
    }); 
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'ORDER NOW', emoji: false },
      style: 'primary',
      action_id: 'open_order_modal_for_runner',
      value: orderNowValue
    });

    // Pass necessary info for cancellation
    const cancelValue = JSON.stringify({ messageTs: messageTs });
    actions.push({
      type: 'button',
      text: { type: 'plain_text', text: 'CANCEL OFFER', emoji: false },
      style: 'danger',
      action_id: 'cancel_ready_offer',
      value: cancelValue
    });
  }

  // Assemble final blocks
  const finalBlocks = [
    { type: 'section', text: { type: 'mrkdwn', text: asciiBlock } }
  ];
  if (actions.length > 0) {
    finalBlocks.push({ type: 'actions', elements: actions });
  }

  // Return the blocks array
  return finalBlocks;
}

/**
 * Format the leaderboard message
 * @param {Array<Object>} players - Sorted array of player objects
 * @returns {Array} - Slack blocks for the message
 */
export function formatLeaderboard(players) {
  const totalWidth = 80; // Target width
  // Define column widths based on user example
  const rankColWidth = 8;
  const nameColWidth = 29;
  const repColWidth = 14;
  const titleColWidth = 24;

  // Use exact strings from user example
  const titleLine = `+=============================[ THE BREW SCROLL ]==============================+`;
  const subDivide = `+------------------------------------------------------------------------------+`; 
  const header = `|  RANK  |           NAME              |  REPUTATION  |         TITLE          |`;
  const separator = `|--------|-----------------------------|--------------|------------------------|`;
  const bottomBorder = `+==============================================================================+`;

  // Recalculate command line padding for 80 width
  const commandText = '/ORDER    /DELIVER    /KARMA    /LEADERBOARD    /REDEEM'; // 57 chars
  const commandPaddingTotal = totalWidth - 2 - commandText.length; // 80 - 2 - 57 = 21
  const commandPadLeft = Math.floor(commandPaddingTotal / 2); // 10
  const commandPadRight = Math.ceil(commandPaddingTotal / 2); // 11
  const commandLine = `|${' '.repeat(commandPadLeft)}${commandText}${' '.repeat(commandPadRight)}|`;

  let leaderboardContent = '';

  if (!players || players.length === 0) {
    leaderboardContent = `Rep wall\'s clean. No legends yet.`;
     return [
        {
            type: 'section',
            text: { type: 'mrkdwn', text: leaderboardContent }
        }
     ];
  }

  const playerLines = players.map((player, index) => {
    // Center Rank in 8 chars
    const rankStr = String(index + 1);
    const rankPadLeft = Math.floor((rankColWidth - rankStr.length) / 2);
    const rankPadRight = Math.ceil((rankColWidth - rankStr.length) / 2);
    const rankPadded = `${ ' '.repeat(rankPadLeft)}${rankStr}${' '.repeat(rankPadRight)}`;
    
    // Pad Name to 29 chars WITH leading space
    const nameStr = ' ' + (player.name || 'UNKNOWN').toUpperCase(); // Add leading space
    const namePadded = nameStr.padEnd(nameColWidth).substring(0, nameColWidth);
    
    // Center Reputation in 14 chars
    const repStr = String(player.reputation || 0);
    const repPadLeft = Math.floor((repColWidth - repStr.length) / 2);
    const repPadRight = Math.ceil((repColWidth - repStr.length) / 2);
    const repPadded = `${ ' '.repeat(repPadLeft)}${repStr}${' '.repeat(repPadRight)}`;

    // Pad Title to 24 chars WITH leading space
    const titleStr = ' ' + (player.title || 'ROOKIE').toUpperCase(); // Add leading space
    const titlePadded = titleStr.padEnd(titleColWidth).substring(0, titleColWidth);
    
    // Construct the row string precisely based on column widths
    return `|${rankPadded}|${namePadded}|${repPadded}|${titlePadded}|`;
  });

  leaderboardContent = [
    titleLine,
    subDivide,
    header,
    separator,
    ...playerLines,
    subDivide,
    commandLine,
    bottomBorder
  ].join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`\n${leaderboardContent}\n\`\`\``
      }
    }
  ];
}

/**
 * Generate ASCII map with marker and legend (optional)
 * @param {string} locationKey - Location key (e.g., nw_studio)
 * @param {object} [options] - Options object
 * @param {boolean} [options.includeLegend=true] - Whether to include the legend side-by-side
 * @returns {string} - Formatted ASCII map string (with or without legend)
 */
export function generateMap(locationKey, options = { includeLegend: true }) {
  // <<< FIX: Go up ONE level from utils to functions, then into assets >>>
  const functionRootDir = path.resolve(__dirname, '..'); // Resolves to the functions directory
  const assetsDir = path.join(functionRootDir, 'assets'); // Look for assets directly inside functions
  const mapTemplatePath = path.join(assetsDir, 'map_template.txt');
  const coordinatesPath = path.join(assetsDir, 'map_coordinates.json');
  const marker = '✗'; // Use a clear marker

  // <<< Add Detailed Path and Exists Logging >>>
  console.log(`[generateMap] Location: ${locationKey}`);
  // <<< FIX: Log correct base path >>>
  console.log(`[generateMap] Calculated functionRootDir: ${functionRootDir}`);
  console.log(`[generateMap] Calculated assetsDir: ${assetsDir}`);
  console.log(`[generateMap] Calculated mapTemplatePath: ${mapTemplatePath}`);
  console.log(`[generateMap] Calculated coordinatesPath: ${coordinatesPath}`);
  const templateExists = fs.existsSync(mapTemplatePath);
  const coordsExist = fs.existsSync(coordinatesPath);
  console.log(`[generateMap] fs.existsSync(mapTemplatePath) = ${templateExists}`);
  console.log(`[generateMap] fs.existsSync(coordinatesPath) = ${coordsExist}`);
  // <<< End Logging >>>

  console.log(`[generateMap] Called with location: ${locationKey}, options:`, options); // Log options

  try {
    // Read template and coordinates
    // <<< Add explicit check before read >>>
    if (!templateExists) throw new Error(`Map template not found at calculated path: ${mapTemplatePath}`);
    if (!coordsExist) throw new Error(`Map coordinates not found at calculated path: ${coordinatesPath}`);
    
    const template = fs.readFileSync(mapTemplatePath, 'utf8');
    const coordinatesData = JSON.parse(fs.readFileSync(coordinatesPath, 'utf8'));

    // Get coordinates using the locationKey directly (matching map_coordinates.json structure)
    const coords = coordinatesData[locationKey];

    // Place marker
    let mapLines = template.split('\n');
    if (coords) {
        try {
            const y = parseInt(coords.y, 10);
            const x = parseInt(coords.x, 10);
            if (!isNaN(y) && !isNaN(x) && y >= 0 && y < mapLines.length) {
                let line = mapLines[y].split('');
                if (x >= 0 && x < line.length) {
                    line[x] = marker;
                    mapLines[y] = line.join('');
                } else {
                     console.warn(`X-coord ${x} out of bounds`);
                }
            } else {
                console.warn(`Y-coord ${y} out of bounds`);
            }
        } catch (e) {
             console.error(`Coord parse error: ${e}`);
        }
    } else if (locationKey && locationKey !== 'loc_default') {
        console.warn(`Coords not found: ${locationKey}`);
    }

    // --- Prepare Map Component --- 
    const mapWidth = 26; // Width of the map part
    const paddedMap = mapLines.map(line => line.padEnd(mapWidth).substring(0, mapWidth));
    const mapHeader = [
        "+--------------------------+",
        "|         LION MAP         |",
        "+--------------------------+"
    ];
    const mapFooter = ["+--------------------------+"];
    // Array of map lines including borders
    const fullMapLines = mapHeader.concat(paddedMap.map(line => `|${line}|`)).concat(mapFooter);
    const fullMapString = fullMapLines.join('\n');

    // --- Return map only if legend not needed --- 
    if (!options.includeLegend) {
        console.log('[generateMap] Returning map ONLY');
        return fullMapString; 
    }

    // --- Prepare Legend Component (only if needed) --- 
    const legendLines = [
        "+--------------------------+",
        "|         LEGEND           |", // Reverted title
        "+--------------------------+",
        "| ✗ = DRINK LOCATION       |", // Reverted legend item
        "| ☕ = CAFÉ                 |", // Reverted legend item
        "| ▯ = ELEVATOR             |", // Reverted legend item
        "| ≋ = BATHROOM             |", // Reverted legend item
        "+--------------------------+",
        // Restoring original descriptive text
        "|                          |",
        "| USE THE DROPDOWN ABOVE   |",
        "| TO PICK YOUR DELIVERY    |",
        "| SPOT IN THE STUDIO. THE  |",
        "| ✗ IN THE MAP SHOWS WHERE |",
        "| YOUR DRINK WILL ARRIVE.  |",
        "|                          |",
        "|                          |",
        "+--------------------------+"
    ];

    // --- Merge Map and Legend Side-by-Side (Default behavior) ---
    console.log('[generateMap] Returning COMBINED map and legend');
    const mergedLines = [];
    const maxLen = Math.max(fullMapLines.length, legendLines.length);
    for (let i = 0; i < maxLen; i++) {
        const left = fullMapLines[i] || ' '.repeat(mapWidth + 2); // Map part
        const right = legendLines[i] || ''; // Legend part
        mergedLines.push(`${left}  ${right}`);
    }
    
    return mergedLines.join('\n');

  } catch (error) {
    console.error("Error generating map:", error);
    return "[Map Unavailable]"; // Return error placeholder
  }
}

/**
 * Post a message to the designated Koffee Karma channel.
 * Handles fetching the channel ID from config.
 * @param {object} client - Slack WebClient instance
 * @param {object} options - Options for chat.postMessage (blocks, text, etc.)
 * @returns {Promise<object>} - Result from chat.postMessage
 */
export async function postMessageToDesignatedChannel(client, options) {
    const channelId = getConfig('KOFFEE_KARMA_CHANNEL_ID');
    if (!channelId) {
        throw new Error('KOFFEE_KARMA_CHANNEL_ID is not configured.');
    }
    try {
        const result = await client.chat.postMessage({
            channel: channelId,
            ...options // Spread the provided blocks, text, etc.
        });
        return result;
    } catch (error) {
        console.error(`Error posting message to channel ${channelId}:`, error);
        throw error; // Re-throw to be handled by caller
    }
}

/**
 * Update an existing Slack message.
 * @param {object} client - Slack WebClient instance
 * @param {object} options - Options for chat.update (channel, ts, blocks, text, etc.)
 * @returns {Promise<object>} - Result from chat.update
 */
export async function updateMessage(client, options) {
    if (!options.channel || !options.ts) {
        throw new Error('channel and ts are required for updateMessage.');
    }
    try {
        const result = await client.chat.update({
            ...options // Spread the provided channel, ts, blocks, text, etc.
        });
        return result;
    } catch (error) {
        console.error(`Error updating message ${options.ts} in channel ${options.channel}:`, error);
        throw error; // Re-throw to be handled by caller
    }
} 