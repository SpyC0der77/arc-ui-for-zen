'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const STYLES = 'content/custom-font/style.css';
const FACE = 'content/custom-font/face';
const FORMATS = {
  '.otf': { signature: 'OTTO', css: 'opentype' },
  '.ttf': { signature: '\0\x01\0\0', css: 'truetype' },
  '.woff2': { signature: 'wOF2', css: 'woff2' },
};
const MAX_BYTES = 8 * 1024 * 1024;
const PRESETS = new Set(['geist', 'sf-pro', 'sf-pro-family']);
const family = '"Zennia Custom"';
// WOFF2 known table tags by flag index (WOFF2 section 5.1). Index 63 is followed by an explicit tag.
const WOFF2_TAGS = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

/** Whether the WOFF2 table directory lists an fvar table. The tables themselves stay compressed. */
function woff2HasFvar(bytes, invalid) {
  let at = 48;
  const base128 = () => {
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (at >= bytes.length) throw invalid();
      const byte = bytes[at++];
      value = value * 128 + (byte & 0x7f);
      if (!(byte & 0x80)) return value;
    }
    throw invalid();
  };
  let variable = false;
  for (let i = 0; i < bytes.readUInt16BE(12); i++) {
    if (at >= bytes.length) throw invalid();
    const flags = bytes[at++];
    let tag = WOFF2_TAGS[flags & 0x3f];
    if ((flags & 0x3f) === 0x3f) {
      if (at + 4 > bytes.length) throw invalid();
      tag = bytes.toString('latin1', at, at + 4);
      at += 4;
    }
    base128(); // origLength
    const version = flags >> 6;
    // glyf and loca are transformed at version 0; every other table is transformed at any other version.
    const transformed = tag === 'glyf' || tag === 'loca' ? version === 0 : version !== 0;
    if (transformed) base128(); // transformLength
    if (tag === 'fvar') variable = true;
  }
  return variable;
}

async function readFont(file, name = path.basename(file)) {
  const format = FORMATS[path.extname(name).toLowerCase()];
  if (!format) throw new Error('Choose an OTF, TTF, or WOFF2 font file.');
  const handle = await fs.open(file, 'r');
  let bytes;
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Choose a font file up to 8 MB.');
    bytes = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length) throw new Error('The selected font changed while it was being read. Choose it again.');
  } finally { await handle.close(); }
  const invalid = () => new Error('The selected file is not a valid OTF, TTF, or WOFF2 font.');
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== format.signature) throw invalid();
  let variable = false;
  if (format.css === 'woff2') {
    if (bytes.length < 48 || bytes.readUInt32BE(8) !== bytes.length || !bytes.readUInt16BE(12)) throw invalid();
    variable = woff2HasFvar(bytes, invalid);
  } else {
    const count = bytes.readUInt16BE(4);
    if (!count || 12 + 16 * count > bytes.length) throw invalid();
    for (let i = 0; i < count; i++) {
      const entry = 12 + i * 16;
      if (bytes.readUInt32BE(entry + 8) + bytes.readUInt32BE(entry + 12) > bytes.length) throw invalid();
      if (bytes.toString('ascii', entry, entry + 4) === 'fvar') variable = true;
    }
  }
  return { name, bytes, format: format.css, variable };
}

/* ---------- SF Pro family: Apple's static Text and Display cuts, as the user downloaded them ---------- */
const FAMILY = 'content/custom-font/sf-pro';
const FAMILY_FILE = /^SF-Pro-(Text|Display)-(Ultralight|Thin|Light|Regular|Medium|Semibold|Bold|Heavy|Black)(Italic)?\.otf$/i;
const WEIGHTS = { ultralight: 100, thin: 200, light: 300, regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 800, black: 900 };
const MAX_FAMILY_BYTES = 160 * 1024 * 1024;
const display = '"Zennia Custom Display"';
/** Windows and Linux draw SF Pro thinner than macOS does, so light and regular text use the
 *  next heavier cut there (regular text gets Medium). Semibold and heavier keep their own cut. */
const HEAVIER = { 100: 200, 200: 300, 300: 400, 400: 500, 500: 600 };

