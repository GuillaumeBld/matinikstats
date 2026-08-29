import React, { useRef, useEffect } from 'react';

/* =========================================================================
   FOND DE SITE — la vidéo n'est plus une étape ni une vignette : elle est le
   fond, en plein écran, derrière toute la page, et son temps suit le scroll.

   Le voile au-dessus d'elle n'est PAS constant. Il est léger sur le premier
   écran, où l'image doit porter, et il s'épaissit à mesure qu'on descend dans
   les tableaux, où c'est le chiffre qui doit porter. C'est ce qui permet
   d'avoir un fond vidéo sans rendre la donnée illisible.

   Trois pièges déjà payés, à ne pas réintroduire :
   - lecture depuis un Blob : un hébergeur qui ne sert pas les requêtes par
     plage fige video.seekable à [0,0] et toute recherche retombe sur l'image 0
   - temps piloté dans une boucle rAF et non sur l'événement scroll, qui ne se
     déclenche pas dans un onglet en arrière-plan
   - une seule recherche à la fois : jamais empiler un currentTime sur un seek
     en cours, sinon le décodeur décroche sur un défilement rapide
   ========================================================================= */

const SRC_DESKTOP = '/app-hero.mp4';
const SRC_MOBILE = '/app-hero-m.mp4';
const POSTER = '/app-hero-poster.jpg';

const lerp = (a, b, t) => a + (b - a) * t;

export default function BackdropFilm() {
  const vidRef = useRef(null);
  const posterRef = useRef(null);
  const scrimRef = useRef(null);

  useEffect(() => {
    const vid = vidRef.current;
    const scrim = scrimRef.current;
    if (!vid || !scrim) return;

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const src = coarse || innerWidth <= 860 ? SRC_MOBILE : SRC_DESKTOP;

    let ready = false, dur = 0, alive = true;
    let seeking = false, want = 0, lastKey = '', raf = 0, seekStart = 0;

    // Le CLIP est calé sur la hauteur RÉELLE de la page : il démarre en haut,
    // il finit en bas, quelle que soit la longueur de la vue. C'est ce qui le
    // rend visible d'un bout à l'autre au lieu de se figer au tiers.
    // Le VOILE, lui, ne monte que sur le premier écran et demi, et il plafonne
    // bas : au-delà, c'est le flou derrière les panneaux qui tient la
    // lisibilité, pas l'effacement de l'image.
    function metrics() {
      const doc = document.documentElement;
      const y = scrollY || doc.scrollTop || 0;
      const range = Math.max(1, doc.scrollHeight - innerHeight);
      const veil = Math.min(1, Math.max(0, y / (innerHeight * 1.15)));
      const clip = Math.min(1, Math.max(0, y / range));
      return { veil, clip };
    }

    // Le voile n'a pas la même exigence selon le thème : sur fond clair, la
    // salle éclairée renvoie autant de lumière que le papier et le texte
    // secondaire s'y noie. Le thème clair voile donc un peu plus.
    function paint(m) {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      const lo = light ? 0.4 : 0.28;
      const hi = light ? 0.7 : 0.55;
      scrim.style.opacity = String(lerp(lo, hi, m.veil));
    }

    function seek(p) {
      if (!ready) return;
      want = p * (dur - 0.05);
      // Sortie de secours : si `seeked` n'arrive jamais (decodeur bloque), la
      // garde resterait fermee et le fond se figerait definitivement.
      if (seeking && performance.now() - seekStart < 1500) return;
      seeking = true;
      seekStart = performance.now();
      try { vid.currentTime = want; } catch (e) { seeking = false; }
    }
    function onSeeked() {
      seeking = false;
      if (Math.abs(vid.currentTime - want) > 0.04) {
        seeking = true;
        seekStart = performance.now();
        try { vid.currentTime = want; } catch (e) { seeking = false; }
      }
    }
    vid.addEventListener('seeked', onSeeked);

    function tick() {
      if (!alive) return;
      const m = metrics();
      const key = m.veil.toFixed(4) + '|' + m.clip.toFixed(4);
      if (key !== lastKey) { lastKey = key; paint(m); seek(m.clip); }
      raf = requestAnimationFrame(tick);
    }

    // En reduction de mouvement on ne telecharge meme pas le clip : le CSS le
    // masque de toute facon, et le fetch declencherait reseau, decodage et memoire
    // pour rien.
    let objectUrl = null;
    if (!reduced) fetch(src)
      .then((r) => r.blob())
      .then((b) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(b);
        vid.src = objectUrl;
        vid.load();
        return new Promise((res) => {
          if (vid.readyState >= 1) return res();
          vid.addEventListener('loadedmetadata', res, { once: true });
        });
      })
      .then(() => {
        if (!alive) return;
        dur = vid.duration || 10;
        return vid.play().then(() => vid.pause()).catch(() => {});
      })
      .then(() => {
        if (!alive) return;
        ready = true;
        seek(metrics().clip);
        setTimeout(() => { if (posterRef.current) posterRef.current.style.opacity = '0'; }, 140);
      })
      .catch(() => { /* l'image fixe reste le fond, la page est utilisable */ });

    paint(metrics());
    if (!reduced) raf = requestAnimationFrame(tick);

    const onResize = () => paint(metrics());
    addEventListener('resize', onResize);
    const themeWatch = new MutationObserver(() => paint(metrics()));
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    const onVis = () => { if (!document.hidden && !ready && vid.readyState === 0) vid.load(); };
    document.addEventListener('visibilitychange', onVis);
    const prime = () => { vid.play().then(() => vid.pause()).catch(() => {}); };
    addEventListener('touchstart', prime, { once: true, passive: true });

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      vid.removeEventListener('seeked', onSeeked);
      removeEventListener('resize', onResize);
      themeWatch.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      removeEventListener('touchstart', prime);
      // Relacher la ressource media : sans revoke ni load(), le Blob reste
      // retenu par le document.
      try {
        vid.removeAttribute('src');
        vid.load();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch (e) { /* sans effet */ }
    };
  }, []);

  return (
    <div className="p4t-backdrop" aria-hidden="true">
      <img className="p4t-backdrop-poster" ref={posterRef} src={POSTER} alt="" />
      <video className="p4t-backdrop-vid" ref={vidRef} muted playsInline preload="auto" poster={POSTER} />
      <div className="p4t-backdrop-scrim" ref={scrimRef} />
    </div>
  );
}
