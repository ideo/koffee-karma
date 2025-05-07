import admin from 'firebase-admin';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { logger } from '../utils/logger.js';
import { REPUTATION_TITLES } from '../utils/constants.js';

// Ensure Firebase Admin is initialized only once
if (!admin.apps.length) {
  try {
    // Explicitly pass undefined to force default credential discovery for the environment
    admin.initializeApp(undefined);
    console.log('Firebase Admin SDK initialized successfully (forcing default creds) in firebase.js.');
  } catch (initError) {
    console.error('Error initializing Firebase Admin SDK in firebase.js:', initError);
  }
} else {
  console.log('Firebase Admin SDK already initialized.');
}

export const db = getFirestore();

/**
 * Determines the player's title based on their reputation score.
 * @param {number} reputation The player's reputation score.
 * @returns {string} The corresponding title string.
 */
export const getPlayerTitle = (reputation) => {
  // Iterate backwards through the sorted titles array
  for (let i = REPUTATION_TITLES.length - 1; i >= 0; i--) {
    if (reputation >= REPUTATION_TITLES[i].minReputation) {
      return REPUTATION_TITLES[i].title;
    }
  }
  // Fallback to the first title if something goes wrong (shouldn't happen with minReputation: 0)
  return REPUTATION_TITLES[0]?.title || 'Unknown Title';
};

/**
 * Fetches or creates a player document in Firestore.
 * Handles fetching user info from Slack if needed.
 * @param {string} userId The Slack User ID of the player.
 * @param {object} [client] Optional Bolt client instance for fetching user info.
 * @returns {Promise<{player: object|null, isNew: boolean, playerRef: object|null}>} An object containing the player data, a flag indicating if the player was newly created, and the document reference.
 */
const getOrCreatePlayer = async (userId, client) => {
  if (!userId) {
    logger.error('[getOrCreatePlayer] userId is required.');
    return { player: null, isNew: false, playerRef: null };
  }

  const playerRef = db.collection('players').doc(userId);
  logger.debug(`[getOrCreatePlayer] Attempting direct lookup for userId: ${userId}`);

  try {
    const doc = await playerRef.get();

    if (doc.exists) {
      logger.debug(`[getOrCreatePlayer] Found existing player via direct lookup: ${userId}`);
      const playerData = doc.data();
      const currentReputation = playerData.reputation || 0; // Use existing reputation or default to 0
      const calculatedTitle = getPlayerTitle(currentReputation);
      // Update title only if it's different or missing
      if (playerData.title !== calculatedTitle) {
        logger.info(`[getOrCreatePlayer] Updating title for existing player ${userId} from "${playerData.title}" to "${calculatedTitle}" based on reputation ${currentReputation}.`);
        // Non-blocking update, fire-and-forget for this scenario
        playerRef.update({ title: calculatedTitle, updatedAt: FieldValue.serverTimestamp() })
                 .catch(err => logger.error(`[getOrCreatePlayer] Failed async title update for ${userId}:`, err));
        playerData.title = calculatedTitle; // Update the returned object immediately
      }
      return { player: playerData, isNew: false, playerRef };
    } else {
      logger.warn(`[getOrCreatePlayer] Player ${userId} not found. Attempting to create.`);
      let userName = 'Unknown User'; // Default name

      // Attempt to fetch user info from Slack if client is provided
      if (client) {
        try {
          logger.debug(`[getOrCreatePlayer] Fetching Slack user info for ${userId}`);
          const userInfo = await client.users.info({ user: userId });
          if (userInfo.ok) {
            userName = userInfo.user?.real_name || userInfo.user?.name || userName;
            logger.debug(`[getOrCreatePlayer] Fetched Slack user name: ${userName}`);
          } else {
            logger.warn(`[getOrCreatePlayer] Failed to fetch Slack user info for ${userId}: ${userInfo.error}`);
          }
        } catch (slackError) {
          logger.error(`[getOrCreatePlayer] Error calling client.users.info for ${userId}:`, slackError);
        }
      }

      // <<< Calculate initial title based on 0 reputation >>>
      const initialTitle = getPlayerTitle(0);
      logger.info(`Creating new player document for userId: ${userId} with name: ${userName}`);
      const newPlayerData = {
        userId: userId,
        name: userName,
        karma: 0, // Switched to karma/reputation fields
        reputation: 0,
        ordersRequestedCount: 0,
        deliveriesCompletedCount: 0,
        title: initialTitle, // <<< Use calculated initial title >>>
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        capabilities: [],
        // active: true // Field seems missing from previous structure, omit for now
      };

      await playerRef.set(newPlayerData);
      logger.info(`[getOrCreatePlayer] Successfully created new player ${userId} with title "${initialTitle}".`);
      // Return the newly created data, including the ID in the player object if needed by caller
      return { player: { id: playerRef.id, ...newPlayerData }, isNew: true, playerRef };
    }
  } catch (error) {
    logger.error(`[getOrCreatePlayer] Error in getOrCreatePlayer for userId ${userId}:`, error);
    if (error.code === 'permission-denied') {
      logger.error('[getOrCreatePlayer] Firestore permission denied. Check Firestore rules.');
    }
    // Propagate error or return null based on desired handling
    return { player: null, isNew: false, playerRef: null }; // Indicate failure
  }
};

