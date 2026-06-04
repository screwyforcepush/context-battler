# Character Authoring Library

This directory holds small source assets for headless character-authoring scripts. These files are inputs for integrated mesh edits, vertex-color masks, procedural materials, and QA renders. They are not runtime showroom assets.

Critical rule: assets in this library must not be stapled onto a character face as detached props. Anatomy and mask sources should be used to modify the character mesh, drive material layers, or bake texture masks. Detached face plates, stickers, floating gore panels, and overlay meshes are not valid uses.

## Layout

- `anatomy/` - source references or future low-poly helper meshes for skull, jaw, facial muscle planes, tendon strands, teeth, and eye-related anatomy. These should be used for sculpting, retopology, deformation guides, or baked/integrated geometry.
- `materials/` - source notes and future procedural material definitions for skin, wet muscle, matte bone, oxidized metal, blood, patina, and restrained emissive fissures.
- `masks/` - small grayscale procedural masks for texture packing and vertex/material blend experiments.
- `qa/lighting/` - reusable lighting notes or future HDRI/rig definitions for contact sheets and diagnostic renders.

## Included Masks

The current masks are deterministic 512x512 grayscale PNGs. They are intentionally modest so they stay repo-friendly while the pipeline is still experimental.

- `masks/cellular_noise_512.png` - cellular breakup for corrosion, necrotic skin mottling, and uneven transition zones.
- `masks/tear_edge_512.png` - torn-edge banding for skin-to-muscle reveal masks or wound-border erosion.
- `masks/vein_noise_512.png` - branching vein/tendon linework for subdermal detail, wetness modulation, or normal-map experiments.
- `masks/clot_breakup_512.png` - blotchy breakup for blood clot, grime, or wet/dry material variation.

Suggested packed atlas convention for future generated textures:

- `R` = skin to muscle blend
- `G` = wetness
- `B` = exposed bone
- `A` = blood or clot breakup

Keep additions deterministic, licensed for local use, and documented here before agents rely on them.
