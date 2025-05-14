import admin from 'firebase-admin';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { jest, describe, beforeAll, beforeEach, test, expect, afterAll } from '@jest/globals';

// Import functions and constants to be tested or used
import { orderHandler } from '../../handlers/order-handler.js';
import { database, getPlayerTitle } from '../../lib/firebase.js';
import { DRINK_CATEGORIES, LOCATIONS, ORDER_STATUS } from '../../utils/constants.js';
import { KOFFEE_KARMA_CHANNEL_ID } from '../../utils/config.js'; 
// formatOrderMessage is used internally by the handler, we'll check its output on the mockClient

// --- Mocks ---
const mockAck = jest.fn();
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
const mockChatPostMessage = jest.fn();
const mockChatUpdate = jest.fn();
const mockChatPostEphemeral = jest.fn(); // For potential error messages or other ephemeral uses
const mockConversationsInfo = jest.fn();
const mockUsersInfo = jest.fn();

const mockClient = {
  chat: {
    postMessage: mockChatPostMessage,
    update: mockChatUpdate,
    postEphemeral: mockChatPostEphemeral,
  },
  conversations: {
    info: mockConversationsInfo,
  },
  users: {
    info: mockUsersInfo,
  },
  views: {
    update: jest.fn().mockResolvedValue({ ok: true }),
  }
};

// --- Firebase Admin SDK Init ---
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'koffee-karma-dev' });
}
const db = getFirestore();

// --- Secret Manager Helper ---
async function accessSecretVersion(secretName) {
  const client = new SecretManagerServiceClient();
  try {
    const [version] = await client.accessSecretVersion({ name: secretName });
    return version.payload.data.toString('utf8');
  } catch (error) {
    console.error(`Failed to access secret ${secretName}:`, error);
    throw error;
  }
}

// --- Mock App setup ---
const mockApp = {
  command: jest.fn(),
  view: jest.fn((constraints, listenerFn) => {
    const actualListener = listenerFn || constraints;
    let callbackId = '';
    if (typeof constraints === 'string') {
      callbackId = constraints;
    } else if (typeof constraints === 'object' && constraints.callback_id) {
      callbackId = constraints.callback_id;
    }

    if (callbackId === 'koffee_request_modal') {
      mockApp.orderModalSubmissionHandler = actualListener;
    }
  }),
  action: jest.fn(),
  event: jest.fn(),
  logger: mockLogger,
};

// Let orderHandler register its command and view listeners with our mockApp
orderHandler(mockApp);

