# Koffee Karma (Firebase/Node.js) - Specification Document

## 1. Project Overview

Koffee Karma is a Slack bot designed for office environments (like IDEO SF) to facilitate peer-to-peer coffee ordering and delivery. It uses a gamified "Karma" point system to incentivize participation. Built with Node.js, the Slack Bolt SDK, and Firebase (Firestore for data, Cloud Functions for backend logic).

**Core Functionality:**
- Users request drinks via the `/order` command (modal interface).
- Orders cost Karma points.
- Other users can "Claim" pending orders via buttons on the order message.
- Runners "Mark as Delivered" orders they've fulfilled, earning Karma (with a chance for a bonus).
- Orders can be cancelled by the requester before being claimed.
- Orders expire if not claimed within a time limit (timer functionality implemented, expiration logic pending).
- Users can check their Karma balance (`/karma`).
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

- **Karma:** The point system. Earned by delivering, spent by ordering. Used for ranking (leaderboard planned).
- **Player Title:** Rank based on Karma amount (planned, thresholds likely in `constants.js` or Firestore config).
- **Order Statuses:** Managed in Firestore (`orders` collection `status` field):
    - `ordered`: Initial state after `/order` submission. Awaiting claim. Timer running.
    - `claimed`: An order a runner has committed to delivering. Order timer stops (or should stop - needs verification). Runner assigned.
    - `delivered`: Order successfully delivered by the runner. Runner earns Karma.
    - `expired`: An 'ordered' request that timed out (logic pending). Karma to be refunded.
    - `cancelled`: An 'ordered' request manually cancelled by the initiator. Karma refunded.
- **Timers:** Cloud Function (`orderTimerUpdater`) triggered periodically (e.g., every minute via Cloud Scheduler - currently runs, but might need optimization) to update countdowns on active 'ordered' messages. Expiration logic itself is not yet implemented.

## 4. Data Storage (Firestore)

- **`players` Collection:**
    - **Document ID:** Slack User ID (e.g., `U12345`)
    - **Schema:**
        - `userId`: String (Slack User ID)
        - `name`: String (Slack User Real Name)
        - `karma`: Number (Current karma points)
        - `title`: String (Calculated based on karma, logic pending)
        - `createdAt`: Timestamp
        - `updatedAt`: Timestamp
        - `capabilities`: Array<String> (Drink categories runner can make - for `/deliver` flow, planned)
    - **Usage:** Created/updated on first interaction (`getOrCreatePlayer`). Karma updated on order submission, cancellation (refund), delivery (award). Fetched for `/karma` command and validation checks.
- **`orders` Collection:**
    - **Document ID:** Firestore Auto-ID
    - **Schema:**
        - `orderId`: String (Firestore Auto-ID)
        - `requesterId`: String (Slack User ID)
        - `requesterName`: String (Slack User Real Name)
        - `runnerId`: String (Slack User ID, populated on claim)
        - `runnerName`: String (Slack User Real Name, populated on claim)
        - `recipientId`: String (Slack User ID, may be same as requester)
        - `recipientName`: String (Slack User Real Name)
        - `category`: String (e.g., 'tea', 'espresso')
        - `drink`: String (Specific drink details)
        - `location`: String (Selected location identifier)
        - `notes`: String (Optional notes)
        - `karmaCost`: Number (Calculated cost)
        - `status`: String ('ordered', 'claimed', 'delivered', 'expired', 'cancelled')
        - `bonusMultiplier`: Number (Applied at delivery, defaults to 1)
        - `slackMessageTs`: String (Timestamp of the Slack message)
        - `slackChannelId`: String (Channel ID of the message)
        - `timeOrdered`: Timestamp
        - `timeClaimed`: Timestamp (Populated on claim)
        - `timeDelivered`: Timestamp (Populated on delivery)
        - `createdAt`: Timestamp (Duplicate of timeOrdered, potentially redundant)
        - `updatedAt`: Timestamp
        - `expiryTimestamp`: Timestamp (Planned, for expiration mechanism)
    - **Usage:** Created on `/order` submission. Updated on claim, delivery, cancellation. Queried by `orderTimerUpdater` to find active orders for countdown updates.