/**
 * Updates a player's karma balance atomically.
 * @param {string} userId The Slack User ID of the player.
 * @param {number} amount The amount to add (positive) or subtract (negative) from the karma balance.
 * @returns {Promise<boolean>} True if the update was successful, false otherwise.
 */
const updatePlayerKarmaBalance = async (userId, amount) => {
  if (!userId || typeof amount !== 'number') {
    logger.error('[updatePlayerKarmaBalance] Invalid parameters:', { userId, amount });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      karmaBalance: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerKarmaBalance] Atomically updated karma balance for user ${userId} by ${amount}.`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerKarmaBalance] Error updating balance for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerKarmaBalance] Player doc not found for ${userId}.`);
    }
    return false;
  }
};

/**
 * Updates a player's karma legacy score atomically.
 * @param {string} userId The Slack User ID of the player.
 * @param {number} amount The amount to add to the karma legacy score (must be positive).
 * @returns {Promise<boolean>} True if the update was successful, false otherwise.
 */
const updatePlayerKarmaLegacy = async (userId, amount) => {
  if (!userId || typeof amount !== 'number' || amount < 0) {
    logger.error('[updatePlayerKarmaLegacy] Invalid parameters:', { userId, amount });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      karmaLegacy: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerKarmaLegacy] Atomically updated karma legacy for user ${userId} by ${amount}.`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerKarmaLegacy] Error updating legacy for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerKarmaLegacy] Player doc not found for ${userId}.`);
    }
    return false;
  }
};

/**
 * Updates a player's completed delivery count atomically.
 * NOTE: Assumes a field like 'deliveriesCompletedCount' exists.
 * @param {string} userId The Slack User ID of the player.
 * @returns {Promise<boolean>} True if the update was successful, false otherwise.
 */
const updatePlayerDeliveryCount = async (userId) => {
  if (!userId) {
    logger.error('[updatePlayerDeliveryCount] Invalid parameters:', { userId });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      deliveriesCompletedCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerDeliveryCount] Atomically incremented deliveriesCompletedCount for user ${userId}.`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerDeliveryCount] Error updating deliveriesCompletedCount for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerDeliveryCount] Player document for user ${userId} not found during delivery count update.`);
    }
    return false;
  }
};

/**
 * Updates a player's requested order count atomically.
 * @param {string} userId The Slack User ID of the player.
 * @returns {Promise<boolean>} True if the update was successful, false otherwise.
 */
const updatePlayerOrdersRequestedCount = async (userId) => {
  if (!userId) {
    logger.error('[updatePlayerOrdersRequestedCount] Invalid parameters:', { userId });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      ordersRequestedCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerOrdersRequestedCount] Atomically incremented ordersRequestedCount for user ${userId}.`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerOrdersRequestedCount] Error updating ordersRequestedCount for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerOrdersRequestedCount] Player document for user ${userId} not found during requested count update.`);
    }
    return false;
  }
};

/**
 * Updates a player's title.
 * @param {string} userId The Slack User ID of the player.
 * @param {string} newTitle The new title for the player.
 * @returns {Promise<boolean>} True if the update was successful, false otherwise.
 */
const updatePlayerTitle = async (userId, newTitle) => {
  if (!userId || !newTitle) {
    logger.error('[updatePlayerTitle] Invalid parameters:', { userId, newTitle });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      title: newTitle,
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerTitle] Updated title for user ${userId} to "${newTitle}".`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerTitle] Error updating title for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerTitle] Player doc not found for ${userId}.`);
    }
    return false;
  }
};

/**
 * Creates a new order document in Firestore.
 * @param {object} orderData The data for the new order.
 * @returns {Promise<admin.firestore.DocumentReference>} The reference to the newly created document.
 */
const createOrder = async (orderData) => {
  if (!orderData) {
    throw new Error('[createOrder] orderData is required.');
  }
  // Add createdAt and updatedAt timestamps if not already present
  const dataWithTimestamps = {
    ...orderData,
    createdAt: orderData.createdAt || FieldValue.serverTimestamp(),
    updatedAt: orderData.updatedAt || FieldValue.serverTimestamp(),
  };
  try {
    const orderRef = await db.collection('orders').add(dataWithTimestamps);
    logger.info(`[createOrder] Successfully created order document ${orderRef.id}.`);
    return orderRef;
  } catch (error) {
    logger.error('[createOrder] Error creating order document:', error);
    throw error; // Re-throw the error for the caller to handle
  }
};

