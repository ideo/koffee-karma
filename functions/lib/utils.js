/**
 * Generates an ASCII progress bar string.
 * @param {number} percentage - The percentage completion (0-100).
 * @param {number} [barLength=20] - The total length of the bar characters.
 * @returns {string} The formatted progress bar string.
 */
function generateProgressBar(percentage, barLength = 20) {
    const filledLength = Math.round((percentage / 100) * barLength);
    const emptyLength = barLength - filledLength;
    const filledBar = '█'.repeat(filledLength);
    const emptyBar = '░'.repeat(emptyLength);
    // Clamp percentage between 0 and 100
    const clampedPercentage = Math.max(0, Math.min(100, percentage));
    if (clampedPercentage === 0) {
        return `[${'░'.repeat(barLength)}]`;
    }
    return `[${filledBar}${emptyBar}]`;
}


/**
 * Formats the remaining time and generates a progress bar.
 * @param {admin.firestore.Timestamp} createdAt - The creation timestamp of the item.
 * @param {number} durationMs - The total duration in milliseconds.
 * @param {string} verb - The action verb (e.g., "CLAIM", "DELIVER", "ORDER").
 * @param {number} [barLength=20] - The length of the progress bar.
 * @returns {string} Formatted string with progress bar and time remaining.
 */
function formatTimeRemaining(createdAt, durationMs, verb, barLength = 20) {
    const now = Date.now();
    const elapsedMs = now - createdAt.toMillis();
    const remainingMs = Math.max(0, durationMs - elapsedMs);
    const remainingMinutes = Math.floor(remainingMs / 60000);
    const remainingSeconds = Math.floor((remainingMs % 60000) / 1000);

    const percentage = Math.max(0, (remainingMs / durationMs) * 100);
    const progressBar = generateProgressBar(percentage, barLength); // Pass barLength

    console.log(`[formatTimeRemaining] progress=${percentage}, progressBarLength=${barLength}, calculated filledLength=${Math.round((percentage / 100) * barLength)}, calculated emptyLength=${barLength - Math.round((percentage / 100) * barLength)}`);

    if (remainingMs === 0) {
        return `${progressBar} TIME EXPIRED`;
    } else {
        // Use ROUND for the displayed minutes to match progress bar rounding
        const displayMinutes = Math.round(remainingMs / 60000);
        const timeUnit = displayMinutes === 1 ? 'MIN' : 'MINS';
        // Ensure consistent spacing and format
        return `${progressBar}  ${displayMinutes} ${timeUnit} TO ${verb.toUpperCase()} ORDER`;
    }
}

// REMOVE module.exports
/*
module.exports = {
    // ... other exports
    generateProgressBar,
    formatTimeRemaining,
    getOrCreatePlayer, // Assuming this exists and needs export
    updatePlayerKarmaBalance, // Assuming this exists and needs export
    updatePlayerKarmaLegacy, // Assuming this exists and needs export
    updatePlayerDeliveryCount, // Assuming this exists and needs export
    updatePlayerOrdersRequestedCount, // Assuming this exists and needs export
    calculateBonusMultiplier, // Assuming this exists and needs export
    logKarmaChange // Assuming this exists and needs export
    // ... other exports
};
*/

// Add export statements for functions needed by other modules
export { 
    generateProgressBar, 
    formatTimeRemaining, 
    // Add other functions that were previously in module.exports
    // getOrCreatePlayer, 
    // updatePlayerKarmaBalance, 
    // updatePlayerKarmaLegacy, 
    // updatePlayerDeliveryCount,
    // updatePlayerOrdersRequestedCount,
    // calculateBonusMultiplier,
    // logKarmaChange
};

// OR export functions individually:
// export function generateProgressBar(...) { ... }
// export function formatTimeRemaining(...) { ... }
// export async function getOrCreatePlayer(...) { ... }
// etc. 