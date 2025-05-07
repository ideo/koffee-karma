const admin = require('firebase-admin');
const serviceAccount = require('./functions/serviceAccountKey.json'); // <<<--- UPDATED path to service account key

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const oldCollectionName = 'redemptionCodes'; // <<<--- Read from the ORIGINAL collection
const newCollectionName = 'redemptionCodes_MIGRATED'; // <<<--- Write to a NEW migrated collection

async function migrateCodes() {
  console.log(`Starting migration from ${oldCollectionName} to ${newCollectionName}...`);

  const oldCodesSnapshot = await db.collection(oldCollectionName).get();

  if (oldCodesSnapshot.empty) {
    console.log(`No documents found in ${oldCollectionName}. Nothing to migrate.`);
    return;
  }

  let migratedCount = 0;
  const batch = db.batch(); // Use batch writes for efficiency

  for (const oldDoc of oldCodesSnapshot.docs) {
    const oldData = oldDoc.data();
    const codeId = oldData.code; // Use the 'code' field value as the new document ID

    if (!codeId) {
      console.warn(`Skipping document with ID ${oldDoc.id} as it lacks a 'code' field.`);
      continue;
    }

    console.log(`Processing code: ${codeId} (Old ID: ${oldDoc.id})`);

    const redeemers = [];
    let redeemedCount = 0;

    // Handle potential existing redemption based on old structure
    if (oldData.redeemedBy) {
        redeemedCount = 1; // Assume only one redemption was possible/tracked
        let redemptionTimestamp = oldData.redeemedTimestamp;
        // Use updatedAt as fallback if redeemedTimestamp is null but redeemedBy exists
        if (!redemptionTimestamp && oldData.updatedAt) {
            redemptionTimestamp = oldData.updatedAt;
            console.log(`  -> Using updatedAt for redemption timestamp for code ${codeId}`);
        }
        // Only add if we have a user and a valid timestamp
        if (oldData.redeemedBy && redemptionTimestamp instanceof admin.firestore.Timestamp) {
             redeemers.push({
                userId: oldData.redeemedBy, // Assuming redeemedBy stored the userId directly
                timestamp: redemptionTimestamp
            });
             console.log(`  -> Added redeemer: ${oldData.redeemedBy}`);
        } else {
            console.warn(`  -> Could not add redeemer for code ${codeId} due to missing/invalid data (redeemedBy: ${oldData.redeemedBy}, timestamp: ${oldData.redeemedTimestamp})`);
             // Decide if redeemedCount should still be 1 if we couldn't add to array
             // For now, we keep redeemedCount = 1 if redeemedBy was set, even if timestamp fails
        }
    }


    const newData = {
      code: codeId,
      label: "Migrated Code", // Default label
      karmaValue: oldData.karmaValue || 0, // Use existing value or default to 0
      maxRedemptions: 1, // Default max redemptions for migrated codes
      redeemedCount: redeemedCount,
      redeemers: redeemers,
      perUserLimit: 1, // Default per-user limit for migrated codes
      expiresAt: null, // Default
      activeFrom: null, // Default
      createdAt: oldData.createdAt || admin.firestore.FieldValue.serverTimestamp(), // Use existing or set new
      updatedAt: oldData.updatedAt || admin.firestore.FieldValue.serverTimestamp() // Use existing or set new
    };

    const newDocRef = db.collection(newCollectionName).doc(codeId);
    batch.set(newDocRef, newData); // Add set operation to the batch
    migratedCount++;
  }

  // Commit the batch
  await batch.commit();
  console.log(`
Migration complete. ${migratedCount} codes processed and written to ${newCollectionName}.`);
  console.log(`
Please verify the data in the '${newCollectionName}' collection.`);
  console.log(`Your original '${oldCollectionName}' collection has NOT been deleted.`);
}

migrateCodes().catch(error => {
  console.error("Migration failed:", error);
}); 