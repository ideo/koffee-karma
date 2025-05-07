const admin = require('firebase-admin');
const serviceAccount = require('./functions/serviceAccountKey.json'); // Ensure this path is still correct

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const sourceCollectionName = 'redemptionCodes_MIGRATED';
const targetCollectionName = 'redemptionCodes';

async function copyCollection() {
  console.log(`Starting copy from ${sourceCollectionName} to ${targetCollectionName}...`);

  const sourceSnapshot = await db.collection(sourceCollectionName).get();

  if (sourceSnapshot.empty) {
    console.log(`Source collection ${sourceCollectionName} is empty. Nothing to copy.`);
    return;
  }

  let copiedCount = 0;
  const batch = db.batch();

  sourceSnapshot.forEach(doc => {
    const docData = doc.data();
    const targetDocRef = db.collection(targetCollectionName).doc(doc.id); // Use the same document ID
    batch.set(targetDocRef, docData);
    copiedCount++;
    console.log(`  -> Preparing to copy document: ${doc.id}`);
  });

  // Commit the batch
  await batch.commit();
  console.log(`
Copy complete. ${copiedCount} documents copied from ${sourceCollectionName} to ${targetCollectionName}.`);
  console.log(`
Please verify the data in the new '${targetCollectionName}' collection.`);
  console.log(`Once verified, you can manually delete the '${sourceCollectionName}' collection.`);
}

copyCollection().catch(error => {
  console.error("Collection copy failed:", error);
}); 