- **`redemptionCodes` Collection:** (Planned)
    - **Document ID:** Unique Code String
    - **Schema:**
        - `code`: String
        - `karmaValue`: Number
        - `maxRedemptions`: Number
        - `redemptions`: Array<{ userId: String, timestamp: Timestamp }> (Tracks who redeemed when)
    - **Usage:** For `/redeem` command. Check validity, update redemption count, award karma.

## 5. User Flows & Slash Commands

- **`/order`:**
    1.  User types `/order`.
    2.  **Bot:** Opens "Place An Order" modal (`order-modal.js`). Category dropdown shows karma cost (`constants.js`). Map updates dynamically on location select (`update_modal_map`).
    3.  User fills details (Category, Drink, Location, Recipient, Notes) and submits.
    4.  **Bot (`handleOrderSubmission` in `order-handler.js`):**
        a.  Validates inputs (category, location required). Shows modal error if invalid.
        b.  Calculates `karmaCost`.
        c.  Fetches/Creates requester player data (`getOrCreatePlayer`).
        d.  Checks if requester has sufficient karma. Sends ephemeral error and stops if not.
        e.  **Firestore Write:** Deducts karma from `players` doc.
        f.  Posts a *temporary* "Processing..." message to the channel.
        g.  **Firestore Write:** Creates `orders` document with status 'ordered', populating all details.
        h.  Formats the final order message (`formatOrderMessage`).
        i.  Updates the temporary Slack message with the final formatted content, including "CLAIM ORDER" and "CANCEL" buttons. Gets `ts`.
        j.  **Firestore Write:** Updates the `orders` doc with `slackMessageTs` and `slackChannelId`.
        k.  Acknowledges the modal submission.
- **`/karma`:**
    1.  User types `/karma`.
    2.  **Bot (`handleKarmaCommand` in `karma-handler.js`):**
        a.  Fetches/Creates player data (`getOrCreatePlayer`).
        b.  Sends ephemeral message showing current Karma and Title (Title logic TBD).
- **`/deliver`:** (Non-functional / Planned)
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
        a.  **Firestore Query:** Fetches top N players from `players` sorted by `karma`.
        b.  Formats leaderboard message.
        c.  Posts public message to channel.
- **`/redeem [code]`:** (Non-functional / Planned)
    1.  User types `/redeem some-code`.
    2.  **Bot:**
        a.  Parses code from text.
        b.  **Firestore Read:** Checks `redemptionCodes` for the code. Validates existence, expiry, max redemptions, if user already redeemed.
        c.  If valid:
            i.  **Firestore Write:** Adds user ID to code's redemption list.
            ii. **Firestore Write:** Adds `karmaValue` to user's `karma` in `players`.
            iii. Sends ephemeral success message.
        d.  If invalid: Sends ephemeral error message.

## 6. Slack Interactions

- **Slash Commands:** Registered in `index.js`, handlers typically in `handlers/` directory.
    - `/order`: Triggers order modal flow.
    - `/karma`: Displays user karma ephemerally.
    - `/deliver`: (Planned) Triggers delivery offer modal.
    - `/leaderboard`: (Planned) Displays public leaderboard.
    - `/redeem`: (Planned) Allows users to redeem codes.
- **Modals:**
    - **Order Modal (`lib/modals/order-modal.js`):** Used for `/order`. Dynamic map updates via `view_submission` handler for `location_select` action. Validation handled on submission. Callback ID: `order_modal`.
    - **Delivery Modal:** (Planned) For `/deliver`. Callback ID: `delivery_modal` (likely).
