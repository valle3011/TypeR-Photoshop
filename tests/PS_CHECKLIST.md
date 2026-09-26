# TypeR für Photoshop – Testanleitung

Alles, was ohne Photoshop prüfbar ist, prüfen die automatischen Tests (59 Tests,
darunter ein Smoke-Test, der das ganze Panel gegen ein nachgebautes Photoshop
aufbaut). Diese Liste deckt den Rest ab: **was Photoshop tatsächlich zeichnet**.

Bitte bei jedem Fehler melden: Punktnummer, was passiert ist, Text der
Statuszeile und – falls vorhanden – die Konsolenausgabe aus dem UXP Developer
Tool (Debug → Console).

## 0. Installieren

1. `TypeR-Setup.exe` (GitHub-Release) oder `INSTALL.bat` doppelklicken (installiert bzw. aktualisiert `release\TypeR.ccx`
   und Photoshop dann neu starten) **oder** im *UXP Developer Tool*:
   *Add Plugin* → `release/plugin/manifest.json` → *Load*.
   ✅ Das Fenster meldet „FERTIG“ – sonst die Ausgabe des Fensters mitschicken.
2. Photoshop: *Plugins › TypeR › TypeR*. Das Panel öffnet sich mit dem Type-Tab.
3. ✅ Kein roter „TypeR could not start“-Text; unten steht
   `TypeR v2.0 · Photoshop 2x.x · UXP x.x`.

## 1. Messung zuerst (wichtigster Punkt)

1. Ein Dokument öffnen (z. B. 1200 × 1800 px, 300 ppi **und** einmal 72 ppi).
2. *Setup › 🩺 Diagnose* aufklappen, drei Schriften eintragen, z. B.
   `Arial, Comic Sans MS, <deine Lettering-Schrift>`, *Selbsttest starten*.
3. ✅ Jede Zeile zeigt **OK** und eine Abweichung ≤ 1 %. Nach dem Test gibt es
   **keine** neue Ebene und **keinen** Verlaufsschritt.
4. Die Ausgabe hier bitte komplett mitschicken (auch bei OK) – daraus sehe ich,
   ob die Größenumrechnung bei 300 ppi stimmt.

## 2. Type-Tab

1. Skript laden (.docx mit Kommentaren, .txt mit „Page 1“-Markern). ✅ Tabelle
   gefüllt, Seitenauswahl sichtbar, Kommentare erscheinen bei der Zeile.
2. Rechteckige Auswahl in eine Sprechblase ziehen, Schrift wählen, *Einfügen*.
   ✅ Eine **Textebene** `TypeR 01 — …`, editierbar mit dem Textwerkzeug,
   zentriert in der Auswahl, Zeilenumbrüche wie in der Vorschau.
   ✅ Genau **ein** Verlaufsschritt „TypeR: insert“.
3. Dieselbe Zeile nochmal einfügen (*Vorher eingefügte Zeile ersetzen* an).
   ✅ Die alte Ebene ist weg, eigene Ebenen bleiben unangetastet.
4. Wort markieren → **Fett**, einfügen. ✅ Nur dieses Wort fett (echter Bold-Schnitt,
   sonst Faux-Fett).
5. Elliptische Auswahl + *Runde Sprechblase*. ✅ Text ellipsenförmig umbrochen.
6. *Senkrechter Text* an. ✅ Aufrechte Zeichen in Spalten, rechts beginnend.
7. Zeilenabstand 60 % und 300 %. ✅ Abstand wirkt wie in der Vorschau.
8. Farbe: Klick auf den Farbknopf öffnet den Photoshop-Farbwähler; nach OK ist
   die Farbe übernommen.
9. Sprechblase (Setup › Experimentell › Sprechblasen-Werkzeuge an): Form wählen,
   *Sprechblase einfügen*. ✅ Formebene mit Schwanz, **unter** dem Text der Zeile.

## 3. Style-Tab (Ebenenstile)

Jeweils einfügen und in *Ebene › Ebenenstil* nachsehen:

1. Kontur 8 px weiß → ✅ *Kontur*, außen, **4 px** (sichtbare Hälfte, wie Krita).
2. 2. Kontur 16 px schwarz → ✅ zusätzlich *Schein nach außen* (präzise, 100 %
   Überfüllen), sichtbar als harter schwarzer Rand **unter** der weißen Kontur.
3. Schatten 6/6 → ✅ *Schlagschatten* nach rechts unten, harte Kante.
4. Setup › Experimentell › Musterfüllungen an; im Kontur-Popup *Erzeugen* →
   Punkte → OK, einfügen. ✅ Kontur mit Muster; ein Muster „TypeR outline …“
   erscheint in *Fenster › Muster*.
