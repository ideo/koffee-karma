/**
 * Configuration Utility
 * Provides a consistent way to access environment variables FOR DEPLOYED FUNCTIONS.
 * For local emulation, ensure your .env files or emulators are configured correctly
 * to populate functions.config() or use a different local config strategy.
 */
import functions from 'firebase-functions';

// Removed defineString for these, as we'll rely on functions.config()
// set by the CI/CD pipeline.

export const getConfig = (key, fallback = null) => {
  const config = functions.config();
  let value;

  // Access values directly based on how they are set by `firebase functions:config:set`
  switch (key) {
    case 'SLACK_BOT_TOKEN':
      value = config.slack ? config.slack.bot_token : undefined;
      break;
    case 'SLACK_SIGNING_SECRET':
      value = config.slack ? config.slack.signing_secret : undefined;
      break;
    case 'KOFFEE_KARMA_CHANNEL_ID':
      value = config.koffee_karma ? config.koffee_karma.channel_id : undefined;
      break;
    default:
      // For any other keys, you might still want a process.env fallback or warning
      console.warn(`[config] Unknown or non-standard config key requested: ${key}. Trying process.env.`);
      value = process.env[key]; // Fallback for other potential env vars
      break;
  }

  if (value !== undefined) {
    return value;
  }

  // Only log warning and use fallback if specifically not found via the known paths
  if (['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'KOFFEE_KARMA_CHANNEL_ID'].includes(key)) {
    console.warn(`[config] Crucial key ${key} not found in functions.config(). Check CI/CD setup and 'firebase functions:config:set' commands.`);
  } else {
    console.warn(`[config] Value for key ${key} not found.`)
  }
  return fallback;
}; 