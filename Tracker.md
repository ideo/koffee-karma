# Koffee Karma Master Tracker (Fully Updated + Behaviors)

This document meticulously tracks the development tasks and **intended behaviors**, categorized clearly, based on the Slackbot project using Bolt (Node.js) and Firebase Firestore.

## Development Tasks

| Category | Task | Status | Priority | Notes / Updates |
|:---|:---|:---|:---|:---|
| Slash Commands - `/order` | Build and open drink order modal | ✅ Done | High | Modal built and launches correctly |
| Slash Commands - `/order` | Validate modal inputs (category, location) | ✅ Done | High | Errors appear/disappear immediately on interaction. |
| Slash Commands - `/order` | Calculate karma cost from category selection | ✅ Done | High | Karma cost calculated based on `constants.js`. |
| Slash Commands - `/order` | Check if requester has enough karma before order | ✅ Done | High | Ephemeral message if insufficient karma; stops processing. Uses Karma. |
| Slash Commands - `/order` | Deduct karma on order submission | ✅ Done | High | Subtracts Karma in Firestore *before* logging order (uses atomic increment). |
| Slash Commands - `/order` | Create Firestore order record on submission | ✅ Done | High | Logs order details on submission. Includes `requesterId/Name`, `recipientId/Name`, `initiatedBy: 'requester'`, `slackChannelId/Name`, `karmaCost`. `createdAt` added automatically by Firestore. |
| Slash Commands - `/order` | Post order message to Slack | ✅ Done | High | Placeholder posted immediately, updated with final order after processing. Includes `(SELF)` / `(GIFT)` label. |
| Slash Commands - `/order` | Update Firestore order with Slack `ts` and `channelId` | ✅ Done | Medium | Updates order doc with placeholder `ts` and fetched `channelId/Name` after successful update. |
| Slash Commands - `/order` | Set expiry timestamp for order (10 minutes CLAIM timer) | ✅ Done | Medium | `expiryTimestamp` set in `handleOrderSubmission`. |
| Slash Commands - `/order` | Gift recipient handling (self vs gift) | ✅ Done | Medium | Fetches real names, sets recipient correctly in DB data. Message includes `(SELF)` / `(GIFT)`. |
| Slash Commands - `/karma` | Fetch and display player's karma and title | ✅ Done | Medium | Working via `karma-handler.js`; ephemeral message shows Karma, Reputation, and Title using minimal inline format. Placeholder message added. |
| Slash Commands - `/deliver` | Open deliver availability modal | ✅ Done | High | Modal built and submits correctly. |
| Slash Commands - `/deliver` | Capture runner capabilities and delivery time | ✅ Done | High | Saves capabilities array + timer (`durationMs`, `expiryTimestamp`). `createdAt` added. |
| Slash Commands - `/deliver` | Post runner availability message to Slack | ✅ Done | Medium | Includes capabilities, ORDER NOW, and CANCEL. Timer display fixed. |
| Slash Commands - `/deliver` | Allow requester to order via Runner offer | ✅ Done | High | Pre-linked runner in order modal (`handleOrderSubmission` targeted flow). |
| Slash Commands - `/deliver` | Validate drink category against runner capabilities | ✅ Done | High | Modal error shown if incompatible drink selected. |
| Slash Commands - `/leaderboard` | Fetch and display top 5 players | ✅ Done | Medium | Firestore query implemented; displays top 5 by reputation using ASCII table format. Function call corrected. |
| Slash Commands - `/redeem` | Redeem codes to grant karma boosts | ❌ Not Functional | Medium | Check code validity, max redemptions, expiry |
| Firestore - Players | Create player on first interaction | ✅ Done | High | `getOrCreatePlayer` function working, initializes `karma: 0`, `reputation: 0`, `ordersRequestedCount: 0`, `deliveriesCompletedCount: 0`. |
| Firestore - Players | Update player's karma and title dynamically | ✅ Done | High | `updatePlayerKarma`, `updatePlayerReputation`, `updatePlayerOrdersRequestedCount`, `updatePlayerDeliveryCount` use atomic increments. Title calculation based on `reputation`. |
| Firestore - Players | Save runner capabilities as an array | ✅ Done | Medium | Saved on `/deliver` submission. |
| Firestore - Orders | Create new order document | ✅ Done | High | Logged at `/order` modal submission with correct fields (`initiatedBy: 'requester'`, `slackChannelName`, etc.). Auto-ID used. `createdAt` added by DB. |
| Firestore - Orders | Update order on claim, deliver, cancel (requester), runner cancel, expiration (unclaimed/claimed) | ✅ Done | High | Status, timestamps (`timeClaimed`, `claimedExpiryTimestamp`, `timeDelivered`), runner info updated. Karma refunded/awarded atomically. Reputation awarded on delivery. `ordersRequestedCount` & `deliveriesCompletedCount` incremented on delivery. |
| Firestore - Orders | Handle order expiry and cleanup (unclaimed: 10 min) | ✅ Done | Medium | `orderTimerUpdater` function queries for expired 'ordered' items, updates status to `EXPIRED`, refunds Karma, and updates message. |
| Firestore - Orders | Handle claimed order expiry (runner timeout: 10 min) | ❌ Needs Verification | Medium | `orderTimerUpdater` function handles querying/processing: 'claimed' -> 'EXPIRED_CLAIMED', refunds Karma, updates message. |
| Firestore - Runner Offers (`orders` coll.) | Create runner offer document | ✅ Done | High | Logged at `/deliver` modal submission (`initiatedBy: 'runner'`, `status: 'OFFERED'`, `createdAt` added). |
| Firestore - Runner Offers (`orders` coll.) | Update runner offer on order submission | ✅ Done | High | When using "ORDER NOW", the runner offer document is updated to `CLAIMED` status with requester/drink details, `timeClaimed`. **Includes check to ensure offer is still 'OFFERED' before claiming.** |
| Firestore - Runner Offers (`orders` coll.) | Handle runner offer expiry | ✅ Done | Medium | `orderTimerUpdater` function queries for expired 'OFFERED' items, updates status to `EXPIRED_OFFER`, and updates message. |
| Firestore - Redemption Codes | Allow codes with maximum number of redemptions | 🚧 Not Started | Medium | Customizable limit; track redemptions |
| Slack UX | Modal - Update ASCII map dynamically | ✅ Done | Medium | `update_modal_map` on location select |
| Slack UX | Modal - Display field errors inline | ✅ Done | Medium | Works correctly for category/location. |
| Slack UX | Modal - Update category dropdown with karma cost | ✅ Done | Medium | Dynamically generated from constants, shows cost (e.g., "Tea – 2 Karma"). |
| Slack UX | Modal - Enforce 30 char limit on Drink/Notes | ✅ Done | Low | `max_length` set correctly in `modal-builder.js`. Enforces limit via client-side validation. |
| Slack UX | Modal - *Display* character count for Drink/Notes | ✅ Done | Medium | Standard Block Kit doesn't support live count display. (Marked as disregarded/resolved). |
| Slack UX | Messages - Order message blocks formatted (New Style) | ✅ Done | High | New format (dynamic title, category line, 10-char bar, status layout, reputation display) implemented in `order-message.js`. Timer updates confirmed working. |
| Slack UX | Messages - Runner offer message blocks formatted | ✅ Done | Medium | Formatted correctly, includes timer. |
| Slack UX | Messages - Countdown timer visual updates (Orders) | ✅ Done | High | `orderTimerUpdater` handles updates for active 'ordered'/'claimed'. Uses `formatTimeRemaining` with 10-char bar length. Uses `Math.ceil`. |
| Slack UX | Messages - Countdown timer visual updates (Offers) | ✅ Done | Medium | `orderTimerUpdater` logic implemented and integrated with `formatRunnerOfferMessage`. Uses `formatTimeRemaining` (with `Math.ceil`) and 20-char bar. |
| Slack UX | Button Actions - CLAIM, CANCEL (Requester), MARK DELIVERED, ORDER NOW, CANCEL DELIVERY (Runner) | ✅ Done | High | Logic implemented. Message updates, Firestore updates (karma, reputation, counts), DMs handled. |
| Slack UX | Bonus karma multiplier triggered at delivery | ✅ Done | Medium | Calculated & awarded (Karma + Reputation). Message updated, public announcement posted. |
| Messaging - Public | New member public welcome message | ✅ Done | Medium | Pulls randomly from `WELCOME_MESSAGES` in `constants.js`. |
| Messaging - DM | New member tutorial message (direct message) | ✅ Done | Medium | Sends detailed DM. Awards 3 initial Karma to new players joining the designated channel. |
| Messaging - DM | Order status updates to requester and runner | ✅ Done | Medium | DMs sent on claim (to runner/requester) and delivery (to runner/requester, includes Karma earned). Line breaks fixed. Order confirmation DM added. |
| Messaging - Ephemeral | Insufficient karma message after failed `/order` | ✅ Done | Medium | Ephemeral notice sent (shows current Karma), processing stops. |
| Messaging - Ephemeral | Incompatible drink category selection | ✅ Done | High | Modal stays open, shows inline error during `/deliver` flow. |
| Button Behaviors | Claim button - requester cannot claim own order | ✅ Done | High | Ephemeral message shown (developer override exists). |
| Button Behaviors | Cancel button (Requester) - only requester can cancel 'ordered' | ✅ Done | High | Checked in handler; ephemeral message sent if invalid user. |
| Button Behaviors | Cancel Delivery button (Runner) - only runner can cancel 'claimed' | ✅ Done | High | Checked in handler; ephemeral message sent if invalid user. |
| Button Behaviors | Mark as Delivered - runner only | ✅ Done | High | Checked in handler; awards karma/reputation; ephemeral message sent if invalid user. |
| Button Behaviors | Order Now - only requester (not runner) can order | ✅ Done | High | Block runner from ordering own availability. Handles race condition. Self-order check fixed; developer override added. |
| Config Management | Karma titles dynamically pulled from Firestore | 🚧 Not Started | Medium | Configurable title thresholds (based on Reputation) |
| Infrastructure & Scheduling | Implement order/offer expiration mechanism | ✅ Done (Partial Verification) | Medium | `orderTimerUpdater` handles querying/processing: 'ordered' -> 'expired' (✅), 'OFFERED' -> 'EXPIRED_OFFER' (✅), 'claimed' -> 'EXPIRED_CLAIMED' (❌ Needs Verification). |
| Error Handling & Logging | Implement robust error handling for Firestore and Slack API calls | ✅ Done | Medium | Basic error handling improved. Logging improved slightly. |
| Error Handling & Logging | Module System Consistency Review | ✅ Done | High | Reviewed all core files. |
| Testing | Implement unit tests for key utilities (database, karma calc, formatting) | 🚧 Not Started | Medium | Ensure core logic is reliable. |
| Testing | Implement integration tests for core command flows | 🚧 Not Started | Low | Verify end-to-end functionality (optional). |

