export default {
  testEnvironment: 'node',
  // If you still face issues with ES modules after adding "type": "module" 
  // to your package.json, you might need to explicitly tell Jest how to transform them.
  // For basic ESM support with modern Node, this might be sufficient:
  // transform: {},
  // Or for more control, you might set up Babel:
  // transform: {
  //   '^.+\\.js$': 'babel-jest',
  // },

  // This pattern tells Jest to NOT ignore modules that are known to cause issues
  // with ESM transformations if they are not transformed.
  // It effectively says: "transform everything in node_modules EXCEPT for these specific modules, 
  // OR if they are in specific Google/Firebase paths."
  // The default is usually ['/node_modules/'], so we are overriding it.
  transformIgnorePatterns: [
    '/node_modules/(?!(@google-cloud|google-auth-library|firebase-admin|@firebase|uuid|firebase-functions)/)',
  ],
  // You might still need a basic transform if not using Babel explicitly
  transform: {
    // Transform .js and .mjs files using babel-jest
    '^.+\\.(js|mjs)$' : 'babel-jest',
  },
  // Explicitly clear mocks between every test
  clearMocks: true,
}; 