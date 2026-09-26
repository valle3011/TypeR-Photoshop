// File access: pickers, reading/writing bytes and text, native paths.
//
// The manifest asks for localFileSystem "fullAccess" because the port has to
// read what the Krita plugin read: script files the user loads, installed
// font files (bundles, measuring), the Downloads folder (Google export) and
// pattern images. Everything else goes through the pickers.

import { uxp, hostRequire } from "./ps.js";

const lfs = () => uxp().storage.localFileSystem;
const formats = () => uxp().storage.formats;

function nodeFs() {
  try {
    return hostRequire("fs") || null;
  } catch (e) {
    return null;
  }
}

/** Open picker. Returns {name, path, bytes: Uint8Array} or null. */
export async function pickOpen(types, opts = {}) {
  const f = await lfs().getFileForOpening({ types, allowMultiple: false, initialDomain: opts.domain });
  if (!f) return null;
  const buf = await f.read({ format: formats().binary });
  return { name: f.name, path: f.nativePath, bytes: new Uint8Array(buf), entry: f };
}

/** Folder picker. Returns {name, path, entry} or null. */
export async function pickFolder() {
  const d = await lfs().getFolder();
  return d ? { name: d.name, path: d.nativePath, entry: d } : null;
}

/** Save picker + write. `data` is a string or bytes. Returns the path or null. */
export async function pickSave(suggestedName, types, data) {
  const f = await lfs().getFileForSaving(suggestedName, { types });
  if (!f) return null;
  if (typeof data === "string") await f.write(data, { format: formats().utf8 });
  else await f.write(data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data, { format: formats().binary });
  return f.nativePath;
}

// --- native paths (fullAccess) ----------------------------------------------

function fileUrl(path) {
  return "file:" + String(path).replace(/\\/g, "/");
}

export async function readBytes(path) {
  const fs = nodeFs();
  if (fs && fs.readFile) {
    try {
      const buf = await fs.readFile(fileUrl(path));
      return new Uint8Array(buf);
    } catch (e) {
      // fall through to the entry API
    }
  }
  const entry = await lfs().getEntryWithUrl(fileUrl(path));
  const buf = await entry.read({ format: formats().binary });
  return new Uint8Array(buf);
}

/** `length` bytes at `offset` of a file — via fs.open/read when the host
 *  has them, else null (the caller then reads the whole file). */
export async function openForRanges(path) {
  const fs = nodeFs();
  if (!fs || !fs.open || !fs.read) return null;
  let fd;
  try {
    fd = await fs.open(fileUrl(path), "r");
  } catch (e) {
    return null;
  }
  return {
    async read(offset, length) {
      const buf = new Uint8Array(length);
      const r = await fs.read(fd, buf, 0, length, offset);
      const n = typeof r === "number" ? r : r && r.bytesRead !== undefined ? r.bytesRead : length;
      return buf.subarray(0, n);
    },
    async close() {
      try {
        await fs.close(fd);
      } catch (e) {
        // closed
      }
    },
  };
}

export async function readText(path) {
  const entry = await lfs().getEntryWithUrl(fileUrl(path));
  return entry.read({ format: formats().utf8 });
}

export async function writeBytes(path, bytes) {
  const fs = nodeFs();
  const data = bytes instanceof Uint8Array ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : bytes;
  if (fs && fs.writeFile) {
    await fs.writeFile(fileUrl(path), data);
    return;
  }
  const dirPath = path.replace(/[\\/][^\\/]*$/, "");
  const name = path.split(/[\\/]/).pop();
  const dir = await lfs().getEntryWithUrl(fileUrl(dirPath));
  const f = await dir.createFile(name, { overwrite: true });
  await f.write(data, { format: formats().binary });
}

export async function writeText(path, text) {
  const fs = nodeFs();
  if (fs && fs.writeFile) {
    await fs.writeFile(fileUrl(path), text, { encoding: "utf-8" });
    return;
  }
  const enc = new TextEncoder().encode(text);
  await writeBytes(path, enc);
}

export async function listDir(path) {
  const fs = nodeFs();
  if (fs && fs.readdir) {
    try {
      return await fs.readdir(fileUrl(path));
    } catch (e) {
      return [];
    }
  }
  try {
    const dir = await lfs().getEntryWithUrl(fileUrl(path));
    const entries = await dir.getEntries();
    return entries.map((e) => e.name);
  } catch (e) {
    return [];
  }
}

/** {isDir, size, mtime} or null. */
export async function stat(path) {
  const fs = nodeFs();
  if (fs && fs.lstat) {
    try {
      const s = await fs.lstat(fileUrl(path));
      return {
        isDir: typeof s.isDirectory === "function" ? s.isDirectory() : !!s.isDirectory,
        size: Number(s.size) || 0,
        mtime: Math.floor(Number(s.mtimeMs || (s.mtime && s.mtime.getTime && s.mtime.getTime()) || 0) / 1000),
      };
    } catch (e) {
      return null;
    }
  }
  return null;
}

export async function exists(path) {
  return (await stat(path)) !== null;
}

export async function makeDir(path) {
  const fs = nodeFs();
  if (fs && fs.mkdir) {
    try {
      await fs.mkdir(fileUrl(path), { recursive: true });
    } catch (e) {
      // already there
    }
  }
}

/** The plugin's data folder (native path) and temp folder. */
export async function dataFolderPath() {
  const f = await lfs().getDataFolder();
  return f.nativePath;
}

export async function tempFolderPath() {
  const f = await lfs().getTemporaryFolder();
  return f.nativePath;
}

/** Text of a file bundled with the plugin (e.g. hyph/*.txt), or null. */
export async function readPluginText(rel) {
  try {
    const root = await lfs().getPluginFolder();
    let entry = root;
    for (const part of rel.split("/")) entry = await entry.getEntry(part);
    return await entry.read({ format: formats().utf8 });
  } catch (e) {
    return null;
  }
}

export async function pluginFileExists(rel) {
  try {
    const root = await lfs().getPluginFolder();
    let entry = root;
    for (const part of rel.split("/")) entry = await entry.getEntry(part);
    return !!entry;
  } catch (e) {
    return false;
  }
}

/** Environment paths the port needs (home, Windows/LocalAppData, Downloads). */
export function envPaths() {
  let os = null;
  try {
    os = hostRequire("os") || null;
  } catch (e) {
    os = null;
  }
  const platform = (os && os.platform && os.platform()) || (navigator && /Mac/.test(navigator.platform) ? "darwin" : "win32");
  let home = "";
  try {
    home = os && os.homedir ? os.homedir() : "";
  } catch (e) {
    home = "";
  }
  const win = platform === "win32";
  const sep = win ? "\\" : "/";
  return { platform, win, home, sep };
}
