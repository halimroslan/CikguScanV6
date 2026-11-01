# anatomy.md

> Auto-maintained by OpenWolf. Last scanned: 2026-11-01T09:05:28.630Z
> Files: 36 tracked | Anatomy hits: 0 | Misses: 0

> Project structure index. Auto-maintained by OpenWolf hooks and daemon.
> Run `openwolf scan` to generate, or wait for the first Claude Code session.
> Status: Pending initial scan

## ./

- `.gitignore` — Git ignore rules (~45 tok)
- `.ignore` — graft's cards are gitignored but should stay greppable: ripgrep reads (~48 tok)
- `AGENTS.md` — OpenWolf (~75 tok)
- `CLAUDE.md` — OpenWolf (~99 tok)
- `eslint.config.js` — ESLint flat configuration (~58 tok)
- `find-images.mjs` — Declares walk (~158 tok)
- `firebase-applet-config.json` (~122 tok)
- `firebase-blueprint.json` (~213 tok)
- `firestore.rules` — isSignedIn: isVerifiedEmail, existing, incoming + 4 more (~1030 tok)
- `fix-svg-back.cjs` — Declares fs (~274 tok)
- `fix-svg.js` — Declares fs (~529 tok)
- `GEMINI.md` — OpenWolf (~75 tok)
- `generate-icons.cjs` — sharp: createIcon, main (~222 tok)
- `generate-icons.mjs` — svgPath: generateIcons (~223 tok)
- `index.html` — CikguScan OMR (~18903 tok)
- `metadata.json` (~58 tok)
- `OMRImageProcessor.py` — OMRImageProcessor: perspective_correction, adaptive_binarization, verify_with_ai (~1292 tok)
- `package.json` — Node.js package manifest (~279 tok)
- `PROJECT_FLOW.md` — 🧭 PROJECT FLOW & LIVING ARCHITECTURE: CikguScan (OMR Smart Sheet Scanner) (~1340 tok)
- `README.md` — Project documentation (~136 tok)
- `restore.js` (~34 tok)
- `ROADMAP.md` — 🗺️ ROADMAP PEMBANGUNAN: CikguScan (Smart OMR Sheet Scanner PWA) (~1021 tok)
- `security_spec.md` — Security Spec (~290 tok)
- `tsconfig.json` — TypeScript configuration (~169 tok)
- `vercel.json` (~75 tok)
- `vite.config.ts` — Vite build configuration (~643 tok)

## dev-dist/

- `sw.js` — Copyright 2018 Google Inc. All Rights Reserved. (~825 tok)
- `workbox-7e5eb42b.js` — Claim any currently available clients once the service worker (~36984 tok)

## public/

- `test-icon.html` (~499 tok)
- `test-svg.html` (~478 tok)

## src/

- `App.tsx` — App (~34 tok)
- `firebase.ts` — Exports app, db, auth, googleProvider, storage (~169 tok)
- `index.css` — Styles: 3 rules, 10 vars, 1 media queries (~1077 tok)
- `main.ts` — showInstallButton: updateStatusHeader (~56877 tok)
- `main.tsx` (~66 tok)

## workspace/src/

- `firebase.ts` — Exports app, db (~71 tok)
