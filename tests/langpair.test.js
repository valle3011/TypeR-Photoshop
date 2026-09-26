// Port of the langpair.py sections of TypeR-Krita/test_typer_logic.py.
import { test, expect } from "vitest";
import * as LP from "../src/core/langpair.js";
import { makeChecker, deepEq } from "./helpers.js";

test("detect_manga + default_preset_for", () => {
  const check = makeChecker();
  const saved = ["Sakamoto Days", "Spy x Family", "One Piece"];
  check("filename hit", LP.detectManga(saved, "body", "Spy x Family ch12.docx") === "Spy x Family");
  check("filename beats body",
    LP.detectManga(["One Piece", "Spy x Family"], "today we read One Piece", "spy_x_family_005.txt") === "Spy x Family");
  check("header hit (Title:)", LP.detectManga(saved, "Title: Sakamoto Days\nPage 1", "") === "Sakamoto Days");
  check("header hit (Manga:)", LP.detectManga(saved, "Manga: One Piece\n...", "") === "One Piece");
  check("first content lines hit", LP.detectManga(saved, "One Piece\nchapter 5", "") === "One Piece");
  check("longest/most-specific wins", LP.detectManga(["Spy", "Spy x Family"], "Title: Spy x Family", "") === "Spy x Family");
  check("no match -> None", LP.detectManga(saved, "nothing here", "notes.txt") === null);
  check("name shorter than 3 is ignored", LP.detectManga(["Oz"], "Title: Oz", "Oz ch1.txt") === null);
  check("empty saved list -> None", LP.detectManga([], "Title: One Piece", "") === null);
  check("accented name matches", LP.detectManga(["Pok\u00e9mon"], "Title: Pok\u00e9mon Adventure", "") === "Pok\u00e9mon");

  check("'Normal Talking' name wins", LP.defaultPresetFor(["Shout", "Normal Talking", "Whisper"]) === "Normal Talking");
  check("'talking' keyword match", LP.defaultPresetFor(["Angry", "Talking (soft)"]) === "Talking (soft)");
  check("most-used fallback", LP.defaultPresetFor(["Style A", "Style B"], { "Style A": 1, "Style B": 5 }) === "Style B");
  check("first non-none fallback", LP.defaultPresetFor(["Zeta", "Alpha"]) === "Alpha");
  check("only 'none' -> None", LP.defaultPresetFor(["none", "None"]) === null);
  check("empty -> None", LP.defaultPresetFor([]) === null);
  check("keyword beats usage", LP.defaultPresetFor(["Normal", "Loud"], { Loud: 99 }) === "Normal");
  expect(check.failed).toEqual([]);
});

test("flatten_presets + main characters", () => {
  const check = makeChecker();
  const chars = {
    Sakamoto: { Normal: { size: 20 }, Shout: { size: 40 } },
    Shin: { Normal: { size: 18 }, Whisper: { size: 12 } },
  };
  const flat = LP.flattenPresets(chars);
  const has = (list, e) => list.some((x) => deepEq(x, e));
  check("flatten_presets lists every preset of the manga", flat.length === 4);
  const labels = flat.map((e) => e[0]);
  check("flatten_presets sorted case-insensitively by label",
    deepEq(labels, [...labels].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0))));
  check("duplicate names get the (Character) suffix",
    has(flat, ["Normal (Sakamoto)", "Sakamoto", "Normal"]) && has(flat, ["Normal (Shin)", "Shin", "Normal"]));
  check("unique names keep their plain label",
    has(flat, ["Shout", "Sakamoto", "Shout"]) && has(flat, ["Whisper", "Shin", "Whisper"]));
  check("flatten_presets tracks the owning character", flat.every((e) => e[2] in chars[e[1]]));
  check("flatten_presets: empty/invalid input -> empty list",
    LP.flattenPresets({}).length === 0 && LP.flattenPresets(null).length === 0 && LP.flattenPresets({ X: "not a dict" }).length === 0);

  const names = ["Zenitsu", "aoi", "Makima", "Denji"];
  const ci = (arr) => [...arr].sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  check("sort_characters puts the main ones in their own block first",
    deepEq(LP.sortCharacters(names, ["Denji", "Makima"]), [["Denji", "Makima"], ["aoi", "Zenitsu"]]));
  check("sort_characters sorts both blocks case-insensitively", deepEq(LP.sortCharacters(["b", "A"], ["b"]), [["b"], ["A"]]));
  check("sort_characters matches a main character case-insensitively", deepEq(LP.sortCharacters(["Denji"], ["denji"]), [["Denji"], []]));
  check("sort_characters without favourites keeps everyone in one block",
    deepEq(LP.sortCharacters(names), [[], ci(names)]) && deepEq(LP.sortCharacters(names, []), [[], ci(names)]));
  check("sort_characters survives junk",
    deepEq(LP.sortCharacters(null), [[], []]) && deepEq(LP.sortCharacters(["A"], [null, "", "  "]), [[], ["A"]]));
  const favflat = LP.flattenPresets(chars, ["Shin"]);
  check("flatten_presets floats a main character's presets to the top",
    deepEq(favflat.map((e) => e[1]), ["Shin", "Shin", "Sakamoto", "Sakamoto"]));
  check("flatten_presets keeps each block alphabetical",
    deepEq(favflat.map((e) => e[0]), ["Normal (Shin)", "Whisper", "Normal (Sakamoto)", "Shout"]));
  check("flatten_presets without favourites is unchanged",
    deepEq(LP.flattenPresets(chars, []), flat) && deepEq(LP.flattenPresets(chars, null), flat));
  check("flatten_presets still labels duplicates when favourites are set", has(favflat, ["Normal (Shin)", "Shin", "Normal"]));
  expect(check.failed).toEqual([]);
});

