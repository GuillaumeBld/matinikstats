#!/usr/bin/env bash
# Preuve que chaque controle mord : on reinjecte le bug, on montre le rouge.
#
# Les substitutions passent par python et str.replace, en LITTERAL. Ni sed -i ''
# (syntaxe BSD qui echoue sur Linux), ni perl -pi -e (dont la partie gauche est
# une expression reguliere : var(--bg) y devient un groupe de capture et le
# motif ne correspond plus, ce qui faisait passer le test sans injecter le bug).
set -u

sub() { python3 -c '
import sys
p, a, b = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(p).read()
if a not in s:
    sys.exit("INJECTION RATEE, motif absent: " + a[:60])
open(p, "w").write(s.replace(a, b, 1))
' "$@"; }

run() { CI=1 npx playwright test -g "$1" 2>&1 | tail -3 | tr '\n' ' '; echo; }

echo "=== 1. empilement du fond : z-index -1 -> 0 ==="
sub src/App.jsx \
  'position: fixed; inset: 0; z-index: -1; overflow: hidden; background: var(--bg);' \
  'position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--bg);'
run "titres de section"
git checkout -q src/App.jsx

echo "=== 2. titre du heros suivant le theme ==="
sub src/App.jsx \
  '.p4t-hero-first .p4t-hero-title { color: #F6F0E4;' \
  '.p4t-hero-first .p4t-hero-title { color: var(--ink);'
run "titre du héros contraste"
git checkout -q src/App.jsx

echo "=== 3. carte de partage reprenant les jetons du theme ==="
sub src/App.jsx \
  '        .p4t-sharecard {
          --ink: #F6F0E4;
          --ink-dim: #A2937E;
          --amber: #FFB020;
        }
' ''
run "carte de partage contraste"
git checkout -q src/App.jsx

echo "=== 4. var() sur un contexte canvas ==="
sub src/App.jsx \
  'ctx.fillStyle = SHARE.amber;' \
  "ctx.fillStyle = 'var(--amber)';"
run "variable CSS passée à un contexte canvas"
git checkout -q src/App.jsx

echo "=== 5. bandeau de demonstration retire ==="
sub src/App.jsx '      <DemoBanner />
' ''
run "bandeau de démonstration est visible"
git checkout -q src/App.jsx

echo "=== 6. tampon retire du PNG genere ==="
sub src/App.jsx '    stampDemo(ctx, w, h);
' ''
run "PNG de partage porte le tampon"
git checkout -q src/App.jsx

echo "=== etat restaure ==="
git status --short src/App.jsx
echo "(vide = restaure)"
