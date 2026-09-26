#!/usr/bin/env python3
"""BubblR bridge: lets the TypeR Photoshop panel reach the BubblR AI detector.

The Krita plugin started the detector's venv python itself. A Photoshop UXP
panel cannot start processes, so this tiny stdlib HTTP server does it on its
behalf. It listens on 127.0.0.1 only (never on the network).

    python tools/bubblr_bridge.py [--ai-dir PATH] [--port 8765]

Endpoints (all JSON unless noted):
    GET  /info                 -> {ai_dir, models_dir, models: [...]}
    POST /detect?conf=&sfx_conf=&tile=&model=   body: page PNG
                               -> detect.py's JSON (boxes)
    POST /panels               body: page PNG -> panels.py's JSON
    POST /export               {stem, image_png_b64, label, boxes} -> {path}
    POST /open_models          opens the models folder

The ai/ folder is found like Krita's ai_backend.find_ai_dir: --ai-dir, then
the BUBBLR_AI_DIR environment variable, then the default development path.
It must hold detect.py (and panels.py) plus a .venv.
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_AI_DIR = r"C:\Users\valle\Desktop\ClaudeProgram\BubblR-Test\ai"
DETECT_TIMEOUT = 90
PANEL_TIMEOUT = 240
MODEL_FILES = (("baseline", "comic-text-bubble-detector.onnx"),
               ("finetuned", "bubblr-finetuned.onnx"))


def venv_python(ai_dir):
    if os.name == "nt":
        return os.path.join(ai_dir, ".venv", "Scripts", "python.exe")
    return os.path.join(ai_dir, ".venv", "bin", "python")


def find_ai_dir(explicit=""):
    for cand in (explicit, os.environ.get("BUBBLR_AI_DIR", ""), DEFAULT_AI_DIR):
        if cand and os.path.exists(os.path.join(cand, "detect.py")) \
                and os.path.exists(venv_python(cand)):
            return cand
    return None


def clean_env():
    """No PYTHON* variables leak into the detector's own interpreter."""
    return {k: v for k, v in os.environ.items()
            if not k.upper().startswith("PYTHON")}


