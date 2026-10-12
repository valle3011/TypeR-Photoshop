// TypeR start guard — loaded BEFORE main.js, written in plain ES5 on purpose
// so it runs on every UXP version. If main.js cannot load or start (e.g. a
// JavaScript feature the host lacks), the panel would otherwise only say
// "TypeR is loading …" forever. This shows the error, and after 8 s without
// a start a short report of what this Photoshop/UXP supports.
(function () {
  var box = null;
  var seen = [];

  function el() {
    if (!box) box = document.getElementById("typer-boot");
    return box;
  }

  function show(text) {
    var b = el();
    if (!b) return;
    var pre = document.createElement("pre");
    pre.className = "fatal";
    pre.textContent = text;
    b.appendChild(pre);
  }

  function log(text) {
    try { console.log("[TypeR boot] " + text); } catch (e) { /* no console */ }
  }

  function has(test) {
    try { return test() ? "ja/yes" : "NEIN/NO"; } catch (e) { return "NEIN/NO (" + (e && e.message) + ")"; }
  }

  function report() {
    var lines = [];
    var host = "?";
    var uxpv = "?";
    try { host = require("photoshop").app.version || (require("uxp").host || {}).version; } catch (e) { host = "? (" + e.message + ")"; }
    try { uxpv = require("uxp").versions.uxp; } catch (e) { uxpv = "? (" + e.message + ")"; }
    lines.push("Photoshop: " + host + "   UXP: " + uxpv);
    lines.push("Unicode-Regex \\p{L}: " + has(function () { return new RegExp("\\p{L}", "u").test("a"); }));
    lines.push("Regex lookbehind: " + has(function () { return new RegExp("(?<!a)b").test("b"); }));
    lines.push("TextDecoder: " + has(function () { return typeof TextDecoder === "function"; }));
    lines.push("TextEncoder: " + has(function () { return typeof TextEncoder === "function"; }));
    lines.push("Promise.allSettled: " + has(function () { return typeof Promise.allSettled === "function"; }));
    lines.push("globalThis: " + has(function () { return typeof globalThis === "object"; }));
    lines.push("entrypoints: " + has(function () { return typeof require("uxp").entrypoints.setup === "function"; }));
    lines.push("main.js geladen/loaded: " + (window.__typerMainLoaded ? "ja/yes" : "NEIN/NO"));
    if (window.__typerSetupErrors) lines.push("\nsetup: " + window.__typerSetupErrors.join("\n"));
    return lines.join("\n");
  }

  window.addEventListener("error", function (ev) {
    var msg = (ev && (ev.message || (ev.error && ev.error.message))) || String(ev);
    var where = ev && ev.filename ? " (" + ev.filename + ":" + ev.lineno + ":" + ev.colno + ")" : "";
    var stack = ev && ev.error && ev.error.stack ? "\n" + ev.error.stack : "";
    var text = msg + where + stack;
    if (seen.indexOf(text) >= 0) return;
    seen.push(text);
    log("error: " + text);
    if (!window.__typerStarted) show("TypeR – Fehler beim Laden / load error:\n" + text);
  });

  log("boot.js loaded");
  setTimeout(function () {
    if (window.__typerStarted) return;
    var r = report();
    log("not started after 8 s\n" + r);
    show("TypeR ist nicht gestartet / did not start.\nBitte Screenshot schicken / please send a screenshot:\n\n" + r);
  }, 8000);
})();
