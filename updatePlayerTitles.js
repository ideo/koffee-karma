import admin from 'firebase-admin';
import { createRequire } from 'module';

// --- Firestore and Title Logic Setup ---
const require = createRequire(import.meta.url);
const serviceAccount = require('./functions/serviceAccountKey.json'); // Assumes script is in project root

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
const db = admin.firestore();

// Manually define REPUTATION_TITLES and getPlayerTitle here
// to make the script self-contained and avoid import issues with utils/constants.js pathing
// when running directly with node from project root.

const REPUTATION_TITLES = [
  { minReputation: 0, title: 'Parched' },
  { minReputation: 1, title: 'Cold Pour' },
  { minReputation: 3, title: 'The Initiate' },
  { minReputation: 5, title: 'Keeper of the Drip' },
  { minReputation: 8, title: 'Roast Prophet' },
  { minReputation: 12, title: 'Foam Scryer' },
  { minReputation: 16, title: 'Café Shade Mystic' },
  { minReputation: 20, title: 'The Last Barista' }
];

const getPlayerTitle = (reputation) => {
  for (let i = REPUTATION_TITLES.length - 1; i >= 0; i--) {
    if (reputation >= REPUTATION_TITLES[i].minReputation) {
      return REPUTATION_TITLES[i].title;
    }
  }
  return REPUTATION_TITLES[0]?.title || 'Unknown Title';
};
// --- End Firestore and Title Logic Setup ---

async function updateAllPlayerTitles() {
  console.log('Starting script to update player titles...');
  const playersRef = db.collection('players');
  let playersChecked = 0;
  let playersUpdated = 0;
  const allPlayerUpdates = []; // For collecting update promises

  try {
    const snapshot = await playersRef.get();

    if (snapshot.empty) {
      console.log('No players found in the "players" collection.');
      return;
    }

    console.log(`Found ${snapshot.size} player documents to check.`);

    snapshot.forEach(doc => {
      playersChecked++;
      const playerData = doc.data();
      const currentReputation = playerData.reputation || 0; // Default to 0 if missing
      const currentTitle = playerData.title;
      const correctTitle = getPlayerTitle(currentReputation);

      if (currentTitle !== correctTitle) {
        console.log(`Player ${doc.id} (${playerData.name || 'N/A Name'}): Current title "${currentTitle}", Correct title "${correctTitle}" (Rep: ${currentReputation}). Scheduling update.`);
        
        const playerDocRef = playersRef.doc(doc.id);
        allPlayerUpdates.push(
          playerDocRef.update({
            title: correctTitle,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }).then(() => {
            playersUpdated++;
          }).catch(err => {
            console.error(`Failed to update title for player ${doc.id}:`, err);
          })
        );
      } else {
        // console.log(`Player ${doc.id} (${playerData.name || 'N/A Name'}): Title "${currentTitle}" is already correct (Rep: ${currentReputation}).`);
      }
    });

    // Wait for all updates to complete
    if (allPlayerUpdates.length > 0) {
        console.log(`Waiting for ${allPlayerUpdates.length} player title updates to complete...`);
        await Promise.all(allPlayerUpdates);
    }

    console.log('--------------------------------------------------');
    console.log('Player title update script finished.');
    console.log(`Total players checked: ${playersChecked}`);
    console.log(`Total players whose titles were updated: ${playersUpdated}`);

  } catch (error) {
    console.error('Error running updateAllPlayerTitles script:', error);
    process.exitCode = 1;
  }
}

updateAllPlayerTitles().then(() => {
  console.log('Script execution complete.');
}).catch(err => {
  console.error('Unhandled error in script execution:', err);
}); 