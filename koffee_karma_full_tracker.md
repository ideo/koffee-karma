# Koffee Karma Master Tracker (Fully Updated + Behaviors)

This document meticulously tracks the development tasks and **intended behaviors**, categorized clearly, based on the Slackbot project using Bolt (Node.js) and Firebase Firestore.

## Development Tasks

| Category | Task | Status | Priority | Notes / Updates |
|:---|:---|:---|:---|:---|
| Slash Commands - `/order` | Build and open drink order modal | ✅ Done | High | Modal built and launches correctly |
| Slash Commands - `/order` | Validate modal inputs (category, location) | ✅ Done | High | Errors appear/disappear immediately on interaction. |
| Slash Commands - `/order` | Calculate karma cost from category selection | ✅ Done | High | Karma cost calculated based on `constants.js`. |
| Slash Commands - `/order` | Check if requester has enough karma before order | ✅ Done | High | Ephemeral message if insufficient karma; stops processing. |
| Slash Commands - `/order` | Deduct karma on order submission | ✅ Done | High | Subtracts karma points in Firestore *before* logging order (uses atomic increment). |
| Slash Commands - `/order` | Create Firestore order record on submission | ✅ Done | High | Logs order details on submission. Includes `requesterId/Name`, `recipientId/Name`, `initiatedBy: 'requester'`, `slackChannelId/Name`. `createdAt` added automatically by Firestore. |
| Slash Commands - `/order` | Post order message to Slack | ✅ Done | High | Placeholder posted immediately, updated with final order after processing. Includes `(SELF)` / `(GIFT)` label. |
| Slash Commands - `/order` | Update Firestore order with Slack `ts` and `channelId` | ✅ Done | Medium | Updates order doc with placeholder `ts` and fetched `channelId/Name` after successful update. |
| Slash Commands - `/order` | Set expiry timestamp for order (10 minutes) | ✅ Done | Medium | `expiryTimestamp` set in `handleOrderSubmission`. |
| Slash Commands - `/order` | Gift recipient handling (self vs gift) | ✅ Done | Medium | Fetches real names, sets recipient correctly in DB data. Message includes `(SELF)` / `(GIFT)`. |
| Slash Commands - `/karma` | Fetch and display player's karma and title | ✅ Done | Medium | Working via `karma-handler.js`; ephemeral message |
| Slash Commands - `/deliver` | Open deliver availability modal | ✅ Done | High | Modal built and submits correctly. |
| Slash Commands - `/deliver` | Capture runner capabilities and delivery time | ✅ Done | High | Saves capabilities array + timer (`durationMs`, `expiryTimestamp`). `createdAt` added. |
| Slash Commands - `/deliver` | Post runner availability message to Slack | ✅ Done | Medium | Includes capabilities, ORDER NOW, and CANCEL. Timer display fixed. |
| Slash Commands - `/deliver` | Allow requester to order via Runner offer | ✅ Done | High | Pre-linked runner in order modal (`handleOrderSubmission` targeted flow). |
| Slash Commands - `/deliver` | Validate drink category against runner capabilities | ✅ Done | High | Modal error shown if incompatible drink selected. |
| Slash Commands - `/leaderboard` | Fetch and display top 5 players | ❌ Not Functional | Medium | Message formatting ready; Firestore query missing |
| Slash Commands - `/redeem` | Redeem codes to grant karma boosts | ❌ Not Functional | Medium | Check code validity, max redemptions, expiry |
| Firestore - Players | Create player on first interaction | ✅ Done | High | `getOrCreatePlayer` function working and used in order flow. |
| Firestore - Players | Update player's karma and title dynamically | ✅ Done | High | `updatePlayerKarma` / `updatePlayerKarmaById` use atomic increments. Title calculation still TBD. |
| Firestore - Players | Save runner capabilities as an array | ✅ Done | Medium | Saved on `/deliver` submission. |
| Firestore - Orders | Create new order document | ✅ Done | High | Logged at `/order` modal submission with correct fields (`initiatedBy: 'requester'`, `slackChannelName`, etc.). Auto-ID used. `createdAt` added by DB. |
| Firestore - Orders | Update order on claim, deliver, cancel | ✅ Done | High | Status, timestamps (`timeClaimed`, `timeDelivered`), runner info updated. Karma refunded/awarded atomically. **Needs thorough testing across all flows.** |
| Firestore - Orders | Handle order expiry and cleanup (after 10 minutes) | ✅ Done | Medium | `orderTimerUpdater` function queries for expired items, updates status to `EXPIRED`, refunds karma, and updates message. |
| Firestore - Runner Offers (`orders` coll.) | Create runner offer document | ✅ Done | High | Logged at `/deliver` modal submission (`initiatedBy: 'runner'`, `status: 'OFFERED'`, `createdAt` added). |
| Firestore - Runner Offers (`orders` coll.) | Update runner offer on order submission | ✅ Done | High | When using "ORDER NOW", the runner offer document is updated to `CLAIMED` status with requester/drink details, `timeClaimed`. |
| Firestore - Redemption Codes | Allow codes with maximum number of redemptions | 🚧 Not Started | Medium | Customizable limit; track redemptions |
| Slack UX | Modal - Update ASCII map dynamically | ✅ Done | Medium | `update_modal_map` on location select |
| Slack UX | Modal - Display field errors inline | ✅ Done | Medium | Works correctly for category/location. |
| Slack UX | Modal - Update category dropdown with karma cost | ✅ Done | Medium | Dynamically generated from constants, shows cost (e.g., "Tea – 2 Karma"). |
| Slack UX | Modal - Enforce 30 char limit on Drink/Notes | ✅ Done | Low | `max_length` set correctly in `modal-builder.js`. Enforces limit via client-side validation. |
| Slack UX | Modal - *Display* character count for Drink/Notes | 🚧 Blocked / Needs Research | Medium | **Current Task.** Standard Block Kit doesn't support live count display. Needs alternative approach (JS interaction?) or confirmation of impossibility. |
| Slack UX | Messages - Order message blocks formatted | ✅ Done | High | ASCII layout correct. Message updates for Claimed, Delivered (with total karma), Cancelled states implemented. Includes `(SELF)` / `(GIFT)`. |
| Slack UX | Messages - Runner offer message blocks formatted | ✅ Done | Medium | Formatted correctly, includes timer. |
| Slack UX | Messages - Countdown timer visual updates | ✅ Done | Medium | `orderTimerUpdater` function handles visual updates for active orders/offers *and* triggers expiration logic (`processExpiredOrders`/`processExpiredRunnerOffers`). |
| Slack UX | Button Actions - CLAIM, CANCEL, MARK DELIVERED, ORDER NOW | ✅ Done | High | Logic implemented in `order-handler.js` and `delivery-handler.js`. Message updates, Firestore updates, DMs, karma refund/award handled. **Needs thorough testing.** |
| Slack UX | Bonus karma multiplier triggered at delivery | ✅ Done | Medium | 10% chance for 2x or 3x calculated and awarded in `handleDeliverOrder`. Message updated (with total karma), public announcement posted. |
| Messaging - Public | New member public welcome message | 🚧 Not Started | Medium | Short randomized greeting in channel |
| Messaging - DM | New member tutorial message (direct message) | 🚧 Not Started | Medium | Full onboarding tutorial in DM |
| Messaging - DM | Order status updates to requester and runner | ✅ Done | Medium | DMs sent on claim (to runner/requester) and delivery (to runner/requester, includes total karma). |
| Messaging - Ephemeral | Insufficient karma message after failed `/order` | ✅ Done | Medium | Ephemeral notice sent, processing stops. |
| Messaging - Ephemeral | Incompatible drink category selection | ✅ Done | High | Modal stays open, shows inline error during `/deliver` flow. |
| Button Behaviors | Claim button - requester cannot claim own order | ✅ Done | High | Ephemeral message shown if attempted (developer override exists). |
| Button Behaviors | Cancel button - only requester can cancel | ✅ Done | High | Checked in handler; ephemeral message sent if invalid user. |
| Button Behaviors | Mark as Delivered - runner or receiver only | ✅ Done | High | Checked in handler (runner only currently); ephemeral message sent if invalid user. |
| Button Behaviors | Order Now - only requester (not runner) can order | ✅ Done | High | Block runner from ordering own availability (checked in `handleOrderSubmission` targeted flow). |
| Config Management | Karma titles dynamically pulled from Firestore | 🚧 Not Started | Medium | Configurable title thresholds |
| Infrastructure & Scheduling | Implement order/offer expiration mechanism (e.g., Cloud Scheduler + Pub/Sub + Function) | ✅ Done | Medium | `orderTimerUpdater` Cloud Function triggered by Pub/Sub topic (`check-order-timers`) handles querying and processing active/expired items. |
| Error Handling & Logging | Implement robust error handling for Firestore and Slack API calls | ✅ Done | Medium | Basic error handling improved (e.g., atomic increments, checks removed). Logging improved slightly. |
| Error Handling & Logging | Set up structured backend logging/alerting | 🚧 Not Started | Low | Improve observability for production issues (optional). |
| Testing | Implement unit tests for key utilities (database, karma calc, formatting) | 🚧 Not Started | Medium | Ensure core logic is reliable. |
| Testing | Implement integration tests for core command flows | 🚧 Not Started | Low | Verify end-to-end functionality (optional). |