// --- ADDED: Get Order Reference by Message Timestamp --- 
/**
 * Finds an order document reference based on its slackMessageTs.
 * @param {string} messageTs The Slack message timestamp.
 * @returns {Promise<admin.firestore.DocumentReference|null>} Document reference or null if not found.
 */
const getOrderRefByMessageTs = async (messageTs) => {
  if (!messageTs) {
    logger.error('[getOrderRefByMessageTs] messageTs is required.');
    return null;
  }
  const ordersRef = db.collection('orders');
  const query = ordersRef.where('slackMessageTs', '==', messageTs).limit(1);
  try {
    const snapshot = await query.get();
    if (snapshot.empty) {
      logger.warn(`[getOrderRefByMessageTs] No order found with slackMessageTs: ${messageTs}`);
      return null;
    }
    // Return the DocumentReference of the first matching document
    logger.debug(`[getOrderRefByMessageTs] Found order ref for ts ${messageTs}: ${snapshot.docs[0].ref.path}`);
    return snapshot.docs[0].ref;
  } catch (error) {
    logger.error(`[getOrderRefByMessageTs] Error querying orders by slackMessageTs ${messageTs}:`, error);
    return null;
  }
};

// --- ADDED: Generic Order Update Function --- 
/**
 * Updates an order document by its Firestore ID.
 * @param {string} orderDbId The Firestore document ID of the order.
 * @param {object} updateData An object containing the fields to update.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
const updateOrder = async (orderDbId, updateData) => {
   if (!orderDbId || !updateData || Object.keys(updateData).length === 0) {
     logger.error('[updateOrder] orderDbId and updateData are required.', { orderDbId, updateData });
     return false;
   }
   const orderRef = db.collection('orders').doc(orderDbId);
   const dataWithTimestamp = {
     ...updateData,
     updatedAt: FieldValue.serverTimestamp()
   };
   try {
     await orderRef.update(dataWithTimestamp);
     logger.info(`[updateOrder] Successfully updated order ${orderDbId}.`);
     return true;
   } catch (error) {
     logger.error(`[updateOrder] Error updating order ${orderDbId}:`, error);
     if (error.code === 'NOT_FOUND') {
        logger.warn(`[updateOrder] Order doc not found: ${orderDbId}`);
     }
     return false;
   }
 };

 // Simplified function specifically for status updates if preferred
 const updateOrderStatus = async (orderDbId, statusData) => {
    return updateOrder(orderDbId, statusData); // Reuses the generic update function
 };

 // Function to get player by Slack ID (useful for targeted order flow)
 const getPlayerBySlackId = async (slackId) => {
   if (!slackId) return null;
   try {
      const playerRef = db.collection('players').doc(slackId);
      const doc = await playerRef.get();
      return doc.exists ? doc.data() : null;
   } catch (error) {
      logger.error(`[getPlayerBySlackId] Error fetching player ${slackId}:`, error);
      return null;
   }
 };

// --- ADDED: Function to get top N players by legacy karma --- 
/**
 * Fetches the top N players sorted by karmaLegacy descending.
 * @param {number} limit The maximum number of players to fetch.
 * @returns {Promise<Array<object>>} An array of player data objects.
 */
const getPlayersSortedByLegacy = async (limit = 5) => {
  try {
    const snapshot = await db.collection('players')
      .orderBy('karmaLegacy', 'desc')
      .limit(limit)
      .get();
    
    const players = [];
    snapshot.forEach(doc => players.push(doc.data()));
    logger.info(`[getPlayersSortedByLegacy] Fetched top ${players.length} players.`);
    return players;
  } catch (error) {
    logger.error('[getPlayersSortedByLegacy] Error fetching leaderboard:', error);
    return []; // Return empty array on error
  }
};

// --- ADDED: Redeem Code Logic --- 
/**
 * Redeems a code, updates counts, and returns the karma value.
 * Handles validation and error messaging internally.
 * @param {string} code The redemption code (uppercase).
 * @param {string} userId The user attempting to redeem.
 * @returns {Promise<number|null>} Karma value if successful, null otherwise.
 */
