/**
 * Constants and enums for Koffee Karma
 */

// Order status constants
export const ORDER_STATUS = {
  ORDERED: 'ordered',     // Replaced PENDING with ORDERED
  OFFERED: 'offered',     // Initial state after runner availability
  CLAIMED: 'claimed',     // Order has been claimed by a runner
  DELIVERED: 'delivered', // Order has been delivered
  EXPIRED: 'expired',     // Order/offer timed out
  CANCELLED: 'cancelled', // Order/offer manually cancelled
  FAILED: 'failed',       // Internal error state
  OFFERED_CLAIMED: 'OFFERED_CLAIMED', // Offer accepted by a requester
  EXPIRED_OFFER: 'EXPIRED_OFFER', // Runner offer expired
  CANCELLED_RUNNER: 'CANCELLED_RUNNER', // Order cancelled by runner after claim
  EXPIRED_CLAIMED: 'EXPIRED_CLAIMED' // Order expired after claim (runner timeout)
};

// Karma costs for different actions
export const KARMA_COSTS = {
  WATER: 1,           // Water orders
  TEA: 2,             // Tea orders
  DRIP: 2,            // Drip coffee orders
  ESPRESSO: 3,        // Espresso drink orders
  DEFAULT: 2,         // Default order cost
  // DELIVER_COFFEE: 3   // Reward is calculated based on cost
};

// Player titles based on karma levels
export const TITLES = [
  // Order from highest minKarma to lowest for easier calculation
  { title: "The Last Barista", minKarma: 20 },
  { title: "Café Shade Mystic", minKarma: 16 },
  { title: "Foam Scryer", minKarma: 12 },
  { title: "Roast Prophet", minKarma: 8 },
  { title: "Keeper of the Drip", minKarma: 5 },
  { title: "The Initiate", minKarma: 3 },
  { title: "Cold Pour", minKarma: 1 },
  { title: "Parched", minKarma: 0 } // Base title
];

// Drink categories
export const DRINK_CATEGORIES = {
  WATER: { name: 'Water', cost: 1 },
  TEA: { name: 'Tea', cost: 2 },
  DRIP: { name: 'Drip Coffee', cost: 2 },
  ESPRESSO: { name: 'Espresso Drinks', cost: 3 }
};

// Locations (Keys should be simple identifiers, values are display names)
// Derived from the python MapGenerator coordinates dictionary
export const LOCATIONS = {
  'nw_studio': 'NW Studio',
  'the_courtyard': 'The Courtyard',
  '4a': '4A',
  '4b': '4B',
  '4c': '4C',
  '4d': '4D',
  '4e': '4E',
  '4f': '4F',
  'sugar_cube_1': 'Sugar Cube 1',
  'sugar_cube_2': 'Sugar Cube 2',
  'sugar_cube_3': 'Sugar Cube 3',
  'sugar_cube_4': 'Sugar Cube 4',
  'shipping_receiving': 'Shipping/Receiving',
  'cherry_pit': 'Cherry Pit',
  'hive': 'Hive',
  'honey': 'Honey',
  'the_scoop': 'The Scoop',
  'the_jelly': 'The Jelly',
  'the_crumb': 'The Crumb',
  'cavity_1': 'Cavity 1',
  'cavity_2': 'Cavity 2',
  'the_cookie_jar': 'The Cookie Jar',
  'cafe_booths': 'Café Booths',
  'the_lookout': 'The Lookout',
  'cafe': 'Café',
  'the_jam': 'The Jam',
  'technology': 'Technology',
  'restrooms': 'Restrooms',
  '4h': '4H',
  'vista_1': 'Vista 1',
  'vista_2': 'Vista 2',
  'vista_3': 'Vista 3',
  'redwood_1': 'Redwood 1',
  'redwood_2': 'Redwood 2',
  'redwood_3': 'Redwood 3',
  'redwood_4': 'Redwood 4',
  '4i': '4I',
  '4j': '4J',
  '4k': '4K',
  '4l': '4L',
  '4m': '4M',
  'redwood_booths': 'Redwood Booths',
  'lactation_lounge': 'Lactation Lounge',
  'sw_studio': 'SW Studio',
  'beach_1': 'Beach 1',
  'beach_2': 'Beach 2',
  'digital_dream_lab': 'Digital Dream Lab',
  'elevator': 'Elevator',
  'mini_shop': 'Mini Shop',
  '4n': '4N',
  '4o': '4O',
  '4p': '4P',
  'prototyping_kitchen': 'Prototyping Kitchen',
  'theater': 'Theater',
  'av_closet': 'AV Closet',
  'facilities_storage': 'Facilities Storage',
  '4q': '4Q',
  'spray_booth': 'Spray Booth',
  'play_lab_photo_studio': 'Play Lab Photo Studio',
  'cork_canyon': 'Cork Canyon',
  'production_shop_storage': 'Production/Shop Storage',
  'play_lab': 'Play Lab',
  'production': 'Production',
  'shop': 'Shop',
  'loc_default': 'Unknown Location' // Keep a default
};

