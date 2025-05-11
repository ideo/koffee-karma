/**
 * Timer scheduler utility for Koffee Karma
 * 
 * Uses Google Cloud Scheduler client library to schedule Pub/Sub events.
 */
import { CloudSchedulerClient } from '@google-cloud/scheduler';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';
// import { getConfig } from './utils/config.js'; // REMOVE THIS - No longer needed here

// Initialize client (only happens once)
const schedulerClient = new CloudSchedulerClient();

// Helper to get project and location with memoization
let projectLocationInfo = null;
function getProjectLocation() {
    if (!projectLocationInfo) {
        const projectId = process.env.GCLOUD_PROJECT;
        // For Gen2 functions (Cloud Run), region might be available in other env vars like CLOUD_RUN_REGION
        // Defaulting to 'us-west1' as a fallback if no specific region env var is consistently available.
        const location = process.env.CLOUD_RUN_REGION || process.env.FUNCTION_REGION || 'us-west1'; 
        if (!projectId) {
            // This should ideally not happen in a deployed GCP environment.
            // If running locally and GCLOUD_PROJECT is not set, this will throw.
            logger.error('Could not determine Google Cloud Project ID. Ensure GCLOUD_PROJECT environment variable is set.');
            throw new Error('Could not determine Google Cloud Project ID.');
        }
        projectLocationInfo = {
            projectId,
            location,
            parentPath: schedulerClient.locationPath(projectId, location)
        };
        logger.debug(`Scheduler using Project: ${projectId}, Location: ${location}`);
    }
    return projectLocationInfo;
}

// Helper to generate job names
const generateJobName = (baseId, type, identifier) => {
    const { projectId, location } = getProjectLocation();
    const safeIdentifier = identifier.replace(/[^a-zA-Z0-9_-]/g, '-'); // Sanitize ID
    // Max length 500, recommend < 100. Keep it short.
    const uniqueSuffix = uuidv4().split('-')[0]; // Add some uniqueness
    // Format: projects/{projectId}/locations/{location}/jobs/kk-{type}-{sanitizedIdentifier}-{uniqueSuffix}
    return `projects/${projectId}/locations/${location}/jobs/kk-${type}-${safeIdentifier}-${uniqueSuffix}`.substring(0, 499); // Ensure max length
};

// Helper function to schedule a one-time Pub/Sub job
async function schedulePubSubJob(topicName, jobNameBase, delayMs, data) {
    const { projectId, parentPath } = getProjectLocation();

    const jobName = generateJobName(jobNameBase, topicName, jobNameBase);
    const topicPath = `projects/${projectId}/topics/${topicName}`;
    const scheduleTime = new Date(Date.now() + delayMs);

    const job = {
        name: jobName,
        pubsubTarget: {
            topicName: topicPath,
            data: Buffer.from(JSON.stringify(data)).toString('base64'),
        },
        // schedule: Use scheduleTime for one-off jobs
        scheduleTime: {
            seconds: Math.floor(scheduleTime.getTime() / 1000),
            nanos: (scheduleTime.getTime() % 1000) * 1e6
        },
        timeZone: 'Etc/UTC', // Use UTC for scheduleTime
        attemptDeadline: { seconds: 300 } // 5 min deadline for job execution
    };

    try {
        logger.info(`Scheduling job ${jobName} for topic ${topicName} at ${scheduleTime.toISOString()}`);
        const [response] = await schedulerClient.createJob({ parent: parentPath, job });
        logger.info(`Job created: ${response.name}`);
        return response.name; // Return the created job name
    } catch (error) {
        logger.error(`Failed to create job ${jobName}:`, error);
        // Decide if this error should be thrown or just logged
        // For now, logging and returning null
        return null;
    }
}

/**
 * Schedule an order timer with both regular updates and final expiration
 * @param {string} orderId - The order ID
 * @param {number} durationMs - Duration in milliseconds
 * @param {string} messageTs - Slack message timestamp
 * @param {string} channelId - Slack channel ID
 */
