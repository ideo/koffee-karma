/**
 * Firestore Player Data Migration Script
 * 
 * Run this script ONCE after deploying code changes that rename
 * 'karmaBalance' to 'karma' and 'karmaLegacy' to 'reputation'.
 * 
 * Usage: node scripts/migratePlayerData.js /path/to/your/serviceAccountKey.json
 */

import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

// --- Script Configuration ---
const BATCH_SIZE = 100; // Process players in batches
// --- End Configuration ---

async function migratePlayerData() {
  // 1. Initialize Firebase Admin SDK
  const serviceAccountRelativePath = process.argv[2];
  if (!serviceAccountRelativePath) {
    console.error('Error: Service account key path is required.');
    console.error('Usage: node scripts/migratePlayerData.js path/to/your/serviceAccountKey.json');
    process.exit(1);
  }

  // Resolve the absolute path based on the script's location
  const serviceAccountPath = path.resolve(process.cwd(), serviceAccountRelativePath);
  console.log(`Resolved service account path: ${serviceAccountPath}`);

  try {
    if (!fs.existsSync(serviceAccountPath)) {
        throw new Error(`Service account file not found at path: ${serviceAccountPath}`);
    }
    const serviceAccountJson = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(serviceAccountJson);
    
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // Add your databaseURL if needed, though often inferred:
      // databaseURL: 'https://YOUR_PROJECT_ID.firebaseio.com' 
    });
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('Error initializing Firebase Admin SDK:', error);
    console.error('Please ensure the path to your service account key is correct and the file is valid JSON.');
    if (error.message.includes('not found at path')) {
         // Already logged above
    } else if (error instanceof SyntaxError) {
        console.error(`Error: The service account file at ${serviceAccountPath} is not valid JSON.`);
    }
    process.exit(1);
  }

  const db = getFirestore();
  const playersRef = db.collection('players');
  let totalProcessed = 0;
  let documentsMigrated = 0;
  let errorsEncountered = 0;

  console.log('Starting player data migration...');

  try {
    let lastVisible = null;
    let query = playersRef.orderBy('__name__').limit(BATCH_SIZE);

    while (true) {
      const snapshot = await query.get();
      if (snapshot.empty) {
        console.log('No more players found. Migration process complete.');
        break;
      }

      console.log(`Processing batch of ${snapshot.size} players...`);
      const batch = db.batch();
      let batchHasUpdates = false;

      snapshot.forEach(doc => {
        totalProcessed++;
        const data = doc.data();
        const updateData = {};
        let needsUpdate = false;

        // Check if karmaBalance exists and karma doesn't (or is different)
        if (data.hasOwnProperty('karmaBalance') && data.karma !== data.karmaBalance) {
            console.log(`  Migrating karmaBalance (${data.karmaBalance}) for player ${doc.id}`);
            updateData.karma = data.karmaBalance;
            updateData.karmaBalance = FieldValue.delete(); 
            needsUpdate = true;
        } else if (data.hasOwnProperty('karmaBalance') && data.karma === data.karmaBalance) {
            // Field names match, just delete the old one
            console.log(`  Deleting redundant karmaBalance for player ${doc.id}`);
            updateData.karmaBalance = FieldValue.delete();
            needsUpdate = true;
        }

        // Check if karmaLegacy exists and reputation doesn't (or is different)
        if (data.hasOwnProperty('karmaLegacy') && data.reputation !== data.karmaLegacy) {
            console.log(`  Migrating karmaLegacy (${data.karmaLegacy}) for player ${doc.id}`);
            updateData.reputation = data.karmaLegacy;
            updateData.karmaLegacy = FieldValue.delete();
            needsUpdate = true;
        } else if (data.hasOwnProperty('karmaLegacy') && data.reputation === data.karmaLegacy) {
            // Field names match, just delete the old one
             console.log(`  Deleting redundant karmaLegacy for player ${doc.id}`);
            updateData.karmaLegacy = FieldValue.delete();
            needsUpdate = true;
        }

        if (needsUpdate) {
          batch.update(doc.ref, updateData);
          batchHasUpdates = true;
          documentsMigrated++;
        }
      });

      if (batchHasUpdates) {
        try {
          await batch.commit();
          console.log(`  Batch committed successfully.`);
        } catch (batchError) {
          console.error('  Error committing batch:', batchError);
          errorsEncountered += snapshot.size; // Approximate error count
        }
      } else {
         console.log('  No updates needed in this batch.');
      }

      // Prepare for the next batch
      lastVisible = snapshot.docs[snapshot.docs.length - 1];
      query = playersRef.orderBy('__name__').startAfter(lastVisible).limit(BATCH_SIZE);
    } // End while loop

  } catch (error) {
    console.error('An error occurred during the migration process:', error);
    errorsEncountered++; // Count this as an error
  }

  console.log('\n--- Migration Summary ---');
  console.log(`Total Players Processed: ${totalProcessed}`);
  console.log(`Documents Migrated/Updated: ${documentsMigrated}`);
  console.log(`Errors Encountered (approx): ${errorsEncountered}`);

  if (errorsEncountered > 0) {
    console.warn('\nPlease review the logs for errors. Some documents might not have been migrated.');
  }
}

// Run the migration
migratePlayerData().catch(err => {
  console.error("Migration script failed unexpectedly:", err);
  process.exit(1);
}); 