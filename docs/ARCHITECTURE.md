# THRESHOLD — Architecture

A top-down Backrooms tactical shooter running in the browser on WebGL2. Single-page build,
no engine dependency. Source is plain ES modules bundled with esbuild (`node build.mjs`).

## Module map

| Path | Responsibility |
|---|---|
| `src/core/math.js` | Seeded hashing, RNG, segment–circle tests |
| `src/core/input.js` | Keyboard/mouse with per-frame edge detection |
| `src/world/world.js` | Infinite procedural level, map window streaming, grid DDA, distance field |
| `src/world/nav.js` | BFS flow fields (to the player, and to the player's predicted position) |
| `src/render/shaders.js` | All GLSL |
| `src/render/renderer.js` | Deferred pipeline, gore render targets, material upload |
| `src/gore/gore.js` | Floor gore clipmap, wall gore atlas, pools, drips, footprints |
| `src/combat/ballistics.js` | Caliber energy model: penetration, ricochet, over-penetration |
| `src/combat/gunsmith.js` | Platforms, attachment catalogue, stat composition, recoil patterns |
| `src/player/operator.js` | Uniform / rig / headgear, persistent wear, pouch layout |
| `src/ai/horde.js` | Structure-of-arrays entity store, pack AI, dismemberment, limbs, droplets |
| `src/audio/audio.js` | Asset-only audio, path-based propagation, image-source reflections |
| `src/assets/manifest.js` | Every audio and texture slot, filename → slot matching |
| `src/assets/loader.js` | Manifest fetch, drag-and-drop, IndexedDB persistence |
| `src/ui/menuscene.js` | Raymarched CRT room |
| `src/ui/terminal.js` | Terminal pages: main, Arsenal Archive, Personnel File, System Diagnostics, report |
| `src/game.js` | One incursion: ties every system together, HUD |
| `src/main.js` | Boot, state machine (menu → transition → game), frame loop |

## World

- Units are meters. Tiles are 0.5 m; cells are 16×16 tiles (8 m rooms); walls are 2.7 m.
- Every cell owns its top and left edge. An edge is open, drywall, or concrete, and an edge
  that exists always has a 1.5–2.5 m doorway, so the infinite plane is fully connected.
- Cell kinds: carpeted office, pillar hall, concrete utility room. Vents sit inside walls.
- A 128×128 tile window (64 m) follows the player. It is re-centred when the player is
  12 m off-centre, uploaded as an RGBA8 texture, and a 512² distance field (chamfer) is rebuilt.

## Render pipeline (WebGL2, deferred)

1. **Shadow atlas** — 512 angles × 40 lights, R32F. Each texel is the distance from a light to
   the first wall along that angle (grid DDA in the fragment shader). Walls are full height,
   so 2D occlusion is exact.
2. **World G-buffer** — per pixel, a perspective ray from an eye 14 m up toward the floor point.
   Only the part of the ray below wall height can hit anything (≤ ~12 grid cells), so the walk
   is cheap. Output: wall tops (cut section), wall faces with true height, or floor.
   Albedo+roughness / normal+AO / position (RGBA16F) plus depth for later occlusion.
   - Normal mapping: floor uses world-aligned TBN; faces use (along-wall, up, face normal).
   - AO: floors sample the distance field around the point; faces darken toward the floor
     and inside corners.
3. **Entities** — instanced quads; each fragment evaluates a signed-distance skeleton
   (2-bone IK limbs, gait from phase, twitch noise) and writes the G-buffer. Height-correct
   perspective and depth, so walls occlude creatures correctly.
4. **Lighting** — Blinn-Phong over up to 40 lights (points + flashlight spot), 5-tap soft
   shadow from the atlas, inverse-square falloff.
5. **Emissive** — troffer panels, tracers, sparks, laser beam and dot (depth tested).
6. **Volumetric fog** — quarter resolution, 10 jittered steps along the view ray below the
   ceiling, 3D noise density, shadowed in-scatter from the 14 nearest lights.
7. **Compose + dust** — lit × transmittance + in-scatter; 2,500 dust motes lit by sampling the
   lit buffer at their projected position.
8. **Blur pyramid** — three levels, shared by bloom and the gas-mask condensation blur.
9. **Post** — ACES, chromatic aberration, NVG intensifier (gain, scintillation, tube
   vignette), mask fog that pulses with breathing, damage vignette, grain.

## Gore

- **Floors:** 2048² RGBA8 toroidal map covering 64 m (32 texels/m), managed in 4 m pages that
  are wiped only when their world page scrolls out. R = thickness, G = paint time (drying
  shade and gloss), B = bullet damage.
- **Walls:** 2048² atlas of 16×96 texel slots (0.5 m × 3 m at 32 texels/m), one slot per wall
  face that has been hit, found through an RGBA16UI per-tile indirection texture
  (4 faces per tile). Splats are scissored into their slot.
- **Shapes** (shader-painted, MAX blended): directional impact (core + forward cone of
  droplets with speed-dependent tails), spreading pool (repainted as it grows), drip runs
  (stick-slip simulation on walls ending in a floor pool), limb smears, boot prints,
  hound hand prints, bullet holes.
- **Footprints:** a coarse CPU mirror of blood amounts. Stepping in blood loads the boot;
  each step prints and decays.
- **Dismemberment:** each creature has 5 severable parts with their own damage. Severed parts
  become physical limbs that slide, smear and settle permanently (cap 1,500); stumps keep
  bleeding. Enough energy in a short window tears the whole body apart.

## Ballistics

Each round carries kinetic energy (`½mv²`, barrel velocity multiplier applied).
- **Drywall:** penetrable; cost scales with crossing length and 1/cos(incidence).
- **Concrete / metal:** below the caliber's critical grazing angle, a ricochet chance that
  rises toward grazing, with partial energy kept; otherwise spall and stop.
- **Flesh:** damage ∝ (E/E0)^0.6, head ×2.2, energy loss per body; over-penetration continues.

## Gunsmith

Platforms (MK-9 9mm, Kestrel 5.56, Vorona 7.62, Breach-12 pump, P9, M45 .45) with slots:
barrel (velocity, flash, **sound radius → AI hearing**), optic (zoom, aim offset, ADS time),
laser (visible or IR — the IR beam only shows under NVG), weapon light (cone, range, output),
grip and stock (vertical/horizontal recoil, ADS speed), magazine (capacity, reload, weight,
and **pouch shape on the rig**). Each platform has a repeatable horizontal recoil pattern.

## Operator

The uniform, plate carrier or chest rig, pouches and headgear are drawn by the same SDF
shader as the horde. Pouches follow the loadout (rifle/drum/shell/pistol/med) and go flat as
reserve ammo runs out. Wear (blood, tears, grime, blood-caked boots) persists in
localStorage across runs until a new uniform is issued. Gas masks fog with exertion and
breathing; NVG swaps the post chain.

## Horde

- Structure-of-arrays typed arrays (capacity 4,096), free list, counting-sort spatial hash
  over the map window, staggered line-of-sight checks.
- **Pack roles:** chaser (flow field), flanker (slides out of the player's aim), cutter
  (second flow field from the predicted position), vent crawler (hounds enter a vent and
  surface from one near the player, out of sight).
- **Behaviours:** Bacteria freeze while lit by your weapon light; Skin-Stealers walk like
  people until close, then run.
- Gunshots alert every pack within the weapon's sound radius, measured as walking distance.
- Measured: ~2 ms/frame CPU update with 700 live entities (headless Chromium, software GL).

## Audio and assets — real recordings only

No sound, music, impulse response or texture is synthesized. Every one of the 47 audio and
12 texture slots is filled only by a file you provide. An empty audio slot plays nothing;
an empty material falls back to a flat graybox colour. Lighting, fog, gore shapes and CRT
effects are rendering, not texture assets. Real blood masks can be added as slots later.

**Spatial propagation:** with line of sight, the sound comes from its true position. Without
it, the sound descends the player's flow field from the source until a cell sees the
listener, so it seems to come from that doorway. Attenuation uses the full walking path,
and a low-pass grows with the path's extra length. Gunshots add up to four first-order
image-source reflections from walls around the listener, absorbed by surface
(concrete > metal > drywall). Late reverb uses a recorded impulse response if one is loaded.

### Integration workflow

1. **Source** recordings and scans you have the rights to. Field recordings work best:
   - an HVAC plant room
   - fluorescent ballasts and starters
   - indoor concrete-range gunfire
   - bolt and charging-handle foley
   - meat and cabbage foley for flesh
   - processed human voice for screams

   CC0 libraries such as Poly Haven, ambientCG and Freesound (filter to CC0) also work.
   They were blocked by this build environment's network policy, so none are bundled.
2. **Name** each file after its slot (`gun.9mm.fire_01.wav`, `mat.carpet.normal.jpg`).
   Several variants per slot rotate without repeats. SYSTEM DIAGNOSTICS → LIST EMPTY SLOTS
   shows every slot with what to record.
3. **Load** them one of three ways. They persist in IndexedDB for that browser.
   - Drop files or folders onto the window.
   - Use LOAD ASSET FILES.
   - Publish them next to the page with `assets/manifest.json`:
     `{ "files": ["assets/gun.9mm.fire_01.wav", ...] }`.
4. **Textures:** albedo + roughness are packed into one RGBA texture (roughness in alpha);
   use OpenGL-convention normal maps.

## Known limits

- Creatures do not cast shadows (walls do). Gore paints at most 26 m from the camera.
- Steering follows flow fields plus separation; at very high densities packs can stack up.
- Needs WebGL2 with `EXT_color_buffer_float`. Mouse and keyboard only.
- Verified in headless Chromium (software GL) only; real-GPU frame rate not yet measured.
