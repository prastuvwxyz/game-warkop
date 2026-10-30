// Boxer art: 7 poses as SVG files in assets/img/, recoloured per skin by swapping the palette hexes in the file text
// and loading the result from a Blob URL (an SVG loaded as <img> cannot see CSS variables).
export const POSES = ['idle', 'jab', 'uppercut', 'block', 'ouch', 'ko', 'win'];
// body, accent (trunks), glove — the card C palette, one skin set in four colourways
export const SKINS = [
  { n: 'Lavender', body: '#e6e3ff', acc: '#9d8cff', glove: '#ffd28a', dot: '#9d8cff' },
  { n: 'Madu', body: '#ffe9c4', acc: '#ff9d6b', glove: '#9d8cff', dot: '#ffd28a' },
  { n: 'Mint', body: '#d6f5ea', acc: '#4fbf9f', glove: '#ffd28a', dot: '#4fbf9f' },
  { n: 'Mawar', body: '#ffd9e4', acc: '#ff6b8a', glove: '#e6e3ff', dot: '#ff6b8a' },
];
const BASE = { body: '#e6e3ff', acc: '#9d8cff', glove: '#ffd28a' };
const urls = {};
export function skinOf(i) { const n = Number.isInteger(i) ? i : 0; return SKINS[((n % SKINS.length) + SKINS.length) % SKINS.length]; }
export function imgUrl(skin, pose) { return urls[(skin % SKINS.length) + '/' + pose] || ''; }
export async function loadArt(base) {
  const texts = {};
  await Promise.all(POSES.map(async p => { try { const r = await fetch(base + 'assets/img/boxer-' + p + '.svg'); texts[p] = await r.text(); } catch (e) { texts[p] = ''; } }));
  SKINS.forEach((k, si) => POSES.forEach(p => {
    let t = texts[p]; if (!t) return;
    t = t.split(BASE.body).join('\u0001').split(BASE.acc).join('\u0002').split(BASE.glove).join('\u0003');
    t = t.split('\u0001').join(k.body).split('\u0002').join(k.acc).split('\u0003').join(k.glove);
    urls[si + '/' + p] = URL.createObjectURL(new Blob([t], { type: 'image/svg+xml' }));
  }));
  return Object.keys(urls).length;
}
