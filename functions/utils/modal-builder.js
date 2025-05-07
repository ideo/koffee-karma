/**
 * Utility functions for building Slack modals
 */
import { DRINK_CATEGORIES, LOCATIONS, DELIVERY_DURATIONS } from './constants.js'; // Use DELIVERY_DURATIONS
import { generateMap } from './message-formatter.js';
import { logger } from './logger.js';
import { fileURLToPath } from 'url';
import path from 'path';

// Equivalent to __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Build the order modal
 * @param {Object} [initialValues={}] - Initial values to pre-populate fields
 * @param {string|null} [viewId=null] - The view ID if updating an existing modal.
 * @param {Array<string>|null} [runnerCapabilities=null] - Array of category keys the target runner CAN make.
 * @param {string|null} [originatingChannelId=null] - ID of the channel where /order was invoked.
 * @param {string|null} [originatingChannelName=null] - Name of the channel where /order was invoked.
 * @param {Object|null} [privateMetadata=null] - Additional metadata to store.
 * @returns {Object} - Slack modal view payload
 */
export function buildOrderModal(
    initialValues = {}, 
    viewId = null, // <<< Corrected parameter name based on usage (though not used here)
    runnerCapabilities = null, 
    originatingChannelId = null,
    originatingChannelName = null,
    privateMetadata = null // <<< Corrected parameter name
) {
  // <<< Fix the debug log >>>
  logger.debug(`[buildOrderModal] Received runnerCapabilities: ${runnerCapabilities ? JSON.stringify(runnerCapabilities) : 'null'}`);
  
  const callbackId = 'koffee_request_modal'; 
  const initialMap = generateMap(initialValues.location || null, { includeLegend: true });

  // Generate category options dynamically, applying formatting based on runnerCapabilities
  const categoryOptions = Object.entries(DRINK_CATEGORIES).map(([key, { name, cost }]) => {
    let optionText = '';
    // <<< ADD check: ensure runnerCapabilities is an array before using includes >>>
    const isRunnerCapabilitiesArray = Array.isArray(runnerCapabilities);
    const canRunnerMake = !isRunnerCapabilitiesArray || runnerCapabilities.includes(key); // Default to true if not an array

    if (!isRunnerCapabilitiesArray && runnerCapabilities !== null) {
        logger.warn(`[buildOrderModal] runnerCapabilities was not an array: ${JSON.stringify(runnerCapabilities)}. Assuming runner can make all.`);
    }

    // Apply new styling from reference file
    if (!canRunnerMake) {
        optionText = `⊘ ${name.toUpperCase()} ⊘`; // Keep disabled style
    } else {
        optionText = `${name} – ${cost} Karma`; // Use reference format
    }
    // <<< Correct the log message to log the actual variable >>>
    logger.debug(`[buildOrderModal] Generated option for ${key}: text='${optionText}', canRunnerMake=${canRunnerMake}`);

    // ALL options must use plain_text
    return {
        text: { type: "plain_text", text: optionText, emoji: true },
        value: key
    };
  });

  // Assemble private metadata
  let finalMetadata = {}; // Use a different variable name
  if (originatingChannelId) {
    finalMetadata.originatingChannelId = originatingChannelId;
    finalMetadata.originatingChannelName = originatingChannelName;
  }
  // Merge with any incoming privateMetadata
  if (privateMetadata && typeof privateMetadata === 'object') {
      finalMetadata = { ...finalMetadata, ...privateMetadata };
  }

  return {
    type: "modal",
    callback_id: callbackId,
    title: {
      type: "plain_text",
      text: "PLACE AN ORDER",
      emoji: true
    },
    submit: {
      type: "plain_text",
      text: "LOCK IT IN",
      emoji: true
    },
    close: {
      type: "plain_text",
      text: "SCRAP IT",
      emoji: true
    },
    private_metadata: JSON.stringify(finalMetadata), // Store combined metadata
    blocks: [
      // Drink Category Selection
      {
        type: "section",
        block_id: "category_block",
        text: {
          type: "mrkdwn",
          text: "*Pick your poison*"
        },
        accessory: {
          type: "static_select",
          action_id: "drink_category_select",
          placeholder: {
            type: "plain_text",
            text: "Select a drink type",
            emoji: true
          },
          options: categoryOptions, // <<< Use dynamically generated options
          // Set initial option if provided
          ...(initialValues.category && {
             initial_option: categoryOptions.find(opt => opt.value === initialValues.category)
           })
        }
      },
      
      // Drink Details Input
      {
        type: "input",
        block_id: "drink_block",
        element: {
          type: "plain_text_input",
          action_id: "drink_input",
          placeholder: {
            type: "plain_text",
            text: "e.g., Large latte with oat milk"
          },
          initial_value: initialValues.drink || "",
          max_length: 30
        },
        label: {
          type: "plain_text",
          text: "What are they drinking?",
          emoji: true
        }
      },
      
      // Location Selection with Map
      {
        type: "section",
        block_id: "location_block",
        text: {
          type: "mrkdwn",
          text: "*Where's the drop?*"
        },
        accessory: {
          type: "static_select",
          action_id: "location_select",
          placeholder: {
            type: "plain_text",
            text: "Select your location",
            emoji: true
          },
          options: Object.entries(LOCATIONS)
            .filter(([key, text]) => key !== 'loc_default') // Exclude default from dropdown
            .sort(([, textA], [, textB]) => textA.localeCompare(textB)) // Sort alphabetically by display name
            .map(([key, text]) => ({
              text: {type: "plain_text", text: text, emoji: true},
              value: key // Use the location key (e.g., nw_studio)
            }))
        }
      },
      
      // Map Visualization
      {
        type: "section",
        block_id: "map_block", // Keep a consistent block ID for updates
        text: {
          type: "mrkdwn",
          text: `\`\`\`${initialMap}\`\`\``
        }
      },
      
      // Optional Recipient Selection (Converted to Input Block)
      {
        type: "input", // Changed from section
        block_id: "recipient_block", // Keep the same block_id
        optional: true, // Make the input optional
        label: {
          type: "plain_text",
          text: "Who's it for? (leave blank for yourself)",
          emoji: true
        },
        element: { // The user select goes in the element field
          type: "users_select",
          action_id: "recipient_select", // Keep the same action_id
          placeholder: {
            type: "plain_text",
            text: "Pick a name... or don't",
            emoji: true
          },
          // Note: initial_user cannot be directly set in an input block's element
          // If pre-population is needed later, it requires a different approach.
        }
      },
      
      // Optional Notes
      {
        type: "input",
        block_id: "notes_block",
        optional: true,
        element: {
          type: "plain_text_input",
          action_id: "notes_input",
          placeholder: {
            type: "plain_text",
            text: "Any special instructions?"
          },
          initial_value: initialValues.notes || "",
          max_length: 30
        },
        label: {
          type: "plain_text",
          text: "Say less...",
          emoji: true
        }
      }
    ]
  };
}

