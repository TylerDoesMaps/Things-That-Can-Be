/* Portraits: a face drawn from one number and what is known of the character (sex, age, race, build, party, clothes, mood).
   portrait(n, over) returns the layers; portraitSvg(layers, width) the picture. The same inputs always give the same face. */
function portrait(n, over) {
  const o = over || {};
  let t = (n * 2654435761) >>> 0;
  const r = () => { t += 0x6D2B79F5; let x = Math.imul(t ^ (t >>> 15), 1 | t); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  const f = (v) => Math.round(v * 10) / 10, pick = (a) => a[Math.floor(r() * a.length)];
  const mix = (a, b, k) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - k) + parseInt(b.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('');
  const circle = (cx, cy, rad) => `M${f(cx - rad)} ${f(cy)} a${f(rad)} ${f(rad)} 0 1 0 ${f(2 * rad)} 0 a${f(rad)} ${f(rad)} 0 1 0 ${f(-2 * rad)} 0 Z`;
  const oval = (cx, cy, rx, ry) => `M${f(cx - rx)} ${f(cy)} a${f(rx)} ${f(ry)} 0 1 0 ${f(2 * rx)} 0 a${f(rx)} ${f(ry)} 0 1 0 ${f(-2 * rx)} 0 Z`;
  const sex = o.sex || (r() < 0.5 ? 'M' : 'F');
  const age = o.age || Math.round(26 + r() * 56);
  const race = o.race || pick(['White', 'White', 'White', 'Black', 'Hispanic', 'Hispanic', 'Asian']);
  const build = o.build !== undefined ? o.build : r() * 2 - 1;
  const party = { rep: '#a95450', dem: '#2f558e', ind: '#7b8086' }[o.party || (r() < 0.45 ? 'rep' : r() < 0.8 ? 'dem' : 'ind')];
  const M = sex === 'M', heavy = build > 0.4;
  const SKIN = { White: ['#ecd9c6', '#e5cfb9', '#dfc4ab'], Hispanic: ['#d6b594', '#c9a582', '#ba9470'], Asian: ['#e6cfae', '#dbc09c'], Black: ['#a87c5c', '#8c6347', '#704d38'] }[race];
  const skin = pick(SKIN), dark = race === 'Black';
  const ink = '#2a2420', soft = mix(skin, '#2a1c14', dark ? 0.45 : 0.32);
  const greys = age >= 72 ? ["#f1efea", "#dedbd5"] : age >= 60 ? ['#b9b6b0', '#d6d3cd', '#8f8b84'] : age >= 48 ? ['#5c5853', '#8f8b84'] : null;
  const natural = race === 'White' ? ['#2e2a27', '#4a3b2f', '#6b523b', '#8f7450', '#b59a6a', '#3a3330', '#7a4a32'] : ['#211e1c', '#2a2523', '#35291f'];
  const greyed = greys && r() < (age >= 60 ? 0.85 : 0.45);
  const hairTone = o.hairTone || pick(greyed ? greys : natural);
  const light = parseInt(hairTone.slice(1, 3), 16) > 170;
  const browTone = light ? '#8f8b84' : mix(hairTone, '#000000', 0.15);
  // head
  const T = 27 + r() * 2, E = 62, C = 97 + (M ? 1.5 : 0) + r() * 1.5;
  const w = (M ? 23 : 21.3) + build * 1.6, jw = w * (heavy ? 0.95 : M ? 0.86 : 0.78), cw = heavy ? 11.5 : M ? 9.5 : 7;
  const right = `C${f(60 + w * 0.9)} ${f(T)} ${f(60 + w)} ${f(T + 16)} ${f(60 + w)} ${E - 2} C${f(60 + w)} ${E + 14} ${f(60 + jw)} ${f(C - 8)} ${f(60 + cw)} ${f(C - 2.5)} Q60 ${f(C + 2.5)} `;
  const face = `M60 ${f(T)} ${right}${f(60 - cw)} ${f(C - 2.5)} C${f(60 - jw)} ${f(C - 8)} ${f(60 - w)} ${E + 14} ${f(60 - w)} ${E - 2} C${f(60 - w)} ${f(T + 16)} ${f(60 - w * 0.9)} ${f(T)} 60 ${f(T)} Z`;
  const shade = `M60 ${f(T)} ${right}60 ${f(C)} Z`;
  const ears = oval(60 - w - 0.6, E + 5, 3, 6.5) + oval(60 + w + 0.6, E + 5, 3, 6.5);
  // neck and clothes: dress 0 work clothes by job, 1 shirt, 2 plain suit, 3 good suit, 4 formal
  const nw = (M ? 11.5 : 9) + build * 1.5, sw = (M ? 56 : 48) + build * 4, sy = 107 + (age > 72 ? 1.5 : 0);
  const dress = o.dress !== undefined ? o.dress : 2 + Math.floor(r() * 2), job = o.job || 'service', jacket = dress >= 2;
  let meet = null, scoop = 13, suitTone, shirtTone = '#f6f4ef', collared = false, tied = false, tieTone = '#8e3b3b', pin = '', pinTone = party, detail = '', extra = '', extraTone = '#f6f4ef', hat = '', hatTone = '#4f6a52';
  const placket = (len) => `M60 ${f(sy + 9)} L60 ${f(sy + 9 + len)}`;
  if (jacket) {
    collared = M || r() < 0.3; tied = M && (dress >= 3 || r() < 0.45); meet = tied ? sy + 0.5 : collared ? sy + 8 : null;
    suitTone = pick(dress === 2 ? (M ? ['#5a5348', '#6b6e73', '#4b4f55', '#59493c', '#3d4a5a'] : ['#5a3d45', '#39505a', '#6a5038', '#7a3b3b', '#55606b', '#4f6a52'])
      : dress === 3 ? (M ? ['#2b2d31', '#33363b', '#2a2f3a'] : ['#2b2d31', '#2f4a6b', '#5a2f3a', '#33363b']) : (M ? ['#1c2230', '#22252b'] : ['#1c2230', '#7a2f33', '#22252b']));
    shirtTone = collared ? pick(dress === 2 ? ['#f6f4ef', '#dfe7ef', '#e9e2cf', '#d3dbe6'] : ['#f6f4ef', '#f6f4ef', '#dfe7ef']) : pick(['#f6f4ef', '#e3d6c4', '#c9d3dc', '#ecd9d4']);
    tieTone = pick(dress === 4 ? ['#8e2f33', '#27467a'] : dress === 3 ? ['#8e3b3b', '#2f4f7f', '#6b4a5e', '#3f6b5a'] : ['#5b6770', '#6b4a5e', '#3f6b5a', '#a0803a', '#7a5a3a']);
    if (dress >= 3) pin = circle(60 + (M ? 19 : 16), sy + 17, dress === 4 ? 2.3 : 2);
    if (dress === 4) { pinTone = '#c9a84a'; if (M) extra = `M${f(60 - 30)} ${sy + 24} l7 0 l0 2.2 l-7 0 Z`; else if (!collared) { for (let k = 0; k < 9; k++) { const u = 0.14 + k * 0.09, x0 = 60 - nw - 3, x1 = 60 + nw + 3; extra += circle((1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * 60 + u * u * x1, (1 - u) * (1 - u) * (sy - 5) + 2 * u * (1 - u) * (sy + 13) + u * u * (sy - 5) + 0.6, 1.25); } extraTone = '#f4efe4'; } }
  } else if (dress === 1 || job === 'office') {
    if (M || r() < 0.5) { collared = true; meet = sy + 8; suitTone = pick(['#c9d6e4', '#e8e4da', '#9fb3c8', '#b7c4b0', '#d9c9c9']); detail = placket(40); }
    else { scoop = 10; suitTone = pick(['#7a3b3b', '#39505a', '#6a5038', '#5a3d45', '#4f6a52', '#c9b79a']); }
  } else if (job === 'farm') {
    collared = true; meet = sy + 8; suitTone = pick(['#8a4b3f', '#4f6a52', '#3f5873', '#9a7a3f']);
    for (let x = 60 - sw + 12; x <= 60 + sw - 12; x += 8) detail += `M${f(x)} ${sy + 12} L${f(x)} 150`;
    for (let y = sy + 19; y < 150; y += 8) detail += `M${f(60 - sw + 1)} ${f(y)} L${f(60 + sw - 1)} ${f(y)}`;
    if (o.hat !== undefined ? o.hat : M && r() < 0.75) { hatTone = pick(['#4f6a52', '#7a5a3a', '#3f4a5a', '#8a4b3f']); hat = `M${f(60 - w - 1.5)} ${E - 13} C${f(60 - w - 2)} ${f(T + 2)} ${f(60 - w * 0.6)} ${f(T - 7)} 60 ${f(T - 7)} C${f(60 + w * 0.6)} ${f(T - 7)} ${f(60 + w + 2)} ${f(T + 2)} ${f(60 + w + 1.5)} ${E - 13} Z M${f(60 - w - 4)} ${E - 12.5} Q60 ${E - 20} ${f(60 + w + 4)} ${E - 12.5} Q60 ${E - 8.5} ${f(60 - w - 4)} ${E - 12.5} Z`; }
  } else if (job === 'trades') {
    scoop = 5; suitTone = pick(['#7b8086', '#55606b', '#8a8377']); extraTone = pick(['#e0a030', '#c9d23c']);
    const panel = (q) => `M${f(60 + q * (nw + 3))} ${sy - 3} L${f(60 + q * (nw + 14))} ${sy + 5} L${f(60 + q * (sw - 13))} 150 L${f(60 + q * 5)} 150 L${f(60 + q * 5)} ${sy + 22} Z`;
    extra = panel(-1) + panel(1);
  } else if (job === 'health') {
    meet = sy + 10; suitTone = pick(['#4f8f93', '#5b7fae', '#7a6a9a', '#3f7a6a']); detail = `M${f(60 - nw - 1)} ${sy - 5} L60 ${f(sy + 12)} L${f(60 + nw + 1)} ${sy - 5}`;
  } else if (job === 'uniform') {
    collared = true; meet = sy + 6; suitTone = pick(['#27324a', '#3d4a3a', '#3d4a3a']); pinTone = '#c9a84a'; pin = `M${f(60 + 21)} ${sy + 13} l1.4 3 l3.3 0.4 l-2.4 2.3 l0.6 3.3 l-2.9 -1.6 l-2.9 1.6 l0.6 -3.3 l-2.4 -2.3 l3.3 -0.4 Z`;
    detail = placket(40) + `M${f(60 - 27)} ${sy + 21} h12 M${f(60 + 15)} ${sy + 25} h12`;
  } else { collared = true; meet = sy + 7; suitTone = pick(['#3f5873', '#7a3b3b', '#4f6a52', '#2b2d31', '#c9b79a', '#55606b']); detail = `M60 ${f(sy + 7)} L60 ${f(sy + 19)}`; }
  const neck = meet !== null ? `M${f(60 - nw)} ${f(C - 12)} L${f(60 - nw - 1)} ${sy - 7} L60 ${f(meet)} L${f(60 + nw + 1)} ${sy - 7} L${f(60 + nw)} ${f(C - 12)} Z`
    : `M${f(60 - nw)} ${f(C - 12)} L${f(60 - nw - 3)} ${sy - 5} Q60 ${f(sy + scoop)} ${f(60 + nw + 3)} ${sy - 5} L${f(60 + nw)} ${f(C - 12)} Z`;
  const chin = `M${f(60 - nw)} ${f(C - 12)} L${f(60 + nw)} ${f(C - 12)} L${f(60 + nw + 0.3)} ${f(C + 4.5)} Q60 ${f(C + 10)} ${f(60 - nw - 0.3)} ${f(C + 4.5)} Z`;
  const suit = `M${f(60 - sw)} 150 C${f(60 - sw)} ${sy + 15} ${f(60 - sw + 5)} ${sy + 8} ${f(60 - nw - 9)} ${sy + 1} L${f(60 - nw - 1)} ${sy - 7} L${f(60 + nw + 1)} ${sy - 7} L${f(60 + nw + 9)} ${sy + 1} C${f(60 + sw - 5)} ${sy + 8} ${f(60 + sw)} ${sy + 15} ${f(60 + sw)} 150 Z`;
  const shirt = !jacket ? '' : collared ? `M${f(60 - nw - 2)} ${sy - 7} L60 ${sy + 21} L${f(60 + nw + 2)} ${sy - 7} Z` : `M${f(60 - nw - 4)} ${sy - 6} Q60 ${sy + 27} ${f(60 + nw + 4)} ${sy - 6} Z`;
  const flap = (q) => `M${f(60 + q * (nw + 2))} ${sy - 8} L${f(60 + q * 0.6)} ${f(meet)} L${f(60 + q * 7.5)} ${f(meet + 7.5)} Z`;
  const collar = collared ? flap(-1) + flap(1) : '', collarTone = jacket ? shirtTone : mix(suitTone, '#ffffff', 0.12);
  const tie = tied ? `M57.2 ${f(meet)} L62.8 ${f(meet)} L62 ${f(meet + 5)} L64.4 ${sy + 19} L60 ${sy + 24} L55.6 ${sy + 19} L58 ${f(meet + 5)} Z` : '';
  const lapel = jacket ? `M${f(60 - nw - 2)} ${sy - 6} L60 ${sy + 22} L${f(60 + nw + 2)} ${sy - 6}` : '';
  const BG = { '#a95450': ['#b07a76', '#d0aba7'], '#2f558e': ['#7b93b6', '#abbdd6'], '#7b8086': ['#a3a8a6', '#c8cbc9'] }[party];
  // features
  const mood = Math.max(-1, Math.min(1, o.mood || 0)), cross = Math.max(0, -mood), glad = Math.max(0, mood);
  const gap = (M ? 10.6 : 10) + build * 0.5, ew = 4.6, lid = 4.1 + r() * 0.9 - cross * 1.3 - glad * 0.5, tilt = r() * 1.2 - 0.6, brow = 7 + r() * 1.5 + glad * 0.9 - cross * 1.2;
  const white = (cx, s) => `M${f(cx - ew)} ${f(E + tilt * s)} Q${f(cx)} ${f(E - lid)} ${f(cx + ew)} ${f(E - tilt * s)} Q${f(cx)} ${f(E + 2.7)} ${f(cx - ew)} ${f(E + tilt * s)} Z`;
  const lidLine = (cx, s) => `M${f(cx - ew - 0.3)} ${f(E + tilt * s + 0.1)} Q${f(cx)} ${f(E - lid)} ${f(cx + ew + 0.3)} ${f(E - tilt * s + 0.1)}`;
  const whites = white(60 - gap, 1) + white(60 + gap, -1);
  const eyes = lidLine(60 - gap, 1) + lidLine(60 + gap, -1);
  const irises = circle(60 - gap, E - 0.45, 1.75) + circle(60 + gap, E - 0.45, 1.75);
  const iris = race === 'White' && r() < 0.45 ? pick(['#4f6677', '#5d6850', '#6a7f8c']) : '#3a2a20';
  const arch = M ? 1.6 : 2.4;
  const brows = `M${f(60 - gap - 6)} ${f(E - brow + 1.2 - cross * 1.6)} Q${f(60 - gap - 1)} ${f(E - brow - arch + cross * 1.2)} ${f(60 - gap + 5.3)} ${f(E - brow + cross * 3)} M${f(60 + gap + 6)} ${f(E - brow + 1.2 - cross * 1.6)} Q${f(60 + gap + 1)} ${f(E - brow - arch + cross * 1.2)} ${f(60 + gap - 5.3)} ${f(E - brow + cross * 3)}`;
  const N = E + 15 + r() * 1.5, nwid = (M ? 4.5 : 3.8) + (dark ? 0.9 : 0) + r() * 0.6;
  const nose = `M${f(60 - nwid)} ${f(N - 1)} Q${f(60 - nwid + 0.4)} ${f(N + 1.5)} ${f(60 - 1.6)} ${f(N + 0.9)} Q60 ${f(N + 2)} ${f(60 + 1.6)} ${f(N + 0.9)} Q${f(60 + nwid - 0.4)} ${f(N + 1.5)} ${f(60 + nwid)} ${f(N - 1)}`;
  const bridge = `M${f(60 + 2.2)} ${E + 4} Q${f(60 + 3.2)} ${f(N - 6)} ${f(60 + nwid - 0.8)} ${f(N - 2.6)}`;
  const Mo = N + 8.3 + r(), mw = (M ? 7.8 : 7) + r() * 1.2 + glad * 1.8 - cross * 0.8, smile = 0.8 + r() * 1.2 + glad * 3 - cross * 3.4;
  const ul = M ? 1.3 : 2, ll = M ? 2.6 : 3.6, cy = Mo - smile * 0.5;
  const mouth = `M${f(60 - mw)} ${f(cy)} Q60 ${f(Mo + smile)} ${f(60 + mw)} ${f(cy)}`;
  const lips = `M${f(60 - mw)} ${f(cy)} Q${f(60 - mw * 0.45)} ${f(Mo - ul - 0.4)} ${f(60 - 1.5)} ${f(Mo - ul)} Q60 ${f(Mo - ul + 0.9)} ${f(60 + 1.5)} ${f(Mo - ul)} Q${f(60 + mw * 0.45)} ${f(Mo - ul - 0.4)} ${f(60 + mw)} ${f(cy)} Q60 ${f(Mo + smile + ll * 2.3)} ${f(60 - mw)} ${f(cy)} Z`;
  const lipTone = mix(skin, dark ? '#5e2f2c' : '#a84f4a', M ? 0.22 : 0.48);
  let lines = bridge;
  if (age >= 42) lines += `M${f(60 - gap - ew + 1)} ${E + 3.6} Q${f(60 - gap)} ${f(E + 5)} ${f(60 - gap + ew - 1)} ${E + 3.6} M${f(60 + gap - ew + 1)} ${E + 3.6} Q${f(60 + gap)} ${f(E + 5)} ${f(60 + gap + ew - 1)} ${E + 3.6}`;
  if (cross > 0.4) lines += `M${f(60 - 2.2)} ${f(E - brow - 1)} l0.6 ${f(2 + cross * 2)} M${f(60 + 2.2)} ${f(E - brow - 1)} l-0.6 ${f(2 + cross * 2)}`;
  if (glad > 0.4) lines += `M${f(60 - mw - 2.5)} ${f(cy - 2.5)} q-1.6 2.5 0 5 M${f(60 + mw + 2.5)} ${f(cy - 2.5)} q1.6 2.5 0 5`;
  if (age >= 54) lines += `M${f(60 - nwid - 2.2)} ${f(N + 0.5)} Q${f(60 - mw - 2.6)} ${f(N + 4)} ${f(60 - mw - 2)} ${f(Mo - 0.5)} M${f(60 + nwid + 2.2)} ${f(N + 0.5)} Q${f(60 + mw + 2.6)} ${f(N + 4)} ${f(60 + mw + 2)} ${f(Mo - 0.5)}`;
  if (age >= 66) lines += `M${f(60 - 8)} ${f(T + 12)} Q60 ${f(T + 11)} ${f(60 + 8)} ${f(T + 12)} M${f(60 - gap - ew - 1.2)} ${E + 1.5} l-2 1.2 M${f(60 + gap + ew + 1.2)} ${E + 1.5} l2 1.2`;
  if (build > 0.62) lines += `M${f(60 - cw - 1)} ${f(C - 3)} Q60 ${f(C + 1.2)} ${f(60 + cw + 1)} ${f(C - 3)}`;
  // hair
  let style = o.hair || pick(M ? ['short', 'short', 'part', 'part', 'part', 'receding', 'buzz'] : age >= 58 ? ['bob', 'bob', 'crop', 'crop', 'up'] : ['long', 'long', 'bob', 'bob', 'up', 'crop']);
  if (!o.hair && M && age > 46 && r() < (age > 64 ? 0.5 : 0.18)) style = pick(['bald', 'receding', 'horseshoe']);
  if (!o.hair && dark && r() < 0.6) style = M ? pick(['buzz', 'buzz', 'short', age > 46 ? 'bald' : 'buzz']) : pick(['natural', 'up', 'bob']);
  const H = T + 9 + (style === 'receding' ? -4 : 0);
  const outer = (pad, lift) => `M${f(60 - w - pad)} ${E - 3} C${f(60 - w - pad - 1.5)} ${f(T + 6)} ${f(60 - w * 0.62)} ${f(T - lift)} 60 ${f(T - lift)} C${f(60 + w * 0.62)} ${f(T - lift)} ${f(60 + w + pad + 1.5)} ${f(T + 6)} ${f(60 + w + pad)} ${E - 3}`;
  const line = (kind) => kind === 'part' ? `L${f(60 + w - 1.5)} ${E - 9} C${f(60 + w - 2.5)} ${f(H + 6)} ${f(60 + 12)} ${f(H + 1)} ${f(60 - 6)} ${f(H - 2.5)} C${f(60 - 14)} ${f(H + 2)} ${f(60 - w + 2)} ${f(H + 5)} ${f(60 - w + 1.5)} ${E - 9} Z`
    : kind === 'm' ? `L${f(60 + w - 1.5)} ${E - 9} C${f(60 + w - 2)} ${f(H + 3)} ${f(60 + 15)} ${f(H - 5)} ${f(60 + 8)} ${f(H - 1)} Q60 ${f(H - 4)} ${f(60 - 8)} ${f(H - 1)} C${f(60 - 15)} ${f(H - 5)} ${f(60 - w + 2)} ${f(H + 3)} ${f(60 - w + 1.5)} ${E - 9} Z`
    : kind === 'centre' ? `L${f(60 + w - 1)} ${E - 4} C${f(60 + w - 1.5)} ${f(H + 3)} ${f(60 + 12)} ${f(H - 2)} 60 ${f(H - 2.5)} C${f(60 - 12)} ${f(H - 2)} ${f(60 - w + 1.5)} ${f(H + 3)} ${f(60 - w + 1)} ${E - 4} Z`
    : kind === 'sweep' ? `L${f(60 + w - 1)} ${E - 5} C${f(60 + w - 1.5)} ${f(H + 6)} ${f(60 + 10)} ${f(H + 2)} ${f(60 - 8)} ${f(H - 2.5)} C${f(60 - 15)} ${f(H - 1)} ${f(60 - w + 2)} ${f(H + 4)} ${f(60 - w + 1)} ${E - 5} Z`
    : `L${f(60 + w - 1.5)} ${E - 9} C${f(60 + w - 2.5)} ${f(H + 5)} ${f(60 + 11)} ${f(H)} 60 ${f(H)} C${f(60 - 11)} ${f(H)} ${f(60 - w + 2.5)} ${f(H + 5)} ${f(60 - w + 1.5)} ${E - 9} Z`;
  let top = '', back = '';
  if (style === 'short') top = outer(0.8, 4.5) + line('round');
  if (style === 'part') top = outer(1.2, 6.5) + line('part');
  if (style === 'receding') top = outer(0.6, 3.5) + line('m');
  if (style === 'buzz') top = outer(0.2, 2) + line('round');
  if (style === 'horseshoe') top = `M${f(60 - w - 0.8)} ${E - 2} C${f(60 - w - 2)} ${E - 14} ${f(60 - w + 1)} ${f(T + 9)} ${f(60 - w + 4)} ${f(T + 8)} C${f(60 - w + 2)} ${f(T + 16)} ${f(60 - w + 2)} ${E - 9} ${f(60 - w + 1.6)} ${E - 2} Z M${f(60 + w + 0.8)} ${E - 2} C${f(60 + w + 2)} ${E - 14} ${f(60 + w - 1)} ${f(T + 9)} ${f(60 + w - 4)} ${f(T + 8)} C${f(60 + w - 2)} ${f(T + 16)} ${f(60 + w - 2)} ${E - 9} ${f(60 + w - 1.6)} ${E - 2} Z`;
  if (style === 'long') { top = outer(2.2, 7.5) + line(r() < 0.5 ? 'centre' : 'sweep'); back = `M${f(60 - w - 3)} ${E - 6} C${f(60 - w - 7)} ${E + 22} ${f(60 - w - 5)} ${sy + 2} ${f(60 - w + 1)} ${sy + 9} L${f(60 + w - 1)} ${sy + 9} C${f(60 + w + 5)} ${sy + 2} ${f(60 + w + 7)} ${E + 22} ${f(60 + w + 3)} ${E - 6} Z`; }
  if (style === 'bob') { top = outer(2.2, 7.5) + line(r() < 0.5 ? 'centre' : 'sweep'); back = `M${f(60 - w - 3)} ${E - 6} C${f(60 - w - 7)} ${E + 10} ${f(60 - w - 5.5)} ${E + 25} ${f(60 - w + 8)} ${E + 30} L${f(60 + w - 8)} ${E + 30} C${f(60 + w + 5.5)} ${E + 25} ${f(60 + w + 7)} ${E + 10} ${f(60 + w + 3)} ${E - 6} Z`; }
  if (style === 'crop') { top = outer(2, 7.5) + line('sweep'); back = `M${f(60 - w - 2.6)} ${E - 6} C${f(60 - w - 4.5)} ${E + 2} ${f(60 - w - 3.5)} ${E + 13} ${f(60 - w + 3)} ${E + 17} L${f(60 + w - 3)} ${E + 17} C${f(60 + w + 3.5)} ${E + 13} ${f(60 + w + 4.5)} ${E + 2} ${f(60 + w + 2.6)} ${E - 6} Z`; }
  if (style === 'up') { top = outer(1, 5) + line('sweep'); back = circle(60, T - 6, 7.5); }
  if (style === 'natural') { top = outer(1.5, 5) + line('round'); back = oval(60, T + 11, w + 8, 23); }
  // facial hair and glasses
  const bearded = o.beard !== undefined ? o.beard : M && style !== 'buzz' && r() < 0.2, tache = M && !bearded && r() < 0.1;
  const beard = bearded ? `M${f(60 - w + 0.5)} ${E + 10} C${f(60 - w + 1)} ${f(C - 12)} ${f(60 - jw)} ${f(C - 7)} ${f(60 - cw)} ${f(C - 2)} Q60 ${f(C + 3)} ${f(60 + cw)} ${f(C - 2)} C${f(60 + jw)} ${f(C - 7)} ${f(60 + w - 1)} ${f(C - 12)} ${f(60 + w - 0.5)} ${E + 10} C${f(60 + w - 5)} ${f(N + 6)} ${f(60 + mw + 2)} ${f(Mo - 4)} ${f(60 + mw - 1)} ${f(Mo - 3.6)} Q60 ${f(Mo - 5.5)} ${f(60 - mw + 1)} ${f(Mo - 3.6)} C${f(60 - mw - 2)} ${f(Mo - 4)} ${f(60 - w + 5)} ${f(N + 6)} ${f(60 - w + 0.5)} ${E + 10} Z M${f(60 - mw - 0.5)} ${f(cy - 0.6)} Q60 ${f(Mo - ul - 2)} ${f(60 + mw + 0.5)} ${f(cy - 0.6)} Q60 ${f(Mo + smile + ll * 1.7 + 1.5)} ${f(60 - mw - 0.5)} ${f(cy - 0.6)} Z`
    : tache ? `M${f(60 - mw - 0.5)} ${f(Mo - 1.6)} Q60 ${f(Mo - 6.5)} ${f(60 + mw + 0.5)} ${f(Mo - 1.6)} Q60 ${f(Mo - 3.4)} ${f(60 - mw - 0.5)} ${f(Mo - 1.6)} Z` : '';
  const specs = o.glasses !== undefined ? o.glasses : r() < (age > 55 ? 0.42 : 0.18);
  const gw = ew + 2.9, gy = E - 4.9, gh = 9;
  const lens = (cx) => `M${f(cx - gw + 2.4)} ${f(gy)} h${f(2 * gw - 4.8)} q2.4 0 2.4 2.4 v${f(gh - 5.4)} q0 3 -3 3 h${f(-(2 * gw - 6))} q-3 0 -3 -3 v${f(-(gh - 5.4))} q0 -2.4 2.4 -2.4 Z`;
  const glasses = specs ? lens(60 - gap) + lens(60 + gap) + `M${f(60 - gap + gw)} ${f(gy + 2.6)} Q60 ${f(gy + 1)} ${f(60 + gap - gw)} ${f(gy + 2.6)} M${f(60 - gap - gw)} ${f(gy + 2.2)} L${f(60 - w - 0.5)} ${f(gy + 1.4)} M${f(60 + gap + gw)} ${f(gy + 2.2)} L${f(60 + w + 0.5)} ${f(gy + 1.4)}` : '';
  return { sex, age, race, style, party, dress, bg: BG[0], bgOval: BG[1], collarTone, pinTone, detail, extra, extraTone, hat, hatTone, skin, ink, soft, hairTone, browTone, back, suit, suitTone, shirt, shirtTone, tie, tieTone, collar, lapel, pin, neck, chin, ears, face, shade, top, beard, whites, eyes, irises, iris, brows, browW: M ? 1.8 : 1.15, nose, mouth, lips, lipTone, lines, glasses };
}
function portraitSvg(p, size) {
  const S = (d, st) => d ? `<path d="${d}" style="${st}"/>` : '';
  const stroke = (c, wd) => `fill:none;stroke:${c};stroke-width:${wd}px;stroke-linecap:round;stroke-linejoin:round`;
  return `<svg viewBox="0 0 120 150" width="${size}" height="${size * 1.25}" class="portrait" style="background:${p.bg}"><ellipse cx="60" cy="66" rx="58" ry="64" fill="${p.bgOval}"/>
  ${S(p.back, `fill:${p.hairTone}`)}${S(p.suit, `fill:${p.suitTone}`)}${S(p.detail, stroke('#00000038', 0.7))}${S(p.shirt, `fill:${p.shirtTone}`)}${S(p.neck, `fill:${p.skin}`)}${S(p.chin, 'fill:#2a1c14;opacity:.2')}${S(p.collar, `fill:${p.collarTone};stroke:#00000030;stroke-width:.5px;stroke-linejoin:round`)}${S(p.lapel, stroke('#00000050', 0.9))}${S(p.tie, `fill:${p.tieTone}`)}${S(p.pin, `fill:${p.pinTone}`)}${S(p.extra, `fill:${p.extraTone}`)}
  ${S(p.ears, `fill:${p.skin}`)}${S(p.face, `fill:${p.skin}`)}${S(p.shade, 'fill:#2a1c14;opacity:.055')}${S(p.beard, `fill:${p.hairTone};opacity:.93`)}${S(p.top, `fill:${p.hairTone}`)}${S(p.hat, `fill:${p.hatTone}`)}
  ${S(p.lines, stroke(p.soft, 0.6) + ';opacity:.7')}${S(p.nose, stroke(p.soft, 0.95))}${S(p.lips, `fill:${p.lipTone}`)}${S(p.mouth, stroke(p.ink, 0.9) + ';opacity:.8')}${S(p.whites, 'fill:#f5f1ea')}${S(p.irises, `fill:${p.iris}`)}${S(p.eyes, stroke(p.ink, 1.15))}${S(p.brows, stroke(p.browTone, p.browW))}${S(p.glasses, stroke(p.ink, 0.8))}</svg>`;
}
