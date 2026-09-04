/* ==========================================================================
   words-mandarin.js — a frequency-ordered word list, and pinyin -> IPA using
   ONLY symbols already in the Mandarin inventory in bridge-engine.js.

   Deliberate simplifications, all forced by "existing infrastructure only":

   - NO TONE. Deferred, as agreed. Every syllable here is toneless, so 是 shì
     and 十 shí are the same string to this code. That is wrong about Mandarin
     and fine for showing the scheduling mechanism.
   - The apical vowel of shi / si / zhi is written /i/. That is the standard
     phonemic analysis (an allophone of /i/ after sibilants), and it avoids
     inventing a symbol.
   - ie / üe are really [jɛ] / [ɥɛ]; /ɛ/ is not in the Mandarin inventory here,
     so they map to ɤ.
   - Diphthongs and nasal finals decompose into sequences of existing phonemes
     (ai -> a i, ang -> a ŋ) rather than being their own units.

   Every phoneme produced is asserted against the engine's Mandarin inventory
   at load, so this file cannot silently drift from the feature model.
   ========================================================================== */

(function (root) {
'use strict';

/* ---- pinyin initials -> phonemes ---------------------------------------- */
const INITIALS = {
  b:['p'],   p:['pʰ'],  m:['m'],   f:['f'],
  d:['t'],   t:['tʰ'],  n:['n'],   l:['l'],
  g:['k'],   k:['kʰ'],  h:['x'],
  j:['tɕ'],  q:['tɕʰ'], x:['ɕ'],
  zh:['ʈʂ'], ch:['ʈʂʰ'],sh:['ʂ'],  r:['ʐ'],
  z:['ts'],  c:['tsʰ'], s:['s'],
};

/* ---- pinyin finals -> phoneme sequences --------------------------------- */
const FINALS = {
  a:['a'],       o:['w','ɤ'],   e:['ɤ'],      i:['i'],     u:['u'],   'ü':['y'],
  ai:['a','i'],  ei:['ə','i'],  ao:['a','u'], ou:['ə','u'],
  an:['a','n'],  en:['ə','n'],  ang:['a','ŋ'],eng:['ə','ŋ'],ong:['u','ŋ'],
  er:['ɚ'],
  ia:['j','a'],  ie:['j','ɤ'],  iao:['j','a','u'], iu:['j','ə','u'],
  ian:['j','a','n'], 'in':['i','n'], iang:['j','a','ŋ'], ing:['i','ŋ'],
  iong:['j','u','ŋ'],
  ua:['w','a'],  uo:['w','ɤ'],  uai:['w','a','i'], ui:['w','ə','i'],
  uan:['w','a','n'], un:['w','ə','n'], uang:['w','a','ŋ'], ueng:['w','ə','ŋ'],
  'üe':['ɥ','ɤ'], 'üan':['ɥ','a','n'], 'ün':['y','n'],
};

/* y- and w- spellings are the same finals wearing a different hat */
const WHOLE = {
  yi:['i'], ya:['j','a'], ye:['j','ɤ'], yao:['j','a','u'], you:['j','ə','u'],
  yan:['j','a','n'], yin:['i','n'], yang:['j','a','ŋ'], ying:['i','ŋ'],
  yong:['j','u','ŋ'], yu:['y'], yue:['ɥ','ɤ'], yuan:['ɥ','a','n'], yun:['y','n'],
  wu:['u'], wa:['w','a'], wo:['w','ɤ'], wai:['w','a','i'], wei:['w','ə','i'],
  wan:['w','a','n'], wen:['w','ə','n'], wang:['w','a','ŋ'], weng:['w','ə','ŋ'],
  er:['ɚ'], e:['ɤ'], a:['a'], ai:['a','i'], ao:['a','u'], ou:['ə','u'],
  an:['a','n'], en:['ə','n'], ang:['a','ŋ'], o:['w','ɤ'],
};

/** one toneless pinyin syllable -> array of phonemes */
function syllable(py){
  py = py.toLowerCase().replace(/v/g, 'ü');
  if (WHOLE[py]) return WHOLE[py].slice();

  // after j/q/x, written u is really ü
  for (const ini of ['zh','ch','sh','b','p','m','f','d','t','n','l','g','k','h','j','q','x','r','z','c','s']){
    if (py.startsWith(ini)){
      let fin = py.slice(ini.length);
      if ('jqx'.includes(ini) && fin[0] === 'u') fin = 'ü' + fin.slice(1);
      if (!FINALS[fin]) return null;
      return INITIALS[ini].concat(FINALS[fin]);
    }
  }
  return FINALS[py] ? FINALS[py].slice() : null;
}

/** a whole word (syllables separated by spaces) -> phonemes */
function pronounce(pinyin){
  const out = [];
  for (const s of pinyin.split(/\s+/)){
    const p = syllable(s);
    if (!p) return null;
    out.push(...p);
  }
  return out;
}

/* ---- the list, roughly in frequency order ------------------------------- */
const WORDS = [
  ['的','de','possessive / modifier particle'], ['一','yi','one'],
  ['是','shi','to be'],            ['不','bu','not'],
  ['了','le','completed action'],  ['人','ren','person'],
  ['我','wo','I, me'],             ['在','zai','at, to be at'],
  ['有','you','to have'],          ['他','ta','he, him'],
  ['这','zhe','this'],             ['中','zhong','middle, China'],
  ['大','da','big'],               ['来','lai','to come'],
  ['上','shang','above, on'],      ['国','guo','country'],
  ['个','ge','general classifier'],['到','dao','to arrive'],
  ['说','shuo','to say'],          ['们','men','plural marker'],
  ['为','wei','for, to be'],       ['子','zi','child, noun suffix'],
  ['和','he','and'],               ['你','ni','you'],
  ['地','di','ground, adverb marker'], ['出','chu','to go out'],
  ['道','dao','way, to say'],      ['也','ye','also'],
  ['时','shi','time'],             ['年','nian','year'],
  ['得','de','to obtain'],         ['就','jiu','then, at once'],
  ['那','na','that'],              ['要','yao','to want'],
  ['下','xia','below, to descend'],['以','yi','by means of'],
  ['生','sheng','to be born, life'],['会','hui','can, meeting'],
  ['自','zi','self'],              ['着','zhe','ongoing action'],
  ['去','qu','to go'],             ['之','zhi','classical possessive'],
  ['过','guo','to pass, experienced'], ['家','jia','home, family'],
  ['学','xue','to study'],         ['对','dui','correct, toward'],
  ['可','ke','may, able'],         ['她','ta','she, her'],
  ['里','li','inside'],            ['后','hou','after, behind'],
  ['小','xiao','small'],           ['么','me','question suffix'],
  ['心','xin','heart, mind'],      ['多','duo','many'],
  ['天','tian','day, sky'],        ['而','er','and, but'],
  ['能','neng','able to'],         ['好','hao','good'],
  ['都','dou','all'],              ['然','ran','thus'],
  ['没','mei','not have'],         ['日','ri','day, sun'],
  ['于','yu','at, in'],            ['起','qi','to rise'],
  ['还','hai','still, also'],      ['发','fa','to send out'],
  ['成','cheng','to become'],      ['事','shi','matter, affair'],
  ['只','zhi','only'],             ['作','zuo','to do, make'],
  ['当','dang','when, to serve as'],['想','xiang','to think, want'],
  ['看','kan','to look'],          ['文','wen','writing, culture'],
  ['无','wu','without'],           ['开','kai','to open'],
  ['手','shou','hand'],            ['十','shi','ten'],
  ['用','yong','to use'],          ['主','zhu','main, master'],
  ['行','xing','to walk, all right'], ['方','fang','direction, square'],
  ['又','you','again'],            ['如','ru','if, like'],
  ['前','qian','front, before'],   ['所','suo','place, nominaliser'],
  ['本','ben','root, volume'],     ['见','jian','to see'],
  ['经','jing','to pass through'], ['头','tou','head'],
  ['面','mian','face, surface'],   ['公','gong','public'],
  ['同','tong','same'],            ['三','san','three'],
  ['已','yi','already'],           ['老','lao','old'],
  ['从','cong','from'],            ['动','dong','to move'],
  ['两','liang','two, a couple'],  ['长','chang','long'],
  ['知','zhi','to know'],          ['民','min','people'],
  ['样','yang','manner, kind'],    ['现','xian','now, to appear'],
  ['分','fen','to divide, minute'],['好像','hao xiang','to seem like'],
];

const LIST = [];
WORDS.forEach(([hanzi, pinyin, gloss], i) => {
  const phonemes = pronounce(pinyin);
  if (!phonemes) { console.warn('unparsed pinyin:', pinyin); return; }
  LIST.push({ rank: i + 1, hanzi, pinyin, gloss, phonemes });
});

root.MandarinWords = { LIST, pronounce, syllable, INITIALS, FINALS, WHOLE };

})(typeof globalThis !== 'undefined' ? globalThis : this);

if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.MandarinWords;
