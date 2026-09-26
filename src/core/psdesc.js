// Photoshop action descriptors (batchPlay), built as plain data.
//
// Everything that says "what to create" lives here so it can be unit-tested
// without Photoshop; host/*.js only executes these. Mapping of the Krita
// renderer onto Photoshop (see PORT_PLAN.md §2.2):
//
//   Krita (SVG copies, bottom -> top)        Photoshop layer style
//   ---------------------------------        -------------------------------
//   soft (blurred) outline / glow            Drop Shadow #2 (distance 0, blur)
//   shadow = offset copy + widest stroke     Drop Shadow (spread 100 %, hard)
//   2nd (outer) outline                      Outer Glow, precise, spread 100 %
//   outline (stroke width = outline_px,      Stroke, outside, size = px / 2
//            the fill covers the inner half)   (= the visible part in Krita)
//   fill                                     the text itself / Pattern Overlay
//
// Photoshop always draws Drop Shadow < Outer Glow < content < Stroke, which is
// exactly Krita's order, so no effect ordering has to be trusted to an array.
// A pattern on the 2nd outline cannot go into a glow; then both outlines
// become strokes (frameFXMulti, widest listed LAST = drawn underneath).

export function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  const v = m ? parseInt(m[1], 16) : 0;
  return { red: (v >> 16) & 255, green: (v >> 8) & 255, blue: v & 255 };
}

/** RGBColor descriptor. Photoshop calls the green channel "grain" here. */
export function rgbDesc(hex) {
  const c = hexToRgb(hex);
  return { _obj: "RGBColor", red: c.red, grain: c.green, blue: c.blue };
}

const px = (v) => ({ _unit: "pixelsUnit", _value: v });
const pct = (v) => ({ _unit: "percentUnit", _value: v });
const pt = (v) => ({ _unit: "pointsUnit", _value: v });
const en = (type, value) => ({ _enum: type, _value: value });
export const TARGET_LAYER = { _ref: "layer", _enum: "ordinal", _value: "targetEnum" };
export const TARGET_DOC = { _ref: "document", _enum: "ordinal", _value: "targetEnum" };

/** Drop-shadow angle/distance for an offset (dx right, dy down). Photoshop
 *  casts the shadow AWAY from the light: x = -d cos(a), y = d sin(a). */
export function shadowAngleDistance(dx, dy) {
  const d = Math.hypot(dx, dy);
  let a = Math.atan2(dy, -dx) * 180 / Math.PI;
  if (a <= -180) a += 360;
  if (a > 180) a -= 360;
  return { angle: a, distance: d };
}

/** Pixel size -> points in a document of `resolution` ppi. */
export function pxToPt(v, resolution) {
  return v * 72 / (resolution || 72);
}

/**
 * The `make textLayer` descriptor.
 *
 * p = {
 *   text,                 lines joined with "\r" (the engine's line breaks)
 *   runs,                 [{from, to, psName, family, style, bold, italic,
 *                            syntheticBold, syntheticItalic}] (UTF-16 offsets)
 *   sizePt, leadingPt, color, align ('left'|'center'|'right'),
 *   anchorPct: {x, y}     click point in % of the document (first baseline)
 *   underline, ligatures, vertical, tracking
 * }
 */
