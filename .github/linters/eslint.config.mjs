// Flat config consumed by super-linter in CI. No imports: the config must
// resolve inside super-linter's image without this repo shipping any npm
// packages (see AGENT.md), so globals and rules are spelled out by hand
// rather than pulled from @eslint/js or the globals package.

const webApiGlobals = {
  console: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  performance: "readonly",
};

const rules = {
  // Correctness. no-undef is the one that actually catches mistakes in an
  // extension: a typo'd chrome.* namespace or a missing import.
  "no-undef": "error",
  "no-unused-vars": ["error", { args: "after-used", caughtErrors: "none" }],
  "no-unreachable": "error",
  "no-dupe-keys": "error",
  "no-duplicate-case": "error",
  "no-self-assign": "error",
  "no-unsafe-negation": "error",
  "no-constant-condition": "error",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-fallthrough": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  // "smart" permits `== null`, used deliberately for null-or-undefined.
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": "error",
  "no-implicit-globals": "error",
  "no-eval": "error",
  "no-implied-eval": "error",
  "no-new-func": "error",
};

export default [
  {
    files: ["**/*.js", "**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: webApiGlobals,
    },
    rules,
  },
  {
    // Extension contexts: the service worker and the options page.
    files: ["**/background.js", "**/options.mjs"],
    languageOptions: {
      globals: { chrome: "readonly", document: "readonly" },
    },
  },
  {
    files: ["**/test/**/*.mjs"],
    languageOptions: {
      globals: { performance: "readonly" },
    },
  },
];