/** Reads every SF Pro Text and Display face (any weight, upright or italic) in `folder`. */
async function readFamily(folder, name = path.basename(folder)) {
  const files = (await fs.readdir(folder)).filter(file => FAMILY_FILE.test(file)).sort();
  const faces = [];
  let total = 0;
  for (const file of files) {
    const [, cut, weight, italic] = FAMILY_FILE.exec(file);
    const face = await readFont(path.join(folder, file));
    total += face.bytes.length;
    if (total > MAX_FAMILY_BYTES) throw new Error('The SF Pro fonts in that folder are larger than expected.');
    faces.push({ file, cut: cut.toLowerCase() === 'text' ? 'Text' : 'Display', weight: WEIGHTS[weight.toLowerCase()], italic: !!italic, bytes: face.bytes });
  }
  if (!faces.some(face => face.cut === 'Text' && face.weight === 400 && !face.italic))
    throw new Error('Choose the folder with the SF Pro fonts. It needs at least SF-Pro-Text-Regular.otf.');
  return { name, preset: 'sf-pro-family', faces };
}

/** The face of `set` closest to `weight`, the heavier one on a tie. */
function nearest(set, weight) {
  return set.reduce((best, face) => {
    const d = Math.abs(face.weight - weight), b = Math.abs(best.weight - weight);
    return d < b || (d === b && face.weight > best.weight) ? face : best;
  });
}

/** One @font-face per CSS weight and style, for the Text family and the Display family. */
function familyFaces(font, platform) {
  const rules = [];
  for (const [cut, name] of [['Text', family], ['Display', display]]) {
    for (const italic of [false, true]) {
      const set = font.faces.filter(face => face.cut === cut && face.italic === italic);
      if (!set.length) continue;
      for (let weight = 100; weight <= 900; weight += 100) {
        const face = nearest(set, platform === 'darwin' ? weight : HEAVIER[weight] ?? weight);
        rules.push(`@font-face { font-family: ${name}; src: url("sf-pro/${face.file}") format("opentype"); font-weight: ${weight}; font-style: ${italic ? 'italic' : 'normal'}; }`);
      }
    }
  }
  return rules.join('\n  ');
}

/** The face a preview should show for regular text on `platform`. */
function previewFace(font, platform = process.platform) {
  const upright = font.faces.filter(face => face.cut === 'Text' && !face.italic);
  return nearest(upright, platform === 'darwin' ? 400 : HEAVIER[400]);
}

function stylesheet(font, platform = process.platform) {
  const face = (source, weight = '400') => `@font-face { font-family: ${family}; src: ${source}; font-weight: ${weight}; }`;
  const faces = font.preset === 'sf-pro-family' ? familyFaces(font, platform)
    : font.preset === 'geist' ? [400, 500, 600].map(weight => face(`url("../geist-${weight}.woff2") format("woff2")`, weight)).join('\n  ')
    : face('url("face") format("' + font.format + '")', font.variable ? '100 900' : '400');
  // Apple sets text of 20 pt and up in the Display cut; headings are the large text here.
  const headings = font.preset === 'sf-pro-family' ? `
    :is(h1, h2):not(.titlebar-button) {
      font-family: ${display}, ${family}, var(--set-font, var(--zennia-default-font, system-ui)) !important;
    }` : '';
  return Buffer.from(`@-moz-document url("chrome://browser/content/browser.xhtml") {
  :root[data-zennia] { --zennia-user-font: ${family}, var(--zennia-default-font); }
}
@-moz-document url-prefix("chrome://"), url-prefix("resource://devtools/"), url-prefix("resource://pdf.js/"),
  regexp("^about:(?!(?:blank|srcdoc|reader)(?:[?#]|$)).+") {
  ${faces}
  /* Important declarations in this layer win over the browser's other user rules. */
  @layer zennia-custom-font {
    /* Windows draws some title bar controls with glyphs from its icon font. */
    :not(.titlebar-button, .titlebar-button *),
    :not(.titlebar-button, .titlebar-button *)::before,
    :not(.titlebar-button, .titlebar-button *)::after,
    ::placeholder {
      font-family: ${family}, var(--set-font, var(--zennia-default-font, system-ui)) !important;
    }${headings}
  }
}
`);
}

module.exports = { STYLES, FACE, FAMILY, PRESETS, readFont, readFamily, previewFace, stylesheet };