test("script-tab helpers", () => {
  const check = makeChecker();
  check("default_tab_label strips dir + extension", LP.defaultTabLabel("x/y/Spy x Family ch12.docx") === "Spy x Family ch12");
  check("default_tab_label empty -> Untitled", LP.defaultTabLabel("") === "Untitled");
  check("unique_untitled counts up",
    LP.uniqueUntitled(["Untitled"]) === "Untitled 2" && LP.uniqueUntitled(["Untitled", "Untitled 2"]) === "Untitled 3"
    && LP.uniqueUntitled([]) === "Untitled");
  const sess = [{ path: "C:\\a\\b\\one.txt" }, { path: "" }];
  check("find_session_by_path matches same file", LP.findSessionByPath(sess, "C:\\a\\b\\one.txt") === 0);
  check("find_session_by_path matches via relative/normalized form", LP.findSessionByPath(sess, "c:/a/b/../b/ONE.txt") === 0);
  check("find_session_by_path: unknown -> -1", LP.findSessionByPath(sess, "C:\\a\\b\\two.txt") === -1);
  check("find_session_by_path: blank path never matches", LP.findSessionByPath(sess, "") === -1);
  check("splitext keeps a dotfile whole", deepEq(LP.splitext("/x/.bashrc"), ["/x/.bashrc", ""]));
  check("splitext takes the last extension", deepEq(LP.splitext("a/b.tar.gz"), ["a/b.tar", ".gz"]));
  expect(check.failed).toEqual([]);
});

test("column-aware pairing", () => {
  const check = makeChecker();
  check("split_columns splits on tab", deepEq(LP.splitColumns("source\ttranslation"), ["source", "translation"]));
  check("split_columns: no tab -> None", LP.splitColumns("just text") === null);
  check("split_columns folds extra cells into translation", deepEq(LP.splitColumns("a\tb\tc"), ["a", "b c"]));
  const tab = ["Page 1", "JP\tEN", "\u3053\u3093\u306b\u3061\u306f\tHello",
    "Vons \u00eates parfaites!\tYou're all perfect! (fr)", "We came all the way\tWe came all the way *in english"];
  const [pairs] = LP.pairLinesPaged(tab);
  check("column pairing: header row dropped, 3 units", pairs.length === 3);
  check("column pairing inserts the translation regardless of source language",
    deepEq(pairs.map((p) => LP.unitText(p)), ["Hello", "You're all perfect! (fr)", "We came all the way *in english"]));
  check("column pairing keeps the source on the JA side", pairs[1][0] === "Vons \u00eates parfaites!");
  const [pp2] = LP.pairLinesPaged(["\u3053\u3093\u306b\u3061\u306f", "Hello", "\u3042\u308a\u304c\u3068\u3046", "Thanks"]);
  check("plain JA/EN script still language-paired", deepEq(pp2.map((p) => LP.unitText(p)), ["Hello", "Thanks"]));
  expect(check.failed).toEqual([]);
});