---

## Intended Behaviors & Data Flows

| Element | Behavior | Firestore Interaction | Notes |
|:---|:---|:---|:---|
| `/order` Modal | User submits drink order modal | Create new document in `orders` | Validate karma and deduct before creating order. Includes `initiatedBy`, `slackChannelName`. |
| `/order` Validation | Required fields must be filled | None if blocked | Inline errors shown in modal |
| `/order` Karma Check | Insufficient karma prevents order | None if blocked | Ephemeral message sent |
| `/order` Post Message | After order submitted, post to Slack | Update `orders` with `ts` and `channelId`/`Name` | Includes `(SELF)` / `(GIFT)` |
| `/order` Expiry Timer | 10-minute expiration if not claimed | Set `expiryTimestamp` in `orders` | Needs auto-expire mechanism |
| `/deliver` Modal | Runner submits availability modal | Update `players` with capabilities. Create new `orders` doc (status `OFFERED`) | Includes `initiatedBy: 'runner'`, `createdAt`, `slackChannelId`/`Name`. |
| `/deliver` Validation | Must select at least one capability | None if blocked | Modal validation error if none selected |
| `/deliver` Runner Offer Post | Slack message with ORDER NOW button | Runner `orders` doc created (see above) | Order created (updates runner's doc) if ORDER NOW clicked. |
| Claim Button | Runner clicks to claim order | Update `orders` to `claimed` status, assign runner info, `timeClaimed` | Block requester from claiming their own order |
| Cancel Button | Requester cancels unclaimed order | Update `orders` to `cancelled` status, refund karma atomically | Only requester can cancel |
| Mark as Delivered Button | Runner/Receiver marks delivery complete | Update `orders` to `delivered` status, `timeDelivered`. Award karma atomically. | Check bonus multiplier chance and adjust karma |
| Bonus Karma Multiplier | 10% chance for 2x or 3x karma at delivery | Update runner's karma points atomically and update message | Update order message to reflect bonus |
| Redemption Codes | Redeemable codes with max uses | Update `redemptionCodes` and player's `karma` | Prevent reuse once fully redeemed |
| New Member Welcome | Public welcome + DM onboarding | Create new document in `players`, award 3 karma | Check if already exists to avoid re-awarding |
| `/karma` Command | User checks their current karma | Read from `players` collection | Ephemeral message with karma and title |
| `/leaderboard` Command | Show top 5 players | Query sorted by karma | Display formatted leaderboard |
| `/redeem` Command | Enter code to gain karma | Validate and update redemption usage | Handle invalid, expired, already used codes |

---

# Additional Notes

- Bonus karma multiplier is triggered at **mark-as-delivered** time.
- Runner capabilities are **stored as arrays**.
- Timers: `/order` = 10 minutes, `/deliver` = 5/10/15 minutes. Timer text uses `floor()`. Timer updates driven by `createdAt`.
- Redemption codes allow flexible limits.
- Runner validation during ORDER NOW flow dynamically restricts drink categories.
- Karma titles pulled live from Firestore.

---
