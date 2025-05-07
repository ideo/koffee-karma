const admin = require('firebase-admin');
const fs = require('fs');
const csv = require('csv-parse');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require('../../serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Helper function to parse CSV file
const parseCSV = (filePath) => {
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(filePath)
      .pipe(csv.parse({ columns: true, skip_empty_lines: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', reject);
  });
};

// Migrate players data
async function migratePlayers() {
  const players = await parseCSV(path.join(__dirname, '../../RESOURCES/Koffee Karma - Player Data.csv'));
  const batch = db.batch();
  
  players.forEach((player) => {
    const docRef = db.collection('players').doc(player['Slack ID']);
    batch.set(docRef, {
      slackId: player['Slack ID'],
      name: player['Name'],
      karmaBalance: parseInt(player['Karma Balance']) || 0,
      karmaLegacy: parseInt(player['Karma Legacy']) || 0,
      ordersRequestedCount: parseInt(player['Orders Requested Count']) || 0,
      deliveriesCompletedCount: parseInt(player['Deliveries Completed Count']) || 0,
      title: player['Title'] || 'Koffee Newbie',
      capabilities: player['Capabilities'] ? JSON.parse(player['Capabilities']) : [],
      location: player['Location'] || '',
      createdAt: player['Created At'] ? admin.firestore.Timestamp.fromDate(new Date(player['Created At'])) : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  console.log(`Migrated ${players.length} players`);
}

// Migrate orders data
async function migrateOrders() {
  const orders = await parseCSV(path.join(__dirname, '../../RESOURCES/Koffee Karma - Order Log.csv'));
  const batch = db.batch();

  orders.forEach((order) => {
    const docRef = db.collection('orders').doc(order['Order ID']);
    batch.set(docRef, {
      orderId: order['Order ID'] || docRef.id,
      requesterId: order['Requester ID'],
      requesterName: order['Requester Name'] || 'Unknown',
      runnerId: order['Runner ID'] || null,
      runnerName: order['Runner Name'] || null,
      recipientId: order['Recipient ID'] || order['Requester ID'],
      recipientName: order['Recipient Name'] || order['Requester Name'] || 'Unknown',
      category: order['Category'],
      drink: order['Drink'],
      location: order['Location'],
      notes: order['Notes'] || null,
      karmaCost: parseInt(order['Karma Cost']) || 0,
      status: order['Status'] || 'delivered',
      offerDuration: order['Offer Duration'] ? parseInt(order['Offer Duration']) : null,
      bonusMultiplier: parseFloat(order['Bonus Multiplier']) || 1,
      timeOrdered: order['Time Ordered'] ? new Date(order['Time Ordered']) : null,
      timeClaimed: order['Time Claimed'] ? new Date(order['Time Claimed']) : null,
      timeDelivered: order['Time Delivered'] ? new Date(order['Time Delivered']) : null,
      slackMessageTs: order['Slack Message TS'] || null,
      slackChannelId: order['Slack Channel ID'] || null,
      expiryTimestamp: order['Expiry Timestamp'] ? new Date(order['Expiry Timestamp']) : null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  console.log(`Migrated ${orders.length} orders`);
}

// Migrate redemption codes data
async function migrateRedemptionCodes() {
  const codes = await parseCSV(path.join(__dirname, '../../RESOURCES/Koffee Karma - Redemption Codes.csv'));
  const batch = db.batch();

  codes.forEach((code) => {
    const docRef = db.collection('redemptionCodes').doc(code['Code']);
    batch.set(docRef, {
      code: code['Code'],
      karmaBalanceValue: parseInt(code['Karma Balance Value']) || 0,
      maxRedemptions: code['Max Redemptions'] ? parseInt(code['Max Redemptions']) : null,
      redemptions: [],
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await batch.commit();
  console.log(`Migrated ${codes.length} redemption codes`);
}

// Run migration
async function runMigration() {
  try {
    console.log('Starting migration...');
    await migratePlayers();
    await migrateOrders();
    await migrateRedemptionCodes();
    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration(); 