test("BubblR page rows + style snapshots", () => {
  const check = makeChecker();
  const pages = ["", "", "Page 1", "Page 1", "Page 2"];
  check("rows for a page", deepEq(LP.rowsForPage(pages, "Page 1"), [2, 3]));
  check("rows before first marker", deepEq(LP.rowsForPage(pages, ""), [0, 1]));
  check("no page filter -> all rows", deepEq(LP.rowsForPage(pages, null), [0, 1, 2, 3, 4]));
  check("unknown page -> empty", deepEq(LP.rowsForPage(pages, "Page 9"), []));
  const style = {
    font: "Wild Words", size: 48, pad: 12, spacing: 110, auto: true, round: true, outline: true, outline_w: 3,
    bold: true, italic: false, underline: true, align: "left", valign: "top", case: "upper", tidy: true,
    color: "#102030", outline_color: "#ffffff", shadow: true, shadow_x: 2, shadow_y: 3,
    shadow_color: "#0a0a0a", hyphenate: true, hyph_lang: "de",
  };
  let kw = LP.styleInsertKwargs(style);
  check("snapshot round trip",
    kw.font_family === "Wild Words" && kw.font_px === 48 && kw.max_px === 48 && Math.abs(kw.padding_frac - 0.12) < 1e-9
    && Math.abs(kw.line_spacing - 1.10) < 1e-9 && kw.auto_fit && kw.shape === "ellipse" && kw.outline
    && kw.outline_px === 3.0 && kw.bold && !kw.italic && kw.underline && kw.align === "left" && kw.valign === "top"
    && kw.case === "upper" && kw.tidy && kw.color === "#102030" && kw.shadow && kw.shadow_dx === 2.0
    && kw.shadow_dy === 3.0 && kw.hyphenate && kw.hyph_lang === "de");
  kw = LP.styleInsertKwargs({});
  check("empty snapshot falls back to defaults",
    kw.font_family === "" && kw.auto_fit && kw.shape === "rect" && kw.align === "center" && kw.case === "none" && kw.hyph_lang === "auto");
  check("fixed size when auto off", LP.styleInsertKwargs({ auto: false, round: true }).shape === "rect");
  expect(check.failed).toEqual([]);
});

test("Drive image comments as a script source", () => {
  const check = makeChecker();
  const ID = "1A2b3C4d5E6f7G8h9I0jKlMnOpQr";
  check("drive_file_id: /file/d/<id>/view", LP.driveFileId(`https://drive.google.com/file/d/${ID}/view?usp=sharing`) === ID);
  check("drive_file_id: open?id=", LP.driveFileId(`https://drive.google.com/open?id=${ID}`) === ID);
  check("drive_file_id: uc?id=", LP.driveFileId(`https://drive.google.com/uc?id=${ID}&export=download`) === ID);
  check("drive_file_id: bare id passes through", LP.driveFileId(ID) === ID);
  check("drive_file_id: junk -> empty", LP.driveFileId("https://example.com/not-a-drive-link") === "");
  check("drive_file_id: empty -> empty", LP.driveFileId("") === "" && LP.driveFileId(null) === "");
  const imgc = [{ text: "Everyone clap" }, { text: "As an idol" }, { text: "" }];
  const script = LP.imageCommentsToScript(imgc);
  check("image_comments_to_script: skips empty comments", (script.match(/\n/g) || []).length === 1);
  const [pairs] = LP.pairLinesPaged(script.split("\n"));
  check("image comments -> one unit per comment", pairs.length === 2);
  check("image comment text lands as the translation", deepEq(pairs.map((p) => LP.unitText(p)), ["Everyone clap", "As an idol"]));
  check("a multi-line comment stays one unit",
    LP.pairLinesPaged(LP.imageCommentsToScript([{ text: "line one\nline two" }]).split("\n"))[0].length === 1);
  check("image_comments_to_script: no comments -> empty script", LP.imageCommentsToScript([]) === "");
  expect(check.failed).toEqual([]);
});

