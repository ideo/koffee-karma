/**
 * Database utility functions for Koffee Karma
 */
import admin from 'firebase-admin';
// const functions = require('firebase-functions'); // No longer needed here
import { v4 as uuidv4 } from 'uuid';
import { 
  ORDER_STATUS, 
  KARMA_COSTS, 
  TITLES 
} from './constants.js';
import { logger } from './logger.js';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
// import path from 'path'; // Not used directly

// --- Firestore Initialization Variables ---
// let db;
// let playersRef;
// let ordersRef;
// let redemptionCodesRef;
// let configRef;

// --- Eager Initialization Function (to be called from index.js) ---
/*
export function initializeDb() {
    // Ensure admin.initializeApp() has been called (should have been in index.js)
    if (admin.apps.length === 0) {
        logger.error('Firestore initializeDb check: Firebase Admin SDK not initialized yet!');
        // Throw or handle? Throwing might prevent function from starting.
        // Let's log an error and proceed; subsequent calls will fail if db is null.
        logger.error("Firebase Admin SDK not initialized. Call initializeApp first in index.js.");
        return; // Exit if admin sdk not ready
    }
    if (!db) {
        logger.debug('Attempting EAGER Firestore connection initialization...');
        try {
            db = getFirestore();
            playersRef = db.collection('players');
            ordersRef = db.collection('orders');
            redemptionCodesRef = db.collection('redemptionCodes');
            configRef = db.collection('config');
            logger.debug('EAGER Firestore connection initialized successfully.');
        } catch (error) {
            logger.error('EAGER Failed to initialize Firestore connection:', error);
            db = null; // Ensure db is null if initialization fails
            // We don't re-throw here, let the individual functions fail if db is null
        }
    }
}
// --- End Eager Initialization Function ---

/**
 * Player Management Functions
 */

/**
 * Get a player by their Slack ID
 * @param {string} slackId - Slack user ID
 * @returns {Promise<Object|null>} - Player object or null if not found
 */
export async function getPlayerBySlackId(slackId) {
  // Remove !db check
  // if (!db) { ... } 
  try {
    logger.debug(`[getPlayerBySlackId] Querying for slackId: ${slackId}`);
    const queryStartTime = Date.now(); // START TIMER
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    const snapshot = await playersRef.where('slackId', '==', slackId).limit(1).get();
    const queryEndTime = Date.now(); // END TIMER
    logger.debug(`[getPlayerBySlackId] Firestore query took ${queryEndTime - queryStartTime} ms`); // LOG DURATION
    
    if (snapshot.empty) {
        logger.warn(`[getPlayerBySlackId] Player not found for slackId: ${slackId}`);
        return null;
    }
    const doc = snapshot.docs[0];
    const data = doc.data();
    if (!data) return null;

    // Remove fallback logic, directly use new fields
    const currentKarma = Number(data.karma ?? 0); 
    const title = calculatePlayerTitle(data.reputation); // Calculate title based on reputation

    // Remove fallback logic, directly use new fields
    const currentReputation = Number(data.reputation ?? 0);

    // Merge calculated title with existing data
    return { 
      id: doc.id, 
      ...data,
      karma: currentKarma,
      reputation: currentReputation,
      title: title
    };
  } catch (error) {
    logger.error(`Error getting player by Slack ID ${slackId}:`, error);
    throw error;
  }
}

/**
 * Create a new player from Slack user info
 * @param {Object} slackInfo - Slack user information (expects user object from users.info)
 * @returns {Promise<Object>} - Created player object
 */
export async function createPlayer(slackInfo) {
  // Remove !db check
  // if (!db) { ... } 
  try {
    const { id: slackId, name, real_name, profile } = slackInfo;
    if (!slackId) throw new Error("Missing Slack ID in createPlayer data");

    const playerData = {
      slackId,
      name: real_name || name, // Prefer real_name
      displayName: profile?.display_name || real_name || name,
      avatarUrl: profile?.image_72,
      // FIX: Initialize with new field names
      karma: 0, 
      reputation: 0, 
      orders: 0,
      deliveries: 0,
      capabilities: [],
      active: true,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    };
    
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    const playerDocRef = playersRef.doc(slackId); 
    await playerDocRef.set(playerData);
    logger.info(`Created new player document with ID ${slackId} for Slack ID ${slackId}`);
    // Return data consistent with fetching, using slackId as the ID
    return { 
      id: slackId, 
      ...playerData,
      title: calculatePlayerTitle(0) // FIX: Pass initial reputation (0)
    };
  } catch (error) {
    logger.error('Error creating player:', error);
    throw error;
  }
}

