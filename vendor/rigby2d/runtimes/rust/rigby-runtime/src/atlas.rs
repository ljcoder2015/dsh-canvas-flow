// SPDX-License-Identifier: MIT OR Apache-2.0
//! Texture atlas text files (".atlas"): pages of packed regions. Both the current (bounds/offsets)
//! and the legacy (xy/size/orig/offset) field names are read.

use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub struct AtlasRegion {
    pub name: String,
    pub index: i64,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotate: f64,
    pub offset_x: f64,
    pub offset_y: f64,
    pub original_width: f64,
    pub original_height: f64,
}

#[derive(Clone, Debug, Default)]
pub struct AtlasPage {
    pub name: String,
    pub width: f64,
    pub height: f64,
    /// Min and mag filter names, e.g. "Linear".
    pub filter: [String; 2],
    pub repeat: String,
    /// Premultiplied alpha.
    pub pma: bool,
    pub regions: Vec<AtlasRegion>,
}

#[derive(Clone, Debug, Default)]
pub struct Atlas {
    pub pages: Vec<AtlasPage>,
}

fn ints(v: &str) -> Vec<f64> {
    v.split(',').map(|s| s.trim().parse::<f64>().unwrap_or(f64::NAN)).collect()
}

fn set(target: &mut [&mut f64], values: &[f64]) {
    for (t, v) in target.iter_mut().zip(values) {
        **t = *v;
    }
}

impl Atlas {
    /// Parses atlas text.
    pub fn parse(text: &str) -> Atlas {
        let text = text.strip_prefix('\u{feff}').unwrap_or(text);
        let mut pages: Vec<AtlasPage> = Vec::new();
        let mut in_page = false;
        let mut in_region = false;
        for raw in text.lines() {
            let line = raw.trim();
            if line.is_empty() {
                in_page = false;
                in_region = false;
                continue;
            }
            let Some(colon) = line.find(':') else {
                if !in_page {
                    pages.push(AtlasPage { name: line.to_string(), filter: ["Nearest".into(), "Nearest".into()], repeat: "none".into(), ..Default::default() });
                    in_page = true;
                } else {
                    pages.last_mut().unwrap().regions.push(AtlasRegion { name: line.to_string(), index: -1, original_width: -1.0, original_height: -1.0, ..Default::default() });
                    in_region = true;
                }
                continue;
            };
            if !in_page {
                continue;
            }
            let key = line[..colon].trim();
            let value = line[colon + 1..].trim();
            let page = pages.last_mut().unwrap();
            if in_region {
                let r = page.regions.last_mut().unwrap();
                match key {
                    "bounds" => set(&mut [&mut r.x, &mut r.y, &mut r.width, &mut r.height], &ints(value)),
                    "offsets" => set(&mut [&mut r.offset_x, &mut r.offset_y, &mut r.original_width, &mut r.original_height], &ints(value)),
                    "xy" => set(&mut [&mut r.x, &mut r.y], &ints(value)),
                    "size" => set(&mut [&mut r.width, &mut r.height], &ints(value)),
                    "orig" => set(&mut [&mut r.original_width, &mut r.original_height], &ints(value)),
                    "offset" => set(&mut [&mut r.offset_x, &mut r.offset_y], &ints(value)),
                    "rotate" => r.rotate = if value == "true" { 90.0 } else if value == "false" { 0.0 } else { value.parse().unwrap_or(0.0) },
                    "index" => r.index = value.parse().unwrap_or(-1),
                    _ => {}
                }
            } else {
                match key {
                    "size" => set(&mut [&mut page.width, &mut page.height], &ints(value)),
                    "filter" => {
                        let f: Vec<String> = value.split(',').map(|s| s.trim().to_string()).collect();
                        page.filter = [f.first().cloned().unwrap_or_default(), f.get(1).or(f.first()).cloned().unwrap_or_default()];
                    }
                    "repeat" => page.repeat = value.to_string(),
                    "pma" => page.pma = value == "true",
                    _ => {}
                }
            }
        }
        for p in &mut pages {
            for r in &mut p.regions {
                if r.original_width < 0.0 {
                    r.original_width = r.width;
                }
                if r.original_height < 0.0 {
                    r.original_height = r.height;
                }
            }
        }
        Atlas { pages }
    }

    /// Region lookup by image name (`name` + `index` for indexed regions).
    pub fn lookup(&self) -> HashMap<String, RegionUv> {
        let mut out = HashMap::new();
        for (p, page) in self.pages.iter().enumerate() {
            for r in &page.regions {
                let key = if r.index >= 0 { format!("{}{}", r.name, r.index) } else { r.name.clone() };
                out.insert(key, RegionUv::new(p, r, page.width, page.height));
            }
        }
        out
    }
}

/// Maps an attachment's 0..1 image coordinates (y down) to page UVs, handling whitespace
/// stripping and rotation in the page.
#[derive(Clone, Copy, Debug)]
pub struct RegionUv {
    pub page: usize,
    /// Part of the original image the packed pixels cover: u0, v0, u1, v1.
    pub trim: [f64; 4],
    ow: f64,
    oh: f64,
    dx: f64,
    dy: f64,
    w: f64,
    h: f64,
    src_x: f64,
    src_y: f64,
    cx: f64,
    cy: f64,
    cos: f64,
    sin: f64,
    page_w: f64,
    page_h: f64,
}

impl RegionUv {
    pub fn new(page: usize, r: &AtlasRegion, page_w: f64, page_h: f64) -> RegionUv {
        let swap = (r.rotate % 180.0).abs() == 90.0;
        let (src_w, src_h) = if swap { (r.height, r.width) } else { (r.width, r.height) };
        let ow = r.original_width.max(1.0);
        let oh = r.original_height.max(1.0);
        let (dx, dy, w, h) = (r.offset_x, r.original_height - r.height - r.offset_y, r.width, r.height);
        // The page holds the packed image rotated by -rotate degrees about its center.
        let rad = -r.rotate * std::f64::consts::PI / 180.0;
        let round6 = |v: f64| (v * 1e6 + 0.5).floor() / 1e6;
        RegionUv {
            page,
            trim: [dx / ow, dy / oh, (dx + w) / ow, (dy + h) / oh],
            ow,
            oh,
            dx,
            dy,
            w,
            h,
            src_x: r.x,
            src_y: r.y,
            cx: src_w / 2.0,
            cy: src_h / 2.0,
            cos: round6(rad.cos()),
            sin: round6(rad.sin()),
            page_w: page_w.max(1.0),
            page_h: page_h.max(1.0),
        }
    }

    /// Page UV for image coordinates (u, v), clamped inside the region.
    pub fn map(&self, u: f64, v: f64) -> (f64, f64) {
        let qx = (u * self.ow - self.dx).clamp(0.0, self.w) - self.w / 2.0;
        let qy = (v * self.oh - self.dy).clamp(0.0, self.h) - self.h / 2.0;
        ((self.src_x + self.cx + qx * self.cos - qy * self.sin) / self.page_w, (self.src_y + self.cy + qx * self.sin + qy * self.cos) / self.page_h)
    }
}
