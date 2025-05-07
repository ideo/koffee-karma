/**
 * Event Handler
 * Handles Slack events like member joining a channel.
 */
import { getConfig } from '../utils/config.js';
import { WELCOME_MESSAGES } from '../utils/constants.js';
import { getOrCreatePlayer, updatePlayerKarma } from '../utils/database.js';
import * as database from '../utils/database.js';

/**
 * Handles the 'member_joined_channel' event.
 * @param {object} payload - The event payload.
 * @param {object} client - Bolt's client instance.
 * @param {object} logger - Bolt's logger instance.
 */
async function handleMemberJoinedChannel({ event, client, logger }) {
    const { user: userId, channel: channelId } = event;
    const targetChannelId = getConfig('KOFFEE_KARMA_CHANNEL_ID');

    logger.info(`Received member_joined_channel event: User ${userId} joined channel ${channelId}`);

    // Only proceed if the user joined the target channel
    if (channelId !== targetChannelId) {
        logger.debug(`User ${userId} joined channel ${channelId}, which is not the target channel ${targetChannelId}. Ignoring.`);
        return;
    }

    logger.info(`User ${userId} joined the target channel ${targetChannelId}. Processing welcome sequence.`);
    
    try {
        // 1. Select and format random public message
        const randomIndex = Math.floor(Math.random() * WELCOME_MESSAGES.length);
        let publicWelcomeMessage = WELCOME_MESSAGES[randomIndex];
        publicWelcomeMessage = publicWelcomeMessage.replace('<@${userId}>', `<@${userId}>`); // Replace placeholder with mention

        // 2. Post public message
        await client.chat.postMessage({
            channel: targetChannelId,
            text: publicWelcomeMessage
        });
        logger.info(`Posted welcome message for ${userId} to ${targetChannelId}.`);

        // 3. Send onboarding DM
        const onboardingDM = `you're in.

this is KOFFEE KARMA — a peer-to-peer coffee system powered by your team.  
no apps. no middlemen. just real people delivering real drinks.

→ you start with 3 Karma  
→ spend Karma to place drink orders  
→ you earn Reputation for ordering and delivering  
→ Reputation never drops. it's how you climb the leaderboard  

here's how it works:

→ \`/order\`  
opens the drink order form  
pick a drink, a drop location, and who it's for (or leave it blank to treat yourself)  
orders cost Karma.  
if someone claims your order and delivers it — both of you earn Reputation.

→ \`/deliver\`  
offer to run drinks for others  
set what you can make and how long you're around  
if someone picks you, deliver their drink and earn Karma + Reputation  
some runs trigger bonus multipliers — luck favors the bold

→ \`/karma\`  
check your current Karma, total Reputation, and your earned title (if you've got one)

→ \`/leaderboard\`  
see the top Reputation earners across the team

→ \`/redeem <code>\`  
enter a one-time code (if someone hands you one)

want to try it now?
Post in #koffee-karma-sf: type \`/order\` and send a drink to someone — or yourself.

keep it simple. keep it moving. build your name one cup at a time.`;
        await client.chat.postMessage({ 
            channel: userId, // Send DM to the user
            text: onboardingDM 
        });
        logger.info(`Sent onboarding DM to ${userId}.`);

        // 4. Create player and award initial Karma
        logger.info(`Ensuring player profile exists for joining user ${userId} and awarding initial karma if new.`);
        const { isNew } = await getOrCreatePlayer(userId, client); // Wait for the result
        
        if (isNew) {
            logger.info(`Created new player profile for ${userId}. Awarding 3 initial Karma.`);
            const karmaAwardSuccess = await updatePlayerKarma(userId, 3);
            if (karmaAwardSuccess) {
                logger.info(`Successfully awarded 3 initial Karma to new user ${userId}.`);
            } else {
                 logger.error(`Failed to award initial 3 karma to new user ${userId} (updatePlayerKarma returned false).`);
            }
        } else {
            logger.info(`Existing player profile found for joining user ${userId}. No initial Karma awarded.`);
        }

    } catch (error) {
        logger.error(`Failed to process member_joined_channel for user ${userId} in channel ${channelId}:`, error);
    }
}

// Register event handlers with the Bolt app
export const eventHandler = (app) => {
  app.event('member_joined_channel', handleMemberJoinedChannel);

  console.log("✅ Event handler registered listener: member_joined_channel");
  // Register other event listeners here if needed
}; 