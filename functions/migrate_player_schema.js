import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore'; // Explicit import for FieldValue
import { createRequire } from 'module'; // Import createRequire

// --- Configuration ---
// IMPORTANT: Place your service account key JSON file in the project root
// or update the path accordingly.
// DO NOT COMMIT YOUR SERVICE ACCOUNT KEY TO VERSION CONTROL.

// Use createRequire to load the JSON file
const require = createRequire(import.meta.url);
// Assuming serviceAccountKey.json is now in the SAME directory as the script (functions/)
const serviceAccount = require('./serviceAccountKey.json'); 

// Initialize Firebase Admin SDK
try {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('Firebase Admin SDK initialized successfully.');
} catch (error) {
  console.error('Error initializing Firebase Admin SDK:', error);
  process.exit(1); // Exit if initialization fails
}

const db = admin.firestore();
const playersRef = db.collection('players');
const ordersRef = db.collection('orders'); // Add reference to orders collection
const BATCH_SIZE = 400; // Firestore batch limit is 500, use a slightly smaller size

/**
 * Deletes all documents in the 'orders' collection.
 */
async function deleteAllOrders() {
  console.log('\n--- Starting Order Deletion ---');
  let totalOrdersDeleted = 0;
  let batch = db.batch();
  let operationsInBatch = 0;

  try {
    const snapshot = await ordersRef.limit(BATCH_SIZE).get(); // Get documents in batches
    let docsToDelete = snapshot.docs;

    while (docsToDelete.length > 0) {
      console.log(`   Found ${docsToDelete.length} orders to delete in this batch...`);
      docsToDelete.forEach(doc => {
        batch.delete(doc.ref);
        operationsInBatch++;
        totalOrdersDeleted++;
      });

      console.log(`   Committing batch of ${operationsInBatch} delete operations...`);
      await batch.commit();
      console.log(`   Batch committed successfully. Total deleted so far: ${totalOrdersDeleted}`);

      // Prepare for the next batch
      batch = db.batch();
      operationsInBatch = 0;

      // Get the next batch
      const nextSnapshot = await ordersRef.limit(BATCH_SIZE).get();
      docsToDelete = nextSnapshot.docs;
    }

    console.log('--- Order Deletion Finished ---');
    console.log(`Total orders deleted: ${totalOrdersDeleted}`);
    console.log('---------------------------------');


  } catch (error) {
    console.error('Error during order deletion:', error);
    throw error; // Re-throw to stop the script if deletion fails
  }
}

/**
 * Migrates the schema of documents in the 'players' collection.
 */
async function migratePlayerSchema() {
  console.log('Starting player schema migration...');
  let totalPlayersProcessed = 0;
  let totalPlayersMigrated = 0;
  let batch = db.batch();
  let operationsInBatch = 0;

  try {
    // Get all player documents
    const snapshot = await playersRef.get();
    const totalDocs = snapshot.size;
    console.log(`Found ${totalDocs} player documents to process.`);

    if (totalDocs === 0) {
      console.log('No players found. Migration not needed.');
      return;
    }

    snapshot.forEach((doc) => {
      totalPlayersProcessed++;
      const playerData = doc.data();
      const playerId = doc.id;
      let needsMigration = false;
      const updateData = {};

      // 1. Check for 'karma' -> 'karmaBalance' migration
      if (playerData.hasOwnProperty('karma') && !playerData.hasOwnProperty('karmaBalance')) {
        updateData.karmaBalance = playerData.karma;
        updateData.karma = FieldValue.delete(); // Mark old field for deletion
        needsMigration = true;
        console.log(`   [${playerId}] Migrating karma (${playerData.karma}) -> karmaBalance`);
      }

      // 2. Add 'karmaLegacy' if it doesn't exist
      if (!playerData.hasOwnProperty('karmaLegacy')) {
        updateData.karmaLegacy = 0; // Initialize legacy score
        needsMigration = true;
         console.log(`   [${playerId}] Adding karmaLegacy: 0`);
      }

      // 3. Add 'ordersRequestedCount' if it doesn't exist
      if (!playerData.hasOwnProperty('ordersRequestedCount')) {
         updateData.ordersRequestedCount = 0; // Initialize requested count
         needsMigration = true;
          console.log(`   [${playerId}] Adding ordersRequestedCount: 0`);
      }
      
      // 4. Check for 'deliveries' -> 'deliveriesCompletedCount' migration
      if (playerData.hasOwnProperty('deliveries') && !playerData.hasOwnProperty('deliveriesCompletedCount')) {
        updateData.deliveriesCompletedCount = playerData.deliveries;
        updateData.deliveries = FieldValue.delete(); // Mark old field for deletion
        needsMigration = true;
        console.log(`   [${playerId}] Migrating deliveries (${playerData.deliveries}) -> deliveriesCompletedCount`);
      } else if (!playerData.hasOwnProperty('deliveriesCompletedCount')) {
          // If 'deliveries' didn't exist but 'deliveriesCompletedCount' doesn't either, initialize it
          updateData.deliveriesCompletedCount = 0;
          needsMigration = true;
          console.log(`   [${playerId}] Adding deliveriesCompletedCount: 0`);
      }


      // If any migration step was needed, add the update to the batch
      if (needsMigration) {
        updateData.updatedAt = FieldValue.serverTimestamp(); // Update timestamp
        batch.update(doc.ref, updateData);
        operationsInBatch++;
        totalPlayersMigrated++;

        // Commit batch if full
        if (operationsInBatch >= BATCH_SIZE) {
          console.log(`   Committing batch of ${operationsInBatch} operations...`);
          batch.commit().then(() => {
             console.log(`   Batch committed successfully.`);
          }).catch(err => {
             console.error(`   Error committing batch:`, err);
             // Decide how to handle batch errors - stop? retry? log and continue?
             // For simplicity, we'll log and potentially allow subsequent batches to proceed.
          });
          // Start a new batch
          batch = db.batch();
          operationsInBatch = 0;
        }
      }

      // Progress logging
      if (totalPlayersProcessed % 100 === 0 || totalPlayersProcessed === totalDocs) {
          console.log(`   Processed ${totalPlayersProcessed}/${totalDocs} players...`);
      }
    });

    // Commit any remaining operations in the last batch
    if (operationsInBatch > 0) {
      console.log(`Committing final batch of ${operationsInBatch} operations...`);
      await batch.commit();
      console.log('Final batch committed successfully.');
    }

    console.log('-----------------------------------------');
    console.log('Player schema migration finished!');
    console.log(`Total players processed: ${totalPlayersProcessed}`);
    console.log(`Total players migrated: ${totalPlayersMigrated}`);
    console.log('-----------------------------------------');

  } catch (error) {
    console.error('Error during player schema migration:', error);
    // If error occurred after some batches committed, state might be partial.
    process.exit(1);
  }
}

// --- Main Execution --- 
async function runMigration() {
  try {
    await deleteAllOrders();       // Delete orders first
    await migratePlayerSchema();   // Then migrate players

    console.log('\nScript execution complete.');
    process.exit(0); // Exit cleanly
  } catch (err) {
    console.error('\nUnhandled error running migration script:', err);
    process.exit(1);
  }
}

// Run the combined migration function
runMigration(); 