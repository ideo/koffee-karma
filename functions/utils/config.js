/**
 * Configuration Utility for Firebase Functions v2 (using Params)
 */
import { defineString, defineSecret } from 'firebase-functions/params';

// Define parameters using v2 SDK. These are resolved at deployment time
// from environment variables available to the 'firebase deploy' command.
// Use defineSecret for sensitive values.
const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN'); // Use defineSecret
const SLACK_SIGNING_SECRET = defineSecret('SLACK_SIGNING_SECRET'); // Use defineSecret
const KOFFEE_KARMA_CHANNEL_ID = defineString('KOFFEE_KARMA_CHANNEL_ID'); // defineString is okay for non-secrets

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
    default:
      // For parameters not explicitly defined, maybe fallback to process.env
      // But it's better to define all required params.
      console.warn(`[config] Unknown config key requested via getConfig: ${key}. Consider defining it as a parameter.`);
      return process.env[key] || fallback; // Or just return fallback
  }

  try {
    // .value() accesses the resolved parameter value
    const value = param.value();
    // defineSecret might return a SecretValue object, handle if necessary
    // but usually .value() gives the string directly in the function runtime.
    // However, check if we get the expected value type.
    if (typeof value !== 'string') {
        console.warn(`[config] Parameter ${key} resolved to non-string type: ${typeof value}. Check parameter definition and deployment environment.`);
        // Fallback if the resolved value isn't usable?
         return process.env[key] || fallback;
    }
    return value;
  } catch (e) {
    // This happens if the parameter isn't set during deployment and has no default
    console.error(`[config] FATAL: Failed to get value for required parameter ${key}. Ensure it's set as an environment variable during deployment (e.g., MY_VAR=value firebase deploy). Error: ${e.message}`);
    // Fallback or throw? Critical params should probably cause failure.
    // return process.env[key] || fallback; // Avoid returning fallback for critical missing params
     throw new Error(`Missing required configuration parameter: ${key}`);
  }
}; 