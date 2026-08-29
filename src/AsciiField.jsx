import React, { useRef, useEffect } from 'react';

/* =========================================================================
   CHAMP ASCII — technique reprise du moteur "living page" (qualiaai.fr) :
   une rampe de densité, un atlas de glyphes en texture, un champ
   d'intensité en texture, et un shader qui choisit un glyphe par cellule.

   Ici ce n'est pas un décor. C'est l'état "pas encore de données" :
   un club dont la caméra n'est pas déployée n'a que du bruit, et les
   vraies chaînes (codes de clubs, scores) émergent de ce bruit à mesure
   qu'elles existent. `seeds` est alimenté par les données réelles.
   ========================================================================= */

const RAMP = ' .:-=+*#%@';
const NG = RAMP.length;
const CW = 8;   // largeur de cellule en px CSS
const CH = 15;  // hauteur de cellule en px CSS

function hexToRgb(h) {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.split('').map((c) => c + c).join('') : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const VS = `attribute vec2 p; varying vec2 vUV;
void main(){ vUV = (p + 1.0) * 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Une cellule = une case de la grille. On lit l'intensité du champ, on en
// deduit l'index du glyphe dans la rampe, et on echantillonne l'atlas.
const FS = `precision mediump float;
varying vec2 vUV;
uniform sampler2D uField, uGlyphs;
uniform vec2 uGrid;
uniform vec3 uInk, uAccent;
uniform float uAlpha;
void main(){
  vec2 g = vUV * uGrid;
  vec2 cell = floor(g);
  vec2 inCell = fract(g);
  vec4 f = texture2D(uField, (cell + 0.5) / uGrid);
  float dens = f.r;          // 0..1 densite -> glyphe
  float isData = f.g;        // 1.0 si la cellule porte une vraie chaine
  float gi = floor(dens * float(${NG} - 1) + 0.5);
  vec2 guv = vec2((gi + inCell.x) / float(${NG}), 1.0 - inCell.y);
  float a = texture2D(uGlyphs, guv).a;
  vec3 col = mix(uInk, uAccent, isData);
  float boost = mix(0.55, 1.0, isData);
  gl_FragColor = vec4(col, a * dens * boost * uAlpha);
}`;

export default function AsciiField({
  accent = '#FFB020',
  ink = '#A2937E',
  seeds = [],
  alpha = 0.5,
  speed = 1,
  converge = 0,          // 0 = bruit pur, 1 = les chaines sont nettes
  className = '',
  style = {},
}) {
  const ref = useRef(null);
  const seedRef = useRef(seeds);
  const convRef = useRef(converge);
  seedRef.current = seeds;
  convRef.current = converge;

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const gl = cv.getContext('webgl', { alpha: true, antialias: false, depth: false });
    if (!gl) return;                                   // pas de WebGL : rien, le fond reste propre

    // --- atlas des glyphes de la rampe -----------------------------------
    const dpr = Math.min(2, devicePixelRatio || 1);
    const ac = document.createElement('canvas');
    ac.width = NG * CW * dpr; ac.height = CH * dpr;
    const a2 = ac.getContext('2d');
    a2.scale(dpr, dpr);
    a2.font = `700 ${CH - 3}px ui-monospace, "SF Mono", Menlo, monospace`;
    a2.textBaseline = 'top';
    a2.fillStyle = '#fff';
    for (let i = 0; i < NG; i++) a2.fillText(RAMP[i], i * CW + 0.5, 0);

    function tex(unit, img, w, h, data) {
      const t = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (img) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      return t;
    }

    function compile(type, src) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
      return s;
    }
    const vs = compile(gl.VERTEX_SHADER, VS);
    const fs = compile(gl.FRAGMENT_SHADER, FS);
    // Sorties anticipees : si un seul des deux shaders compile, l'autre reste
    // alloue ; si le linkage echoue, le programme et les shaders attaches le
    // restent aussi. Le nettoyage de fin d'effet n'est pas atteint dans ces
    // chemins, il faut donc liberer ici.
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      return;
    }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const glyphTex = tex(1, ac);
    gl.uniform1i(gl.getUniformLocation(prog, 'uGlyphs'), 1);
    gl.uniform1i(gl.getUniformLocation(prog, 'uField'), 0);
    gl.uniform3fv(gl.getUniformLocation(prog, 'uInk'), hexToRgb(ink));
    gl.uniform3fv(gl.getUniformLocation(prog, 'uAccent'), hexToRgb(accent));
    const uGrid = gl.getUniformLocation(prog, 'uGrid');
    const uAlpha = gl.getUniformLocation(prog, 'uAlpha');

    let cols = 0, rows = 0, field = null, fieldTex = null, textMask = null;

    function layout() {
      const r = cv.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width));
      const h = Math.max(1, Math.round(r.height));
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      gl.viewport(0, 0, cv.width, cv.height);
      cols = Math.max(4, Math.floor(w / CW));
      rows = Math.max(3, Math.floor(h / CH));
      field = new Uint8Array(cols * rows * 4);
      textMask = new Uint8Array(cols * rows);
      // Les vraies chaines sont posees sur la grille, espacees, jamais
      // sur la premiere ni la derniere ligne (ou elles seraient coupees).
      const list = seedRef.current || [];
      for (let i = 0; i < list.length; i++) {
        const s = String(list[i]);
        const row = 1 + Math.floor(((i + 0.5) / Math.max(1, list.length)) * (rows - 2));
        const start = Math.max(0, Math.floor((cols - s.length) * ((i * 37) % 100) / 100));
        for (let c = 0; c < s.length && start + c < cols; c++) {
          if (s[c] === ' ') continue;
          textMask[row * cols + start + c] = 1;
        }
      }
      if (fieldTex) gl.deleteTexture(fieldTex);   // sinon une texture fuit a chaque redimensionnement
      fieldTex = tex(0, null, cols, rows, field);
      gl.uniform2f(uGrid, cols, rows);
    }
    layout();

    let raf = 0, t0 = performance.now(), alive = true;
    function frame(now) {
      if (!alive) return;
      const t = ((now - t0) / 1000) * speed;
      const conv = convRef.current;
      let i = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++, i++) {
          // houle : deux ondes croisees + une derive lente, comme la "mer"
          // du moteur d'origine. Pas de bruit aleatoire, donc pas de
          // scintillement d'une image a l'autre.
          const x = c * 0.16, y = r * 0.29;
          let v = 0.5 + 0.5 * Math.sin(x + t * 0.55) * Math.cos(y - t * 0.31);
          v *= 0.5 + 0.5 * Math.sin((x + y) * 0.35 - t * 0.22);
          // Les deux ondes sont larges: sur une petite surface, presque toutes
          // les cellules finissent a une densite voisine et elevee, ce qui donne
          // un LAVIS uniforme au lieu de caracteres epars. On durcit donc le
          // contraste et on coupe le bas, pour que seules les cellules fortes
          // s allument et qu on lise des glyphes, pas une brume.
          v = Math.pow(v, 3);
          if (v < 0.14) v = 0;
          const isData = textMask[i];
          if (isData) v = Math.min(1, v * (1 - conv) + conv);
          const k = i * 4;
          field[k] = Math.max(0, Math.min(255, v * 255));
          field[k + 1] = isData ? Math.round(conv * 255) : 0;
          field[k + 2] = 0; field[k + 3] = 255;
        }
      }
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, fieldTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cols, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, field);
      gl.uniform1f(uAlpha, alpha);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!reduced) raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    const ro = new ResizeObserver(() => layout());
    ro.observe(cv);
    const onVis = () => {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; }
      else if (!raf && !reduced) raf = requestAnimationFrame(frame);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      // Liberer explicitement les ressources GPU : le ramasse-miettes ne rend
      // pas la memoire d'un contexte WebGL, et les contextes sont plafonnes
      // par le navigateur (une poignee par page).
      try {
        if (fieldTex) gl.deleteTexture(fieldTex);
        if (glyphTex) gl.deleteTexture(glyphTex);
        gl.deleteBuffer(buf);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
        const lose = gl.getExtension('WEBGL_lose_context');
        if (lose) lose.loseContext();
      } catch (e) { /* contexte deja perdu */ }
    };
  }, [accent, ink, alpha, speed]);

  return <canvas ref={ref} className={className} aria-hidden="true" style={style} />;
}
