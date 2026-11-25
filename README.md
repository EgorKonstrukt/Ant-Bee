# Ant & Bee — Langton's Ant 2D & 3D Simulator

High-performance, hardware-accelerated Langton's Ant (2D) and Bee (3D cubic lattice) simulator.
Google Material Design 2 UI, all in English, single static site — no build step.

## Run

Any static server works, e.g.:

```bash
npx serve .
# or
python -m http.server 8000
```

Then open `http://localhost:8000` (or `:3000`).

> 3D view loads Three.js from CDN (`unpkg.com`). 2D works fully offline.

## Features

- **2 modes** — 2D Ant grid (128–1024) and 3D Bee cube (32³–128³), switchable via top tabs (keys `1`/`2`).
- **Custom rules** — any length 2–16 states (`L/R/U/C` in 2D, `F/B/L/R/U/D` relative turns in 3D), per-state color picker + turn dropdown, add/remove states, rule-string editing with validation. Any turn edit resets the world fresh.
- **Rules** — documented turmites, not invented ones. 2D: the original 1986 `LR` highway ant, symmetric `LLRR`, chaotic `RLR`, plus `LRRRRRLLR` (textured square), `LLRRRLRRRLLL` (travelling triangle), `LRRRRLLLRRRL` (logarithmic spiral square) and the `LLRRRLL` / `LLRLRRLL` infinite-highway family (Lutfalla, "Ants on the highway", 2024). 3D presets follow Hamann's 2003 three-dimensional ant definition (`Complex Systems` 14(3)): `LR`, `LLRR`, `RLR` lifted to the cubic lattice, the `LRRRRRLLR` analog and the full-turn-set `FRLUD` coral bee.
- **Unified effects (GPU, zero sim cost)** — same structure in 2D and 3D: a shared **glow color** picker (drives the 2D trail + ant light and the 3D appear-flash + bee halo), bloom (toggle + strength + spread/radius + threshold), appear glow (toggle + time + flash intensity), agent light, plus atmosphere extras (2D vignette, 3D fog/opacity). 3D flashes on every color change with a cooldown instead of burning forever.
- **Motion** — staggered card entrances, Material ripple on every control, play/pause icon morph, dialog pop, `prefers-reduced-motion` respected.
- **Autostart** — the classic `LR` highway starts running on load, so the grid is alive immediately; loading any preset/turn edit resets the world fresh.
- **Speed** — 1 to 1,000,000 steps/frame (log slider) + Turbo mode (runs batches until a 12 ms frame budget). Live steps/s, FPS, alive cells, agent count.
- **Tools** — Pan / Paint / Place agent / Erase, paint-state swatches, click-drag painting, right-click erase, wheel zoom, pinch zoom, follow-agent, wrap (torus) vs infinite (2D auto-centering) / bounce (3D).
- **Multi-agent** — up to 12 ants/bees, placed with the agent tool or double-click (3D).
- **Share & persist** — URL hash encodes rule/colors/speed/grid, Copy-link button, localStorage autosave, JSON export/import, PNG snapshot.
- **Material Design 2** — top app bar, cards, FABs, switches, sliders, dialogs, light/dark theme, Roboto + Material Icons.

## Engine (why it is fast)

- Flat `Uint8Array` grids, `Uint8` turn codes, mask-based wrapping (`& (N-1)`), branch-lean inner loops, zero allocation per step.
- Measured: ~60M 2D steps/s, ~20M 3D sim steps/s (desktop).
- 2D rendering: single WebGL `RGB` texture (nearest), fullscreen quad with pan/zoom in the vertex shader, full re-upload only when dirty.
- 3D rendering: Three.js `InstancedMesh` voxels, sparse `Map<cell → instance>` with swap-remove, one dirty-flag byte per cell + single linear sync scan per frame (no per-step GC).

## Files

- `index.html` — M2 layout, drawer, stage, dialogs.
- `style.css` — Material Design 2 theme (light/dark).
- `app.js` — sim + render + UI (ES module, lazy Three.js import).
