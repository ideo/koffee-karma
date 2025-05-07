import admin from 'firebase-admin';

// --- IMPORTANT: SET EMULATOR HOST BEFORE INITIALIZING APP --- 
const firestoreHost = '127.0.0.1:8082';
process.env['FIRESTORE_EMULATOR_HOST'] = firestoreHost;
console.log(`Set FIRESTORE_EMULATOR_HOST to: ${process.env.FIRESTORE_EMULATOR_HOST}`);

// Initialize Firebase Admin SDK with explicit dummy credentials and project ID
try {
  admin.initializeApp({
    projectId: 'koffee-karma',
    // Explicitly provide dummy credentials to avoid potential fallback to real ones
    credential: admin.credential.applicationDefault(), // Usually picks up env var or default, let's see emulator behavior
  });
  console.log('firebase-admin initialized successfully.');
} catch (initError) {
    console.error('Error initializing firebase-admin:', initError);
    // Attempt initializing with explicit dummy creds if default fails
    console.log('Retrying initialization with dummy credentials... (using project ID: koffee-karma)');
    try {
         admin.initializeApp({
            projectId: 'koffee-karma',
            credential: admin.credential.cert({ // Dummy service account structure
                projectId: 'koffee-karma',
                clientEmail: 'emulator@example.com',
                privateKey: '-----BEGIN PRIVATE KEY-----\nFAKE_KEY\n-----END PRIVATE KEY-----\n',
            }),
        });
        console.log('firebase-admin initialized successfully with dummy cert.');
    } catch (retryError) {
        console.error('FATAL: Could not initialize firebase-admin even with dummy cert:', retryError);
        process.exit(1);
    }
}

const db = admin.firestore();

// --- Log Firestore settings --- 
try {
    const settings = db.settings();
    console.log('Firestore Client Settings:', JSON.stringify(settings, null, 2));
    // Check internal properties (use with caution, may change between versions)
    if (db._settings) {
         console.log('Firestore Internal Settings Host:', db._settings.host);
         console.log('Firestore Internal Settings SSL:', db._settings.ssl);
    } else {
        console.log('Cannot access internal _settings property.');
    }
} catch (e) {
    console.error('Could not retrieve Firestore settings:', e);
}

console.log('Attempting Firestore operations...');

const playersRef = db.collection('players');

async function seedFirestore() {
  console.log('Starting Firestore seed...');

  try {
    // --- Define Player Data --- 
    const playerData = [
      {
        slackId: 'U02EY5S5J0M', // Your Slack ID
        name: 'Neal Boyer', // Your Name
        karmaBalance: 999, 
        karmaLegacy: 1500,
        ordersRequestedCount: 20, // Added sample requested count
        deliveriesCompletedCount: 15, // Added sample delivery count
        title: 'Cold Pour', // Corrected Title for karma: 2
        capabilities: ['WATER', 'DRIP', 'TEA', 'ESPRESSO'], // Use category keys
        active: true,
        // Add other fields if necessary for testing, using server timestamps for dates
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      // Add more test players here if needed
      {
        slackId: 'U_TEST_NOVICE', 
        name: 'Test Novice',
        karmaBalance: 0, 
        karmaLegacy: 0,
        ordersRequestedCount: 0, // Added requested count
        deliveriesCompletedCount: 0, // Added delivery count
        title: 'Parched',
        capabilities: [],
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
       {
        slackId: 'U_TEST_INITIATE', 
        name: 'Test Initiate',
        karmaBalance: 4, 
        karmaLegacy: 10,
        ordersRequestedCount: 1, // Added requested count
        deliveriesCompletedCount: 0, // Added delivery count
        // Title will be calculated if missing, or you can set it
        capabilities: ['DRIP'],
        active: true,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      },
    ];

    // --- Seed Players --- 
    console.log(`Seeding ${playerData.length} players...`);
    const playerPromises = playerData.map(async (player) => {
      // Use slackId as the document ID for easy lookup/overwrite
      const playerDocRef = playersRef.doc(player.slackId);
      try {
        // Use set with merge: true to create or update
        await playerDocRef.set(player, { merge: true });
        console.log(`   Upserted player: ${player.slackId} (${player.name})`);
      } catch (error) {
        console.error(`  Error seeding player ${player.slackId}:`, error);
      }
    });
    await Promise.all(playerPromises);
    console.log('Player seeding finished.');

    // --- Seed Other Collections (Example: Redemption Codes) --- 
    // const codesRef = db.collection('redemptionCodes');
    // const codeData = {
    //     code: 'TESTCODE1',
    //     value: 10,
    //     maxRedemptions: 1,
    //     redemptionCount: 0,
    //     expiresAt: null,
    //     createdAt: admin.firestore.FieldValue.serverTimestamp(),
    //     redeemedBy: []
    // };
    // console.log('Seeding redemption code TESTCODE1...');
    // await codesRef.doc(codeData.code).set(codeData, { merge: true });
    // console.log('Redemption code seeding finished.');

    console.log('Firestore seed completed successfully!');

  } catch (error) {
    console.error('Error during Firestore seeding:', error);
    process.exit(1); // Exit with error code
  } 
}

// Run the seed function
seedFirestore().then(() => {
    // Optional: Exit gracefully after seeding if needed
    // process.exit(0);
}).catch((err) => {
     console.error('Unhandled error running seed script:', err);
     process.exit(1);
}); 