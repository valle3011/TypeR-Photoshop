// Port of TypeR-Krita/test_fontfav.py.
import { test, expect } from "vitest";
import { FavoritesStore, UNCATEGORIZED } from "../src/core/fontfav.js";
import { makeChecker, deepEq } from "./helpers.js";

const setEq = (a, b) => deepEq([...a].sort(), [...b].sort());

test("font favourites store", () => {
  const check = makeChecker();
  let s = new FavoritesStore();
  check("empty store has no categories", deepEq(s.categories(), []));
  check("add_category returns the name", s.addCategory("Dialog") === "Dialog");
  check("add_category is case-insensitively idempotent", s.addCategory("dialog") === "Dialog" && deepEq(s.categories(), ["Dialog"]));
  check("blank category is ignored", s.addCategory("   ") === null && deepEq(s.categories(), ["Dialog"]));
  s.addCategory("SFX");
  check("categories keep insertion order", deepEq(s.categories(), ["Dialog", "SFX"]));
  check("rename_category updates the list", s.renameCategory("SFX", "Sound") === "Sound" && deepEq(s.categories(), ["Dialog", "Sound"]));
  check("rename unknown category returns None", s.renameCategory("nope", "x") === null);

  s = new FavoritesStore();
  s.addFont("CC Wild Words", ["Dialog", "SFX"]);
  check("add_font creates referenced categories", setEq(s.categories(), ["Dialog", "SFX"]));
  check("is_favorite true after add", s.isFavorite("CC Wild Words"));
  check("font_categories reflects the links (1..n)", deepEq(s.fontCategories("CC Wild Words"), ["Dialog", "SFX"]));
  check("a font can be added to more categories later",
    s.addFont("CC Wild Words", ["Titel"]) && deepEq(s.fontCategories("CC Wild Words"), ["Dialog", "SFX", "Titel"]));
  check("re-adding an existing link does not duplicate it",
    s.addFont("CC Wild Words", ["Dialog"]) && deepEq(s.fontCategories("CC Wild Words"), ["Dialog", "SFX", "Titel"]));
  check("blank font is ignored", s.addFont("  ") === null);
  s.addFont("Anime Ace 2", ["Dialog"]);
  check("many fonts share one category", setEq(s.fontsInCategory("Dialog"), ["CC Wild Words", "Anime Ace 2"]));

  s = new FavoritesStore();
  check("toggle adds a link and the font", s.toggle("Font A", "SFX") === true);
  check("toggle again removes the link", s.toggle("Font A", "SFX") === false);
  check("font stays a favourite after its last link is toggled off", s.isFavorite("Font A") && deepEq(s.fontCategories("Font A"), []));

  s = new FavoritesStore();
  s.addFont("Zed", ["Dialog"]);
  s.addFont("alpha", ["Dialog"]);
  s.addFont("Loose");
  check("fonts_in_category(None) returns all favourites, sorted CI", deepEq(s.fontsInCategory(null), ["alpha", "Loose", "Zed"]));
  check("category filter narrows the list", deepEq(s.fontsInCategory("Dialog"), ["alpha", "Zed"]));
  check("UNCATEGORIZED returns only link-less favourites", deepEq(s.fontsInCategory(UNCATEGORIZED), ["Loose"]));
  check("unknown category yields empty list", deepEq(s.fontsInCategory("Ghost"), []));
  check("search filters by substring, case-insensitively", deepEq(s.fontsInCategory(null, "AL"), ["alpha"]));
  check("multi-token search requires all tokens", deepEq(s.fontsInCategory(null, "al ph"), ["alpha"]));
  check("category_counts counts references", deepEq(s.categoryCounts(), { Dialog: 2 }));

  s = new FavoritesStore();
  s.addFont("F1", ["A", "B"]);
  s.addFont("F2", ["A"]);
  check("remove_category strips it from every font",
    s.removeCategory("A") && deepEq(s.fontCategories("F1"), ["B"]) && deepEq(s.fontCategories("F2"), []));
  check("remove_font drops the favourite", s.removeFont("F1") && !s.isFavorite("F1"));
  check("remove_font on a missing font returns False", s.removeFont("nope") === false);

  s = new FavoritesStore();
  s.addFont("F", ["Old", "Keep"]);
  check("renaming onto an existing category merges (no dup on the font)",
    s.renameCategory("Old", "keep") === "Keep" && deepEq(s.fontCategories("F"), ["Keep"]) && deepEq(s.categories(), ["Keep"]));

  s = new FavoritesStore();
  s.addFont("F", ["A", "B"]);
  s.setFontCategories("F", ["C"]);
  check("set_font_categories replaces the whole set", deepEq(s.fontCategories("F"), ["C"]) && s.categories().includes("C"));

  s = new FavoritesStore();
  s.addFont("CC Wild Words", ["Dialog", "SFX"]);
  s.addFont("Anime Ace 2", ["Dialog"]);
  s.addCategory("Titel");
  const s2 = FavoritesStore.fromJson(s.toJson());
  check("round-trip preserves categories", deepEq(s2.categories(), s.categories()));
  check("round-trip preserves font links", deepEq(s2.fontCategories("CC Wild Words"), ["Dialog", "SFX"]));
  check("round-trip preserves an empty category", s2.categories().includes("Titel"));

  check("from_json('') -> empty store", deepEq(FavoritesStore.fromJson("").categories(), []) && deepEq(FavoritesStore.fromJson("").fonts(), []));
  check("from_json(None) -> empty store", deepEq(FavoritesStore.fromJson(null).fonts(), []));
  check("from_json(garbage) -> empty store, no raise", deepEq(FavoritesStore.fromJson("{not json").fonts(), []));
  check("from_json(non-dict json) -> empty store", deepEq(FavoritesStore.fromJson("[1,2,3]").fonts(), []));
  const partial = FavoritesStore.fromJson('{"fonts": {"X": "notalist"}}');
  check("from_json tolerates a bad font value (keeps font, no links)", partial.isFavorite("X") && deepEq(partial.fontCategories("X"), []));

  s = new FavoritesStore();
  s.addFont("CC Wild Words", ["Dialog"]);
  s.addFont("Anime Ace 2", ["Dialog"]);
  s.addFont("Arial", []);
  check("missing_fonts lists favourites not in the installed set", deepEq(s.missingFonts(["Arial"]), ["Anime Ace 2", "CC Wild Words"]));
  check("missing_fonts matches case-insensitively", deepEq(s.missingFonts(["arial", "anime ace 2", "cc wild words"]), []));
  check("missing_fonts with nothing installed returns all favourites", deepEq(s.missingFonts([]), ["Anime Ace 2", "Arial", "CC Wild Words"]));

  const a = new FavoritesStore();
  a.addFont("Font A", ["Dialog"]);
  const b = new FavoritesStore();
  b.addFont("Font A", ["SFX"]);
  b.addFont("Font B", ["Titel"]);
  const added = a.merge(b);
  check("merge reports the number of NEW favourites added", added === 1);
  check("merge unions a shared font's categories", deepEq(a.fontCategories("Font A"), ["Dialog", "SFX"]));
  check("merge brings in new fonts + their categories", deepEq(a.fontCategories("Font B"), ["Titel"]) && a.categories().includes("Titel"));
  check("merge(None) is a safe no-op", a.merge(null) === 0);

  s = new FavoritesStore();
  s.addFont("F", ["Dialog"]);
  check("ui_get default when unset", s.uiGet("last_category", "X") === "X");
  s.uiSet("last_category", "Dialog");
  s.uiSet("last_search", "wild");
  const s3 = FavoritesStore.fromJson(s.toJson());
  check("ui state round-trips (category)", s3.uiGet("last_category") === "Dialog");
  check("ui state round-trips (search)", s3.uiGet("last_search") === "wild");
  check("ui state does not leak into the data model", deepEq(s3.categories(), ["Dialog"]) && deepEq(s3.fonts(), ["F"]));
  check("None category round-trips as None", FavoritesStore.fromJson(new FavoritesStore().toJson()).uiGet("last_category") === null);
  check("the JSON format is the Krita one (version 1)", JSON.parse(s.toJson()).version === 1);
  expect(check.failed).toEqual([]);
});
