/**
 * Configuration Utility for Koffee Karma Firebase Functions (Gen2)
 * Defines parameters that will be sourced from environment variables
 * or Google Cloud Secret Manager.
 */
import { defineString, defineSecret } from 'firebase-functions/v2/params';

// Secrets - These will be sourced from Google Cloud Secret Manager
// Ensure these secret names match what's stored in Secret Manager.
export const SLACK_BOT_TOKEN = defineSecret('SLACK_BOT_TOKEN');
export const SLACK_SIGNING_SECRET = defineSecret('SLACK_SIGNING_SECRET');

// Regular Configuration Parameters - These will be sourced from environment variables
// (which can be set via .env files for local dev, or via deployment configurations).
// For deployed environments, these can also be linked to Secret Manager if needed,
// by changing them to defineSecret.
export const KOFFEE_KARMA_CHANNEL_ID = defineSecret('KOFFEE_KARMA_CHANNEL_ID');
export const DEVELOPER_SLACK_ID = defineSecret('DEVELOPER_SLACK_ID');

// Parameters often provided by the Google Cloud environment.
// It's generally better to access these directly via process.env if available,
// but they can be defined here if explicit configuration is preferred.
// Defaulting to empty strings or specific values might be necessary if they aren't always present.
// For GCLOUD_PROJECT, process.env.GCLOUD_PROJECT is usually available.
// For CLOUD_FUNCTION_REGION, process.env.FUNCTION_REGION (Gen1) or other Cloud Run env vars (Gen2 like process.env.CLOUD_RUN_SERVICE) exist.

// Example: If you wanted to define GCLOUD_PROJECT as a param:
// export const GCLOUD_PROJECT = defineString('GCLOUD_PROJECT');
// Then in your code, you'd use GCLOUD_PROJECT.value().
// However, for system-provided ones, direct process.env access is often simpler.

// The old getConfig function is no longer needed with this pattern.
// If you need to access these values, import them and use .value()
// e.g., import { SLACK_BOT_TOKEN } from './config.js';
// const token = SLACK_BOT_TOKEN.value(); 