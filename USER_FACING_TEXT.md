# Koffee Karma - User-Facing Text Audit

This document lists all identified user-facing text strings and templates within the Koffee Karma Slack bot application.

*Note: Dynamic values like usernames, drink names, karma amounts, locations, times, etc., are represented using placeholders like `[User Name]`, `[Drink Name]`, `[X] Karma`, `[Location]`, `[N] MINS`.*

| Text / Template                                     | Context/Location                                    | Type                 |
| :-------------------------------------------------- | :-------------------------------------------------- | :------------------- |
| **`/order` Command & Modal**                        |                                                     |                      |
| Place An Order                                      | `/order` Modal: Title                               | Modal Title          |
| Submit Order                                        | `/order` Modal: Submit Button                       | Modal Button         |
| Cancel                                              | `/order` Modal: Close Button                        | Modal Button         |
| *What type of drink do you want?*                   | `/order` Modal: Category Selection Section        | Modal Text           |
| Select a drink type                                 | `/order` Modal: Category Select Placeholder         | Modal Placeholder    |
| [Category Name] – [X] Karma                         | `/order` Modal: Category Select Option (Enabled)    | Modal Dropdown Text  |
| ⊘ [Category Name] ⊘                                 | `/order` Modal: Category Select Option (Disabled for Runner Offer) | Modal Dropdown Text  |
| Drink details                                       | `/order` Modal: Drink Input Label                   | Modal Label          |
| e.g., Large latte with oat milk                     | `/order` Modal: Drink Input Placeholder             | Modal Placeholder    |
| *Where are you located?*                            | `/order` Modal: Location Selection Section          | Modal Text           |
| Select your location                                | `/order` Modal: Location Select Placeholder         | Modal Placeholder    |
| [Location Display Name]                             | `/order` Modal: Location Select Option              | Modal Dropdown Text  |
| ``` [ASCII Map Text] ```                            | `/order` Modal: Map Display Section               | Modal Text (Code)    |
| Who is this for? (Leave empty if for yourself)      | `/order` Modal: Recipient Input Label               | Modal Label          |
| Select recipient...                                 | `/order` Modal: Recipient Select Placeholder        | Modal Placeholder    |
| Notes                                               | `/order` Modal: Notes Input Label                   | Modal Label          |
| Any special instructions?                           | `/order` Modal: Notes Input Placeholder             | Modal Placeholder    |
| *Invalid input. Please select a category.*          | `/order` Modal: Category Validation Error (likely)  | Modal Error Text     |
| *Invalid input. Please select a location.*          | `/order` Modal: Location Validation Error (likely)  | Modal Error Text     |
| *Invalid category for this runner.*                 | `/order` Modal: Runner Capability Validation Error (Targeted Order) | Modal Error Text     |
| Sorry, you don't have enough Karma to place this order! You have [X] Karma. | `/order` Submission: Insufficient Karma Error   | Ephemeral Error      |
| 🤔 Sorry, something went wrong processing your order. Please try again. | `/order` Submission: Generic Processing Error     | Ephemeral Error      |
| Processing your order...                            | `/order` Submission: Initial Placeholder Message    | Public Message       |
| :hourglass_flowing_sand: Processing [User Name]'s order... | `/order` Submission: Initial Placeholder Message (Block) | Public Message       |
| **`/deliver` Command & Modal**                      |                                                     |                      |
| Offer to Deliver                                    | `/deliver` Modal: Initial Loading Title             | Modal Title          |
| :hourglass_flowing_sand: Loading your capabilities... | `/deliver` Modal: Initial Loading Text              | Modal Text           |
| Offer to Deliver Drinks                             | `/deliver` Modal: Final Title                       | Modal Title          |
| Post Offer                                          | `/deliver` Modal: Submit Button                     | Modal Button         |
| Cancel                                              | `/deliver` Modal: Close Button                      | Modal Button         |
| Select the types of drinks you can make and how long youll be available. | `/deliver` Modal: Instructions Section            | Modal Text           |
| What can you make?                                  | `/deliver` Modal: Capabilities Input Label          | Modal Label          |
| [Category Name]                                     | `/deliver` Modal: Capabilities Checkbox Option      | Modal Checkbox Text  |
| How long are you available?                         | `/deliver` Modal: Duration Input Label              | Modal Label          |
| Select duration                                     | `/deliver` Modal: Duration Select Placeholder       | Modal Placeholder    |
| [N] minutes                                         | `/deliver` Modal: Duration Select Option            | Modal Dropdown Text  |
| *Please select at least one capability.*            | `/deliver` Modal: Capability Validation Error (likely) | Modal Error Text     |
| *Please select a duration.*                         | `/deliver` Modal: Duration Validation Error (likely) | Modal Error Text     |
| Sorry, there was an error opening the delivery modal: [Error Details] (View ID: [View ID]) | `/deliver` Command: Modal Opening Error | Ephemeral Error      |
| ✅ Your offer to deliver for [N] minutes has been posted! | `/deliver` Submission: Success Confirmation       | Ephemeral Message    |
| 🤔 Sorry, something went wrong posting your delivery offer. Please try again. | `/deliver` Submission: Generic Processing Error | Ephemeral Error      |
| Processing [User Name]'s delivery offer...          | `/deliver` Submission: Initial Placeholder Message  | Public Message       |
| :hourglass_flowing_sand: Processing [User Name]'s delivery offer... | `/deliver` Submission: Initial Placeholder Message (Block) | Public Message       |
| **`/karma` Command**                                |                                                     |                      |
| Your Karma: [X] Karma, Reputation: [Y], Title: [Title] | `/karma` Command: Result Display                  | Ephemeral Message    |
| Error fetching your Karma. Please try again.        | `/karma` Command: Error Fetching Player Data      | Ephemeral Error      |
| **`/leaderboard` Command (Planned)**                |                                                     |                      |
| 🏆 Koffee Karma Leaderboard 🏆                      | `/leaderboard` Command: Message Header              | Public Message       |
| The leaderboard is empty! Start delivering coffee to earn Karma. | `/leaderboard` Command: Empty Leaderboard Text    | Public Message       |
| [Rank]. [Emoji] *[User Name]* - [X] Karma ([Title]) | `/leaderboard` Command: Player Rank Entry         | Public Message       |
| **`/redeem` Command (Planned)**                     |                                                     |                      |
| Successfully redeemed code '[Code]' for [X] Karma! Your new balance is [Y]. | `/redeem` Command: Success                      | Ephemeral Message    |
| Invalid code '[Code]'.                           | `/redeem` Command: Invalid Code Error             | Ephemeral Error      |
| Code '[Code]' has expired.                       | `/redeem` Command: Expired Code Error             | Ephemeral Error      |
| Code '[Code]' has reached its maximum redemptions. | `/redeem` Command: Max Redemptions Error          | Ephemeral Error      |
| You have already redeemed code '[Code]'.          | `/redeem` Command: Already Redeemed Error         | Ephemeral Error      |
| Error redeeming code. Please try again.             | `/redeem` Command: Generic Error                  | Ephemeral Error      |
| **Order Messages (Public)**                         |                                                     |                      |
| ``` [ASCII Art Order Message - Ordered State] ```   | Public Order Message: Initial State (Unclaimed)   | Public Message       |
| ``` [ASCII Art Order Message - Claimed State] ```   | Public Order Message: Claimed State               | Public Message       |
| ``` [ASCII Art Order Message - Delivered State] ``` | Public Order Message: Delivered State             | Public Message       |
| ORDER FROM [Requester Name]: [Drink Name]           | Public Order Message: Fallback Text (Initial Post) | Public Message Text  |
| Order delivered by [Runner Name]!                   | Public Order Message: Fallback Text (Delivered)   | Public Message Text  |
| ✅ CLAIM ORDER                                      | Public Order Message: Claim Button                | Button Text          |
| ❌ CANCEL                                           | Public Order Message: Cancel Order Button         | Button Text          |
| 🏁 MARK DELIVERED                                   | Public Order Message: Deliver Button              | Button Text          |
| ❌ CANCEL DELIVERY                                  | Public Order Message: Cancel Claimed Order Button | Button Text          |
| 🎉 Bonus! <@[Runner ID]> got a *[X]x Karma bonus* for delivering <@[Requester ID]>'s order! 🎉 | Public Bonus Announcement Message | Public Message       |
| ORDER \`[Order ID]\` EXPIRED. NOBODY CLAIMED THE ORDER IN TIME. YOUR [X] KARMA HAS BEEN REFUNDED. | Public Order Message: Expired (Unclaimed) State | Public Message Text  |
| ORDER \`[Order ID]\` EXPIRED. RUNNER @[Runner Name] DIDN'T DELIVER IN TIME. YOUR [X] KARMA HAS BEEN REFUNDED. | Public Order Message: Expired (Claimed) State   | Public Message Text  |
| ORDER \`[Order ID]\` EXPIRED. [...] THERE WAS AN ISSUE REFUNDING YOUR [X] KARMA. PLEASE CONTACT AN ADMIN. | Public Order Message: Expired State (Refund Failed) | Public Message Text  |
| ORDER \`[Order ID]\` EXPIRED. [...] AN ERROR OCCURRED WHILE TRYING TO REFUND YOUR [X] KARMA. PLEASE CONTACT AN ADMIN. | Public Order Message: Expired State (Refund Error) | Public Message Text  |
| Order cancelled by @[User Name].                    | Public Order Message: Cancelled by Requester      | Public Message Text  |
| ORDER CANCELLED BY RUNNER @[Runner Name]. KARMA REFUNDED. | Public Order Message: Cancelled by Runner         | Public Message Text  |
| ORDER CANCELLED BY RUNNER @[Runner Name]. FAILED TO REFUND KARMA. | Public Order Message: Cancelled by Runner (Refund Failed) | Public Message Text  |
| **Runner Availability Messages (Public)**           |                                                     |                      |
| ``` [ASCII Art Runner Message - Offered State] ```  | Public Runner Offer Message: Active State         | Public Message       |
| Order Now                                           | Public Runner Offer Message: Order Button         | Button Text          |
| Cancel Offer                                        | Public Runner Offer Message: Cancel Button          | Button Text          |
| Runner [Runner Name] is still available.            | Public Runner Offer Message: Fallback Text (Update) | Public Message Text  |
| Runner offer by [Runner Name] has expired.          | Public Runner Offer Message: Expired State        | Public Message Text  |
| Delivery offer by [Runner Name] was cancelled.      | Public Runner Offer Message: Cancelled State      | Public Message Text  |
| **Direct Messages (DMs)**                           |                                                     |                      |
| ✅ You claimed [Requester Name]'s order for a [Drink Name]! Please deliver it to [Location] within [N] minutes! | Order Claimed: DM to Runner                     | DM                   |
| 🏃 [Runner Name] has claimed your order for a [Drink Name] and should be on their way to [Location]! | Order Claimed: DM to Requester                  | DM                   |
| ✅ Order delivered! You earned [X] Karma for delivering to [Requester Name]. | Order Delivered: DM to Runner (No Bonus)        | DM                   |
| ✅ Order delivered! You earned [X] Karma for delivering to [Requester Name]. Wow, a [Y]x bonus! | Order Delivered: DM to Runner (With Bonus)      | DM                   |
| ✅ Your order from [Runner Name] has been marked as delivered! | Order Delivered: DM to Requester                  | DM                   |
| ✅ Your order \`[Order ID]\` was cancelled and [X] Karma has been refunded. | Order Cancelled (Requester): DM to Requester      | DM                   |
| *YOUR ORDER \`[Order ID]\` HAS EXPIRED.* NOBODY CLAIMED THE ORDER IN TIME. YOUR [X] KARMA HAS BEEN REFUNDED. | Order Expired (Unclaimed): DM to Requester       | DM                   |
| *YOUR ORDER \`[Order ID]\` HAS EXPIRED.* Runner @[Runner Name] didn't deliver in time. YOUR [X] KARMA HAS BEEN REFUNDED. | Order Expired (Claimed): DM to Requester         | DM                   |
| *YOUR ORDER \`[Order ID]\` HAS EXPIRED.* [...] THERE WAS AN ISSUE REFUNDING YOUR [X] KARMA. PLEASE CONTACT AN ADMIN. | Order Expired: DM to Requester (Refund Failed/Error) | DM                   |
| *ORDER \`[Order ID]\` EXPIRED.* You didn't mark order \`[Order ID]\` from <@[Requester ID]> as delivered in time. Their karma was refunded. | Order Expired (Claimed): DM to Runner            | DM                   |
| ✅ Your delivery of order \`[Order ID]\` was cancelled. The requester's [X] Karma has been refunded. | Order Cancelled (Runner): DM to Runner            | DM                   |
| ✅ Your delivery of order \`[Order ID]\` was cancelled. FAILED TO REFUND REQUESTER KARMA. | Order Cancelled (Runner): DM to Runner (Refund Failed) | DM                   |
| <@[Requester ID]> cancelled their order \`[Order ID]\` that you claimed. | Order Cancelled (Requester after Claim): DM to Runner | DM                   |
| Welcome @[User Name] to Koffee Karma!                | New Member Joined Channel (Example)               | Public Message       |
| [Detailed Onboarding Message]                       | New Member Joined Channel: DM to New Member       | DM                   |
| **Button Interaction Errors (Ephemeral)**           |                                                     |                      |
| Wait, you can't claim your own order!               | Claim Button: Clicked by Requester (Non-Dev)      | Ephemeral Error      |
| This order has already been claimed by @[Runner Name]. | Claim Button: Order Already Claimed             | Ephemeral Error      |
| This order is no longer available (Status: [Status]). | Claim Button: Order Not in 'ordered' State       | Ephemeral Error      |
| 🤔 Sorry, something went wrong trying to claim the order. | Claim Button: Generic Error                   | Ephemeral Error      |
| This order is currently marked as [Status], not claimed. | Deliver Button: Order Not in 'claimed' State      | Ephemeral Error      |
| Wait, you didn't claim this order! Only the runner can mark it as delivered. | Deliver Button: Clicked by Non-Runner           | Ephemeral Error      |
| 🤔 Hmmm, I couldn't find the original order details. | Deliver Button: Order Not Found in DB           | Ephemeral Error      |
| Failed to update the order status in the database. Please try again. | Deliver Button: Firestore Update Failed         | Ephemeral Error      |
| There was an issue finalizing the delivery. Please check your stats later or contact an admin. | Deliver Button: Player Stat Update Failed       | Ephemeral Error      |
| 🙁 An error occurred while marking the order as delivered. Please try again. Error: [Error Details] | Deliver Button: Generic Error                   | Ephemeral Error      |
| Only the requester (<@[Requester ID]>) can cancel this order. | Cancel Order Button: Clicked by Non-Requester   | Ephemeral Error      |
| This order can no longer be cancelled (Status: [Status]). | Cancel Order Button: Order Not in 'ordered' State | Ephemeral Error      |
| 🤔 Sorry, something went wrong trying to cancel the order. | Cancel Order Button: Generic Error                | Ephemeral Error      |
| Only the runner (<@[Runner ID]>) can cancel this delivery. | Cancel Delivery Button: Clicked by Non-Runner   | Ephemeral Error      |
| This order is not in a state where delivery can be cancelled (Status: [Status]). | Cancel Delivery Button: Order Not in 'claimed' State | Ephemeral Error      |
| 🤔 Sorry, something went wrong trying to cancel the delivery. | Cancel Delivery Button: Generic Error             | Ephemeral Error      |
| Sorry, this runner is no longer available.          | Order Now Button: Runner Offer Not Found/Claimed/Expired | Ephemeral Error      |
| You can't order from yourself!                      | Order Now Button: Runner Clicks Own Offer         | Ephemeral Error      |
| Sorry, an error occurred trying to open the order form. | Order Now Button: Error Opening Modal           | Ephemeral Error      |
| Sorry, the runner's offer was claimed just before you submitted. Please try ordering from someone else. | Order Now Button: Race Condition (Offer Claimed) | Ephemeral Error      |
| Only the runner (<@[Runner ID]>) can cancel this offer. | Cancel Offer Button: Clicked by Non-Runner        | Ephemeral Error      |
| This offer is no longer active (Status: [Status]).  | Cancel Offer Button: Offer Not in 'offered' State | Ephemeral Error      |
| 🤔 Sorry, something went wrong trying to cancel the offer. | Cancel Offer Button: Generic Error              | Ephemeral Error      |
| **Miscellaneous Errors**                            |                                                     |                      |
| 🤔 Sorry, something went wrong identifying the item. | Generic Action Error (Missing Value/ID)         | Ephemeral Error      |
| Oops! Something went wrong. Please try again.       | Generic Bot Error (Defined in constants)        | Ephemeral/Public Error |
| 🔥🔥🔥 Global Bolt Error Handler Caught Error 🔥🔥🔥 | Internal Error Log (Not user-facing directly, but informs potential user messages) | Internal Log         | 