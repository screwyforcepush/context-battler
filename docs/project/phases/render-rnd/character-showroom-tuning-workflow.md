# Character Showroom Tuning Workflow

This is the handoff doc for iterating on character design in the Godot showroom, especially the current `glitch_reaper` prototype.

The important direction is: use the existing Mesh2Motion humanoid as the animation carrier, author the identity-defining character parts in Blender, then use Godot/showroom for import, animation playback, comparison, toggles, and web export. Avoid trying to make a readable final face by painting or procedurally drawing on the old mannequin mesh.

## Current Prototype

App root:

```bash
cd throwaway-prototypes/d-full-match
```

Primary runtime asset:

```text
shared-harness/art-kit/characters/generated/glitch_reaper.glb
```

Authoring and preview artifacts:

```text
dist/characters/glitch_reaper/glitch_reaper.blend
dist/characters/glitch_reaper/glitch_reaper.glb
dist/characters/glitch_reaper/glitch_reaper_contact_sheet.png
dist/characters/glitch_reaper/glitch_reaper_report.json
```

Showroom hook:

```text
src/Showroom.gd
```

The showroom loads `GLITCH_REAPER_PROTOTYPE_PATH`, currently:

```gdscript
res://shared-harness/art-kit/characters/generated/glitch_reaper.glb
```

The prototype is displayed as its own station in the row. It is not a normal persona instantiated through `EquipmentMeshAttachment`; the skin/gore/weapon/armour toggles apply to the persona row, while the animation buttons also drive the Glitch Reaper through its own `AnimationPlayer`.

## Fast Iteration Loop

1. Edit the Blender asset compiler:

```text
scripts/build-glitch-reaper-blender.py
```

2. Build the `.blend`, GLBs, previews, and first report:

```bash
npm run build:glitch-reaper:blender
```

3. Inspect the contact sheet:

```text
dist/characters/glitch_reaper/glitch_reaper_contact_sheet.png
```

Do this before Godot import. The contact sheet is the cheapest way to catch bad silhouette, unreadable eyes, goofy head shape, missing props, or overbright emission.

4. Import and audit in Godot:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm run import:glitch-reaper
```

5. Run the project audits:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm test
```