test("preset keybinds", () => {
  const check = makeChecker();
  const kb = LP.cleanKeybinds({
    Serie: { "Ctrl+Alt+1": ["Hizashi", "Normal Talk"], "Ctrl+Alt+2": ["Kuromiya", "Normal Talk"] },
    Andere: { "Ctrl+Alt+1": ["Bob", "Shout"] },
  });
  check("keybinds: a stored map survives the read", deepEq(kb.Serie["Ctrl+Alt+2"], ["Kuromiya", "Normal Talk"]));
  check("keybinds: the same key is free again in another manga", deepEq(kb.Andere["Ctrl+Alt+1"], ["Bob", "Shout"]));
  check("keybinds: junk is dropped, not raised over",
    deepEq(LP.cleanKeybinds({ A: { K: ["c"], "": ["c", "n"], K2: ["c", ""] }, B: "nope" }), {})
    && deepEq(LP.cleanKeybinds(null), {}) && deepEq(LP.cleanKeybinds([1]), {}));
  check("keybinds: keybind_for finds the key of a preset",
    LP.keybindFor(kb, "Serie", "Kuromiya", "Normal Talk") === "Ctrl+Alt+2"
    && LP.keybindFor(kb, "Serie", "Hizashi", "Shout") === "" && LP.keybindFor(kb, "Serie", "Kuromiya", "") === "");
  check("keybinds: keybind_target reports what a key already drives",
    deepEq(LP.keybindTarget(kb, "Serie", "Ctrl+Alt+1"), ["Hizashi", "Normal Talk"])
    && deepEq(LP.keybindTarget(kb, "Serie", "Ctrl+Alt+9"), ["", ""]));
  LP.setKeybind(kb, "Serie", "Ctrl+Alt+7", "Hizashi", "Normal Talk");
  check("keybinds: a preset keeps only its newest key",
    LP.keybindFor(kb, "Serie", "Hizashi", "Normal Talk") === "Ctrl+Alt+7" && !("Ctrl+Alt+1" in kb.Serie));
  LP.setKeybind(kb, "Serie", "Ctrl+Alt+7", "Kuromiya", "Normal Talk");
  check("keybinds: a key taken over leaves its old preset unbound",
    LP.keybindFor(kb, "Serie", "Kuromiya", "Normal Talk") === "Ctrl+Alt+7" && LP.keybindFor(kb, "Serie", "Hizashi", "Normal Talk") === "");
  check("keybinds: the same name under two characters stays two presets", LP.keybindTarget(kb, "Serie", "Ctrl+Alt+7")[0] === "Kuromiya");
  LP.setKeybind(kb, "Serie", "", "Kuromiya", "Normal Talk");
  check("keybinds: an empty key only unbinds, and an empty manga drops out", !("Serie" in kb));
  check("keybinds: binding nothing is a no-op",
    deepEq(LP.setKeybind({}, "Serie", "Ctrl+Alt+1", "Hizashi", ""), {}) && deepEq(LP.setKeybind({}, "", "Ctrl+Alt+1", "Hizashi", "Talk"), {}));
  const kb2 = LP.cleanKeybinds({ Serie: { F5: ["Hizashi", "Talk"], F6: ["Hizashi", "Shout"], F7: ["Kuromiya", "Talk"] } });
  check("keybinds: keybinds_of lists one manga, sorted by key",
    deepEq(LP.keybindsOf(kb2, "Serie"), [["F5", "Hizashi", "Talk"], ["F6", "Hizashi", "Shout"], ["F7", "Kuromiya", "Talk"]])
    && deepEq(LP.keybindsOf(kb2, "Nichts"), []));
  LP.dropKeybinds(kb2, "Serie", "Hizashi", "Shout");
  check("keybinds: deleting a preset drops only its key", deepEq(Object.keys(kb2.Serie).sort(), ["F5", "F7"]));
  LP.dropKeybinds(kb2, "Serie", "Hizashi");
  check("keybinds: deleting a character drops all of theirs", deepEq(Object.keys(kb2.Serie).sort(), ["F7"]));
  LP.dropKeybinds(kb2, "Serie");
  check("keybinds: deleting the manga drops the whole block", deepEq(kb2, {}) && deepEq(LP.dropKeybinds({}, "Weg"), {}));
  expect(check.failed).toEqual([]);
});
