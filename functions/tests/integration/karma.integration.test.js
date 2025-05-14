import admin from 'firebase-admin';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { jest, describe, beforeAll, beforeEach, test, expect, afterAll } from '@jest/globals';

// Mock the Slack client's postEphemeral method
const mockPostEphemeral = jest.fn();
const mockAck = jest.fn();
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Simulate the Slack app client
const mockClient = {
  chat: {
    postEphemeral: mockPostEphemeral,
  },
  users: { // Add a mock for users.info if getOrCreatePlayer needs it for new users
    info: jest.fn().mockResolvedValue({
      ok: true,
      user: { real_name: 'Test User Name', name: 'testuser' },
    }),
  }
};

// Import the actual handler and the database object
// IMPORTANT: Adjust the path based on your actual file structure
// We are assuming this test file is in functions/tests/integration/
import { karmaHandler } from '../../handlers/karma-handler.js'; 
import { database as actualDatabase, getPlayerTitle } from '../../lib/firebase.js'; // Using actualDatabase to avoid conflict

// Initialize Firebase Admin SDK for testing
// IMPORTANT: Ensure your environment is configured for Firebase Admin (e.g., GOOGLE_APPLICATION_CREDENTIALS)
// This will connect to your Firebase project specified in the service account or environment.
if (!admin.apps.length) {
  admin.initializeApp({
    // If GOOGLE_APPLICATION_CREDENTIALS is not set, you might need to specify:
    // credential: admin.credential.cert(require('path/to/your/serviceAccountKey.json')),
    // databaseURL: 'https://your-project-id.firebaseio.com' // Optional if using Firestore
    projectId: 'koffee-karma-dev', // Explicitly set the project ID
  });
}
const db = getFirestore(); // Use the admin-initialized Firestore instance

// --- Helper to set up the Bolt app command structure ---
// The karmaHandler expects the app instance to register the command.
// We'll create a simplified mock app for the handler to attach to.
const mockApp = {
  command: jest.fn((commandName, handlerFn) => {
    // Store the handler function so we can call it directly
    if (commandName === '/karma') {
      mockApp.karmaCommandHandler = handlerFn;
    }
  }),
  // Add any other app methods your handler might use globally, e.g., app.logger
  logger: mockLogger, // karmaHandler might not use app.logger directly but its own logger from params
};

// Let karmaHandler register its command with our mockApp
karmaHandler(mockApp); 
// Now mockApp.karmaCommandHandler holds the function we want to test.

// Helper function to access secrets from Google Cloud Secret Manager
async function accessSecretVersion(secretName) {
  const client = new SecretManagerServiceClient();
  try {
    const [version] = await client.accessSecretVersion({
      name: secretName, // e.g., projects/PROJECT_ID/secrets/SECRET_NAME/versions/latest
    });
    const payload = version.payload.data.toString('utf8');
    return payload;
  } catch (error) {
    console.error(`Failed to access secret ${secretName}:`, error);
    throw error; // Re-throw to fail fast if secret is essential
  }
}