describe('Integration Test: /order command - Standard Self-Order', () => {
  const testRequesterId = 'U_ORDER_TEST_REQUESTER';
  const testRequesterName = 'Order Test User';
  let testChannelId;
  const gcpProjectId = 'koffee-karma-dev';
  const initialKarma = 10; // Enough for orders

  beforeAll(async () => {
    try {
      const secretFullName = `projects/${gcpProjectId}/secrets/KOFFEE_KARMA_CHANNEL_ID/versions/latest`;
      testChannelId = await accessSecretVersion(secretFullName);
      KOFFEE_KARMA_CHANNEL_ID.value = () => testChannelId;
      console.log(`Successfully fetched KOFFEE_KARMA_CHANNEL_ID ('${testChannelId}') for tests.`);
    } catch (error) {
      console.error("CRITICAL: Could not fetch KOFFEE_KARMA_CHANNEL_ID. Tests cannot proceed. Error details:", error);
      // process.exit(1); // Temporarily commented out for debugging
    }

    // Ensure test user exists with sufficient karma
    const playerRef = db.collection('players').doc(testRequesterId);
    await playerRef.set({
      userId: testRequesterId,
      name: testRequesterName,
      karma: initialKarma,
      reputation: 5,
      title: getPlayerTitle(5),
      ordersRequestedCount: 1,
      deliveriesCompletedCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log(`Test user ${testRequesterId} ensured with ${initialKarma} karma.`);
  }, 20000); // Increased timeout for beforeAll

  beforeEach(() => {
    mockAck.mockClear();
    mockChatPostMessage.mockClear();
    mockChatUpdate.mockClear();
    mockChatPostEphemeral.mockClear();
    mockConversationsInfo.mockClear();
    mockUsersInfo.mockClear();
    Object.values(mockLogger).forEach(fn => fn.mockClear());

    // Default mock for successful conversations.info
    mockConversationsInfo.mockResolvedValue({
      ok: true,
      channel: { name: 'koffee-karma-dev-test-channel' }
    });
    // Default mock for successful users.info (for requester, and recipient if different)
    mockUsersInfo.mockImplementation(async ({ user }) => {
        if (user === testRequesterId) {
            return { ok: true, user: { real_name: testRequesterName, name: 'ordertestuser' } };
        }
        // Add other specific users if needed for gift tests later
        return { ok: true, user: { real_name: 'Generic Test User', name: 'generictest' } };
    });
    // Mock for placeholder message
    mockChatPostMessage.mockResolvedValueOnce({ ok: true, ts: 'placeholder_ts_12345', channel: testChannelId });
    // Mock for final message update
    mockChatUpdate.mockResolvedValue({ ok: true, ts: 'final_ts_67890', channel: testChannelId });
    // Mock for DM
    mockChatPostMessage.mockResolvedValue({ ok: true, ts: 'dm_ts_11223' }); // Default for subsequent calls like DMs

  });

  test('should successfully process a standard self-order', async () => {
    const orderCategory = 'ESPRESSO';
    const drinkDetails = 'Double Latte';
    const orderLocation = 'cafe';
    const orderNotes = 'Extra hot please';
    const expectedKarmaCost = DRINK_CATEGORIES[orderCategory]?.cost;

    const mockView = {
      callback_id: 'koffee_request_modal',
      type: 'view_submission',
      state: {
        values: {
          'category_block': { 'drink_category_select': { selected_option: { value: orderCategory } } },
          'drink_block': { 'drink_input': { value: drinkDetails } },
          'location_block': { 'location_select': { selected_option: { value: orderLocation } } },
          'recipient_block': { 'recipient_select': { selected_user: testRequesterId } },
          'notes_block': { 'notes_input': { value: orderNotes } }
        }
      },
      private_metadata: '{}',
      title: { type: 'plain_text', text: 'Place An Order Test' },
      submit: { type: 'plain_text', text: 'Submit Test' },
      close: { type: 'plain_text', text: 'Cancel Test' },
      blocks: [],
    };

    const mockBody = {
      user: { id: testRequesterId, name: testRequesterName },
    };

    // Ensure the handler was registered
    if (!mockApp.orderModalSubmissionHandler) {
      throw new Error('Order modal submission handler was not registered on mockApp.');
    }

    await mockApp.orderModalSubmissionHandler({
      ack: mockAck,
      body: mockBody,
      view: mockView,
      client: mockClient,
      logger: mockLogger,
    });

    // 1. Assertions for ack
    expect(mockAck).toHaveBeenCalledTimes(1);

    // 2. Assertions for Slack client calls
    // Placeholder message
    expect(mockChatPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: testChannelId,
      text: '⏳ ORDER INCOMING... STANDBY.',
    }));
    
    // Final message update - Adjust expectations to match actual formatOrderMessage output
    // Step 1: Check the main call structure, being loose on blocks initially
    const expectedText = `ORDER FROM ${testRequesterName.toUpperCase()}: ${drinkDetails.toUpperCase()}`;
    // console.log('DEBUG: testChannelId:', JSON.stringify(testChannelId));
    // console.log('DEBUG: expectedTs:', JSON.stringify('placeholder_ts_12345'));
    // console.log('DEBUG: expectedText (substring):', JSON.stringify(expectedText));
    // console.log('DEBUG: expectedText charCodes:', JSON.stringify(Array.from(expectedText).map(c => c.charCodeAt(0))));

    // if (mockChatUpdate.mock.calls.length > 0) {
    //   const receivedPayloadText = mockChatUpdate.mock.calls[0][0].text;
    //   console.log('DEBUG: receivedPayload:', JSON.stringify(mockChatUpdate.mock.calls[0][0], null, 2));
    //   console.log('DEBUG: receivedPayload.text charCodes:', JSON.stringify(Array.from(receivedPayloadText).map(c => c.charCodeAt(0))));
    // }

    expect(mockChatUpdate).toHaveBeenCalledTimes(1); // Ensure it was called
    const actualArgs = mockChatUpdate.mock.calls[0][0];
    expect(actualArgs.channel).toBe(testChannelId);
    expect(actualArgs.ts).toBe('placeholder_ts_12345');
    expect(actualArgs.text).toBe(expectedText);

    // Step 2: If the above passes, specifically check the blocks content
    // const mockChatUpdateCallArgs = mockChatUpdate.mock.calls[0][0]; // Already got this in actualArgs
    expect(actualArgs.blocks).toEqual([
      // Block 0: Section with ASCII art
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: expect.stringContaining('DRINK ORDER – UNCLAIMED') 
        }
      },
      // Block 1: Actions with buttons (exact match with dynamic values)
      {
        type: 'actions',
        elements: [
          {
            action_id: 'claim_order',
            style: 'primary',
            text: { emoji: false, text: 'CLAIM', type: 'plain_text' },
            type: 'button',
            value: expect.any(String) // Order ID is dynamic
          },
          {
            action_id: 'cancel_order',
            style: 'danger',
            text: { emoji: false, text: 'CANCEL ORDER', type: 'plain_text' },
            type: 'button',
            value: expect.any(String) // Order ID is dynamic
          }
        ]
      }
    ]);

    // DM to requester
    expect(mockChatPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      channel: testRequesterId,
      text: expect.stringContaining('Your order is live'),
    }));

    // 3. Assertions for Firestore 'players' collection (Karma Deducation)
    const playerDoc = await db.collection('players').doc(testRequesterId).get();
    expect(playerDoc.exists).toBe(true);
    expect(playerDoc.data().karma).toBe(initialKarma - expectedKarmaCost);

    // 4. Assertions for Firestore 'orders' collection (Order Creation)
    const ordersQuery = await db.collection('orders')
                            .where('requesterId', '==', testRequesterId)
                            .where('status', '==', ORDER_STATUS.ORDERED)
                            .orderBy('createdAt', 'desc')
                            .limit(1)
                            .get();
    expect(ordersQuery.empty).toBe(false);
    const orderData = ordersQuery.docs[0].data();
    const orderId = ordersQuery.docs[0].id;

    expect(orderData.requesterId).toBe(testRequesterId);
    expect(orderData.recipientId).toBe(testRequesterId); // Self-order
    expect(orderData.category).toBe(orderCategory);
    expect(orderData.drink).toBe(drinkDetails);
    expect(orderData.location).toBe(orderLocation);
    expect(orderData.notes).toBe(orderNotes);
    expect(orderData.karmaCost).toBe(expectedKarmaCost);
    expect(orderData.status).toBe(ORDER_STATUS.ORDERED);
    expect(orderData.slackMessageTs).toBe('final_ts_67890'); // TS from the updated message
    expect(orderData.slackChannelId).toBe(testChannelId);
    expect(orderData.initiatedBy).toBe('requester');
    expect(orderData.orderId).toBe(orderId); 
    // Check expiryTimestamp (approx 10 mins from now)
    const tenMinutesInMillis = 10 * 60 * 1000;
    const expectedExpiryLowerBound = Date.now() + tenMinutesInMillis - 5000; // Allow 5s buffer
    const expectedExpiryUpperBound = Date.now() + tenMinutesInMillis + 5000;
    expect(orderData.expiryTimestamp).toBeInstanceOf(Timestamp);
    expect(orderData.expiryTimestamp.toMillis()).toBeGreaterThanOrEqual(expectedExpiryLowerBound);
    expect(orderData.expiryTimestamp.toMillis()).toBeLessThanOrEqual(expectedExpiryUpperBound);
    expect(orderData.createdAt).toBeInstanceOf(Timestamp);

    // Cleanup after test if needed, or in afterAll
    await db.collection('orders').doc(orderId).delete(); // Delete the created order

  }, 20000); // Test timeout

  afterAll(async () => {
    // Clean up test player
    await db.collection('players').doc(testRequesterId).delete();
    // Reset KOFFEE_KARMA_CHANNEL_ID.value if it was mocked for other test files
    // (Requires knowing the original implementation or a more robust mocking strategy if shared)
    // For now, this specific mock only affects this file.
    console.log('Order tests finished. Cleaned up test player.');
  });
}); 