6. Export the web build so the running showroom can see the updated runtime asset:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm run build
```

Do not use a headless browser to render the showroom in the VM for visual review. It burns resources and the user can see the running server locally. Blender preview renders and Godot CLI validation are fine.

## Blender Compiler Levers

File:

```text
scripts/build-glitch-reaper-blender.py
```

High-level flow:

```text
import base GLB
make materials
assign carrier material
build authored modules
export dist GLB
export Godot runtime GLB
render previews/contact sheet
save .blend
write report
```

Main module builders:

```text
build_head_module()
build_torso_module()
build_limb_modules()
build_gore_modules()
build_surface_breakup_modules()
build_glitch_modules()
```

Useful helper levers:

```text
add_box()
add_sphere()
add_cone()
add_torus()
add_cylinder()
add_blade()
polish_mesh()
parent_to_bone()
```

Material levers:

```text
make_materials()
make_mat()
attach_texture_to_material()
make_material_image()
texture_color()
```

Current material groups:

```text
GR_blackened_metal
GR_dark_cavity
GR_infernal_red_emissive
GR_gore_flesh
GR_cyan_glitch
GR_scraped_raw_metal
```

The current pass embeds small 256px procedural maps. This worked better than flat PBR constants because it gives the black metal, gore, glow, cyan glitch, and raw scrape surfaces some breakup without external texture dependencies.

Geometry placement levers:

```text
bone name
object name
local location
local rotation
local scale/size
material
bevel width
bevel segment count
primitive resolution
```

Example pattern:

```python
add_box(
    armature,
    "head",
    "glitch_reaper_head_A_red_eye_slit",
    (0.0, 0.145, 0.174),
    (0.168, 0.014, 0.014),
    glow,
    (-8, 0, 0),
    bevel=0.004,
)
```

Naming matters. The audit expects module tokens such as:

```text
glitch_reaper_head_A_skull_shell
glitch_reaper_head_A_red_eye_slit
glitch_reaper_rib_core_molten_heart
glitch_reaper_execution_blade_body
glitch_reaper_flayed_gore_drape
glitch_reaper_cyan_data_tear
```

Do not rename those without updating `scripts/audit-glitch-reaper-prototype.gd`.

## Showroom Levers

File:

```text
src/Showroom.gd
```

Prototype asset path:

```gdscript
const GLITCH_REAPER_PROTOTYPE_PATH := "res://shared-harness/art-kit/characters/generated/glitch_reaper.glb"
```

Prototype scale:

```gdscript
const GLITCH_REAPER_PROTOTYPE_SCALE := 0.93464883
```

Station spacing and synthetic showroom map size:

```gdscript
const STATION_SPACING := 1.6
const SAMPLE_MAP_WIDTH := 32
const SAMPLE_MAP_HEIGHT := 12
```

Animation fallbacks:

```gdscript
const GLITCH_REAPER_CLIP_FALLBACKS := {
    "idle": [...],
    "walk": [...],
    "run": [...],
    "attack_unarmed": [...],
    "attack_armed": [...],
    "loot": [...],
    "take_hit": [...],
    "death": [...],
}
```

The showroom animation buttons call `_play_glitch_reaper_animation(kind)`, which picks the first matching clip from the fallback list. If an animation appears missing in the showroom, check this mapping before assuming the GLB lost clips.

The layer toggles are useful for comparing the normal persona row:

```text
Skin
Gore
Weapons
Armour
```

They do not currently toggle modules inside the generated Glitch Reaper GLB. If you want togglable Glitch Reaper layers later, build them either as separate Godot scene children or add a runtime controller that hides module name groups.

## Validation Tools

Blender build:

```bash
npm run build:glitch-reaper:blender
```

Godot import/audit:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm run import:glitch-reaper
```

This runs:

```text
scripts/import-glitch-reaper-prototype.gd
scripts/audit-glitch-reaper-prototype.gd
```

The audit checks:

```text
GLB resource exists
resource imports as PackedScene
scene instantiates
Skeleton3D exists
required bones exist
idle/walk/run/attack resolve and play
required authored module names exist
head/red-eye/gore/glitch identity modules are present
```

