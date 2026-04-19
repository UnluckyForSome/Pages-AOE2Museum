# SLP notes

Quick reference for the slice of the SLP format the /gif/ app supports. The
canonical spec lives at
[openage/doc/media/slp-files.md](https://github.com/SFTtech/openage/blob/master/doc/media/slp-files.md);
this document only records the conventions this app commits to.

## Versions

Accepted: `2.0N`, `2.0P`, `3.0` headers (AoK, TC, SWGB, HD). All share the
same command loop. Definitive Edition `.sld` files are not supported by this
tab &mdash; see the DE tab stub.

## Directions

AoE2 military graphics store **5 directions** per SLP:

| Stored slice | Facing |
|:------------:|:------:|
| 0            | S      |
| 1            | SW     |
| 2            | W      |
| 3            | NW     |
| 4            | N      |

The remaining three compass directions are produced by horizontally flipping an
already-rendered frame:

| UI direction | Source slice | flipX |
|:------------:|:------------:|:-----:|
| S            | 0            | no    |
| SW           | 1            | no    |
| W            | 2            | no    |
| NW           | 3            | no    |
| N            | 4            | no    |
| SE           | 1            | yes   |
| E            | 2            | yes   |
| NE           | 3            | yes   |

`framesPerDirection = numFrames / 5`. If a file doesn't divide evenly (e.g.
buildings with a single frame, projectiles), the app falls back to rendering
all frames as a single "direction" and surfaces a note in the status bar.

## Player colors

Indices `16..143` of the 256-entry `Standard_Graphics.pal` palette are the
**player-color band**, 16 entries per player. A player-colored pixel stored
as index `i` resolves to the RGB at

```
resolved = palette[i + 16 * player]
```

where `player` is 1..8 matching the UI swatches. When `flipX` is true the
hotspot is remapped to `width - 1 - hotspotX` so the sprite stays aligned
after mirroring.

## Draw commands implemented

| Opcode       | Name              | Action                                         |
|:-------------|:------------------|:------------------------------------------------|
| `..00` low   | Color list        | Emit N palette indices straight                 |
| `0x02`       | Color list ext    | Same, 12-bit count                              |
| `..01` low   | Skip              | Transparent run                                 |
| `0x03`       | Skip ext          | Transparent run, 12-bit count                   |
| `0x06`       | Player color list | N player-colored indices                        |
| `0x07`       | Fill              | RLE of a single palette index                   |
| `0x0A`       | Player fill       | RLE of a single player-colored index            |
| `0x0B`       | Shadow            | Flat semi-transparent black (placeholder)       |
| `0x0E/0x40`  | Outline 1         | 1-pixel black outline                           |
| `0x0E/0x60`  | Outline 2         | 1-pixel black outline (alt)                     |
| `0x0E/0x50`  | Fill outline 1    | N outline pixels                                |
| `0x0E/0x70`  | Fill outline 2    | N outline pixels                                |
| `0x0F` low   | End of row        | Advance one row                                 |

Outline pixels are drawn only when the "Draw behind-building outline" toggle
is on. Shadow support is a flat approximation; full shadow blending is
future work.

## Hotspot alignment

Each SLP frame carries its own `(hotspotX, hotspotY)` pivot. The app unions
these pivots across the selected direction's frames to build a single canvas
so every GIF frame shares the sprite's anchor point. This is what keeps the
unit from jittering around between animation frames.