- **Messages:**
    - **Public Order Messages:** Posted to `KOFFEE_KARMA_CHANNEL_ID`. Formatted using `lib/messages/order-message.js`. Includes ASCII map, details, buttons, countdown timer. Updated via `chat.update`.
    - **Public Runner Offers:** (Planned) Similar format to orders, shows capabilities, duration, different buttons.
    - **Public Bonus Announcements:** Posted when a delivery bonus (>1x) occurs.
    - **Ephemeral Messages:** Used for confirmations (`/karma`), errors (insufficient karma, failed actions, invalid user for button press), and potentially `/redeem` results. Sent via `chat.postEphemeral`.
    - **Direct Messages (DMs):** Sent via `chat.postMessage` to specific `userId`s.
        - On Claim: To requester ("@Runner claimed your order!"), To runner ("You claimed @Requester's order!").
        - On Delivery: To requester ("@Runner delivered your order!"), To runner ("You delivered @Requester's order and earned X Karma! Total: Y").
        - On Cancel/Expire: (Potentially) DM confirmation of refund.
        - New Member Welcome: (Planned) Onboarding tutorial DM.
- **Button Actions (`app.action`):** Handlers in `handlers/order-handler.js` primarily.
    - `claim_order`:
        - **Handler:** `handleClaimOrder`
        - **Action:** Validates status ('ordered'), user is not requester. Stops timer (needs verification). Updates Firestore order status to 'claimed', sets runner info, `timeClaimed`. Updates Slack message (removes CLAIM, adds DELIVERED, updates status text). Sends DMs.
    - `deliver_order`:
        - **Handler:** `handleDeliverOrder`
        - **Action:** Validates status ('claimed'), user is the runner. Calculates bonus multiplier. Calculates earned karma. Updates runner's karma in Firestore. Updates Firestore order status to 'delivered', sets `timeDelivered`, `bonusMultiplier`. Updates Slack message (removes buttons, updates status text with total karma earned). Sends DMs. Posts public bonus message if applicable.
    - `cancel_order`:
        - **Handler:** `handleCancelOrder`
        - **Action:** Validates status ('ordered'), user is the requester. Stops timer (needs verification). Updates Firestore order status to 'cancelled'. Refunds karma cost to requester in Firestore. Updates Slack message to simple "Order cancelled by @User." (removes blocks/buttons). Sends confirmation DM (potentially).
    - `order_now`: (Planned) Triggered from Runner Offer message. Opens order modal pre-filled with runner info.
    - `cancel_ready_offer`: (Planned) Triggered from Runner Offer message. Cancels the offer, updates message.

## 7. Key Functions/Modules

- **`index.js`:** Entry point for Firebase Functions. Initializes Bolt app, registers handlers (slash commands, actions, views, events), defines HTTPS endpoint (`slackEvents`), defines scheduled function (`orderTimerUpdater`).
- **`functions/handlers/`:** Contains handler logic for specific features.
    - `order-handler.js`: Handles `/order` submission, `claim_order`, `deliver_order`, `cancel_order` actions. Contains `handleOrderSubmission`, `handleClaimOrder`, etc. Also contains (currently placeholder) `handleOrderExpiration`.
    - `karma-handler.js`: Handles `/karma` command.
    - `misc-handlers.js`: (Potentially) For `/leaderboard`, `/redeem`, event handlers like new member join.
    - `delivery-handler.js`: (Planned) For `/deliver` submission, `order_now`, `cancel_ready_offer`.
- **`functions/lib/`:** Contains reusable utilities and definitions.
    - `firebase.js`: Initializes `firebase-admin` and exports Firestore DB instance.
    - `slack.js`: Initializes and exports Bolt App instance.
    - `utils.js`: General utility functions (e.g., `getOrCreatePlayer`, karma calculation, fetching user info).
    - `constants.js`: Defines constants like karma costs per category, titles (maybe), channel IDs (though env var preferred), timer durations.
    - `modals/`: Directory for modal view definitions (e.g., `order-modal.js`).
    - `messages/`: Directory for message block kit definitions (e.g., `order-message.js`).
