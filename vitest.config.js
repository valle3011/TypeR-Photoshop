// Vitest config. node_modules live OUTSIDE the project on purpose: the repo
// sits on a Google Drive mount where npm cannot write its thousands of files
// reliably (EBADF). tools/devdir.cjs resolves that folder.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { DEV_MODULES } = require("./tools/devdir.cjs");

export default {
  test: {
    include: ["tests/**/*.test.js"],
    testTimeout: 60000,
  },
  resolve: {
    alias: {
      jszip: DEV_MODULES + "/jszip/dist/jszip.min.js",
      "opentype.js": DEV_MODULES + "/opentype.js/dist/opentype.mjs",
      pako: DEV_MODULES + "/pako/index.js",
    },
  },
};