Full test suite:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm test
```

Web export:

```bash
GODOT_BIN=/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64 npm run build
```

Expected web outputs:

```text
dist/index.html
dist/index.pck
dist/index.wasm
```

The export path preserves `dist/characters` and imports the generated runtime GLB from `shared-harness/art-kit/characters/generated`.

## What Worked Well

Blender-side authored modules worked. Bone-parented rigid meshes are crude but fast, robust, and preserve the Mesh2Motion skeleton and animation clips.

Covering the original head worked better than deleting it. The old head remains as part of the skinned carrier, but the face is visually covered by the skull/visor shell, faceplate, jaw assembly, brow, and neck collar.

Large silhouette pieces worked. The red slit face, crown plates, rib furnace, blade arm, pauldrons, gore drapes, and cyan data tears are readable from the showroom camera.

Narrow emissive eye slits worked better than separate eyeball props. Spheres read like goggles or stuck-on eyes; a visor slit reads more like a deliberate mask.

Bevels and weighted normals helped. `polish_mesh()` reduces the obvious cube/low-poly read on boxes and primitive parts.

Embedded small material maps helped. Procedural maps for blackened metal, gore, glow, glitch, and raw scrapes give surface breakup without external texture bookkeeping.

The contact sheet is the fastest visual review loop. It catches most bad art-direction problems before Godot import.

Godot CLI import/audit is good for contract checks. It catches missing bones, lost animations, missing module tokens, and failed imports without needing browser rendering.

## What Did Not Work Well

Primary UV face painting did not work. The source mesh UVs are not a good substrate for readable facial placement.

UV2 face overlays did not work. The face/body detail either landed at the wrong scale or was not visibly placed where expected.

Shader/procedural-coordinate faces did not work as final art. They can create color/glow effects, but they do not solve topology, UV placement, or coherent head shape.

Vertex-color eyes/mouth did not work. The source topology is too coarse for crisp facial features, and the result smears.

Tiny face props did not work. Eye/mouth/jaw pieces attached to the old head looked like stickers or goggles rather than a coherent head.

A simple replacement sphere head did not work. Without hard plates, cavities, brow, jaw, and silhouette breakup, it reads like a rounded placeholder.

Runtime Godot authoring is the wrong place for identity-defining face work. `EquipmentMeshAttachment.gd` is useful for runtime swaps, toggles, equipment, and existing persona skins, but it should not be the canonical authoring path for the Glitch Reaper face/head.

Static decorative portal rings were unclear in the showroom. If portal VFX return, they need animation, spawn timing, and/or attachment to the character moment, not just floor props.

The showroom layer toggles do not affect the Glitch Reaper prototype. Do not use them to judge whether generated GLB materials/modules changed.

## Practical Tuning Advice

Change one major visual target per pass. Examples: head silhouette, chest read, gore density, emissive intensity, material roughness, or body surface breakup.

Prioritize gameplay-distance read over close-up detail. If the contact sheet does not show the face, core, weapon, and silhouette clearly, tiny texture improvements will not fix it.

Keep the eyes simple and bright. A red slit, a small vertical throat glow, and a chest furnace are more readable than many small facial details.

Use cyan sparingly. Cyan glitch accents work as contrast against red infernal emission, but too many cyan chunks make the model look like random blocks.

Use gore as separate geometry. Drapes, membranes, tendon lines, and hooked tags read better than trying to paint the whole base body fleshy.

Prefer opaque geometry over transparency. Web/WASM and Godot import are more predictable with mostly opaque parts.

For smoother shape, prefer higher primitive resolution plus bevel/weighted normals. For boxes, bevels are usually enough. For skull/helmet curves, increase sphere segments/rings or replace the primitive with a real authored mesh.

If the asset starts looking too busy, reduce cyan and tiny red bars before removing the big silhouette pieces. The big pieces carry the character identity.

## Current Known Debt

The prototype is heavy for runtime optimization: about 207 generated modules, 208 meshes, 6 materials, 5 embedded 256px maps, and a roughly 15MB runtime GLB. That is acceptable for art-direction review, not ideal for production.

Many modules are separate draw-call candidates. A production pass should join meshes by bone/material or export combined submeshes per module group.

Rigid bone parenting can clip during extreme animations. It is acceptable for MVP review, but future cloth/gore pieces should be weighted or designed around animation poses.

The original head is covered, not removed. That preserves the rig/carrier, but it means the head module is a visual cover assembly rather than a clean replacement mesh.

There is no LOD pipeline yet.

There is no multi-variant spec-driven generation yet. The current compiler is one-off for `glitch_reaper`, though its module functions can become the seed for variant JSON specs.

## Best Next-Step Options

For visual polish:

```text
author/import a better helmet/skull mesh
reduce the rounded carrier-head read
make the faceplate more skull-like and less box-like
add better rib/torso asymmetry
improve gore drape shapes with tapered custom meshes
rebalance red emission down if showroom bloom overwhelms detail
```

For pipeline polish:

```text
join generated meshes by material/bone
move constants into a JSON spec
add variant IDs beyond glitch_reaper
write a module visibility/group manifest
add LOD generation
add a turntable render
make the report update fully automatic after Godot/web validation
```

For showroom polish:

```text
add a Glitch Reaper layer toggle group
add a close-up camera preset for the prototype station
add a per-prototype material intensity slider
add a spawn/attack preview pose lane
```

