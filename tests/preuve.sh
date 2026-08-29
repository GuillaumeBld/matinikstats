set -u
run() { CI=1 npx playwright test -g "$1" 2>&1 | tail -3 | tr '\n' ' '; echo; }

echo "=== 1. empilement du fond : z-index -1 -> 0 ==="
sed -i '' 's|position: fixed; inset: 0; z-index: -1; overflow: hidden; background: var(--bg);|position: fixed; inset: 0; z-index: 0; overflow: hidden; background: var(--bg);|' src/App.jsx
run "titres de section"
git checkout -q src/App.jsx

echo "=== 2. titre du heros suivant le theme ==="
sed -i '' 's|\.p4t-hero-first \.p4t-hero-title { color: #F6F0E4;|.p4t-hero-first .p4t-hero-title { color: var(--ink);|' src/App.jsx
run "titre du héros contraste"
git checkout -q src/App.jsx

echo "=== 3. carte de partage reprenant les jetons du theme ==="
python3 - <<'PY'
p='src/App.jsx'; s=open(p).read()
s = s.replace("        .p4t-sharecard {\n          --ink: #F6F0E4;\n          --ink-dim: #A2937E;\n          --amber: #FFB020;\n        }\n", "")
open(p,'w').write(s)
PY
run "carte de partage contraste"
git checkout -q src/App.jsx

echo "=== 4. var() sur un contexte canvas ==="
sed -i '' "s|ctx.fillStyle = SHARE.amber;|ctx.fillStyle = 'var(--amber)';|" src/App.jsx
run "variable CSS passée à un contexte canvas"
git checkout -q src/App.jsx

echo "=== etat restaure ==="; git status --short src/App.jsx | head -2; echo "(vide = restaure)"
