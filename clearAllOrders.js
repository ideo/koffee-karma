import admin from 'firebase-admin';
import { createRequire } from 'module';

// Helper to require JSON files in ES module
const require = createRequire(import.meta.url);
// Path to service account key, relative to the project root where this script will be
const serviceAccount = require('./functions/serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const ordersCollectionRef = db.collection('orders');

async function deleteAllOrders() {
  console.log('Attempting to delete all documents from the "orders" collection...');
  console.log('This is a destructive operation and cannot be undone.');
  // Adding a small delay with a clear warning, just in case.
  // User has already confirmed, but this is good practice for destructive scripts.
  console.log('Proceeding with deletion in 5 seconds... Press Ctrl+C to abort NOW.');
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('Starting deletion...');

  try {
    let snapshot = await ordersCollectionRef.limit(500).get(); // Process in batches

    if (snapshot.empty) {
      console.log('No documents found in the "orders" collection. Nothing to delete.');
      return 0;
    }

    let deletedCount = 0;
    // Firestore limits batches to 500 operations.
    // This loop will handle collections larger than 500 by re-querying.
    while (!snapshot.empty) {
        const batch = db.batch();
        snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        deletedCount += snapshot.size;
        console.log(`Deleted batch of ${snapshot.size} documents.`);
        if (snapshot.size < 500) { // If last batch was less than 500, we're done.
            break;
        }
        // Re-fetch the next batch
        snapshot = await ordersCollectionRef.limit(500).get();
    }

    console.log(`Successfully deleted ${deletedCount} documents from the "orders" collection.`);
    return deletedCount;

  } catch (error) {
    console.error('Error deleting documents from "orders" collection:', error);
    process.exitCode = 1; // Indicate an error
    return -1; // Indicate error in return
  }
}

deleteAllOrders().then((count) => {
  if (count >= 0) {
    console.log(`Operation finished. ${count} orders deleted.`);
  } else {
    console.log('Operation finished with errors.');
  }
}).catch(err => {
    console.error('Unhandled error in script execution:', err);
}); 