export function makeTextLayer(p) {
  const n = p.text.length;
  const styleFor = (r) => {
    const st = {
      _obj: "textStyle",
      fontPostScriptName: r.psName,
      fontName: r.family,
      fontStyleName: r.style,
      size: pt(p.sizePt),
      color: rgbDesc(p.color),
      autoLeading: false,
      leading: pt(p.leadingPt),
      tracking: p.tracking || 0,
      horizontalScale: 100,
      verticalScale: 100,
      syntheticBold: !!r.syntheticBold,
      syntheticItalic: !!r.syntheticItalic,
      autoKern: en("autoKern", "metricsKern"),
      ligature: p.ligatures !== false,
      altligature: false,
      underline: en("underline", p.underline
        ? (p.vertical ? "underlineOnRightInVertical" : "underlineOnLeftInHorizontal") : "underlineOff"),
      fontCaps: en("fontCaps", "normal"),
      baselineShift: pt(0),
    };
    if (p.vertical) st.baselineDirection = en("baselineDirection", "crossStream");   // upright
    return st;
  };
  const runs = p.runs && p.runs.length ? p.runs : [{ from: 0, to: n }];
  const alignValue = p.vertical
    ? ({ top: "left", middle: "center", bottom: "right" }[p.align] || "center")
    : ({ left: "left", right: "right" }[p.align] || "center");
  return {
    _obj: "make",
    _target: [{ _ref: "textLayer" }],
    using: {
      _obj: "textLayer",
      textKey: p.text,
      textClickPoint: { _obj: "paint", horizontal: pct(p.anchorPct.x), vertical: pct(p.anchorPct.y) },
      antiAlias: en("antiAliasType", "antiAliasSmooth"),
      textShape: [{
        _obj: "textShape",
        char: en("char", "paint"),
        orientation: en("orientation", p.vertical ? "vertical" : "horizontal"),
        transform: { _obj: "transform", xx: 1, xy: 0, yx: 0, yy: 1, tx: 0, ty: 0 },
        rowCount: 1,
        columnCount: 1,
        rowMajorOrder: true,
        rowGutter: pt(0),
        columnGutter: pt(0),
        spacing: pt(0),
        frameBaselineAlignment: en("frameBaselineAlignment", "alignByAscent"),
        firstBaselineMinimum: pt(0),
        base: { _obj: "paint", horizontal: 0, vertical: 0 },
      }],
      textStyleRange: runs.map((r) => ({ _obj: "textStyleRange", from: r.from, to: r.to, textStyle: styleFor(r) })),
      paragraphStyleRange: [{
        _obj: "paragraphStyleRange",
        from: 0,
        to: n,
        paragraphStyle: { _obj: "paragraphStyle", align: en("alignmentType", alignValue), hyphenate: false },
      }],
    },
  };
}

function stroke(sizePx, paint) {
  const fx = {
    _obj: "frameFX",
    enabled: true,
    present: true,
    showInDialog: true,
    style: en("frameStyle", "outsetFrame"),
    mode: en("blendMode", "normal"),
    opacity: pct(100),
    size: px(sizePx),
    overprint: false,
  };
  if (paint && paint.pattern) {
    fx.paintType = en("frameFill", "pattern");
    fx.pattern = { _obj: "pattern", name: paint.pattern.name, ID: paint.pattern.id };
    fx.scale = pct(paint.pattern.scale || 100);
    fx.linked = true;
    fx.phase = { _obj: "paint", horizontal: 0, vertical: 0 };
  } else {
    fx.paintType = en("frameFill", "solidColor");
    fx.color = rgbDesc(paint && paint.color);
  }
  return fx;
}

function hardGlow(sizePx, color) {
  return {
    _obj: "outerGlow",
    enabled: true,
    present: true,
    showInDialog: true,
    mode: en("blendMode", "normal"),
    color: rgbDesc(color),
    opacity: pct(100),
    glowTechnique: en("matteTechnique", "preciseMatte"),
    chokeMatte: pct(100),
    blur: px(sizePx),
    noise: pct(0),
    shadingNoise: pct(0),
    antiAlias: true,
    inputRange: pct(50),
    transferSpec: { _obj: "shapeCurveType", name: "Linear" },
  };
}

function dropShadow({ color, angle, distance, size, spreadPct, opacity = 100 }) {
  return {
    _obj: "dropShadow",
    enabled: true,
    present: true,
    showInDialog: true,
    mode: en("blendMode", "normal"),
    color: rgbDesc(color),
    opacity: pct(opacity),
    useGlobalAngle: false,
    localLightingAngle: { _unit: "angleUnit", _value: angle },
    distance: px(distance),
    chokeMatte: pct(spreadPct),
    blur: px(size),
    noise: pct(0),
    antiAlias: true,
    transferSpec: { _obj: "shapeCurveType", name: "Linear" },
    layerConceals: true,
  };
}

/**
 * The layer style for a text layer, or null when no effect is on.
 *
 * s = { outline, outlinePx, outlineColor, outline2Px, outline2Color,
 *       outlinePattern: {name, id, scale} | null, patternTarget,
 *       shadow, shadowColor, shadowDx, shadowDy,
 *       soft, softPx, softBlur, softColor, softPattern,
 *       fillPattern: {name, id, scale} | null,
 *       fillGradient: {top, bottom} | null }
 * Widths are Krita's FULL stroke widths; the visible part is half of that.
 */
