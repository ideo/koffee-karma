/**
 * Configuration Utility
 * Provides a consistent way to access environment variables.
 * Reads directly from process.env for V2 Functions compatibility.
 */
// import functions from 'firebase-functions'; // Removed - Not compatible with V2
// import { defineString } from 'firebase-functions/params'; // Removed - Caused issues in CI/CD

export const getConfig = (key, fallback = null) => {
  // For V2 functions, read directly from process.env
  const value = process.env[key];

  if (value !== undefined) {
    return value;
  }

  // Log a warning if a crucial key is missing
  if (['SLACK_BOT_TOKEN', 'SLACK_SIGNING_SECRET', 'KOFFEE_KARMA_CHANNEL_ID'].includes(key)) {
    console.warn(`[config] Crucial environment variable ${key} is not set. Check deployment environment variables.`);
  } else {
    console.warn(`[config] Environment variable ${key} not found.`);
  }
  
  // Return the fallback value if the environment variable is not found
  return fallback;
}; 