describe('Integration Test: /karma command', () => {
  const testUserId = 'U08RAUDT8R2'; // Your Slack ID
  let testChannelId; // Will be fetched from Secret Manager
  const gcpProjectId = 'koffee-karma-dev'; // Your GCP Project ID from the screenshot
  const initialKarma = 50;
  const initialReputation = 100;
  let expectedTitle;

  beforeAll(async () => {
    // Fetch the KOFFEE_KARMA_CHANNEL_ID from Secret Manager
    try {
      const secretFullName = `projects/${gcpProjectId}/secrets/KOFFEE_KARMA_CHANNEL_ID/versions/latest`;
      testChannelId = await accessSecretVersion(secretFullName);
      console.log(`Successfully fetched KOFFEE_KARMA_CHANNEL_ID ('${testChannelId}') from Secret Manager.`);
    } catch (error) {
      console.error("CRITICAL: Could not fetch KOFFEE_KARMA_CHANNEL_ID from Secret Manager. Tests cannot proceed reliably.", error);
      // Optionally, force exit or skip tests if the channel ID is critical
      process.exit(1); // Or throw error to make Jest fail the suite
    }

    // Ensure the test user exists in the dev Firestore with a known state
    const playerRef = db.collection('players').doc(testUserId);
    expectedTitle = getPlayerTitle(initialReputation); // Calculate expected title
    await playerRef.set({
      userId: testUserId,
      name: 'Neal Boyer (Test)', // Or fetch if preferred
      karma: initialKarma,
      reputation: initialReputation,
      title: expectedTitle, // Set the expected title
      ordersRequestedCount: 5,
      deliveriesCompletedCount: 2,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      capabilities: ['tea', 'coffee'],
    });
    console.log(`Test user ${testUserId} ensured in Firestore with Karma: ${initialKarma}, Reputation: ${initialReputation}, Title: ${expectedTitle}`);
  }, 15000);

  beforeEach(() => {
    // Reset mocks before each test
    mockPostEphemeral.mockClear();
    mockAck.mockClear();
    // Clear all logger mocks
    Object.values(mockLogger).forEach(fn => fn.mockClear());
  });

  test('should fetch and display existing user karma, reputation, and title', async () => {
    // Prepare the command body similar to what Slack sends
    const commandBody = {
      user_id: testUserId,
      channel_id: testChannelId, // Now fetched from Secret Manager
      channel_name: 'koffee-karma-dev', // Or any non-'directmessage' channel name
      // Add any other properties the handler might expect from 'body'
    };

    // Call the /karma command handler directly
    // The handler is: async ({ ack, body, client, logger })
    await mockApp.karmaCommandHandler({
      ack: mockAck,
      body: commandBody,
      client: mockClient,
      logger: mockLogger, // Pass the file-scoped mockLogger
    });

    // 1. Verify ack() was called
    expect(mockAck).toHaveBeenCalledTimes(1);

    // 2. Verify Firestore data for the user was NOT changed
    const playerDoc = await db.collection('players').doc(testUserId).get();
    expect(playerDoc.exists).toBe(true);
    const playerData = playerDoc.data();
    expect(playerData.karma).toBe(initialKarma);
    expect(playerData.reputation).toBe(initialReputation);
    expect(playerData.title).toBe(expectedTitle); // Verify title remains consistent

    // 3. Verify client.chat.postEphemeral was called with correct parameters
    // The karma handler sends a placeholder message first, then the actual stats.
    expect(mockPostEphemeral).toHaveBeenCalledTimes(2); // Placeholder + Actual

    // Check the call for the actual stats (typically the second call)
    // Both .text and the block's text arrive without backslashes before backticks.
    const expectedMessageContent = `karma: \`${initialKarma}\` / reputation: \`${initialReputation}\` / title: \`${expectedTitle.toUpperCase()}\``;

    // The second call to postEphemeral should be the main message
    const mainMessageCall = mockPostEphemeral.mock.calls[1][0]; // Get the arguments of the second call

    expect(mainMessageCall.channel).toBe(testChannelId);
    expect(mainMessageCall.user).toBe(testUserId);
    expect(mainMessageCall.text).toBe(expectedMessageContent);
    expect(mainMessageCall.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            type: 'mrkdwn',
            text: expectedMessageContent, 
          }),
        }),
      ])
    );

    // Optional: Check placeholder message (first call)
    const placeholderCall = mockPostEphemeral.mock.calls[0][0];
     expect(placeholderCall.text).toBe("Grabbing your stats...");
  });

  const newTestUserId = 'U_NEW_TEST_USER_KARMA'; // A distinct ID for the new user test
  const defaultTitleForNewUser = getPlayerTitle(0); // Get the expected default title

  test('should create a new player with default values and display them via /karma', async () => {
    // Ensure this user does NOT exist before the test
    await db.collection('players').doc(newTestUserId).delete();

    const commandBody = {
      user_id: newTestUserId,
      channel_id: testChannelId, // Re-use from beforeAll
      channel_name: 'koffee-karma-dev',
    };

    // Mock the users.info call for this specific new user ID if needed, or rely on the general mock
    // If getOrCreatePlayer fetches name, ensure mockClient.users.info is set up for newTestUserId if it behaves differently
    // For simplicity, we assume the existing mock is sufficient or getOrCreatePlayer handles unknown names gracefully.

    await mockApp.karmaCommandHandler({
      ack: mockAck,
      body: commandBody,
      client: mockClient,
      logger: mockLogger,
    });

    // 1. Verify ack() was called
    expect(mockAck).toHaveBeenCalledTimes(1);

    // 2. Verify Firestore data for the new user was created correctly
    const playerDoc = await db.collection('players').doc(newTestUserId).get();
    expect(playerDoc.exists).toBe(true);
    const playerData = playerDoc.data();
    expect(playerData.karma).toBe(0);
    expect(playerData.reputation).toBe(0);
    expect(playerData.title).toBe(defaultTitleForNewUser);
    expect(playerData.ordersRequestedCount).toBe(0);
    expect(playerData.deliveriesCompletedCount).toBe(0);
    expect(playerData.name).toBe('Test User Name'); // Based on the current mockClient.users.info
    expect(playerData.userId).toBe(newTestUserId);

    // 3. Verify client.chat.postEphemeral was called with correct parameters
    expect(mockPostEphemeral).toHaveBeenCalledTimes(2); // Placeholder + Actual

    const expectedMessageContent = `karma: \`0\` / reputation: \`0\` / title: \`${defaultTitleForNewUser.toUpperCase()}\``;
    const mainMessageCall = mockPostEphemeral.mock.calls[1][0];

    expect(mainMessageCall.channel).toBe(testChannelId);
    expect(mainMessageCall.user).toBe(newTestUserId);
    expect(mainMessageCall.text).toBe(expectedMessageContent);
    expect(mainMessageCall.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'section',
          text: expect.objectContaining({
            type: 'mrkdwn',
            text: expectedMessageContent,
          }),
        }),
      ])
    );

    // Cleanup: Delete the test user created by this test
    await db.collection('players').doc(newTestUserId).delete();
  });

  // Add more tests here:
  // - Test for a new user (getOrCreatePlayer creates them)
  // - Test for /karma in DM (should send "COMMANDS IN THE CHANNEL...")
  // - Test for error scenarios if a player somehow isn't found after creation attempt (though getOrCreatePlayer should handle this)

  afterAll(async () => {
    // Optional: Clean up test data from Firestore if needed
    // For example, delete the test user:
    // await db.collection('players').doc(testUserId).delete();
    // console.log(`Test user ${testUserId} deleted from Firestore.`);
    // Or, more simply, close the Firebase connection if your test runner doesn't do it.
    // await admin.app().delete(); // This might be too aggressive if other tests use it.
  });
}); 