export function layerEffects(s) {
  const fx = { _obj: "layerEffects", scale: pct(100) };
  let any = false;
  const o1 = s.outline && s.outlinePx > 0 ? s.outlinePx / 2 : 0;
  // the 2nd outline is part of the outline feature: off with it
  const o2 = s.outline && s.outline2Px > 0 ? s.outline2Px / 2 : 0;
  const widest = Math.max(o1, o2);
  const tgt = s.patternTarget || "outline1";
  const pat = s.outline ? s.outlinePattern : null;
  const pat1 = pat && (tgt === "outline1" || tgt === "both");
  const pat2 = pat && (tgt === "outline2" || tgt === "both");

  if (o2 > 0 && pat2) {
    // a pattern cannot fill a glow: both outlines become strokes, the wider
    // (outer) listed last so it is painted underneath
    const inner = o1 > 0 ? stroke(o1, pat1 ? { pattern: pat } : { color: s.outlineColor }) : null;
    const outer = stroke(o2, { pattern: pat });
    fx.frameFXMulti = inner ? [inner, outer] : [outer];
    any = true;
  } else {
    if (o1 > 0) {
      fx.frameFX = stroke(o1, pat1 ? { pattern: pat } : { color: s.outlineColor });
      any = true;
    }
    if (o2 > 0) {
      fx.outerGlow = hardGlow(o2, s.outline2Color);
      any = true;
    }
  }

  const shadows = [];
  if (s.shadow && (s.shadowDx || s.shadowDy)) {
    const { angle, distance } = shadowAngleDistance(s.shadowDx || 0, s.shadowDy || 0);
    shadows.push(dropShadow({ color: s.shadowColor, angle, distance, size: widest, spreadPct: 100 }));
  }
  if (s.soft && (s.softPx > 0 || s.softBlur > 0)) {
    const size = (s.softPx || 0) + widest + 2 * (s.softBlur || 0);
    const spread = size > 0 ? Math.round(100 * ((s.softPx || 0) + widest) / size) : 0;
    shadows.push(dropShadow({ color: s.softColor, angle: 90, distance: 0, size, spreadPct: spread }));
  }
  if (shadows.length === 1) {
    fx.dropShadow = shadows[0];
    any = true;
  } else if (shadows.length > 1) {
    fx.dropShadowMulti = shadows;
    any = true;
  }
  if (s.fillGradient) {
    // top -> bottom two-colour fill (the SFX Helper's gradient fill)
    const stop = (color, location) => ({ _obj: "colorStop", color: rgbDesc(color), type: en("colorStopType", "userStop"), location, midpoint: 50 });
    const tstop = (location) => ({ _obj: "transferSpec", opacity: pct(100), location, midpoint: 50 });
    fx.gradientFill = {
      _obj: "gradientFill",
      enabled: true,
      present: true,
      showInDialog: true,
      mode: en("blendMode", "normal"),
      opacity: pct(100),
      gradient: {
        _obj: "gradientClassEvent",
        name: "TypeR",
        gradientForm: en("gradientForm", "customStops"),
        interfaceIconFrameDimmed: 4096,
        colors: [stop(s.fillGradient.top, 0), stop(s.fillGradient.bottom, 4096)],
        transparency: [tstop(0), tstop(4096)],
      },
      angle: { _unit: "angleUnit", _value: -90 },
      type: en("gradientType", "linear"),
      reverse: false,
      dither: false,
      align: true,
      scale: pct(100),
      offset: { _obj: "paint", horizontal: pct(0), vertical: pct(0) },
    };
    any = true;
  }
  if (s.fillPattern) {
    fx.patternFill = {
      _obj: "patternFill",
      enabled: true,
      present: true,
      showInDialog: true,
      mode: en("blendMode", "normal"),
      opacity: pct(100),
      pattern: { _obj: "pattern", name: s.fillPattern.name, ID: s.fillPattern.id },
      scale: pct(s.fillPattern.scale || 100),
      align: true,
      phase: { _obj: "paint", horizontal: 0, vertical: 0 },
    };
    any = true;
  }
  return any ? fx : null;
}

export function setLayerEffects(effects) {
  return { _obj: "set", _target: [{ _ref: "property", _property: "layerEffects" }, TARGET_LAYER], to: effects };
}

export function renameLayer(name, target = TARGET_LAYER) {
  return { _obj: "set", _target: [target], to: { _obj: "layer", name } };
}

export function moveLayerBy(dx, dy) {
  return {
    _obj: "move",
    _target: [TARGET_LAYER],
    to: { _obj: "offset", horizontal: px(dx), vertical: px(dy) },
  };
}

export function selectRect(x, y, w, h) {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _obj: "rectangle", top: px(y), left: px(x), bottom: px(y + h), right: px(x + w) },
  };
}

export function selectEllipse(x, y, w, h) {
  return {
    _obj: "set",
    _target: [{ _ref: "channel", _property: "selection" }],
    to: { _obj: "ellipse", top: px(y), left: px(x), bottom: px(y + h), right: px(x + w) },
    antiAlias: true,
  };
}

