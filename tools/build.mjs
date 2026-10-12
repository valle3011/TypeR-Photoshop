// Build the UXP plugin: bundle src/main.js with esbuild into dist/plugin/
// together with manifest.json, index.html, styles.css, the hyphenation
// patterns and the icons. `--ccx` also packs dist/TypeR-<version>.ccx (a ccx
// is a zip of the plugin folder; install it by double-clicking or with the
// UXP Developer Tool). `--watch` rebuilds on change for the UDT's "Load".
//
//   node tools/build.mjs [--ccx] [--watch] [--dev]

import fs from "node:fs";
import childProcess from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { DEV_MODULES } = require("./devdir.cjs");
const esbuild = require(DEV_MODULES + "/esbuild");
const JSZip = require(DEV_MODULES + "/jszip");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "dist", "plugin");
const args = new Set(process.argv.slice(2));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

// --- icons (drawn here, no image tools needed) ---------------------------------

function iconPng(size, dark) {
  const { encodePng } = requireCore("png");
  const rgba = new Uint8Array(size * size * 4);
  const ink = dark ? [230, 230, 230, 255] : [40, 40, 40, 255];
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    rgba.set(c, (y * size + x) * 4);
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++) for (let x = Math.round(x0); x < Math.round(x1); x++) set(x, y, c);
  };
  const s = size / 23;
  // a speech bubble with a "T" in it
  const cx = size / 2;
  const cy = size * 0.44;
  const rx = size * 0.46;
  const ry = size * 0.36;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
      if (d <= 1 && d >= 0.72) set(x, y, ink);
    }
  }
  rect(size * 0.22, cy + ry * 0.7, size * 0.36, cy + ry * 1.25, ink);
  rect(cx - 5 * s, cy - 4 * s, cx + 5 * s, cy - 2.4 * s, ink);
  rect(cx - 0.9 * s, cy - 4 * s, cx + 0.9 * s, cy + 4.5 * s, ink);
  return encodePng(rgba, size, size);
}

const coreCache = {};
function requireCore(name) {
  if (!coreCache[name]) {
    // the core modules are ESM; load the PNG encoder through a tiny transform
    const src = fs.readFileSync(path.join(ROOT, "src", "core", name + ".js"), "utf8");
    const out = esbuild.transformSync(src, { format: "cjs", loader: "js" }).code;
    const mod = { exports: {} };
    new Function("module", "exports", "require", out)(mod, mod.exports, (id) => require(id === "pako" ? DEV_MODULES + "/pako" : id));    // eslint-disable-line no-new-func
    coreCache[name] = mod.exports;
  }
  return coreCache[name];
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "main.js")],
    bundle: true,
    outfile: path.join(OUT, "main.js"),
    format: "iife",
    platform: "browser",
    target: ["es2019"],
    external: ["uxp", "photoshop", "fs", "os"],
    nodePaths: [DEV_MODULES],
    alias: {
      jszip: DEV_MODULES + "/jszip/dist/jszip.min.js",
      "opentype.js": DEV_MODULES + "/opentype.js/dist/opentype.mjs",
      pako: DEV_MODULES + "/pako/index.js",
    },
    sourcemap: args.has("--dev") ? "inline" : false,
    minify: !args.has("--dev"),
    legalComments: "linked",
    logLevel: "info",
  });
  fs.copyFileSync(path.join(ROOT, "manifest.json"), path.join(OUT, "manifest.json"));
  fs.copyFileSync(path.join(ROOT, "src", "index.html"), path.join(OUT, "index.html"));
  fs.copyFileSync(path.join(ROOT, "src", "styles.css"), path.join(OUT, "styles.css"));
  copyDir(path.join(ROOT, "hyph"), path.join(OUT, "hyph"));
  fs.mkdirSync(path.join(OUT, "icons"), { recursive: true });
  // UXP resolves "icons/panel.png" with scale [1, 2] to panel@1x.png / panel@2x.png
  fs.writeFileSync(path.join(OUT, "icons", "panel.png"), iconPng(23, true));
  fs.writeFileSync(path.join(OUT, "icons", "panel@1x.png"), iconPng(23, true));
  fs.writeFileSync(path.join(OUT, "icons", "plugin@1x.png"), iconPng(48, false));
  fs.writeFileSync(path.join(OUT, "icons", "panel@2x.png"), iconPng(46, true));
  fs.writeFileSync(path.join(OUT, "icons", "plugin.png"), iconPng(48, false));
  fs.writeFileSync(path.join(OUT, "icons", "plugin@2x.png"), iconPng(96, false));
  for (const f of ["README.md", "FEATURES.md", "LICENSE"]) {
    if (fs.existsSync(path.join(ROOT, f))) fs.copyFileSync(path.join(ROOT, f), path.join(OUT, f));
  }
  console.log("built", OUT);
}

