// Centre-pixel RGB samples from /gif/assets/1.png ... /gif/assets/8.png.
// Used as the "team tint" target for SLD player-color masks: each mask pixel
// with grayscale value V blends the underlying main-graphic pixel towards a
// luminance-scaled team RGB.
//
// Order is player 1..8, index 0 == player 1.
export const TEAM_COLORS = [
  [0,   0,   255], // 1 - blue
  [255, 0,   0  ], // 2 - red
  [0,   255, 0  ], // 3 - green
  [255, 255, 0  ], // 4 - yellow
  [0,   255, 255], // 5 - cyan
  [255, 0,   255], // 6 - magenta
  [228, 180, 121], // 7 - tan
  [255, 130, 1  ], // 8 - orange
];

export function teamColor(player) {
  const i = Math.max(1, Math.min(8, player | 0)) - 1;
  return TEAM_COLORS[i];
}
