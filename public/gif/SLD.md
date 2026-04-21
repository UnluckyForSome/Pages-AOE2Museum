# SLD notes

Quick reference for the slice of the SLDX format the /gif/ DE tab supports.
Canonical spec:
[openage/doc/media/sld-files.md](https://github.com/SFTtech/openage/blob/master/doc/media/sld-files.md).
The pure-JS parser+renderer lives at
[worker-sld.js](worker-sld.js) and is a DataView-based port of
[SLD Extractor 1.4 / sld.js](newexamples/SLD%20Extractor%201.4/sld.js).

## File lookup

Unlike SLPs (where the mapping is `{Unit, Action} -> numeric ID`), DE sprites
are looked up by a composite filename key:

```
<prefix>_<unit>_<action>_<zoom>.sld
```

e.g. `a_alfred_deathA_x2.sld` for Unit=`alfred`, Action=`deathA`, Zoom=`x2`
with prefix `a_`. The prefix encodes the entity family (`a_`, `u_cav_`,
`b_`, ...) and is stored as part of the original key in
[`mapping/sld_mapping.json`](mapping/sld_mapping.json).

The `/gif/` UI presents `unit -> action -> zoom` as a cascading picker; only
zoom levels that exist for the selected `{unit, action}` pair are enabled.

## Versions

Accepted header: `SLDX` signature, version `4`. The app rejects any other
signature; other versions have not been observed in released DE data.

## Frame layers

Each frame declares its layer set with the `frame_type` bitfield:

| Bit mask | Layer              | Decoder           | Rendered? |
|:--------:|:-------------------|:------------------|:---------:|
| `0x01`   | Main graphics      | DXT1 -> RGBA      | yes       |
| `0x02`   | Shadow             | DXT4 -> grayscale | yes (toggleable) |
| `0x04`   | "???" / tile mask  | skipped           | no        |
| `0x08`   | Smudge / damage    | skipped           | no        |
| `0x10`   | Playercolor mask   | DXT4 -> grayscale | yes       |

The `0x04` tile-mask refinement (what [`adjustByUnknownLayer`](newexamples/SLD%20Extractor%201.4/sld.js)
does in the original Chinese extractor) is consumed to keep the byte cursor
aligned but not applied; sprites that lean heavily on the "reuse previous
block" semantics may show minor artefacts on inherited blocks. Full
damage-mask support is future work.

## Directions

DE sprites store **16 directions**, one per slice, with no mirroring. Slice
ordering is counter-clockwise starting at **E**:

| Slice | Bearing | Slice | Bearing |
|:-----:|:-------:|:-----:|:-------:|
| 0     | E       | 8     | W       |
| 1     | ESE     | 9     | WNW     |
| 2     | SE      | 10    | NW      |
| 3     | SSE     | 11    | NNW     |
| 4     | S       | 12    | N       |
| 5     | SSW     | 13    | NNE     |
| 6     | SW      | 14    | NE      |
| 7     | WSW     | 15    | ENE     |

The UI dropdown presents the bearings in a human-friendly S→W→N→E order but
each `<option value>` is the raw stored-slice index, so the worker's
`startIdx = directionIndex * fpd` formula stays a straight lookup.

`framesPerDirection = numFrames / 16`, with one AoE2:DE wrinkle: most
military walk / attack / death sprites ship with **one extra trailing
"reference" frame** &mdash; e.g. 481 frames = 30 &times; 16 + 1. The worker
recognises `numFrames % 16 == 1` and drops that last frame, so a 481-frame
sprite decodes as 16 directions of 30 frames each.

If a file matches neither `N % 16 == 0` nor `N % 16 == 1` (e.g. static
decorations, single-frame entities) the worker falls back to rendering every
frame as a single reel.

## Player tint (approximation)

No official DE player-color palette is vendored. Instead, each swatch in
`/gif/assets/{1..8}.png` provides a single team RGB (see
[team-colors.js](team-colors.js)) and each player-mask pixel with grayscale
value `m` blends the underlying main pixel towards a luminance-weighted team
colour:

```
lum    = 0.299 * R_main + 0.587 * G_main + 0.114 * B_main
target = team_rgb * (lum / 255)
out    = lerp(main_rgb, target, m / 255)
```

This matches the approach used in the `ChineseWorkingMcSimpleButArtefacts`
extractor and is visually close enough for GIF rendering. Pixel-identical
playercolor reproduction would require shipping the per-player 256-entry
gradient palettes from DE; that's a future upgrade.

## DXT1 (main graphics)

Each 4x4 block stores two reference colors in R5G6B5 plus a 32-bit index
array (2 bits per pixel) that looks up one of four interpolated colors.
When `color0 <= color1`, index 3 is treated as fully transparent; otherwise
the block is fully opaque.

## DXT4 (shadow / playercolor)

Each 4x4 block stores two reference grayscale colors plus 48 bits of
indices (3 bits per pixel) into an 8-entry lookup. When
`color0 <= color1`, entries 6 and 7 are forced to `0` (fully empty) and
`255` respectively; otherwise all 8 entries are interpolated.

## Hotspot alignment

Identical to SLP: each frame's `canvas_hotspot_*` defines a pivot. Every
frame in the selected direction is blitted into a single canvas whose pivot
is the union max so the sprite never jitters across the animation.