- **`functions/scheduled/`:** (Implied by `orderTimerUpdater`) Contains logic for scheduled tasks.
    - `order-timer.js`: (Likely location for `orderTimerUpdater` logic) Queries Firestore for active 'ordered' messages, calculates remaining time, updates Slack messages via `chat.update`. **Needs enhancement for expiration.**

## 8. Karma System

- **Cost Calculation:** Defined in `constants.js`, based on drink `category` selected in `/order` modal.
- **Deduction:** Occurs immediately upon valid `/order` submission *before* the order is logged in Firestore (`handleOrderSubmission`).
- **Award (Delivery):** Occurs when `deliver_order` action is handled (`handleDeliverOrder`).
    - Base amount = Original `karmaCost` of the order.
    - Bonus Multiplier: Randomly determined (currently 10% chance 3x, 10% chance 2x, 80% chance 1x).
    - Total Award = `karmaCost * bonusMultiplier`.
    - Awarded to the `runnerId`.
- **Refund (Cancellation):** Occurs when `cancel_order` action is handled (`handleCancelOrder`). Original `karmaCost` is added back to the `requesterId`.
- **Refund (Expiration):** (Planned) Should occur when an order expires. Original `karmaCost` refunded to `requesterId`.
- **Award (Redemption):** (Planned) Occurs on successful `/redeem`. Value from `redemptionCodes` doc added to user's karma.
- **Initial Karma:** (Planned/Optional) New users might start with a small amount (e.g., 3 Karma) upon first interaction / joining channel.

## 9. New Member Behavior (Planned)

- **Trigger:** `member_joined_channel` event when a user joins `KOFFEE_KARMA_CHANNEL_ID`.
- **Actions:**
    - **Public Message:** Post a short, randomized welcome message to the channel (e.g., "Welcome @User to Koffee Karma!").
    - **Direct Message (DM):** Send a detailed onboarding message explaining the bot's purpose, commands (`/order`, `/karma`, `/deliver`), and the Karma system.
    - **Firestore Write:** Create the player document in `players` collection (`getOrCreatePlayer`), potentially awarding initial Karma points.

## 10. Intended Behaviors & Validation

- `/order` Modal: Requires Category and Location. Shows inline errors.
- `/order` Submission: Fails if user has insufficient Karma (ephemeral message).
- `claim_order` Button: Only works on 'ordered' status messages. Requester cannot claim their own order (ephemeral error).
- `deliver_order` Button: Only works on 'claimed' status messages. Only the assigned runner can trigger it (ephemeral error).
- `cancel_order` Button: Only works on 'ordered' status messages. Only the original requester can trigger it (ephemeral error).
- `/deliver` Flow (Planned): Runner capabilities stored. When ordering via "ORDER NOW", modal should potentially filter/validate drink choice against runner's capabilities. Runner cannot use "ORDER NOW" on their own offer.
- Expiration (Planned): 'ordered' messages should change to 'expired' status after timeout (e.g., 10 mins), buttons removed, Karma refunded. Runner offers should expire similarly.

## 11. Next Steps & Known Issues

- **Verify Karma Calculations Across All Flows:**
    - **Issue:** User reported potential inconsistencies in Karma updates (deduction, award, refund) during testing. Recent logs for the `/deliver` -> "ORDER NOW" -> "MARK DELIVERED" flow show correct deduction and award, but comprehensive verification across all scenarios is required.
    - **Verification Steps:**
        - Test standard `/order` flow: Place order, check Firestore for requester Karma deduction immediately after submission confirmation.
        - Test `/deliver` -> "ORDER NOW" flow: Repeat test, check Firestore for requester Karma deduction.
        - Test `cancel_order` button (standard `/order` flow): Cancel an 'ordered' item, check Firestore for requester Karma refund. Verify Slack message updates correctly.
        - Test `deliver_order` button (for both standard `/order` claimed items AND `/deliver` flow claimed items): Mark as delivered, check Firestore for runner Karma award (including verification of bonus calculation). Check that the Public Bonus Message posts correctly when applicable. Verify Slack message updates correctly (shows bonus, total karma).
        - Test `handleOrderExpiration` (once fully implemented): Let a standard `/order` expire, check Firestore for requester Karma refund and correct message update.
        - **Enhancement:** Consider adding more detailed logging within the `updatePlayerKarma` and `updatePlayerKarmaById` functions (e.g., logging karma *before* and *after* the update attempt) to simplify debugging and Firestore verification.