export async function scheduleOrderTimer(orderId, durationMs, messageTs, channelId) {
    const updateInterval = 60 * 1000; // 1 minute
    const updateCount = Math.floor(durationMs / updateInterval);
    const jobDataBase = { orderId, messageTs, channelId };
    const jobNameBase = `order-${orderId}`;
    let scheduledJobNames = [];

    logger.info(`Scheduling timers for order ${orderId}`);

    // Schedule regular updates (every minute, excluding the final minute)
    for (let i = 1; i < updateCount; i++) {
        const delay = i * updateInterval;
        const jobName = await schedulePubSubJob('update-order-timer', `${jobNameBase}-update-${i}`, delay, jobDataBase);
        if (jobName) scheduledJobNames.push(jobName);
    }

    // Schedule expiration (at the full duration)
    const expirationJobName = await schedulePubSubJob('expire-order', `${jobNameBase}-expire`, durationMs, { orderId });
    if (expirationJobName) scheduledJobNames.push(expirationJobName);

    logger.debug(`Scheduled jobs for order ${orderId}: ${scheduledJobNames.join(', ')}`);
}

/**
 * Schedule a runner timer with both regular updates and final expiration
 * @param {string} messageTs - Slack message timestamp (used as the offer ID)
 * @param {number} durationMs - Duration in milliseconds
 * @param {string} channelId - Slack channel ID
 */
export async function scheduleRunnerTimer(messageTs, durationMs, channelId) {
    const updateInterval = 60 * 1000; // 1 minute
    const updateCount = Math.floor(durationMs / updateInterval);
    const jobDataBase = { messageTs, channelId };
    const jobNameBase = `runner-${messageTs}`; // Keep base simple
    let scheduledJobNames = [];

    logger.info(`Scheduling timers for runner offer ${messageTs}`);

    // Schedule regular updates (every minute, excluding the final minute)
    for (let i = 1; i < updateCount; i++) {
        const delay = i * updateInterval;
        const jobName = await schedulePubSubJob('update-runner-timer', `${jobNameBase}-update-${i}`, delay, jobDataBase);
        if (jobName) scheduledJobNames.push(jobName);
    }

    // Schedule expiration
    const expirationJobName = await schedulePubSubJob('expire-runner-offer', `${jobNameBase}-expire`, durationMs, { messageTs });
    if (expirationJobName) scheduledJobNames.push(expirationJobName);

    logger.debug(`Scheduled jobs for runner ${messageTs}: ${scheduledJobNames.join(', ')}`);
}

// Helper to delete jobs based on a filter function
async function deleteJobsByFilter(filterFn) {
    const { parentPath } = getProjectLocation();
    try {
        const request = { parent: parentPath };
        const iterable = schedulerClient.listJobsAsync(request);
        let deletedCount = 0;
        const deletePromises = [];

        for await (const job of iterable) {
            if (filterFn(job.name)) {
                logger.debug(`Queueing deletion for job: ${job.name}`);
                // Queue deletion promises
                deletePromises.push(
                    schedulerClient.deleteJob({ name: job.name })
                        .then(() => {
                            logger.info(`Deleted job: ${job.name}`);
                            deletedCount++;
                        })
                        .catch(deleteError => {
                            // Log error but don't stop other deletions
                            logger.error(`Failed to delete job ${job.name}:`, deleteError);
                        })
                );
            }
        }
        
        // Wait for all deletions to complete
        await Promise.all(deletePromises);
        logger.info(`Attempted deletion for matching jobs. Successfully deleted ${deletedCount} jobs.`);
    } catch (listError) {
        logger.error('Failed to list jobs for deletion:', listError);
    }
}

/**
 * Cancel all timers associated with an order
 * Uses job naming convention kk-{type}-{baseIdentifier}-{uniqueSuffix}
 * @param {string} orderId - The order ID
 */
export async function cancelOrderTimers(orderId) {
    logger.info(`Cancelling timers for order ${orderId}`);
    const baseIdentifier = `order-${orderId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const updatePrefix = `kk-update-order-timer-${baseIdentifier}-`;
    const expirePrefix = `kk-expire-order-${baseIdentifier}-`;
    await deleteJobsByFilter(jobName => 
        jobName.includes(updatePrefix) || jobName.includes(expirePrefix)
    );
}

/**
 * Cancel all timers associated with a runner offer
 * Uses job naming convention kk-{type}-{baseIdentifier}-{uniqueSuffix}
 * @param {string} messageTs - The Slack message timestamp (offer ID)
 */
export async function cancelRunnerTimers(messageTs) {
    logger.info(`Cancelling timers for runner offer ${messageTs}`);
    const baseIdentifier = `runner-${messageTs}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    const updatePrefix = `kk-update-runner-timer-${baseIdentifier}-`;
    const expirePrefix = `kk-expire-runner-offer-${baseIdentifier}-`;
    await deleteJobsByFilter(jobName => 
        jobName.includes(updatePrefix) || jobName.includes(expirePrefix)
    );
}

// Removed module.exports 