/**
 * Build the delivery modal
 * @param {Array<string>} [initialCapabilities] - Initial capabilities (keys from DRINK_CATEGORIES) to pre-select
 * @returns {Object} - Slack modal view payload
 */
export function buildDeliveryModal(currentCapabilities = []) {
    const callbackId = 'delivery_modal_submit';

    // Build capability options
    const capabilityOptions = Object.entries(DRINK_CATEGORIES).map(([key, { name }]) => ({
        text: {
            type: 'plain_text',
            text: name,
            emoji: true
        },
        value: key // Use the constant key (e.g., 'TEA') as the value
    }));

    // Pre-select options based on currentCapabilities
    const initialCapabilityOptions = capabilityOptions.filter(opt => currentCapabilities.includes(opt.value));

    // Build duration options correctly by iterating over the array AND filtering
    const durationOptions = DELIVERY_DURATIONS
        .filter(duration => duration.value !== '30') // <<< FILTER out 30 mins
        .map(duration => ({                        // <<< MAP remaining durations
        text: {
            type: 'plain_text',
            text: duration.text, 
            emoji: true
        },
        value: duration.value 
    }));

    // Find the initial option object for 10 minutes from the filtered list
    const initialDurationOption = durationOptions.find(opt => opt.value === '10');

    return {
        type: 'modal',
        callback_id: callbackId,
        title: {
            type: 'plain_text',
            text: 'OFFER TO DELIVER',
            emoji: true
        },
        submit: {
            type: 'plain_text',
            text: 'READY TO RUN',
            emoji: true
        },
        close: {
            type: 'plain_text',
            text: 'SCRAP IT',
            emoji: true
        },
        blocks: [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: 'Select what you can make + how long you\'ll be around.'
                }
            },
            {
                type: 'input',
                block_id: 'capabilities_block',
                label: {
                    type: 'plain_text',
                    text: 'What can you brew, freak?',
                    emoji: true
                },
                element: {
                    type: 'checkboxes',
                    action_id: 'capabilities_select',
                    options: capabilityOptions,
                    ...(initialCapabilityOptions.length > 0 && { initial_options: initialCapabilityOptions })
                },
                optional: false
            },
            {
                type: 'input',
                block_id: 'duration_block',
                label: {
                    type: 'plain_text',
                    text: 'How long you hangin\' around?',
                    emoji: true
                },
                element: {
                    type: 'static_select',
                    action_id: 'duration_select',
                    placeholder: {
                        type: 'plain_text',
                        text: 'Pick your window',
                        emoji: true
                    },
                    options: durationOptions,
                    initial_option: initialDurationOption || durationOptions[0]
                },
                optional: false
            }
        ]
    };
}

/**
 * Update an existing modal view to change the map block.
 * @param {Object} currentView - The existing view payload from the interaction body.
 * @param {number} mapBlockIndex - The index of the map block in the view's blocks array.
 * @param {string} newMapText - The new pre-formatted map string.
 * @returns {Object} - The updated view payload for views.update.
 */
export function update_modal_map(currentView, mapBlockIndex, newMapText) {
    if (!currentView || !currentView.blocks || mapBlockIndex >= currentView.blocks.length) {
        console.error("Invalid view or mapBlockIndex provided to update_modal_map");
        return currentView; // Return original view if update fails
    }

    // Create a deep copy to avoid modifying the original view object directly
    const updatedBlocks = JSON.parse(JSON.stringify(currentView.blocks));
    
    // Update the specific map block
    updatedBlocks[mapBlockIndex] = {
        type: "section",
        block_id: "map_block", // Ensure block_id is consistent
        text: {
            type: "mrkdwn",
            text: `\`\`\`${newMapText}\`\`\``
        }
    };

    // Return the *entire* view object structure required by Slack
    return {
        type: "modal",
        title: currentView.title,
        submit: currentView.submit,
        close: currentView.close,
        private_metadata: currentView.private_metadata,
        blocks: updatedBlocks
    };
}

/**
 * Parse state values from a modal submission view payload.
 * @param {Object} view - The view payload from the submission.
 * @returns {Object} - An object containing extracted values keyed by action_id or block_id.
 */
// ... existing code ... 