- **Implement Order Expiration:**
    - Modify `orderTimerUpdater` (or create a new function) to identify orders past their `expiryTimestamp`.
    - Implement `handleOrderExpiration` logic in `order-handler.js`: Update Firestore status to 'expired', refund karma, update Slack message to final expired state.
    - Ensure `/order` submission correctly calculates and stores `expiryTimestamp`.
- **Implement `/deliver` Flow:** (Core functionality seems present, needs thorough testing)
    - Create Delivery Modal (Done).
    - Implement `delivery-handler.js` for modal submission (save capabilities, post offer message) (Done).
    - Create `runner-message.js` formatter (Done).
    - Post runner availability message (Done).
    - Implement `order_now` button action (opens order modal pre-filled/linked to runner) (Done - via `handleOrderSubmission` targeted flow).
    - Implement `cancel_ready_offer` button action.
    - Implement runner offer expiration.
    - Add capability validation in order modal (Done).
    - Test runner cannot use "ORDER NOW" on their own offer.
- **Implement `/leaderboard`:**
    - Add Firestore query in handler.
    - Format message.
- **Implement `/redeem`:**
    - Define Firestore schema for `redemptionCodes`.
    - Implement handler logic (validation, updates).
- **Implement New Member Welcome:**
    - Add `member_joined_channel` event handler.
    - Implement DM and public message logic.
    - Award initial karma if desired.
- **Refinements & Fixes:**
    - **Performance:** Monitor Cloud Function cold starts and execution time. Investigate any remaining significant delays. Consider Firestore indexing if needed.
    - **Timer Reliability:** Ensure Cloud Scheduler trigger for `orderTimerUpdater` is robust. Ensure timers are correctly stopped on claim/cancel. Verify countdowns display correctly for both `/order` messages and `/deliver` offers.
    - **Error Handling:** Improve user feedback on errors (e.g., Firestore write failures, insufficient karma during `/deliver` flow order placement).
    - **Titles:** Implement dynamic title calculation based on karma thresholds (fetch thresholds from Firestore config or use `constants.js`).
    - **Code Structure:** Continue organizing code logically (handlers, libs, utils).

## 12. Tracker Update (Summary for Edit)

- Mark tasks related to `claim_order`, `deliver_order`, `cancel_order` button logic (Firestore updates, message updates, DMs, karma award/refund, bonus multiplier) as ✅ Done (Pending final verification described above).
- Mark tasks related to message formatting for claimed, delivered, cancelled, expired states as ✅ Done.
- Mark tasks related to DM sending for claim/delivery as ✅ Done.
- Mark task related to Bonus Karma calculation/award/messaging as ✅ Done (Pending final verification).
- Update status of `orderTimerUpdater` to reflect it's running and updating countdowns, but expiration logic is still pending (`🚧 Partial` or keep ✅ Done for timer updates, add new task for expiration logic).
- Update `/deliver` flow tasks based on current implementation (modal, posting, ORDER NOW linking, validation seem ✅ Done, Cancel/Expiration TBD).
- Keep `/leaderboard`, `/redeem`, New Member flows as ❌ Not Functional or 🚧 Not Started.
- Keep Order Expiry mechanism as ⏳ Planned or 🚧 Not Started.
- Keep Title system as 🚧 Partial or 🚧 Not Started.
