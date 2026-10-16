const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const XLINK_NAMESPACE = "http://www.w3.org/1999/xlink";
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

// Static SVG only: unknown elements (including foreign content and animation)
// lose their entire subtree rather than having potentially active children unwrapped.
const elements = new Set(`svg g defs symbol use switch a title desc metadata style
  path rect circle ellipse line polyline polygon text tspan textPath image
  clipPath mask marker pattern linearGradient radialGradient stop filter
  feBlend feColorMatrix feComponentTransfer feComposite feConvolveMatrix
  feDiffuseLighting feDisplacementMap feDistantLight feDropShadow feFlood
  feFuncA feFuncB feFuncG feFuncR feGaussianBlur feImage feMerge feMergeNode
  feMorphology feOffset fePointLight feSpecularLighting feSpotLight feTile
  feTurbulence`.split(/\s+/));
const graphics = new Set("path rect circle ellipse line polyline polygon text image use".split(" "));

const attributes = new Set(`id class style transform transform-origin opacity
  x y x1 y1 x2 y2 dx dy width height viewBox preserveAspectRatio version
  d points pathLength rx ry r cx cy fx fy fr
  fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap
  stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset
  paint-order vector-effect color color-interpolation color-interpolation-filters
  display visibility overflow clip clip-path clip-rule mask maskUnits maskContentUnits
  filter filterUnits primitiveUnits marker-start marker-mid marker-end
  markerWidth markerHeight markerUnits refX refY orient
  patternUnits patternContentUnits patternTransform gradientUnits gradientTransform
  spreadMethod offset stop-color stop-opacity flood-color flood-opacity lighting-color
  font-family font-size font-size-adjust font-style font-weight font-variant font-stretch
  text-anchor text-decoration text-rendering textLength lengthAdjust rotate
  dominant-baseline alignment-baseline baseline-shift direction unicode-bidi
  letter-spacing word-spacing writing-mode shape-rendering image-rendering
  href src type media role tabindex focusable
  in in2 result mode values operator k1 k2 k3 k4 order kernelMatrix divisor bias
  targetX targetY edgeMode kernelUnitLength preserveAlpha surfaceScale
  diffuseConstant specularConstant specularExponent limitingConeAngle
  scale xChannelSelector yChannelSelector stdDeviation tableValues slope intercept
  amplitude exponent azimuth elevation pointsAtX pointsAtY pointsAtZ z
  radius baseFrequency numOctaves seed stitchTiles`.split(/\s+/));

function isLocalUrl(value: string, fonts: boolean): boolean {
  const url = value.trim();
  // No relative paths, network URLs, executable schemes or HTML data documents.
  return /^#[^\s]*$/.test(url)
    || /^data:image\/[a-z\d.+-]+(?:;[^,]*)?,/i.test(url)
    || (fonts && /^data:(?:font\/(?:woff2?|ttf|otf)|application\/(?:font-woff2?|x-font-ttf|x-font-opentype))(?:;[^,]*)?,/i.test(url));
}

/** Inspect a decoded copy only; retain the original safe CSS verbatim. */
function isSafeCss(value: string): boolean {
  const css = value.replace(/\/\*[\s\S]*?\*\//g, "").replace(
    /\\(?:([a-f\d]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\s\S]))/gi,
    (_, hex: string | undefined, character: string) => {
      if (!hex) return /[\r\n\f]/.test(character) ? "" : character;
      const code = parseInt(hex, 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd";
    },
  );
  // Font-face with embedded fonts is used by normal Excalidraw exports.
  // Other at-rules and alternate URL-bearing/executable CSS constructs are excluded.
  if (/@(?!font-face\b)|(?:expression|(?:-webkit-)?image-set|image|src|attr)\s*\(|(?:behavior|-moz-binding)\s*:/i.test(css)) return false;
  let safe = true;
  const remainder = css.replace(/\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'"(]*))\s*\)/gi,
    (_, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      if (!isLocalUrl(double ?? single ?? bare ?? "", true)) safe = false;
      return "";
    });
  // Fail closed for malformed or otherwise unrecognised URL syntax.
  return safe && !/\burl\s*\(/i.test(remainder);
}

function isSafeAttribute(attribute: Attr): boolean {
  const { localName: name, namespaceURI: namespace, value } = attribute;
  if (/^on/i.test(name)) return false;
  if (namespace === XMLNS_NAMESPACE) return value === SVG_NAMESPACE || value === XLINK_NAMESPACE;
  if (namespace === XML_NAMESPACE) return name === "lang" || name === "space";
  if (namespace && namespace !== XLINK_NAMESPACE) return false;
  if (namespace === XLINK_NAMESPACE && name !== "href") return false;
  if (!attributes.has(name) && !/^(?:data|aria)-[\w-]+$/.test(name)) return false;
  if (name === "href" || name === "src") return isLocalUrl(value, false);
  return isSafeCss(value);
}

/** Mutate only the detached, validated parse tree. Never attach untrusted SVG. */
export function sanitizeSvg(doc: Document): string | undefined {
  const root = doc.documentElement;
  const pending: Element[] = [root];
  let hasGraphics = false;
  while (pending.length) {
    const element = pending.pop()!;
    if (element.namespaceURI !== SVG_NAMESPACE || !elements.has(element.localName)
      || (element.localName === "style" && !isSafeCss(element.textContent ?? ""))) {
      element.remove();
      continue;
    }
    if (graphics.has(element.localName)) hasGraphics = true;
    for (const attribute of Array.from(element.attributes)) {
      if (!isSafeAttribute(attribute)) element.removeAttributeNode(attribute);
    }
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === 1) pending.push(child as Element);
      // Processing instructions can load stylesheets; comments/CDATA/text are inert.
      else if (child.nodeType === 7) element.removeChild(child);
    }
  }
  if (!hasGraphics) return undefined;
  // Serializing the root also discards document-level processing instructions.
  return new XMLSerializer().serializeToString(root);
}