// Define delivery durations constants
export const DELIVERY_DURATIONS = [
    { text: "5 minutes", value: "5" },
    { text: "10 minutes", value: "10" },
    { text: "15 minutes", value: "15" },
    { text: "30 minutes", value: "30" }
];

// Timer durations (in seconds)
export const DURATIONS = {
  ORDER_EXPIRY: 600,        // 10 minutes for orders
  RUNNER_AVAILABILITY: 600, // 10 minutes for runner offers
  UPDATE_INTERVAL: 60      // Update countdown every minute
};

// Bonus multiplier probabilities
export const BONUS_CHANCES = {
  TRIPLE: 0.10,  // 10% chance of 3x
  DOUBLE: 0.10,  // 10% chance of 2x
  // NORMAL: 0.80   // Calculated implicitly
};

// Bot messages - Keep these simple, formatting is done elsewhere
export const BOT_MESSAGES = {
  // WELCOME: 'Welcome to Koffee Karma!', // Welcome handled by event handler
  // HELP: 'Use /order, /deliver, /karma, /leaderboard, /redeem, /mydeliveries', // Help likely shown via command descriptions
  // ... other simple message templates if needed ...
  ERROR: 'Bot tripped. Try again.' // Updated default error to match style guide
};

// New Member Welcome Messages (Use <@${userId}> for mention)
export const WELCOME_MESSAGES = [
  '<@${userId}> dropped into the pit',
  '<@${userId}> just punched their card',
  '<@${userId}> showed up with empty hands and caffeine debt',
  '<@${userId}> stepped into the mess',
  '<@${userId}> arrived. Watch your orders',
  '<@${userId}> fell in. Karma starts low, Rep starts lower',
  '<@${userId}> rolled up looking thirsty',
  '<@${userId}> entered the chaos',
  '<@${userId}>\'s boots hit the floor',
  '<@${userId}>\'s on the grid now',
  '<@${userId}>\'s just a name until they run something',
  '<@${userId}> stepped into the queue. Let\'s see if they survive',
  '<@${userId}> lit their first match',
  '<@${userId}> crawled outta nowhere',
  '<@${userId}> signed the unwritten contract',
  '<@${userId}> clawed their way in',
  '<@${userId}> pulled up with no Rep and no clue',
  '<@${userId}> just broke the silence',
  '<@${userId}> marked the floor with fresh boots',
  '<@${userId}> joined the noise',
  '<@${userId}> crossed the threshold. no refunds',
  '<@${userId}> got scanned. no matches found',
  '<@${userId}>\'s name got chalked on the wall',
  '<@${userId}> got stamped and loaded',
  '<@${userId}> entered with nothing but a caffeine debt',
  '<@${userId}>\'s now in the ledger',
  '<@${userId}> spawned into the static',
  '<@${userId}> burned their first credit',
  '<@${userId}> dropped into the ritual loop',
  '<@${userId}>\'s soul now belongs to the queue',
  '<@${userId}> cracked open the boiler room',
  '<@${userId}>\'s Rep starts at zero. just like everyone else',
  '<@${userId}> said yes to the wrong invitation',
  '<@${userId}> just showed up on the wrong day to start fresh',
  '<@${userId}> entered the sweat economy',
  '<@${userId}> just opted into caffeine capitalism',
  '<@${userId}> took the bait',
  '<@${userId}> got pulled into the spill zone',
  '<@${userId}> joined the waiting list for regret'
];

export const ORDER_INITIATOR = {
  REQUESTER: 'requester',
  RUNNER: 'runner'
};

// <<< ADD Reputation Titles >>>
// Titles are awarded based on reaching the minimum reputation score.
// The array should be sorted by minReputation ascending.
export const REPUTATION_TITLES = [
  { minReputation: 0, title: 'Parched' },
  { minReputation: 1, title: 'Cold Pour' },
  { minReputation: 3, title: 'The Initiate' },
  { minReputation: 5, title: 'Keeper of the Drip' },
  { minReputation: 8, title: 'Roast Prophet' },
  { minReputation: 12, title: 'Foam Scryer' },
  { minReputation: 16, title: 'Café Shade Mystic' },
  { minReputation: 20, title: 'The Last Barista' }
  // Add more titles and thresholds as desired
];