/**
 * Update player capabilities
 * @param {string} playerIdOrSlackId - Player document ID or Slack ID
 * @param {string[]} capabilities - Array of drink capabilities
 * @returns {Promise<void>}
 */
export async function updatePlayerCapabilities(playerIdOrSlackId, capabilities) {
  // Remove !db check
  // if (!db) { ... } 
  try {
    let playerDocRef;
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    // Check if it looks like a Slack ID (starts with U or W)
    if (playerIdOrSlackId.startsWith('U') || playerIdOrSlackId.startsWith('W')) {
        const player = await getPlayerBySlackId(playerIdOrSlackId);
        if (!player) throw new Error(`Player not found for Slack ID ${playerIdOrSlackId} in updatePlayerCapabilities`);
        playerDocRef = playersRef.doc(player.id);
    } else {
        playerDocRef = playersRef.doc(playerIdOrSlackId);
    }

    await playerDocRef.update({
      capabilities,
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    logger.error(`Error updating player capabilities for ${playerIdOrSlackId}:`, error);
    throw error;
  }
}

/**
 * Update player's last used location
 * @param {string} playerIdOrSlackId - Player document ID or Slack ID
 * @param {string} location - Location code
 * @returns {Promise<void>}
 */
export async function updatePlayerLocation(playerIdOrSlackId, location) {
  // Remove !db check
  // if (!db) { ... } 
  try {
    let playerDocRef;
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    if (playerIdOrSlackId.startsWith('U') || playerIdOrSlackId.startsWith('W')) {
        const player = await getPlayerBySlackId(playerIdOrSlackId);
        if (!player) throw new Error(`Player not found for Slack ID ${playerIdOrSlackId} in updatePlayerLocation`);
        playerDocRef = playersRef.doc(player.id);
    } else {
        playerDocRef = playersRef.doc(playerIdOrSlackId);
    }

    await playerDocRef.update({
      lastLocation: location,
      updatedAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    logger.error(`Error updating player location for ${playerIdOrSlackId}:`, error);
    throw error;
  }
}

/**
 * Get an existing player or create a new one
 * @param {string} userId - The Slack User ID.
 * @param {object | null} client - Optional Slack WebClient instance to fetch user info if not found.
 * @returns {Promise<{player: object, isNew: boolean}>} - Player object and a flag indicating if it was newly created.
 * @throws {Error} If player not found and client is not provided or Slack fetch fails.
 */
export async function getOrCreatePlayer(userId, client = null) {
    // Remove !db check
    // if (!db) { ... } 

    try {
        // --- Use Direct Lookup --- 
        logger.debug(`[getOrCreatePlayer] Attempting direct lookup for userId: ${userId}`);
        // Use getFirestore() directly
        const playersRef = getFirestore().collection('players');
        const playerDocRef = playersRef.doc(userId); // Get the DocumentReference

        // *** Remove Precise Timing Block ***
        const playerDoc = await playerDocRef.get(); // The actual Firestore read
        // *** End Remove Precise Timing Block ***

        if (playerDoc.exists) {
            logger.debug(`[getOrCreatePlayer] Found existing player via direct lookup: ${userId}`);
            const data = playerDoc.data();
            if (!data) return null;

            // Remove fallback logic, directly use new fields
            const currentKarma = Number(data.karma ?? 0);
            const currentReputation = Number(data.reputation ?? 0);
            const storedTitle = data.title;
            const finalTitle = (storedTitle !== undefined && storedTitle !== null && storedTitle !== '')
                       ? storedTitle
                       : calculatePlayerTitle(currentReputation); // FIX: Pass reputation
            return {
                 player: {
                     id: playerDoc.id, // which is userId
                     ...data,
                     karma: currentKarma,
                     reputation: currentReputation, // Use 'reputation' key
                     title: finalTitle
                 },
                 isNew: false
             };
        }
        // --- End Direct Lookup ---

        // --- If direct lookup fails, proceed to create ---
        logger.info(`Player ${userId} not found via direct lookup, attempting to create...`);
        if (!client) {
            logger.warn(`No Slack client provided for new user ${userId}. Cannot fetch details.`);
            throw new Error(`Cannot create new player ${userId} without Slack client to fetch details.`);
        }

        // Fetch Slack user info
        const slackUserInfo = await client.users.info({ user: userId });
        if (!slackUserInfo.ok || !slackUserInfo.user) {
            throw new Error(`Failed to fetch Slack user info for ${userId}: ${slackUserInfo.error || 'User data missing'}`);
        }
        logger.debug(`Slack user info fetched successfully for ${userId}.`);

        // Create player
        const newPlayer = await createPlayer(slackUserInfo.user);
        return { player: newPlayer, isNew: true };

    } catch (error) {
        if (error.data && error.data.error === 'user_not_found') {
             logger.error(`Slack API error: User ${userId} not found.`);
        } else {
            logger.error(`Error in getOrCreatePlayer for user ${userId}:`, error);
        }
        throw new Error(`Could not get or create player for user ${userId}. Reason: ${error.message}`);
    }
}

/**
 * Update a player's karma based on Firestore Document ID.
 * @param {string} playerId - Firestore Document ID.
 * @param {number} karmaChange - Amount to change karma by (positive or negative)
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function updatePlayerKarmaById(playerId, karmaChange) {
  logger.debug(`[updatePlayerKarmaById] Updating karma for player ID ${playerId} by ${karmaChange}`);
  try {
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    const playerDocRef = playersRef.doc(playerId);

    // *** Use Atomic Increment on 'karma' field ***
    await playerDocRef.update({
      karma: FieldValue.increment(karmaChange), // FIX: Use 'karma' field
      updatedAt: FieldValue.serverTimestamp()
    });

    logger.info(`[updatePlayerKarmaById] Successfully updated karma for player ID ${playerId} by ${karmaChange}.`);
    return true; // <<< ADDED RETURN true >>>
  } catch (error) {
    // Add specific error handling if player document might not exist
     if (error.code === 5 || error.message.includes('NOT_FOUND')) { // Firestore NOT_FOUND error code is 5
       logger.error(`[updatePlayerKarmaById] Player document not found for ID ${playerId} during atomic update.`);
       // Decide how to handle - rethrow, log, etc. Rethrowing is often safest.
       throw new Error(`Player document not found for ID ${playerId}`);
     } else {
       logger.error(`Error updating karma for player ID ${playerId}:`, error);
       // throw error; // Rethrow other errors // <<< REMOVED throw >>>
       return false; // <<< ADDED RETURN false >>>
     }
  }
}

/**
 * Update a player's reputation based on Firestore Document ID.
 * @param {string} playerId - Firestore Document ID.
 * @param {number} reputationChange - Amount to change reputation by (should always be positive).
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function updatePlayerReputationById(playerId, reputationChange) {
  if (reputationChange <= 0) {
    logger.warn(`[updatePlayerReputationById] Attempted to update reputation for player ID ${playerId} with non-positive value: ${reputationChange}. Skipping.`);
    return true; // Not a failure, just no-op
  }
  logger.debug(`[updatePlayerReputationById] Updating reputation for player ID ${playerId} by ${reputationChange}`);
  try {
    const playersRef = getFirestore().collection('players');
    const playerDocRef = playersRef.doc(playerId);

    await playerDocRef.update({
      reputation: FieldValue.increment(reputationChange), // FIX: Use 'reputation' field
      updatedAt: FieldValue.serverTimestamp()
    });

    logger.info(`[updatePlayerReputationById] Successfully updated reputation for player ID ${playerId} by ${reputationChange}.`);
    return true;
  } catch (error) {
     if (error.code === 5 || error.message.includes('NOT_FOUND')) {
       logger.error(`[updatePlayerReputationById] Player document not found for ID ${playerId} during atomic update.`);
       // throw new Error(`Player document not found for ID ${playerId}`); // Don't throw, return false
     } else {
       logger.error(`Error updating reputation for player ID ${playerId}:`, error);
     }
     return false; // Return false on any error
  }
}

/**
 * Update a player's order count based on Slack ID.
 * @param {string} slackId - Slack User ID.
 * @param {number} increment - Amount to increment order count by (default 1).
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function updatePlayerOrderCount(slackId, increment = 1) {
  // Remove !db check
  try {
    // Use getFirestore() directly
    const playerDocRef = getFirestore().collection('players').doc(slackId);
    await playerDocRef.update({
      orders: FieldValue.increment(increment),
      updatedAt: FieldValue.serverTimestamp()
    });
    logger.info(`[updatePlayerOrderCount] Updated order count for ${slackId} by ${increment}`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerOrderCount] Error updating order count for ${slackId}:`, error);
    return false;
  }
}

/**
 * Update a player's delivery count based on Slack ID.
 * @param {string} slackId - Slack User ID.
 * @param {number} increment - Amount to increment delivery count by (default 1).
 * @returns {Promise<boolean>} - True on success, false on failure.
 */
export async function updatePlayerDeliveryCount(slackId, increment = 1) {
  // Remove !db check
  try {
    // Use getFirestore() directly
    const playerDocRef = getFirestore().collection('players').doc(slackId);
    await playerDocRef.update({
      deliveries: FieldValue.increment(increment),
      updatedAt: FieldValue.serverTimestamp()
    });
    logger.info(`[updatePlayerDeliveryCount] Updated delivery count for ${slackId} by ${increment}`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerDeliveryCount] Error updating delivery count for ${slackId}:`, error);
    return false;
  }
}

/**
 * Calculate a player's title based on reputation
 * @param {number} reputation - Player's reputation
 * @returns {string} - Player's title
 */
function calculatePlayerTitle(reputation) { // FIX: Parameter name change
  // Ensure reputation is a number
  const numReputation = Number(reputation); // FIX: Use reputation
  let currentReputation = 0; // Default to 0 if invalid
  if (isNaN(numReputation)) {
      logger.warn(`[calculatePlayerTitle] Invalid reputation value: ${reputation}. Defaulting to 0.`);
  } else {
      currentReputation = numReputation;
  }
  logger.debug(`[calculatePlayerTitle] Calculating title for reputation: ${currentReputation}`);

  // Determine title based on thresholds (matching Python logic)
  let calculatedTitle;
  // FIX: Update thresholds if needed, based on 'reputation' score range
  if (currentReputation >= 20) { 
    calculatedTitle = "The Last Barista";
  } else if (currentReputation >= 16) {
    calculatedTitle = "Café Shade Mystic";
  } else if (currentReputation >= 12) {
    calculatedTitle = "Foam Scryer";
  } else if (currentReputation >= 8) {
    calculatedTitle = "Roast Prophet";
  } else if (currentReputation >= 5) {
    calculatedTitle = "Keeper of the Drip";
  } else if (currentReputation >= 3) {
    calculatedTitle = "The Initiate";
  } else if (currentReputation >= 1) {
    calculatedTitle = "Cold Pour";
  } else {
    calculatedTitle = "Parched";
  }

  logger.debug(`[calculatePlayerTitle] Calculated title: ${calculatedTitle}`);
  return calculatedTitle;
}

/**
 * Get top players by reputation
 * @param {number} limit - Maximum number of players to return
 * @returns {Promise<Array>} - Array of player objects
 */
export async function getLeaderboard(limit = 10) {
  // Remove !db check
  try {
    // Use getFirestore() directly
    const playersRef = getFirestore().collection('players');
    const snapshot = await playersRef.orderBy('reputation', 'desc').limit(limit).get();
    return snapshot.docs.map(doc => {
        const data = doc.data();
        if (!data) return null;

        // Remove fallback logic, directly use new fields
        const reputation = Number(data.reputation ?? 0);
        const title = calculatePlayerTitle(reputation); // Calculate title

        return { 
            id: doc.id, 
            ...data,
            // Ensure karma and reputation fields exist even if reading old data
            karma: Number(data.karma ?? 0),
            reputation: reputation, 
            title: title
        };
    });
  } catch (error) {
    logger.error('Error getting leaderboard:', error);
    throw error;
  }
}

/**
 * Order Management Functions
 */

/**
 * Create a new order
 * @param {Object} orderData - Order data
 * @returns {Promise<Object>} - Created order object
 */
export async function createOrder(orderData) {
  // Remove !db check
  try {
    logger.debug('[createOrder] Creating new order with data:', orderData);
    // Use getFirestore() directly
    const ordersRef = getFirestore().collection('orders');
    const docRef = await ordersRef.add({
      ...orderData,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[createOrder] Order created successfully with ID: ${docRef.id}`);
    return docRef; // Return the DocumentReference
  } catch (error) {
    logger.error('[createOrder] Error creating order:', error);
    throw error; // Re-throw to be handled by caller
  }
}

/**
 * Update an order's status and details
 * @param {string} orderId - Order document ID
 * @param {Object} updateData - Data to update
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
export async function updateOrder(orderId, updateData) {
    // Remove !db check
    try {
        logger.debug(`[updateOrder] Updating order ${orderId} with data:`, updateData);
        // Use getFirestore() directly
        const orderDocRef = getFirestore().collection('orders').doc(orderId);
        await orderDocRef.update({
            ...updateData,
            updatedAt: FieldValue.serverTimestamp()
        });
        logger.info(`[updateOrder] Successfully updated order ${orderId}.`);
        return true;
    } catch (error) {
        // Check for not-found error specifically
        if (error.code === 'not-found') {
            logger.warn(`[updateOrder] Order document ${orderId} not found for update.`);
        } else {
            logger.error(`[updateOrder] Error updating order ${orderId}:`, error);
        }
        return false;
    }
}

/**
 * Get orders by status
 * @param {string} status - Order status to filter by (from ORDER_STATUS)
 * @param {string} [channelName] - Optional channel name to filter by
 * @param {number} limit - Maximum number of orders to return
 * @returns {Promise<Array>} - Array of order objects
 */
export async function getOrdersByStatus(status, channelName = null, limit = 50) {
  // Remove !db check
  try {
    // Use getFirestore() directly
    let query = getFirestore().collection('orders').where('status', '==', status);
    if (channelName) {
      query = query.where('channelName', '==', channelName);
    }
    query = query.orderBy('createdAt', 'desc').limit(limit);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    logger.error(`Error getting orders with status ${status}:`, error);
    throw error;
  }
}

/**
 * Get orders for a specific player
 * @param {string} slackId - Player's Slack ID
 * @param {string} [status] - Optional status filter
 * @param {number} limit - Maximum number of orders to return
 * @returns {Promise<Array>} - Array of order objects
 */
export async function getPlayerOrders(slackId, status = null, limit = 10) {
  // Remove !db check
  try {
    // Use getFirestore() directly
    let query = getFirestore().collection('orders').where('requesterId', '==', slackId);
    if (status) {
      query = query.where('status', '==', status);
    }
    query = query.orderBy('createdAt', 'desc').limit(limit);
    const snapshot = await query.get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    logger.error(`Error getting orders for player ${slackId}:`, error);
    throw error;
  }
}

/**
 * Finds an order document reference by its Slack message timestamp.
 * @param {string} messageTs - The Slack message timestamp (e.g., '1678886400.000100')
 * @returns {Promise<admin.firestore.DocumentReference|null>} - The DocumentReference or null if not found.
 */
export async function getOrderRefByMessageTs(messageTs) {
    // Remove !db check
    if (!messageTs) {
        logger.warn('[getOrderRefByMessageTs] messageTs is missing.');
        return null;
    }
    try {
        logger.debug(`[getOrderRefByMessageTs] Querying for slackMessageTs: ${messageTs}`);
        // Use getFirestore() directly
        const ordersRef = getFirestore().collection('orders');
        const snapshot = await ordersRef.where('slackMessageTs', '==', messageTs).limit(1).get();

        if (snapshot.empty) {
            logger.warn(`[getOrderRefByMessageTs] No order found for slackMessageTs: ${messageTs}`);
            return null;
        }
        logger.debug(`[getOrderRefByMessageTs] Found order ref: ${snapshot.docs[0].ref.path}`);
        return snapshot.docs[0].ref; // Return the DocumentReference
    } catch (error) {
        logger.error(`[getOrderRefByMessageTs] Error finding order by slackMessageTs ${messageTs}:`, error);
        throw error; // Re-throw error to be handled by caller
    }
}

/**
 * Add a new order document to Firestore.
 * Uses Firestore's auto-generated ID.
 * @param {object} orderDetails - The order details to save.
 * @returns {Promise<string>} - The Firestore document ID of the newly created order.
 * @throws {Error} If saving fails.
 */
export async function addOrder(orderDetails) {
  // Remove !db check
  try {
    logger.debug('[addOrder] Adding new order with details:', orderDetails);
    // Use getFirestore() directly
    const ordersRef = getFirestore().collection('orders');
    // Add default timestamps if not provided
    const dataToAdd = {
      ...orderDetails,
      createdAt: orderDetails.createdAt || FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    const docRef = await ordersRef.add(dataToAdd);
    logger.info(`[addOrder] Order added successfully with Firestore ID: ${docRef.id}`);
    return docRef.id; // Return the auto-generated Firestore ID
  } catch (error) {
    logger.error('[addOrder] Error adding order:', error);
    throw error; // Re-throw to be handled by the caller
  }
}

/**
 * Redemption Code Functions
 */

/**
 * Create a redemption code
 * @param {number} value - Karma value
 * @param {number} maxRedemptions - Maximum number of redemptions (default: 1)
 * @param {Date} expiresAt - Expiration date
 * @returns {Promise<string>} - Generated redemption code
 */
export async function createRedemptionCode(value, maxRedemptions = 1, expiresAt = null) {
  // Remove !db check
  try {
    const code = uuidv4().substring(0, 8).toUpperCase(); // Generate a shorter code
    // Use getFirestore() directly
    const codeRef = getFirestore().collection('redemptionCodes').doc(code);
    await codeRef.set({
      value,
      maxRedemptions,
      redemptionCount: 0,
      redeemedBy: [], // Store array of user IDs who redeemed
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
      active: true
    });
    logger.info(`Created redemption code ${code} with value ${value}`);
    return code;
  } catch (error) {
    logger.error('Error creating redemption code:', error);
    throw error;
  }
}

/**
 * Attempt to redeem a code for a user.
 * Uses a transaction to ensure atomicity.
 * @param {string} code - The redemption code string.
 * @param {string} slackId - The Slack ID of the user attempting to redeem.
 * @returns {Promise<{success: boolean, value: number|null, message: string}>} - Result object.
 */
export async function redeemCode(code, slackId) {
    // Remove !db check
    if (!code || !slackId) {
        logger.warn('[redeemCode] Missing code or slackId.');
        return { success: false, value: null, message: 'Missing code or user information.' };
    }
    const normalizedCode = code.toUpperCase();
    let karmaValue = null; // Define karmaValue here
    try {
        logger.info(`[redeemCode] Attempting redemption for code ${normalizedCode} by user ${slackId}`);
        // Use getFirestore() directly
        const codeRef = getFirestore().collection('redemptionCodes').doc(normalizedCode);
        const playerRef = getFirestore().collection('players').doc(slackId); // Direct ref using Slack ID

        const result = await getFirestore().runTransaction(async (transaction) => {
            const codeDoc = await transaction.get(codeRef);

            // 1. Check if code exists
            if (!codeDoc.exists) {
                logger.warn(`Redemption failed: Code ${normalizedCode} not found.`);
                return null;
            }

            const codeData = codeDoc.data();

            // 2. Check if code is expired
            if (codeData.expiresAt && codeData.expiresAt.toMillis() < Date.now()) {
                logger.warn(`Redemption failed: Code ${normalizedCode} expired.`);
                return null;
            }

            // 3. Check if max redemptions reached
            // Note: Using >= covers both maxRedemptions = 1 and > 1 cases initially
            if (codeData.redemptionCount >= codeData.maxRedemptions) {
                logger.warn(`Redemption failed: Code ${normalizedCode} max redemptions (${codeData.maxRedemptions}) reached.`);
                return null;
            }

            // 4. Check if this user already redeemed this specific code
            const userRedeemed = codeData.redeemedBy?.some(redemption => redemption.userId === slackId);
            if (userRedeemed) {
                logger.warn(`Redemption failed: User ${slackId} already redeemed code ${normalizedCode}.`);
                return null;
            }
            
            // --- If all checks pass, proceed with redemption --- 
            
            // Prepare update data
            const newRedemptionCount = (codeData.redemptionCount || 0) + 1;
            const newRedeemedBy = [ 
                ...(codeData.redeemedBy || []), 
                { userId: slackId, timestamp: FieldValue.serverTimestamp() }
            ];
            
            // Update the code document within the transaction
            transaction.update(codeRef, {
                redemptionCount: newRedemptionCount,
                redeemedBy: newRedeemedBy
            });

            // --- Update Player Karma ---
            const karmaValueFromCode = codeData.value; // Get value from code
            transaction.update(playerRef, {
                karma: FieldValue.increment(karmaValueFromCode) // FIX: Increment 'karma' field
            });

            karmaValue = karmaValueFromCode; // Assign value for return
            logger.info(`Code ${normalizedCode} successfully redeemed by user ${slackId} for ${karmaValue} karma.`);
            return true; // Indicate transaction success
        });

        if (result) {
             return { success: true, value: karmaValue, message: `Successfully redeemed code for ${karmaValue} Karma!` };
        } else {
             // This case now covers the specific validation failures inside the transaction
             // Determine specific message based on earlier checks (this part is tricky without returning specific reasons from transaction)
             // For simplicity, return a generic failure message if result is null (meaning validation failed)
             return { success: false, value: null, message: 'Redemption failed: Code is invalid, expired, fully redeemed, or already used by you.' };
        }

    } catch (error) {
        logger.error(`[redeemCode] Error during transaction for code ${normalizedCode} by ${slackId}:`, error);
        return { success: false, value: null, message: `An internal error occurred during redemption: ${error.message}` };
    }
}

/**
 * Get application configuration
 * @returns {Promise<Object>} - Application configuration
 */
export async function getAppConfig() {
    // Remove !db check
    try {
        // Use getFirestore() directly
        const configSnapshot = await getFirestore().collection('config').doc('appSettings').get();
        if (!configSnapshot.exists) {
            logger.warn('[getAppConfig] appSettings document not found.');
            return null; // Or return default config?
        }
        return configSnapshot.data();
    } catch (error) {
        logger.error('[getAppConfig] Error fetching app config:', error);
        throw error;
    }
}

/**
 * Update application configuration
 * @param {Object} configData - New configuration data
 * @returns {Promise<Object>} - Updated configuration
 */
export async function updateAppConfig(configData) {
    // Remove !db check
    try {
        // Use getFirestore() directly
        const configRef = getFirestore().collection('config').doc('appSettings');
        await configRef.set(configData, { merge: true }); // Use set with merge to update or create
        logger.info('[updateAppConfig] App config updated successfully.');
        return true;
    } catch (error) {
        logger.error('[updateAppConfig] Error updating app config:', error);
        return false;
    }
}

/**
 * Update a player's karma based on Slack ID.
 * Finds the player doc ID first, then calls the appropriate update mechanism.
 * @param {string} slackId - Slack User ID.
 * @param {number} karmaChange - Amount to change karma by (can be negative).
 * @returns {Promise<boolean>} - True on success, false otherwise.
 */
export async function updatePlayerKarma(slackId, karmaChange) {
    logger.debug(`[updatePlayerKarma] Attempting karma update for Slack ID ${slackId} by ${karmaChange}`);
    try {
        // Use getFirestore() directly
        const playersRef = getFirestore().collection('players');
        // Assume the document ID is the slackId based on getOrCreatePlayer logic
        const playerDocRef = playersRef.doc(slackId); 

        // *** Use Atomic Increment on 'karma' field ***
        await playerDocRef.update({
            karma: FieldValue.increment(karmaChange), // FIX: Use 'karma' field
            updatedAt: FieldValue.serverTimestamp()
        });

        logger.info(`[updatePlayerKarma] Successfully updated karma for Slack ID ${slackId} by ${karmaChange}.`);
        return true; // Return true on success
    } catch (error) {
        // Check if the error is due to the document not existing
        if (error.code === 5 || error.message.includes('NOT_FOUND')) { // Firestore NOT_FOUND error code is 5
            logger.error(`[updatePlayerKarma] Player document for Slack ID ${slackId} not found during atomic update.`);
            // Decide how to handle - rethrow is often safest.
            throw new Error(`Player document not found for Slack ID ${slackId}`);
        } else {
            // Log other Firestore errors
            logger.error(`Error updating karma via FieldValue.increment for Slack ID ${slackId}:`, error);
            // throw error; // Rethrow unexpected errors // <<< REMOVE throw >>>
            return false; // Return false on error
        }
    }
}

/**
 * Get an order by its Firestore Document ID
 * @param {string} orderId - Firestore Document ID
 * @returns {Promise<Object|null>} - Order data object or null if not found
 */
export async function getOrderById(orderId) {
  try {
    logger.debug(`[getOrderById] Fetching order with ID: ${orderId}`);
    const orderRef = getFirestore().collection('orders').doc(orderId);
    const docSnap = await orderRef.get();
    if (docSnap.exists) {
      logger.debug(`[getOrderById] Order found for ID: ${orderId}`);
      return { id: docSnap.id, ...docSnap.data() };
    } else {
      logger.warn(`[getOrderById] No order found with ID: ${orderId}`);
      return null;
    }
  } catch (error) {
    logger.error(`Error getting order by ID ${orderId}:`, error);
    throw error; // Re-throw error to be caught by caller
  }
}

/**
 * Update a player's reputation based on Slack ID.
 * @param {string} slackId - Slack User ID.
 * @param {number} reputationChange - Amount to change reputation by (should always be positive).
 * @returns {Promise<boolean>} - True on success, false otherwise.
 */
export async function updatePlayerReputation(slackId, reputationChange) {
  if (reputationChange <= 0) {
    logger.warn(`[updatePlayerReputation] Attempted to update reputation for Slack ID ${slackId} with non-positive value: ${reputationChange}. Skipping.`);
    return true; // Not an error
  }
  logger.debug(`[updatePlayerReputation] Attempting reputation update for Slack ID ${slackId} by ${reputationChange}`);
  try {
    const playersRef = getFirestore().collection('players');
    const playerDocRef = playersRef.doc(slackId);

    await playerDocRef.update({
      reputation: FieldValue.increment(reputationChange), // FIX: Use 'reputation' field
      updatedAt: FieldValue.serverTimestamp()
    });

    logger.info(`[updatePlayerReputation] Successfully updated reputation for Slack ID ${slackId} by ${reputationChange}.`);
    return true; // Return true on success
  } catch (error) {
    if (error.code === 5 || error.message.includes('NOT_FOUND')) {
      logger.error(`[updatePlayerReputation] Player document for Slack ID ${slackId} not found during atomic update.`);
    } else {
      logger.error(`Error updating reputation via FieldValue.increment for Slack ID ${slackId}:`, error);
    }
    return false; // Return false on error
  }
}

// <<< REMOVE this block >>>
/*
module.exports = {
  // Player functions
  getPlayerBySlackId,
  createPlayer,
  getOrCreatePlayer,
  updatePlayerKarma,
  updatePlayerOrderCount,
  updatePlayerDeliveryCount,
  calculatePlayerTitle,
  getLeaderboard,
  updatePlayerCapabilities,
  updatePlayerLocation,
  
  // Order functions
  createOrder,
  updateOrder,
  getOrdersByStatus,
  getPlayerOrders,
  
  // Redemption code functions
  createRedemptionCode,
  redeemCode,

  // Config functions
  getAppConfig,
  updateAppConfig,

  // Firebase references (usually not exported directly)
  // db, 
  // admin, 
  
  // Reference to constants (usually not needed if imported where used)
  // ORDER_STATUS,
  // KARMA_COSTS
}; 
*/ 