export function deselect() {
  return { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: en("ordinal", "none") };
}

export function deleteLayerById(id) {
  return { _obj: "delete", _target: [{ _ref: "layer", _id: id }] };
}

/** A path component list for a closed polygon / bezier outline (document
 *  pixels). `segments` = [{anchor:[x,y], fwd:[x,y], bwd:[x,y]}] (smooth) or
 *  plain points (corner). */
export function pathComponent(points, smoothHandles = null) {
  const pts = points.map((p, i) => {
    const anchor = { _obj: "paint", horizontal: px(p[0]), vertical: px(p[1]) };
    const pnt = { _obj: "pathPoint", anchor };
    if (smoothHandles) {
      const h = smoothHandles[i];
      pnt.forward = { _obj: "paint", horizontal: px(h.fwd[0]), vertical: px(h.fwd[1]) };
      pnt.backward = { _obj: "paint", horizontal: px(h.bwd[0]), vertical: px(h.bwd[1]) };
      pnt.smooth = true;
    }
    return pnt;
  });
  return {
    _obj: "pathComponent",
    shapeOperation: en("shapeOperation", "add"),
    subpathListKey: [{ _obj: "subpathsList", closedSubpath: true, points: pts }],
  };
}

/** Bezier handles of a Catmull-Rom ring (the balloon's round shapes): for
 *  anchor i, forward = c1 of segment i, backward = c2 of segment i-1. */
export function catmullHandles(points) {
  const n = points.length;
  return points.map((p1, i) => {
    const p0 = points[(i - 1 + n) % n];
    const p2 = points[(i + 1) % n];
    return {
      fwd: [p1[0] + (p2[0] - p0[0]) / 6.0, p1[1] + (p2[1] - p0[1]) / 6.0],
      bwd: [p1[0] - (p2[0] - p0[0]) / 6.0, p1[1] - (p2[1] - p0[1]) / 6.0],
    };
  });
}

/** `make contentLayer` (a shape layer) from path components with a solid
 *  fill and a centred-free inside stroke. */
export function makeShapeLayer(components, fill, strokeColor, strokeW, dashed = false) {
  const strokeStyle = {
    _obj: "strokeStyle",
    strokeStyleVersion: 2,
    strokeEnabled: strokeW > 0,
    fillEnabled: true,
    strokeStyleLineWidth: px(strokeW),
    strokeStyleLineDashOffset: pt(0),
    strokeStyleMiterLimit: 100,
    strokeStyleLineCapType: en("strokeStyleLineCapType", "strokeStyleButtCap"),
    strokeStyleLineJoinType: en("strokeStyleLineJoinType", "strokeStyleRoundJoin"),
    strokeStyleLineAlignment: en("strokeStyleLineAlignment", "strokeStyleAlignCenter"),
    strokeStyleScaleLock: false,
    strokeStyleStrokeAdjust: false,
    strokeStyleLineDashSet: dashed ? [{ _unit: "noneUnit", _value: 2.5 }, { _unit: "noneUnit", _value: 2 }] : [],
    strokeStyleBlendMode: en("blendMode", "normal"),
    strokeStyleOpacity: pct(100),
    strokeStyleContent: { _obj: "solidColorLayer", color: rgbDesc(strokeColor) },
    strokeStyleResolution: 72,
  };
  return {
    _obj: "make",
    _target: [{ _ref: "contentLayer" }],
    using: {
      _obj: "contentLayer",
      type: { _obj: "solidColorLayer", color: rgbDesc(fill) },
      shape: { _obj: "pathClass", pathComponents: components },
      strokeStyle,
    },
  };
}

/** Rotate the target layer by `angle` degrees about its centre. */
export function rotateLayer(angle) {
  return {
    _obj: "transform",
    _target: [TARGET_LAYER],
    freeTransformCenterState: en("quadCenterState", "QCSAverage"),
    angle: { _unit: "angleUnit", _value: angle },
    interfaceIconFrameDimmed: en("interpolationType", "bicubic"),
  };
}

/** Restyle the target text layer in place: new text + style runs +
 *  paragraph, keeping its position (no click point is sent). */
export function restyleTextLayer(make) {
  const u = make.using;
  return {
    _obj: "set",
    _target: [{ _ref: "textLayer", _enum: "ordinal", _value: "targetEnum" }],
    to: { _obj: "textLayer", textKey: u.textKey, textStyleRange: u.textStyleRange, paragraphStyleRange: u.paragraphStyleRange },
  };
}
