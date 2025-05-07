/**
 * Logger utility for Koffee Karma
 */

export const logger = {
  info: (message, ...args) => {
    console.log(message, ...args);
  },
  error: (message, ...args) => {
    console.error(message, ...args);
  },
  warn: (message, ...args) => {
    console.warn(message, ...args);
  },
  debug: (message, ...args) => {
    // Firebase Functions converts console.debug to info level by default
    // Using console.info or a dedicated logging library might be better
    // if distinct debug level is needed in production.
    console.log("DEBUG:", message, ...args);
  }
}; 