def run_script(ai_dir, script, args, timeout):
    """Run <ai_dir>/<script> with --image/--out; return the output text."""
    py = venv_python(ai_dir)
    path = os.path.join(ai_dir, script)
    if not (os.path.exists(py) and os.path.exists(path)):
        raise RuntimeError("ai folder not set up (%s)" % ai_dir)
    out_path = os.path.join(tempfile.gettempdir(),
                            "bubblr_bridge_%d.json" % int(time.time() * 1000))
    cmd = [py, path] + args + ["--out", out_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=timeout, env=clean_env(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except subprocess.TimeoutExpired:
        raise RuntimeError("%s timed out after %ds" % (script, timeout))
    try:
        if proc.returncode != 0:
            err = (proc.stderr or b"").decode("utf-8", "replace").strip()
            raise RuntimeError(err or "exit code %d" % proc.returncode)
        with open(out_path, "r", encoding="utf-8") as fh:
            return fh.read()
    finally:
        try:
            os.remove(out_path)
        except OSError:
            pass


def dataset_root(ai_dir):
    cfg = os.path.join(ai_dir, "dataset_root.txt")
    try:
        with open(cfg, "r", encoding="utf-8") as fh:
            p = fh.read().strip()
        if p and os.path.isdir(p):
            return p
    except OSError:
        pass
    return os.path.join(ai_dir, "dataset")


def save_preview(png_path, boxes, out_path):
    """Human-viewable copy with the markings (needs Pillow; optional)."""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return
    img = Image.open(png_path).convert("RGB")
    d = ImageDraw.Draw(img)
    w, h = img.size
    pen = max(2, w // 400)
    for i, b in enumerate(boxes, 1):
        sfx = b.get("kind") == "sfx"
        col = (70, 130, 230) if sfx else (230, 60, 60)
        r = [b["x"], b["y"], b["x"] + b["w"], b["y"] + b["h"]]
        poly = b.get("poly")
        if poly and not sfx and len(poly) >= 3:
            d.polygon([tuple(p) for p in poly], outline=col, width=pen)
        elif b.get("shape") == "round" and not sfx:
            d.ellipse(r, outline=col, width=pen)
        else:
            d.rectangle(r, outline=col, width=pen)
        bw, bh = max(26, w // 70), max(20, h // 110)
        d.rectangle([b["x"], b["y"], b["x"] + bw, b["y"] + bh], fill=col)
        d.text((b["x"] + 4, b["y"] + 2), str(i), fill=(255, 255, 255))
    img.save(out_path, "PNG")


class Handler(BaseHTTPRequestHandler):
    ai_dir = None

    def log_message(self, fmt, *args):
        sys.stderr.write("bubblr_bridge: " + (fmt % args) + "\n")

    def _send(self, code, payload, ctype="application/json"):
        data = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _error(self, code, msg):
        self._send(code, json.dumps({"error": str(msg)}))

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        url = urllib.parse.urlparse(self.path)
        if url.path == "/info":
            ai = self.ai_dir
            models_dir = os.path.join(ai, "models") if ai else ""
            rows = []
            for choice, fname in MODEL_FILES:
                p = os.path.join(models_dir, fname) if ai else ""
                if p and os.path.exists(p):
                    state = "%.0f MB" % (os.path.getsize(p) / 1048576.0)
                    if os.path.exists(p + ".promoted"):
                        state += " + promoted"
                else:
                    state = "\u2014"
                rows.append({"choice": choice, "fname": fname, "state": state})
            self._send(200, json.dumps({"ai_dir": ai or "", "models_dir": models_dir, "models": rows}))
            return
        self._error(404, "unknown endpoint")

    def do_POST(self):  # noqa: N802
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        ai = self.ai_dir
        try:
            if url.path in ("/detect", "/panels"):
                if not ai:
                    self._error(503, "ai folder not found")
                    return
                png = self._body()
                tmp = os.path.join(tempfile.gettempdir(), "bubblr_bridge_page_%d.png" % int(time.time() * 1000))
                with open(tmp, "wb") as fh:
                    fh.write(png)
                try:
                    if url.path == "/detect":
                        args = ["--image", tmp, "--conf", q.get("conf", "0.4"),
                                "--sfx-conf", q.get("sfx_conf", "0.25"),
                                "--tile", q.get("tile", "auto"), "--model", q.get("model", "auto")]
                        text = run_script(ai, "detect.py", args, DETECT_TIMEOUT)
                    else:
                        text = run_script(ai, "panels.py", ["--image", tmp], PANEL_TIMEOUT)
                finally:
                    try:
                        os.remove(tmp)
                    except OSError:
                        pass
                self._send(200, text)
                return
            if url.path == "/export":
                if not ai:
                    self._error(503, "ai folder not found")
                    return
                d = json.loads(self._body().decode("utf-8"))
                stem = "".join(ch if (ch.isalnum() or ch in "-_") else "_" for ch in str(d.get("stem") or "page"))
                root = dataset_root(ai)
                images = os.path.join(root, "images", "train")
                labels = os.path.join(root, "labels", "train")
                os.makedirs(images, exist_ok=True)
                os.makedirs(labels, exist_ok=True)
                img_path = os.path.join(images, stem + ".png")
                with open(img_path, "wb") as fh:
                    fh.write(base64.b64decode(d["image_png_b64"]))
                with open(os.path.join(labels, stem + ".txt"), "w", encoding="utf-8") as fh:
                    fh.write(d.get("label") or "")
                try:
                    preview = os.path.join(root, "preview")
                    os.makedirs(preview, exist_ok=True)
                    save_preview(img_path, d.get("boxes") or [], os.path.join(preview, stem + ".png"))
                except Exception:
                    pass
                self._send(200, json.dumps({"path": img_path}))
                return
            if url.path == "/open_models":
                target = os.path.join(ai, "models") if ai else ""
                if target and not os.path.isdir(target):
                    target = ai
                if target:
                    if os.name == "nt":
                        os.startfile(target)            # noqa: S606
                    else:
                        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", target])
                self._send(200, "{}")
                return
        except Exception as exc:                        # noqa: BLE001
            self._error(500, exc)
            return
        self._error(404, "unknown endpoint")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ai-dir", default="")
    ap.add_argument("--port", type=int, default=8765)
    a = ap.parse_args()
    Handler.ai_dir = find_ai_dir(a.ai_dir)
    srv = ThreadingHTTPServer(("127.0.0.1", a.port), Handler)
    print("BubblR bridge on http://127.0.0.1:%d  (ai folder: %s)" % (a.port, Handler.ai_dir or "NOT FOUND"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
