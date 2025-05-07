# Koffee Karma (Firebase/Node.js) - Specification Document

## 1. Project Overview

Koffee Karma is a Slack bot designed for office environments (like IDEO SF) to facilitate peer-to-peer coffee ordering and delivery. It uses a gamified "Karma" point system and a "Reputation" score to incentivize participation. Built with Node.js, the Slack Bolt SDK, and Firebase (Firestore for data, Cloud Functions for backend logic).

### 1.1 Tone of Voice & Aesthetic

The bot utilizes a specific "punk" aesthetic for its user-facing communication. Key characteristics include:
- **Tone:** Serious, raw, somewhat stylized, direct.
- **Capitalization:** Mix of standard sentence case and ALL CAPS for emphasis.
- **Punctuation:** Deliberate avoidance of exclamation marks.
- **Emojis/Symbols:** Used sparsely, primarily in specific message formats (like status updates or `/karma` output) rather than modals or standard prompts.
- **Modals vs. Messages:** Modals generally maintain a cleaner, colder text style, while formatted messages (like the leaderboard or status updates) incorporate more of the stylized elements.
- **Consistency:** Efforts were made to apply this tone consistently across modals, buttons, ephemeral messages, DMs, command outputs, and error messages.
- **Reference:** The specific language and style choices are cataloged in `USER_FACING_TEXT copy.md`.

### 1.2 Core Functionality:
- Users request drinks via the `/order` command (modal interface).
- Orders cost Karma points.
- Other users can "Claim" pending orders via buttons on the order message.
- Runners "Mark as Delivered" orders they've fulfilled, earning Karma (with a chance for a bonus).
- Orders can be cancelled by the requester before being claimed.
- Orders expire if not claimed within a time limit (timer functionality implemented, expiration logic pending).
- Users can check their Karma (`/karma`).
- Basic data persistence for orders and players is handled via Firestore.
- Messages are updated dynamically to reflect order status and timer countdowns.

## 2. Architecture

- **Language/Runtime:** Node.js
- **Framework:** Slack Bolt SDK for Node.js
- **Backend:** Google Cloud Functions (Firebase Functions)
- **Database:** Google Firestore
- **Key Libraries:**
    - `@slack/bolt`: Core Slack app framework.
    - `firebase-admin`: For backend interaction with Firebase services.
    - `firebase-functions`: For defining Cloud Functions.
    - `dotenv`: For environment variable management.
- **Configuration (`.env` & Firebase Runtime Config):**
    - `SLACK_BOT_TOKEN`: Slack Bot User OAuth Token.
    - `SLACK_SIGNING_SECRET`: Slack App Signing Secret.
    - `SLACK_APP_TOKEN`: (Potentially needed for Socket Mode, if used).
    - Firebase Project Configuration (handled via `firebase-admin` initialization).
    - `KOFFEE_KARMA_CHANNEL_ID`: The default Slack channel ID for public messages.
- **Deployment:** Firebase CLI (`firebase deploy --only functions`)

## 3. Core Concepts

- **Karma:** The spendable/earnable point system. Earned by delivering, spent by ordering.
- **Reputation:** A cumulative, non-decreasing metric awarded upon successful order delivery to both requester and runner. Used for leaderboard ranking.
- **Player Title:** Rank based on Reputation amount (logic pending, thresholds likely in `constants.js` or Firestore config).
- **Order Statuses:** Managed in Firestore (`orders` collection `status` field):
    - `ordered`: Initial state after `/order` submission. Awaiting claim. Timer running.
    - `claimed`: An order a runner has committed to delivering. Order timer stops. Runner assigned.
    - `delivered`: Order successfully delivered by the runner. Runner earns Karma and Reputation. Requester earns Reputation. `ordersRequestedCount` and `deliveriesCompletedCount` incremented.
    - `expired`: An 'ordered' request that timed out. Karma refunded to requester.
    - `cancelled`: An 'ordered' request manually cancelled by the initiator. Karma refunded to requester.
- **Timers:** Cloud Function (`orderTimerUpdater`) triggered periodically (e.g., every minute via Cloud Scheduler) to update countdowns on active 'ordered' messages and process expirations.

## 4. Data Storage (Firestore)