---

## Intended Behaviors & Data Flows

| Element | Behavior | Firestore Interaction | Notes |
|:---|:---|:---|:---| 
| `/order` Modal | User submits drink order modal | Create new document in `orders` | Validate karma and deduct before creating order. Includes `initiatedBy`, `slackChannelName`. |
| `/order` Validation | Required fields must be filled | None if blocked | Inline errors shown in modal |
| `/order` Karma Check | Insufficient karma prevents order | None if blocked | Ephemeral message sent |
| `/order` Post Message | After order submitted, post to Slack | Update `orders` with `ts` and `channelId`/`Name` | Includes `(SELF)` / `(GIFT)`. Uses new format. |
| `/order` Expiry Timer | 10-minute expiration if not claimed | Set `expiryTimestamp` in `orders`. `orderTimerUpdater` checks this. | Updates status to `expired`. |
| `/deliver` Modal | Runner submits availability modal | Update `players` with capabilities. Create new `orders` doc (status `OFFERED`) | Includes `initiatedBy: 'runner'`, `createdAt`, `slackChannelId`/`Name`. |
| `/deliver` Validation | Must select at least one capability | None if blocked | Modal validation error if none selected |
| `/deliver` Runner Offer Post | Slack message with ORDER NOW button | Runner `orders` doc created (see above) | Order created (updates runner's doc) if ORDER NOW clicked. **Only the first user to submit a valid order modal against an 'OFFERED' status offer will succeed. Others get an ephemeral error.** |
| Claim Button | Runner clicks to claim order | Update `orders` to `claimed` status, assign runner info, `timeClaimed`, `claimedExpiryTimestamp` | Block requester. Starts 10-min delivery timer. Updates message to new 'claimed' format. |
| Cancel Button (Requester) | Requester cancels unclaimed ('ordered') order | Update `orders` to `cancelled` status, refund Karma atomically | Only requester can cancel. Updates message to simple text. |
| Cancel Delivery Button (Runner) | Runner cancels claimed order | Update `orders` to `CANCELLED_RUNNER` status, refund Karma atomically | Only assigned runner can cancel. Updates message to simple text. |
| Mark as Delivered Button | Runner marks delivery complete | Update `orders` to `delivered` status, `timeDelivered`. Award Karma (`karma` field) & Reputation (`reputation` field) atomically. Increment `ordersRequestedCount` & `deliveriesCompletedCount`. | Check bonus multiplier. Updates message to new 'delivered' format. |
| Claimed Order Expiry | 10-minute delivery timer runs out | `orderTimerUpdater` updates status to `EXPIRED_CLAIMED`, refunds Karma atomically. | Updates message to simple text. **Needs verification.** |
| Bonus Karma Multiplier | 10% chance for 2x or 3x karma at delivery | Update runner's karma points atomically and update message | Update order message to reflect bonus |
| Redemption Codes | Redeemable codes with max uses | Update `redemptionCodes` and player's `karma` | Prevent reuse once fully redeemed |
| New Member Welcome | Public welcome + DM onboarding | Create new document in `players`, award 3 karma | Check if already exists to avoid re-awarding |
| `/karma` Command | User checks their Karma | Read from `players` collection | Ephemeral message with Karma (`karma` field), Reputation (`reputation` field), and title. |
| `/leaderboard` Command | Show top 5 players | Query sorted by `reputation` | Display leaderboard ranked by Reputation. |
| `/redeem` Command | Enter code to gain karma | Validate and update redemption usage | Handle invalid, expired, already used codes |

---

# Additional Notes

- **Tone of Voice / Aesthetic:** A specific "punk" aesthetic (serious, raw, stylized, no exclamation marks, sparse emojis, mix of casing) has been applied to most user-facing text elements (modals, buttons, errors, DMs, command outputs). The main block-kit order/runner messages were excluded from this styling. See `USER_FACING_TEXT copy.md` for details. Verified no exclamation marks in recent handlers.
- Bonus karma multiplier is triggered at **mark-as-delivered** time.
- Runner capabilities are **stored as arrays**.
- Timers: `/order` = 10 minutes, `/deliver` = 5/10/15 minutes. **Timer text uses `Math.ceil()` to round up.** Timer updates driven by `createdAt` or `timeClaimed`. Order timer updates active; Offer timer updates implemented.
- Redemption codes allow flexible limits.
- Runner validation during ORDER NOW flow dynamically restricts drink categories.
- Title system based on Reputation (logic TBD).

- Reputation is a cumulative, non-decreasing score that tracks total engagement. Requesters earn Reputation equal to the amount spent when an order is delivered; runners earn Reputation equal to what they receive (including bonus). This metric is used for leaderboard rankings.

---

- *Note: Firestore fields are now `karma` and `reputation`.*

---

## Integration Tests

| Category | Task | Status | Priority | Notes / Updates |
|:---|:---|:---|:---|:---|
| User Init & Basic Commands | New User First Interaction (`/karma`) | ✅ Done | High | Verify new player doc in Firestore, initial Karma/Reputation/Title in ephemeral message. |
| User Init & Basic Commands | `/karma` Command for Existing User | ✅ Done | Medium | Verify correct Karma/Reputation/Title displayed for existing user; no data change in Firestore. |
| `/order` Flow | Successful Order Placement (Self) | ✅ Done | High | Verify Karma deduction, `orders` doc creation (self-recipient, status `ordered`, cost, expiry), Slack channel message (via mocks), DM confirmation (via mocks). Resolved `expect(mockChatUpdate)` assertion. |
| `/order` Flow | Successful Order Placement (Gift for Another User) | 🚧 Not Started | High | Verify Karma deduction, `orders` doc (gift-recipient, status `ordered`, cost, expiry), Slack channel message (`(GIFT)` label), DM confirmation. |
| `/order` Flow | Order Attempt with Insufficient Karma | 🚧 Not Started | High | Verify Karma unchanged, no order doc, ephemeral error message. |
| `/order` Flow | Order Modal Input Validation (Missing Category/Location) | 🚧 Not Started | Medium | Verify modal shows inline error, submission prevented, no Firestore changes. |
| `/order` Flow | Order Cancellation by Requester (Before Claim) | 🚧 Not Started | High | Verify order status to `cancelled`, Karma refunded to requester, Slack message updates (cancelled text, buttons removed), DM confirmation. |
| `/order` Flow | Order Expiration (Unclaimed) | 🚧 Not Started | High | Verify order status to `expired`, Karma refunded, Slack message updates (expired text, buttons removed), DM confirmation. (Requires `orderTimerUpdater` execution). |
| `/deliver` Flow | Successful Runner Offer Creation | 🚧 Not Started | High | Verify runner `capabilities` updated in `players`, new `orders` doc (status `OFFERED`, capabilities, duration, expiry, `initiatedBy: 'runner'`), Slack channel message (availability, buttons), ephemeral confirmation. |
| `/deliver` Flow | Runner Offer Expiration | 🚧 Not Started | Medium | Verify offer doc status to `EXPIRED_OFFER`, Slack message updates (expired text, buttons removed). (Requires `orderTimerUpdater` execution). |
| `/deliver` Flow | Runner Cancels Own Offer | 🚧 Not Started | Medium | Verify offer doc status updated (e.g., `CANCELLED_OFFER`), Slack message updates (buttons removed). |
| `/deliver` Flow | User Successfully Orders via "ORDER NOW" on Runner Offer | 🚧 Not Started | High | Verify offer doc updates to `CLAIMED` (requester set, drink details, `timeClaimed`), requester Karma deducted, Slack message updates (claimed status, new buttons), DMs to requester & runner. |
| `/deliver` Flow | User Orders via "ORDER NOW" - Incompatible Drink Category | 🚧 Not Started | Medium | Verify modal shows inline error, submission blocked, no Firestore changes. |
| `/deliver` Flow | Runner Attempts to "ORDER NOW" on Own Offer | 🚧 Not Started | Medium | Verify ephemeral error, modal does not open/submission blocked, no Firestore changes. |
| `/deliver` Flow | Race Condition for "ORDER NOW" - Second User Fails | 🚧 Not Started | High | Verify first user succeeds, second user gets ephemeral error, offer claimed by first, no order/karma change for second. |
| Claim & Delivery Flow | Successful Order Claim by Another User (Standard Order) | 🚧 Not Started | High | Verify order status to `claimed`, `runnerId`/`Name`, `timeClaimed` set, (optional `claimedExpiryTimestamp`), Slack message updates (buttons, status), DMs to requester & runner. |
| Claim & Delivery Flow | Requester Attempts to Claim Own Standard Order | 🚧 Not Started | Medium | Verify ephemeral error, order status/data unchanged. |
| Claim & Delivery Flow | Successful Delivery by Runner (No Bonus) | 🚧 Not Started | High | Verify order status `delivered`, `timeDelivered`, `bonusMultiplier: 1`. Requester: Reputation & `ordersRequestedCount` updated. Runner: Karma, Reputation & `deliveriesCompletedCount` updated. Slack message (delivered, Karma earned), DMs. |
| Claim & Delivery Flow | Successful Delivery by Runner (With Bonus) | 🚧 Not Started | High | Verify order `bonusMultiplier > 1`. Requester: Reputation updated (by original cost). Runner: Karma & Reputation updated (with bonus). Counts updated. Slack message (bonus indicated), public bonus announcement, DMs. |
| Claim & Delivery Flow | Delivery Attempt by Non-Runner User | 🚧 Not Started | Medium | Verify ephemeral error, no Firestore changes. |
| Claim & Delivery Flow | Order Cancellation by Runner (Post-Claim) | 🚧 Not Started | High | Verify order status to `CANCELLED_RUNNER`, requester Karma refunded, Slack message updates, DMs. |
| Claim & Delivery Flow | Claimed Order Expiration (Runner Timeout) | 🚧 Not Started | High | **Needs Verification.** Verify order status `EXPIRED_CLAIMED`, requester Karma refunded, Slack message updates, DM to requester. (Requires `orderTimerUpdater` execution). |
| `/leaderboard`