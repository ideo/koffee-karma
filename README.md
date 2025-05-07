# Koffee Karma Firebase

A Firebase-based implementation of the Koffee Karma Slack bot for facilitating peer-to-peer coffee ordering and delivery with a karma-based point system.

## Overview

Koffee Karma allows users to:
- Request drinks (via `/order`) with karma cost based on drink category
- Offer to deliver drinks (via `/deliver`) for a set duration
- Claim pending orders as a runner to earn karma
- Track karma points (via `/karma`) and view a leaderboard (via `/leaderboard`)
- Redeem codes for bonus karma (via `/redeem`)

## Architecture

- **Firebase Cloud Functions**: Serverless backend that handles Slack interactions
- **Firebase Realtime Database**: Stores player data, orders, and redemption codes
- **Firebase Firestore**: Stores timer schedules
- **Slack Bolt Framework**: SDK for Slack app development
- **Firebase Pub/Sub**: Handles timer events for order/runner offer countdowns

## Setup Instructions

### 1. Firebase Setup

1. **Install Firebase CLI**:
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```

3. **Initialize Firebase** (if not done already):
   ```bash
   firebase init
   ```
   Select:
   - Functions (Node.js)
   - Realtime Database
   - Firestore
   - Storage (optional)

4. **Install dependencies**:
   ```bash
   cd functions
   npm install
   ```

### 2. Slack App Setup

1. **Create a Slack App** at [api.slack.com/apps](https://api.slack.com/apps):
   - Click "Create New App" > "From scratch"
   - Enter a name (e.g., "Koffee Karma") and select your workspace

2. **Configure App Features**:
   - **Bot Token Scopes**: Navigate to "OAuth & Permissions" and add:
     - `chat:write`
     - `chat:write.public`
     - `commands`
     - `users:read`
     - `users:read.email`

   - **Slash Commands**: Navigate to "Slash Commands" and add:
     - `/order` - Request a coffee
     - `/deliver` - Offer to deliver drinks
     - `/karma` - Check your karma
     - `/leaderboard` - View top karma earners
     - `/redeem` - Redeem a karma code

   - **Event Subscriptions**: Enable and subscribe to:
     - `member_joined_channel`
     - `app_mention`

   - **Interactivity**: Enable and add a placeholder URL (we'll update it later)

3. **Install App to Workspace** via "Install App" section

4. **Take note of credentials**:
   - Bot User OAuth Token (starts with `xoxb-`)
   - Signing Secret

### 3. Firebase Configuration

1. **Set environment config values**:
   ```bash
   firebase functions:config:set \
     slack.bot_token="xoxb-your-token-here" \
     slack.signing_secret="your-signing-secret" \
     slack.channel_id="C12345678" \
     app.database_url="https://your-firebase-url.firebaseio.com"
   ```

2. **Update .env** for local development:
   ```
   SLACK_BOT_TOKEN=xoxb-your-token-here
   SLACK_SIGNING_SECRET=your-signing-secret
   KOFFEE_KARMA_CHANNEL_ID=C12345678
   FIREBASE_DATABASE_URL=https://your-firebase-url.firebaseio.com
   GOOGLE_APPLICATION_CREDENTIALS=../serviceAccountKey.json
   ```

3. **Create Pub/Sub topics** for timers:
   ```bash
   gcloud pubsub topics create update-order-timer
   gcloud pubsub topics create expire-order
   gcloud pubsub topics create update-runner-timer
   gcloud pubsub topics create expire-runner-offer
   ```

### 4. Deployment

1. **Deploy Functions**:
   ```bash
   firebase deploy --only functions
   ```

2. **Update Slack App URLs**:
   - Interactivity Request URL: `https://us-central1-[YOUR-PROJECT-ID].cloudfunctions.net/slack/events`
   - Slash Command Request URLs: Same as above
   - Event Subscriptions Request URL: Same as above

### 5. Test the Bot

1. **Join the designated channel** where the bot is active
2. **Test basic commands**:
   - `/karma` - Should show your starting karma
   - `/order` - Should open the order modal
   - `/deliver` - Should open the delivery modal

## Local Development

1. **Install dependencies**:
   ```bash
   cd functions
   npm install
   ```

2. **Start Firebase emulators**:
   ```bash
   firebase emulators:start
   ```

3. **Expose local server** with ngrok or similar:
   ```bash
   ngrok http 5001
   ```

4. **Update Slack App URLs** temporarily to your ngrok URL

## Firebase Database Structure

### Realtime Database

```
database/
  players/
    [slackUserId]/
      name: "User Name"
      karma: 10
      title: "Delivery Master"
      capabilities: ["water", "tea", "drip"]
      lastLocation: "north_kitchen"
      
  orders/
    [orderId]/
      timestamp: 1628762345678
      initiatedBy: "requester" // or "runner"
      requesterId: "U12345"
      requesterName: "John Doe"
      runnerId: "U67890"
      runnerName: "Jane Smith"
      recipientId: "U12345"
      recipientName: "John Doe"
      category: "espresso"
      drink: "Oat milk latte"
      location: "south_kitchen"
      notes: "Extra hot please"
      karmaCost: 3
      status: "ordered" // ordered, offered, claimed, delivered, expired, cancelled
      offerDuration: 900000 // in milliseconds
      bonusMultiplier: 1
      timeOrdered: 1628762345678
      timeClaimed: null
      timeDelivered: null
      messageTs: "1628762345.123456"
      channelId: "C12345"
      expiryTimestamp: 1628763245678
      
  redemptionCodes/
    [code]/
      karmaValue: 5
      redeemedBy: "U12345" // null if not redeemed
      redeemedTimestamp: 1628762345678 // null if not redeemed
```

### Firestore (for timer schedules)

```
schedules/
  [scheduleId]/
    name: "order-update-abc123-1"
    topicName: "update-order-timer"
    executeTime: 1628762345678
    data: { orderId: "abc123", messageTs: "1628762345.123456", channelId: "C12345" }
    status: "scheduled" // scheduled, processed, failed
    createdAt: Timestamp
    processedAt: Timestamp
```

## License

This project is private and confidential. 