- **`players` Collection:**
    - **Document ID:** Slack User ID (e.g., `U12345`)
    - **Schema:**
        - `userId`: String (Slack User ID)
        - `name`: String (Slack User Real Name)
        - `karma`: Number (Current spendable/earnable karma points)
        - `reputation`: Number (Cumulative score used for leaderboard)
        - `ordersRequestedCount`: Number (Total successful orders initiated and received by this user)
        - `deliveriesCompletedCount`: Number (Total successful orders delivered by this user)
        - `title`: String (Calculated based on Reputation, logic pending)
        - `createdAt`: Timestamp
        - `updatedAt`: Timestamp
        - `capabilities`: Array<String> (Drink categories runner can make - for `/deliver` flow)
    - **Usage:** Created/updated on first interaction (`getOrCreatePlayer`) with initial values (0 for karma/reputation/counts). `karma` updated on order submission (deduct), cancellation/expiration (refund), delivery (award). `reputation` awarded on successful delivery to both requester (amount = `karmaCost`) and runner (amount = earned Karma). `ordersRequestedCount` and `deliveriesCompletedCount` incremented on delivery. Fetched for `/karma` command and validation checks.
- **`orders` Collection:**
    - **Document ID:** Firestore Auto-ID
    - **Schema:**
        - `orderId`: String (Firestore Auto-ID, added after creation)
        - `requesterId`: String (Slack User ID)
        - `requesterName`: String (Slack User Real Name)
        - `runnerId`: String (Slack User ID, populated on claim)
        - `runnerName`: String (Slack User Real Name, populated on claim)
        - `recipientId`: String (Slack User ID, may be same as requester)
        - `recipientName`: String (Slack User Real Name)
        - `category`: String (e.g., 'tea', 'espresso')
        - `drink`: String (Specific drink details)
        - `location`: String (Selected location identifier)
        - `locationDisplayName`: String (Display name for the location)
        - `notes`: String (Optional notes)
        - `karmaCost`: Number (Calculated cost deducted from requester's Karma)
        - `status`: String ('ordered', 'claimed', 'delivered', 'expired', 'cancelled')
        - `bonusMultiplier`: Number (Applied at delivery, defaults to 1)
        - `slackMessageTs`: String (Timestamp of the Slack message)
        - `slackChannelId`: String (Channel ID of the message)
        - `slackChannelName`: String (Name of the channel, e.g., #koffee-karma)
        - `timeClaimed`: Timestamp (Populated on claim)
        - `timeDelivered`: Timestamp (Populated on delivery)
        - `createdAt`: Timestamp (Added automatically by Firestore, used for timer calculations)
        - `updatedAt`: Timestamp (Added automatically by Firestore)
        - `durationMs`: Number (Order duration in milliseconds, e.g., 600000 for 10 mins)
        - `expiryTimestamp`: Timestamp (Calculated on creation for expiration mechanism)
    - **Usage:** Created on `/order` or `/deliver` submission. Updated on claim, delivery, cancellation, expiration. Queried by `orderTimerUpdater` to find active orders/offers for countdown updates and expiration processing.
- **`redemptionCodes` Collection:** (Planned)
    - **Document ID:** Unique Code String
    - **Schema:**
        - `code`: String
        - `karmaValue`: Number
        - `maxRedemptions`: Number
        - `redemptions`: Array<{ userId: String, timestamp: Timestamp }> (Tracks who redeemed when)
    - **Usage:** For `/redeem` command. Check validity, update redemption count, award Karma.

## 5. User Flows & Slash Commands

- **`/order`:**
    1.  User types `/order`.
    2.  **Bot:** Opens "Place An Order" modal (`order-modal.js`). Category dropdown shows karma cost (`constants.js`). Map updates dynamically on location select (`update_modal_map`).
    3.  User fills details (Category, Drink, Location, Recipient, Notes) and submits.
    4.  **Bot (`handleOrderSubmission` in `order-handler.js`):**
        a.  Validates inputs (category, location required). Shows modal error if invalid.
        b.  Calculates `karmaCost`.
        c.  Fetches/Creates requester player data (`getOrCreatePlayer`).
        d.  Checks if requester has sufficient Karma. Sends ephemeral error and stops if not.
        e.  **Firestore Write:** Deducts Karma from `players` doc (`karma` field).
        f.  Posts a *temporary* "Processing..." message to the channel.
        g.  **Firestore Write:** Creates `orders` document with status 'ordered', populating all details (including `karmaCost`, `durationMs`, `expiryTimestamp`).
        h.  Formats the final order message (`formatOrderMessage`).
        i.  Updates the temporary Slack message with the final formatted content, including "CLAIM ORDER" and "CANCEL" buttons. Gets `ts`.
        j.  **Firestore Write:** Updates the `orders` doc with `slackMessageTs` and `slackChannelId`.
        k.  Acknowledges the modal submission.
**`/karma`:**
    1.  User types `/karma`.
    2.  **Bot (`handleKarmaCommand` in `karma-handler.js`):**
        a.  Fetches/Creates player data (`getOrCreatePlayer`).
        b.  Sends ephemeral message showing both Karma and Reputation (and Title, logic TBD).
- **`/deliver`:** (Implemented)
    1.  User types `/deliver`.
    2.  **Bot:** Opens "Offer to Deliver" modal. Pre-fills capabilities from `players` doc. User selects duration and confirms capabilities.
    3.  User submits.
    4.  **Bot:**
        a.  **Firestore Write:** Updates runner's `capabilities` in `players` doc.
        b.  Posts runner availability message (formatted, with "ORDER NOW", "CANCEL" buttons) to channel. Gets `ts`.
        c.  Sets up a timer for the offer duration.
        d.  Sends ephemeral confirmation.
- **`/leaderboard`:** (Non-functional / Planned)
    1.  User types `/leaderboard`.
    2.  **Bot:**
        a.  **Firestore Query:** Fetches top N players from `players` sorted by `reputation` (Reputation field) (descending).
        b.  Formats leaderboard message.
        c.  Posts public message to channel.
- **`/redeem [code]`:** (Non-functional / Planned)
    1.  User types `/redeem some-code`.
    2.  **Bot:**
        a.  Parses code from text.
        b.  **Firestore Read:** Checks `redemptionCodes` for the code. Validates existence, expiry, max redemptions, if user already redeemed.
        c.  If valid:
            i.  **Firestore Write:** Adds user ID to code's redemption list.
            ii. **Firestore Write:** Adds `karmaValue` to user's Karma (`karma` field).
            iii. Sends ephemeral success message.
        d.  If invalid: Sends ephemeral error message.

## 6. Slack Interactions

- **Slash Commands:** Registered in `index.js`, handlers typically in `handlers/` directory.
    - `/order`: Triggers order modal flow.
    - `/karma`: Displays user Karma and Reputation ephemerally.
    - `/deliver`: Triggers delivery offer modal.
    - `/leaderboard`: (Planned) Displays public leaderboard based on Reputation.
    - `/redeem`: (Planned) Allows users to redeem codes for Karma.
- **Modals:**
    - **Order Modal (`lib/modals/order-modal.js`):** Used for `/order`. Dynamic map updates via `view_submission` handler for `location_select` action. Validation handled on submission. Callback ID: `order_modal`.
    - **Delivery Modal:** (Planned) For `/deliver`. Callback ID: `delivery_modal` (likely).
- **Messages:**
    - **Public Order Messages:** Posted to `KOFFEE_KARMA_CHANNEL_ID`. Formatted using `lib/messages/order-message.js`. Includes ASCII map, details, buttons, countdown timer. Updated via `chat.update`.
    - **Public Runner Offers:** (Planned) Similar format to orders, shows capabilities, duration, different buttons.
    - **Public Bonus Announcements:** Posted when a delivery bonus (>1x) occurs.
    - **Ephemeral Messages:** Used for confirmations (`/karma`), errors (insufficient Karma, failed actions, invalid user for button press), and potentially `/redeem` results. Sent via `chat.postEphemeral`.
    - **Direct Messages (DMs):** Sent via `chat.postMessage` to specific `userId`s.
        - On Claim: To requester ("@Runner claimed your order!"), To runner ("You claimed @Requester's order!").
        - On Delivery: To requester ("@Runner delivered your order!"), To runner ("You delivered @Requester's order and earned X Karma! Total Karma: Y").
        - On Cancel/Expire: DM confirmation of Karma refund.
        - New Member Welcome: (Planned) Onboarding tutorial DM.
- **Button Actions (`app.action`):** Handlers in `order-handler.js` and `delivery-handler.js`.
    - `claim_order`:
        - **Handler:** `handleClaimOrder`
        - **Action:** Validates status ('ordered'), user is not requester. Updates Firestore order status to 'claimed', sets runner info, `timeClaimed`. Updates Slack message (removes CLAIM, adds DELIVERED, updates status text). Sends DMs.
    - `deliver_order`:
        - **Handler:** `handleDeliverOrder`
        - **Action:** Validates status ('claimed'), user is the runner. Calculates bonus multiplier. Calculates earned Karma. Updates runner's Karma (`karma` field) and Reputation (`reputation` field) in Firestore. Updates requester's Reputation (`reputation` field). Increments runner's `deliveriesCompletedCount` and requester's `ordersRequestedCount`. Updates Firestore order status to 'delivered', sets `timeDelivered`, `bonusMultiplier`. Updates Slack message (removes buttons, updates status text with earned Karma). Sends DMs. Posts public bonus message if applicable.
    - `cancel_order`:
        - **Handler:** `handleCancelOrder`
        - **Action:** Validates status ('ordered'), user is the requester. Updates Firestore order status to 'cancelled'. Refunds `karmaCost` to requester's Karma (`karma` field). Updates Slack message to simple "Order cancelled by @User." (removes blocks/buttons). Sends confirmation DM.
    - `order_now`: Triggered from Runner Offer message. Opens order modal pre-filled with runner info.
    - `cancel_ready_offer`: (Implemented) Triggered from Runner Offer message. Cancels the offer, updates message.

## 7. Key Functions/Modules

- **`index.js`:** Entry point for Firebase Functions. Initializes Bolt app, registers handlers (slash commands, actions, views, events), defines HTTPS endpoint (`slackEvents`), defines scheduled function (`orderTimerUpdater`).
- **`functions/handlers/`:** Contains handler logic for specific features.
    - `order-handler.js`: Handles `/order` submission (both standard and targeted via runner offers), `claim_order`, `deliver_order`, `cancel_order`, `cancel_claimed_order` actions. Includes logic to prevent claiming already claimed runner offers (race condition handling). Contains `handleOrderSubmission`, `handleClaimOrder`, etc. Also contains `handleOrderExpiration`.
    - `karma-handler.js`: Handles `/karma` command.
    - `misc-handlers.js`: (Potentially) For `/leaderboard`, `/redeem`, event handlers like new member join.
    - `delivery-handler.js`: Handles `/deliver` submission, `open_order_modal_for_runner` (opens modal for runner offer), `cancel_ready_offer`.
- **`functions/lib/`:** Contains reusable utilities and definitions.
    - `firebase.js`: Initializes `firebase-admin` and exports Firestore DB instance.
    - `slack.js`: Initializes and exports Bolt App instance.
    - `utils.js`: General utility functions (e.g., `getOrCreatePlayer`, karmaBalance calculation, fetching user info).
    - `constants.js`: Defines constants like karma costs per category, titles (maybe), channel IDs (though env var preferred), timer durations.
    - `modals/`: Directory for modal view definitions (e.g., `order-modal.js`).
    - `messages/`: Directory for message block kit definitions (e.g., `order-message.js`).
- **`functions/scheduled/`:** (Implied by `orderTimerUpdater`) Contains logic for scheduled tasks.
    - `order-timer.js`: (Likely location for `orderTimerUpdater` logic) Queries Firestore for active 'ordered' messages, calculates remaining time, updates Slack messages via `chat.update`. **Needs enhancement for expiration.**

## 8. Karma System

- **Cost Calculation:** Defined in `constants.js`, based on drink `category` selected in `/order` modal. This is the `karmaCost` stored in the `orders` document.
- **Deduction:** `karmaCost` is deducted from the requester's Karma (`karma` field) immediately upon valid `/order` submission (`handleOrderSubmission`).
- **Award (Delivery):** Occurs when `deliver_order` action is handled (`handleDeliverOrder`).
    - Runner Earns Karma: Base amount = Original `karmaCost` of the order. Bonus Multiplier applied. Total Award = `karmaCost * bonusMultiplier`. Awarded to the `runnerId`'s Karma (`karma` field).
    - Runner Earns Reputation: Amount = Earned Karma (including bonus). Added to `runnerId`'s Reputation (`reputation` field).
    - Requester Earns Reputation: Amount = Original `karmaCost` of the order. Added to `requesterId`'s Reputation (`reputation` field).
- **Player Counts (Delivery):**
    - Runner's `deliveriesCompletedCount` is incremented by 1.
    - Requester's `ordersRequestedCount` is incremented by 1.
- **Refund (Cancellation/Expiration):** Occurs when `cancel_order` action is handled or when an order expires (`handleOrderExpiration`). Original `karmaCost` is added back to the `requesterId`'s Karma (`karma` field).
- **Award (Redemption):** (Planned) Occurs on successful `/redeem`. Value from `redemptionCodes` doc added to user's Karma (`karma` field).
- **Initial Karma:** (Planned/Optional) New users might start with a small amount (e.g., 3 Karma) upon first interaction / joining channel.

## 9. New Member Behavior (Planned)

- **Trigger:** `member_joined_channel` event when a user joins `KOFFEE_KARMA_CHANNEL_ID`.
- **Actions:**
    - **Public Message:** Post a short, randomized welcome message to the channel (e.g., "Welcome @User to Koffee Karma!").
    - **Direct Message (DM):** Send a detailed onboarding message explaining the bot's purpose, commands (`/order`, `/karma`, `/deliver`), and the Karma/Reputation system.
    - **Firestore Write:** Create the player document in `players` collection (`getOrCreatePlayer`), potentially awarding initial Karma points.

## 10. Intended Behaviors & Validation

- `/order` Modal: Requires Category and Location. Shows inline errors.
- `/order` Submission: Fails if user has insufficient Karma (ephemeral message).
- `claim_order` Button: Only works on 'ordered' status messages. Requester cannot claim their own order (ephemeral error).
- `deliver_order` Button: Only works on 'claimed' status messages. Only the assigned runner can trigger it (ephemeral error).
- `cancel_order` Button: Only works on 'ordered' status messages. Only the original requester can trigger it (ephemeral error).
- `cancel_claimed_order` Button: Only works on 'claimed' status messages. Only the assigned runner can trigger it (ephemeral error).
- `/deliver` Flow: Runner capabilities stored. When ordering via "ORDER NOW", modal filters/validates drink choice against runner's capabilities. Runner cannot use "ORDER NOW" on their own offer. If multiple users click 'ORDER NOW' on the same runner offer, only the first user to submit a valid order modal will succeed; subsequent users receive an ephemeral error.
- Expiration: 'ordered' messages should change to 'expired' status after timeout, buttons removed, Karma refunded. Runner offers should expire similarly. 'claimed' orders should change to 'EXPIRED_CLAIMED' if runner times out, Karma refunded.

## 11. Next Steps & Known Issues

- **Verify Claimed Order Expiration Flow (`EXPIRED_CLAIMED`):** ❌ Needs Verification
- **Implement `/leaderboard`:** (Based on Reputation)
- **Implement `/redeem`:** (Awards Karma)
- **Implement New Member Welcome:** (Explain Karma/Reputation)
- **Refinements & Fixes:**
    - **Module System Consistency:** ✅ Done.
    - **Performance:** Monitor Cloud Function cold starts and execution time.
    - **Timer Reliability:** Ensure Cloud Scheduler trigger for `orderTimerUpdater` is robust. Timer text now rounds up using `Math.ceil`.
    - **Persistent Timer Rounding Issue:** ❌ **Unresolved:** Despite code changes (`Math.ceil` in `formatTimeRemaining` and correct calls in formatters/handlers), the timer text in newly posted order messages *still* appears to round down (e.g., showing "9 MINS" immediately). Logs indicate that stale code (containing old formatting logic and debug logs) is likely being executed in the deployed environment. A redeployment (`firebase deploy --only functions`) is needed to ensure the latest code is running.
    - **Error Handling:** Continue improving user feedback on errors.
    - **Titles:** Implement dynamic title calculation based on Reputation thresholds.
    - **Code Structure:** Continue organizing code logically.
    - **Runner Offer Timer Updates:** Implement message formatting (`formatRunnerOfferMessage`) and enable updates in `orderTimerUpdater`.

## 12. Tracker Update (Summary for Edit)

- Mark tasks related to Karma/Reputation implementation (`karma`, `reputation`, `ordersRequestedCount`, `deliveriesCompletedCount`) as ✅ Done.
- Mark tasks related to `claim_order`, `deliver_order`, `cancel_order`, `cancel_claimed_order`, `order_now`, `cancel_ready_offer` button logic (Firestore updates, message updates, DMs, Karma/Reputation award/refund, counts, bonus multiplier) as ✅ Done.
- Mark tasks related to message formatting for all states (including showing earned Karma on delivery and Reputation) as ✅ Done.
- Mark tasks related to DM sending for claim/delivery/cancel as ✅ Done.
- Mark task related to Bonus Karma calculation/award/messaging as ✅ Done.
- Mark status of `orderTimerUpdater` to reflect it handles countdowns AND expiration for both orders and offers as ✅ Done.
- Update `/deliver` flow tasks to ✅ Done.
- Keep `/leaderboard` (using Reputation), `/redeem` (for Karma), New Member flows as ❌ Not Functional or 🚧 Not Started.
- Keep Title system (using Reputation) as 🚧 Not Started.
