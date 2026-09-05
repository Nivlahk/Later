/* filename -> IPA symbol matcher. Testable without network. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('./bridge-engine.js');

/* Commons vocabulary vs the engine's. Applied to BOTH sides, so retroflex and
   "apical postalveolar" land on the same tokens either way round. */
const SYN = [
  [/\bsibilants?\b/g, 'fricative'],
  [/\bretroflex\b/g, 'postalveolar apical'],
  // NB: hyphens are already spaces by the time these run, so allow either
  [/\bpalato[\s-]?alveolar\b/g, 'postalveolar laminal'],
  [/\bpost[\s-]?alveolar\b/g, 'postalveolar'],
  [/\balveolo[\s-]?palatal\b/g, 'alveolopalatal'],
  [/\bstops?\b/g, 'plosive'],
  [/\bflaps?\b/g, 'tap'],
  [/\bnasalized\b/g, 'nasalised'],
  [/\blabialized\b/g, 'labialised'],
  [/\bunvoiced\b/g, 'voiceless'],
  [/\baspirated\b/g, 'aspirated'],
  [/\bopen[\s-]?mid\b/g, 'openmid'], [/\bclose[\s-]?mid\b/g, 'closemid'],
  [/\bnear[\s-]?close\b/g, 'nearclose'], [/\bnear[\s-]?open\b/g, 'nearopen'],
];
const DROP = new Set(['the','a','of','and','sound','audio','pronunciation','ipa','with','no','consonant']);

/* Tokens Commons routinely omits because they are predictable. Missing one of
   these is not evidence against a match; having a WRONG one still is. */
const OPTIONAL = new Set(['apical', 'laminal']);

export function tokens(str){
  let s = ' ' + str.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/_+/g, ' ') + ' ';
  for (const [re, to] of SYN) s = s.replace(re, to);      // hyphens still intact
  s = s.replace(/[^a-z\s]/g, ' ');
  for (const [re, to] of SYN) s = s.replace(re, to);      // and again, now spaced
  return new Set(s.split(/\s+/).filter(w => w.length > 2 && !DROP.has(w)));
}

const SONORANT = new Set(['nasal', 'tap', 'trill', 'approximant']);
const ENTRIES = Object.entries(E.NAMES).map(([sym, name]) => {
  const t = tokens(name);
  const seg = E.SYMBOLS[sym];
  const opt = new Set(OPTIONAL);
  // Commons writes "Alveolar trill", not "Voiced alveolar trill"
  if (seg.kind === 'C' && seg.voiced && SONORANT.has(seg.manner)) opt.add('voiced');
  if (seg.kind === 'V') { opt.add('unrounded'); }
  return { sym, t, opt };
});

/** best IPA symbol for a Commons filename, or null if none or ambiguous */
export function match(filename){
  const f = tokens(filename);
  if (!f.size) return null;
  const scored = [];
  for (const { sym, t, opt } of ENTRIES){
    let hit = 0, missedRequired = 0;
    for (const w of t){
      if (f.has(w)) hit++;
      else if (!opt.has(w)) missedRequired++;
    }
    if (missedRequired) continue;               // a required word is absent
    const extra = f.size - hit;                 // words the symbol doesn't explain
    scored.push({ sym, hit, extra });
  }
  if (!scored.length) return null;
  // prefer the symbol explaining the most of the filename, then the tightest fit
  scored.sort((a, b) => b.hit - a.hit || a.extra - b.extra);
  if (scored.length > 1 &&
      scored[0].hit === scored[1].hit && scored[0].extra === scored[1].extra) return null;
  if (scored[0].extra > 2) return null;         // mostly unrelated words
  return scored[0].sym;
}