async function packCcx() {
  const zip = new JSZip();
  const add = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) add(p, prefix + e.name + "/");
      else zip.file(prefix + e.name, fs.readFileSync(p));
    }
  };
  add(OUT, "");
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const file = path.join(ROOT, "dist", `TypeR-${manifest.version}.ccx`);
  fs.writeFileSync(file, bytes);
  console.log("packed", file, `(${(bytes.length / 1024).toFixed(0)} KB)`);
  // release/ is what INSTALL.bat / install.command use and what git keeps:
  // the .ccx under a fixed name + the unpacked plugin (UXP Developer Tool)
  const rel = path.join(ROOT, "release");
  fs.rmSync(path.join(rel, "plugin"), { recursive: true, force: true });
  fs.mkdirSync(rel, { recursive: true });
  fs.writeFileSync(path.join(rel, "TypeR.ccx"), bytes);
  copyDir(OUT, path.join(rel, "plugin"));
  console.log("release", rel);
  buildSetupExe(rel);
}

/** release/TypeR-Setup.exe: the one-click Windows installer with the .ccx
 *  embedded (tools/setup/Setup.cs, compiled with the .NET Framework's csc,
 *  which ships with Windows). Skipped where csc is not available. */
function buildSetupExe(rel) {
  const csc = path.join(process.env.WINDIR || "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  if (process.platform !== "win32" || !fs.existsSync(csc)) {
    console.log("setup exe skipped (no csc.exe)");
    return;
  }
  // an .ico holding one PNG image (Vista+)
  const png = iconPng(48, false);
  const ico = Buffer.alloc(6 + 16 + png.length);
  ico.writeUInt16LE(0, 0);
  ico.writeUInt16LE(1, 2);
  ico.writeUInt16LE(1, 4);
  ico.writeUInt8(48, 6);
  ico.writeUInt8(48, 7);
  ico.writeUInt16LE(1, 10);
  ico.writeUInt16LE(32, 12);
  ico.writeUInt32LE(png.length, 14);
  ico.writeUInt32LE(22, 18);
  Buffer.from(png).copy(ico, 22);
  const icoPath = path.join(ROOT, "dist", "setup.ico");
  fs.writeFileSync(icoPath, ico);
  const out = path.join(rel, "TypeR-Setup.exe");
  const res = childProcess.spawnSync(csc, [
    "/nologo", "/target:winexe", "/optimize+", "/platform:anycpu",
    `/out:${out}`, `/win32icon:${icoPath}`,
    `/resource:${path.join(rel, "TypeR.ccx")},TypeR.ccx`,
    "/reference:System.Windows.Forms.dll",
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll",
    "/reference:System.Web.Extensions.dll",
    path.join(ROOT, "tools", "setup", "Setup.cs"),
  ], { encoding: "utf8" });
  if (res.status !== 0) {
    console.error("setup exe failed:\n" + (res.stdout || "") + (res.stderr || ""));
    process.exitCode = 1;
    return;
  }
  console.log("setup", out, `(${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
}

await build();
if (args.has("--ccx")) await packCcx();
if (args.has("--watch")) {
  let t = null;
  fs.watch(path.join(ROOT, "src"), { recursive: true }, () => {
    clearTimeout(t);
    t = setTimeout(() => build().catch((e) => console.error(e.message)), 200);
  });
  console.log("watching src/ …");
}
