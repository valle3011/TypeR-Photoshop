// Where the dev dependencies (esbuild, vitest, jszip, opentype.js) live.
// Override with TYPER_PS_DEV; default: %LOCALAPPDATA%/typer-ps-dev (Windows)
// or ~/.cache/typer-ps-dev.
const path = require("path");
const os = require("os");
const base = process.env.TYPER_PS_DEV
  || (process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "typer-ps-dev")
    : path.join(os.homedir(), ".cache", "typer-ps-dev"));
module.exports = { DEV_DIR: base, DEV_MODULES: path.join(base, "node_modules").split(path.sep).join("/") };