const redeemCode = async (code, userId) => {
  if (!code || !userId) return null; // Basic validation

  const codeRef = db.collection('redemptionCodes').doc(code);
  const playerRef = db.collection('players').doc(userId);

  try {
    return await db.runTransaction(async (transaction) => {
      const codeDoc = await transaction.get(codeRef);
      const playerDoc = await transaction.get(playerRef); // Get player doc for title update later?

      // 1. Validate Code Existence
      if (!codeDoc.exists) {
        logger.warn(`[redeemCode] User ${userId} tried invalid code: ${code}`);
        // Throw error to be caught and handled by caller?
        // Or handle messaging here? Let's throw for now.
        throw new Error('Invalid redemption code.'); 
      }

      const codeData = codeDoc.data();
      const redemptions = codeData.redemptions || [];

      // 2. Check Max Redemptions
      if (codeData.maxRedemptions && redemptions.length >= codeData.maxRedemptions) {
        logger.warn(`[redeemCode] Code ${code} already reached max redemptions (${codeData.maxRedemptions}). Attempt by ${userId}.`);
        throw new Error('This code has already reached its maximum number of redemptions.');
      }

      // 3. Check if User Already Redeemed
      if (redemptions.some(r => r.userId === userId)) {
        logger.warn(`[redeemCode] User ${userId} already redeemed code ${code}.`);
        throw new Error('You have already redeemed this code.');
      }

      // --- Validation Passed --- 

      // Add redemption record
      const newRedemption = { userId, timestamp: FieldValue.serverTimestamp() };
      transaction.update(codeRef, { 
        redemptions: FieldValue.arrayUnion(newRedemption),
        updatedAt: FieldValue.serverTimestamp() 
      });

      logger.info(`[redeemCode] User ${userId} successfully validated code ${code}. Returning value: ${codeData.karmaBalanceValue}`);
      // Return the karma value to be awarded by the caller
      return codeData.karmaBalanceValue;
    });
  } catch (error) {
    logger.error(`[redeemCode] Transaction failed for user ${userId} redeeming code ${code}:`, error.message);
    // Send ephemeral error message from here?
    // The calling handler should probably handle messaging based on the return value.
    // Let's just return null to indicate failure.
    // TODO: Improve error message propagation back to the handler.
     throw error; // Re-throw for the handler to catch and send specific messages
  }
};

// --- ADDED: Get Order By ID function --- 
/**
 * Fetches a single order document by its Firestore ID.
 * @param {string} orderDbId The Firestore document ID of the order.
 * @returns {Promise<object|null>} The order data object or null if not found.
 */
const getOrderById = async (orderDbId) => {
  if (!orderDbId) {
    logger.error('[getOrderById] orderDbId is required.');
    return null;
  }
  logger.debug(`[getOrderById] Fetching order with ID: ${orderDbId}`);
  const orderRef = db.collection('orders').doc(orderDbId);
  try {
    const doc = await orderRef.get();
    if (!doc.exists) {
      logger.warn(`[getOrderById] Order document not found for ID: ${orderDbId}`);
      return null;
    }
    logger.debug(`[getOrderById] Order found for ID: ${orderDbId}`);
    // Return the document data along with its ID
    return { id: doc.id, ...doc.data() };
  } catch (error) {
    logger.error(`[getOrderById] Error fetching order ${orderDbId}:`, error);
    return null;
  }
};

// --- ADDED: Update Player Capabilities --- 
/**
 * Updates the capabilities array for a player.
 * @param {string} userId The Slack User ID of the player.
 * @param {Array<string>} capabilitiesArray The new array of capability strings.
 * @returns {Promise<boolean>} True if successful, false otherwise.
 */
const updatePlayerCapabilities = async (userId, capabilitiesArray) => {
  if (!userId || !Array.isArray(capabilitiesArray)) {
    logger.error('[updatePlayerCapabilities] Invalid parameters:', { userId, capabilitiesArray });
    return false;
  }
  const playerRef = db.collection('players').doc(userId);
  try {
    await playerRef.update({
      capabilities: capabilitiesArray, // Set the capabilities field directly
      updatedAt: FieldValue.serverTimestamp(),
    });
    logger.info(`[updatePlayerCapabilities] Successfully updated capabilities for user ${userId}.`);
    return true;
  } catch (error) {
    logger.error(`[updatePlayerCapabilities] Error updating capabilities for user ${userId}:`, error);
    if (error.code === 'NOT_FOUND') {
      logger.warn(`[updatePlayerCapabilities] Player doc not found for ${userId}.`);
    }
    return false;
  }
};

// Export all database utility functions
export const database = {
  getOrCreatePlayer,
  updatePlayerKarmaBalance,
  updatePlayerKarmaLegacy,
  updatePlayerDeliveryCount,
  updatePlayerOrdersRequestedCount,
  updatePlayerTitle,
  createOrder,
  getOrderRefByMessageTs,
  updateOrder,
  updateOrderStatus,
  getPlayerBySlackId,
  getPlayersSortedByLegacy,
  redeemCode,
  getOrderById,
  updatePlayerCapabilities
}; 