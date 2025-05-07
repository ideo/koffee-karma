/**
 * Configuration Utility
 * Provides a consistent way to access environment variables
 */
import functions from 'firebase-functions'; // Ensure this is imported
import { defineString } from 'firebase-functions/params';

// Define parameters for potential use with CLI or local .env files
// but primary access will be through functions.config() for deployed env.
const SLACK_BOT_TOKEN_PARAM = defineString('SLACK_BOT_TOKEN');
const SLACK_SIGNING_SECRET_PARAM = defineString('SLACK_SIGNING_SECRET');
const KOFFEE_KARMA_CHANNEL_ID_PARAM = defineString('KOFFEE_KARMA_CHANNEL_ID');

/**
 * Get configuration value using Firebase Params (V2 SDK).
 * Uses the value defined via `defineString` which loads from environment variables
 * (including .env files loaded via dotenv) or deployment-time configuration.
 * 
 * @param {string} key - The environment variable key (e.g., 'SLACK_BOT_TOKEN')
 * @param {string | null} [fallback=null] - The default value if the key is not found
 * @returns {string} The configuration value or the fallback
 */
export const getConfig = (key, fallback = null) => {
  const config = functions.config();
  let value;

  switch (key) {
    case 'SLACK_BOT_TOKEN':
      // Prefer functions.config(), then param, then process.env for wider compatibility
      value = config.slack && config.slack.bot_token !== undefined ? config.slack.bot_token :
              (SLACK_BOT_TOKEN_PARAM.value ? SLACK_BOT_TOKEN_PARAM.value() : process.env.SLACK_BOT_TOKEN);
      break;
    case 'SLACK_SIGNING_SECRET':
      value = config.slack && config.slack.signing_secret !== undefined ? config.slack.signing_secret :
              (SLACK_SIGNING_SECRET_PARAM.value ? SLACK_SIGNING_SECRET_PARAM.value() : process.env.SLACK_SIGNING_SECRET);
      break;
    case 'KOFFEE_KARMA_CHANNEL_ID':
      value = config.koffee_karma && config.koffee_karma.channel_id !== undefined ? config.koffee_karma.channel_id :
              (KOFFEE_KARMA_CHANNEL_ID_PARAM.value ? KOFFEE_KARMA_CHANNEL_ID_PARAM.value() : process.env.KOFFEE_KARMA_CHANNEL_ID);
      break;
    default:
      console.warn(`[config] Unknown config key requested: ${key}. Trying process.env.`);
      value = process.env[key];
      break;
  }

  if (value !== undefined) {
    return value;
  }

  console.warn(`[config] Value for key ${key} not found in functions.config(), params, or process.env. Falling back to default.`);
  return fallback;
}; 