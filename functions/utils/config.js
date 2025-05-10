/**
 * Configuration Utility
 * Provides a consistent way to access environment variables
 */
// import functions from 'firebase-functions'; // v1 needed for config fallback - REMOVED
import { defineString } from 'firebase-functions/params';

// Define parameters using v2 SDK - these will be evaluated at deployment time
// Values can be set in .env files for local emulation
// See https://firebase.google.com/docs/functions/config-env
const SLACK_BOT_TOKEN = defineString('SLACK_BOT_TOKEN', { secret: true });
const SLACK_SIGNING_SECRET = defineString('SLACK_SIGNING_SECRET', { secret: true });
const KOFFEE_KARMA_CHANNEL_ID = defineString('KOFFEE_KARMA_CHANNEL_ID');
// Define other parameters as needed, e.g.:
// const GOOGLE_APPLICATION_CREDENTIALS = defineString('GOOGLE_APPLICATION_CREDENTIALS');

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
  let param;
  switch (key) {
    case 'SLACK_BOT_TOKEN':
      param = SLACK_BOT_TOKEN;
      break;
    case 'SLACK_SIGNING_SECRET':
      param = SLACK_SIGNING_SECRET;
      break;
    case 'KOFFEE_KARMA_CHANNEL_ID':
      param = KOFFEE_KARMA_CHANNEL_ID;
      break;
    // Add cases for other defined parameters
    // case 'GOOGLE_APPLICATION_CREDENTIALS':
    //   param = GOOGLE_APPLICATION_CREDENTIALS;
    //   break;
    default:
      console.warn(`[config] Unknown config key requested: ${key}`);
      // Attempt to read directly from process.env as a last resort for unparameterized values
      return process.env[key] || fallback;
  }

  try {
    // .value() accesses the resolved parameter value
    return param.value();
  } catch (e) {
    // This might happen if the parameter isn't set and has no default
    console.warn(`[config] Failed to get value for parameter ${key}: ${e.message}`);
    // Fallback to process.env again or the provided fallback
    return process.env[key] || fallback;
  }
}; 