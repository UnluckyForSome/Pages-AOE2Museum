use genie_scx::{Scenario, ScenarioObject};
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen as swb;
use std::io::Cursor;
use wasm_bindgen::prelude::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(default)]
pub struct ParseOptions {
    /// Include full map tile grid (large).
    pub include_tiles: bool,
    /// Include placed objects (gaia + players).
    pub include_objects: bool,
    /// Include trigger system (can be large).
    pub include_triggers: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            include_tiles: true,
            include_objects: true,
            include_triggers: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct ParsedScenario {
    pub ok: bool,
    pub error: Option<String>,

    pub versions: VersionsOut,
    pub header: HeaderOut,

    /// `map.dimension` + `map.tiles` is the shape McMinimap expects.
    pub map: Option<MapOut>,
    pub players: Vec<PlayerOut>,
    pub gaia: Vec<ObjectOut>,
    pub triggers: Option<TriggersOut>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionsOut {
    pub format: String,
    pub header: u32,
    pub data: f32,
    pub triggers: Option<f64>,
    pub map: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct HeaderOut {
    pub version: u32,
    pub timestamp: u32,
    pub description: Option<String>,
    pub author_name: Option<String>,
    pub any_sp_victory: bool,
    pub active_player_count: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapOut {
    pub width: u32,
    pub height: u32,
    /// Compatibility field for McMinimap (expects square). We set this to `width` when square,
    /// else `max(width,height)`.
    pub dimension: u32,
    pub tiles: Option<Vec<TileOut>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TileOut {
    pub position: XY,
    pub terrain: u32,
    pub elevation: i32,
    pub layered_terrain: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PlayerOut {
    /// 1..N
    pub player_id: u32,
    /// 0..7 for McMinimap usage (best-effort clamp).
    pub color_id: u32,
    pub name: Option<String>,
    pub position: XYOpt,
    pub civilization: Option<i32>,
    pub objects: Vec<ObjectOut>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectOut {
    pub object_id: u32,
    pub class_id: u32,
    pub position: XY,
}

#[derive(Debug, Clone, Serialize)]
pub struct TriggersOut {
    pub present: bool,
    pub num_triggers: Option<u32>,
    pub version: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct XY {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct XYOpt {
    pub x: Option<i32>,
    pub y: Option<i32>,
}

fn obj_to_out(obj: &ScenarioObject) -> ObjectOut {
    let object_id: u32 = u16::from(obj.object_type).into();
    let x = obj.position.0.floor() as i32;
    let y = obj.position.1.floor() as i32;
    ObjectOut {
        object_id,
        class_id: 0,
        position: XY { x, y },
    }
}

fn js_err(msg: impl Into<String>) -> JsValue {
    JsValue::from_str(&msg.into())
}

#[wasm_bindgen]
pub fn parse_scenario(bytes: &[u8], options: JsValue) -> Result<JsValue, JsValue> {
    let opts: ParseOptions = if options.is_undefined() || options.is_null() {
        ParseOptions::default()
    } else {
        swb::from_value(options).map_err(|e| js_err(format!("Bad options: {e}")))?
    };

    let mut cursor = Cursor::new(bytes);
    let scen = match Scenario::read_from(&mut cursor) {
        Ok(s) => s,
        Err(e) => {
            let out = ParsedScenario {
                ok: false,
                error: Some(e.to_string()),
                versions: VersionsOut {
                    format: "".to_string(),
                    header: 0,
                    data: 0.0,
                    triggers: None,
                    map: 0,
                },
                header: HeaderOut {
                    version: 0,
                    timestamp: 0,
                    description: None,
                    author_name: None,
                    any_sp_victory: false,
                    active_player_count: 0,
                },
                map: None,
                players: vec![],
                gaia: vec![],
                triggers: None,
            };
            return swb::to_value(&out).map_err(|e| js_err(e.to_string()));
        }
    };

    let vb = scen.version();
    let versions = VersionsOut {
        format: vb.format.to_string(),
        header: vb.header,
        data: vb.data,
        triggers: vb.triggers,
        map: vb.map,
    };

    let h = scen.header();
    let header = HeaderOut {
        version: h.version,
        timestamp: h.timestamp,
        description: h.description.clone(),
        author_name: h.author_name.clone(),
        any_sp_victory: h.any_sp_victory,
        active_player_count: h.active_player_count,
    };

    // Map + tiles.
    let map = scen.map();
    let width = map.width();
    let height = map.height();
    let dimension = if width == height { width } else { width.max(height) };

    let tiles = if opts.include_tiles {
        let mut out = Vec::with_capacity((width * height) as usize);
        for (y, row) in map.rows().enumerate() {
            for (x, tile) in row.iter().enumerate() {
                out.push(TileOut {
                    position: XY {
                        x: x as i32,
                        y: y as i32,
                    },
                    terrain: tile.terrain as u32,
                    elevation: tile.elevation as i32,
                    layered_terrain: tile.layered_terrain.map(|t| t as u32),
                });
            }
        }
        Some(out)
    } else {
        None
    };

    let map_out = Some(MapOut {
        width,
        height,
        dimension,
        tiles,
    });

    // Objects: player_objects_by_player includes Gaia at index 0.
    let objects_by_player = scen.player_objects_by_player();
    let mut gaia = vec![];
    let mut players = vec![];

    if opts.include_objects {
        if let Some(gaia_list) = objects_by_player.first() {
            gaia = gaia_list.iter().map(obj_to_out).collect();
        }
    }

    // Scenario player metadata is 0-indexed for player 1..N.
    let scenario_players = scen.scenario_players();
    for (idx, sp) in scenario_players.iter().enumerate() {
        let player_id = (idx + 1) as u32;
        let raw_color = sp.color.unwrap_or(idx as i32);
        let color_id = (raw_color.max(0).min(7)) as u32;

        let pos = XYOpt {
            x: Some(sp.location.0 as i32),
            y: Some(sp.location.1 as i32),
        };

        let objects = if opts.include_objects {
            objects_by_player
                .get(player_id as usize)
                .map(|list| list.iter().map(obj_to_out).collect())
                .unwrap_or_else(Vec::new)
        } else {
            vec![]
        };

        players.push(PlayerOut {
            player_id,
            color_id,
            name: sp.name.clone(),
            position: pos,
            civilization: None,
            objects,
        });
    }

    let triggers = if opts.include_triggers {
        let tr = scen.triggers();
        Some(TriggersOut {
            present: tr.is_some(),
            num_triggers: tr.as_ref().map(|t| t.num_triggers()),
            version: tr.as_ref().map(|t| t.version()),
        })
    } else {
        None
    };

    let out = ParsedScenario {
        ok: true,
        error: None,
        versions,
        header,
        map: map_out,
        players,
        gaia,
        triggers,
    };

    swb::to_value(&out).map_err(|e| js_err(e.to_string()))
}