5. Weiche Kontur an. ✅ zusätzlicher weicher Schein (Schlagschatten, Distanz 0).
6. Musterziel „2. Kontur“ → ✅ zwei Konturen (Konturmulti), Muster auf der äußeren.
7. Füll-Panel: Auswahl zeichnen, Muster wählen, *Auswahl füllen*.
   ✅ Musterfüllungsebene mit Maske in Auswahlform. Mit Verlauf: Pixelebene.
8. *Photoshop-Muster…*: ✅ Liste deiner Muster erscheint (wenn leer: melden!).

## 4. TextShapR

1. Auswahl ziehen, Tab öffnen. ✅ Bis zu 10 Karten, ★ auf der ersten.
2. Karte 3 anklicken, *Anwenden*. ✅ Ebene hat genau die Umbrüche der Karte.
3. *Live* an, Karten wechseln. ✅ Ebene auf der Seite wird jeweils ersetzt.
4. Elliptische Auswahl + *Auto-Form*. ✅ Rund-Modus wird genommen.

## 5. Batch

1. Tab öffnen. ✅ Die Seite erscheint als Vorschau (braucht PS 24.2+).
2. Mehrere Blasen mit Umschalt-Auswahl markieren → *Aus Auswahl*.
   ✅ Eine Box pro Blase, nummeriert.
3. *Zeilen zuordnen*, *Alle füllen*, bestätigen. ✅ Jede Blase bekommt ihre
   Zeile; das Panel bleibt bedienbar, *Stopp* funktioniert.
4. *Batch rückgängig*. ✅ Nur die Batch-Ebenen verschwinden.
5. *Jede prüfen* an → Lauf startet, TextShapR zeigt Karten; *Anwenden* geht
   zur nächsten Blase.

## 6. SFX-Tab

1. Strategie *Neu zeichnen*, Wort `boom`, Schrift wählen, Auswahl ziehen,
   *Einfügen*. ✅ **Eine** editierbare Textebene „SFX“ mit Kontur.
2. Verlauf + Drehung 15° + Muster + weiche Kontur an, erneut einfügen.
   ✅ Verlaufsüberlagerung von oben (Füllfarbe) nach unten (2. Farbe), Ebene
   gedreht, Text weiter editierbar.
3. SFX-Ebene auswählen, Stil ändern, *Ebene neu stylen*. ✅ Gleiche Ebene,
   gleiche Position, neuer Stil – keine Ebene gelöscht.
4. *Aus Ebene* liest das Wort einer Textebene zurück.
5. Strategie *Notiz*: zwei SFX setzen, *Liste platzieren*. ✅ Kleiner Textblock
   unten links.

## 7. Presets, Tasten, Fonts-Tab

1. Preset speichern, Taste zuweisen (Feld anklicken, z. B. Strg+1 drücken).
   ✅ `[Ctrl+1]` im Preset-Menü. Stil ändern, Strg+1 drücken, **während das
   TypeR-Panel den Fokus hat** → Preset wird angewendet.
2. Preset-Export als Paket (.zip) → ✅ enthält `presets.json` + `fonts/`.
3. Import eines Pakets: ✅ Ordner mit den Schriften öffnet sich, Hinweis erscheint.
4. Fonts-Tab: Schrift per Rechtsklick in der Schriftliste zu einer Kategorie.
   ✅ Zeilen zeigen den Namen in der jeweiligen Schrift.

## 8. Layout

1. *Setup › Experimentell › Layout anpassen*: Panels ziehen, ⋮-Menü, Sperre,
   Höhe ziehen, *Abkoppeln*. ✅ Panel wandert in „TypeR panel 1“ (Plugins-Menü);
   nach Photoshop-Neustart ist das Layout gleich.
2. Panel auf ~300 px schmal ziehen. ✅ Nichts wird abgeschnitten.
3. Photoshop-Farbthema wechseln (hell/dunkel). ✅ Panel passt sich an.
4. Sprache auf Deutsch/Spanisch: ✅ keine rohen Schlüssel wie `insert_btn`.

## 9. Google (optional)

1. Setup › Google: eigene Client-ID eintragen, *Anmelden*. Browser öffnet sich,
   zustimmen; die Adresse der nicht ladenden `127.0.0.1`-Seite kopieren und in
   TypeR einfügen. ✅ „Angemeldet“.
2. `.gdoc` laden. ✅ Text + Kommentare.

## 10. BubblR (nur mit Datei `bubblr_dev` im Plugin-Ordner)

`python tools/bubblr_bridge.py --ai-dir <Pfad zu ai>` starten, dann
*Erkennen* mit Backend *KI*. Ohne Brücke: klare Meldung statt Absturz.
