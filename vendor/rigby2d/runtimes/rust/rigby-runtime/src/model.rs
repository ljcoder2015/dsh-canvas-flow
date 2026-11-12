// SPDX-License-Identifier: MIT OR Apache-2.0
//! Skeleton data: bones, slots, attachments, skins, constraints, events and animations, loaded
//! once and shared by every instance (see `Pose` and `AnimationState` for per-instance state).

use crate::curve::{Curve, RawKey};
use crate::math::Transform;
use std::collections::HashMap;

/// Interned attachment / image name.
pub type NameId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Inherit {
    #[default]
    Normal,
    OnlyTranslation,
    NoRotationOrReflection,
    NoScale,
    NoScaleOrReflection,
}

impl Inherit {
    pub fn parse(s: &str) -> Option<Inherit> {
        Some(match s {
            "normal" => Inherit::Normal,
            "onlyTranslation" => Inherit::OnlyTranslation,
            "noRotationOrReflection" => Inherit::NoRotationOrReflection,
            "noScale" => Inherit::NoScale,
            "noScaleOrReflection" => Inherit::NoScaleOrReflection,
            _ => return None,
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Default)]
pub enum Blend {
    #[default]
    Normal,
    Additive,
    Multiply,
    Screen,
}

impl Blend {
    pub fn parse(s: &str) -> Blend {
        match s {
            "additive" => Blend::Additive,
            "multiply" => Blend::Multiply,
            "screen" => Blend::Screen,
            _ => Blend::Normal,
        }
    }
}

#[derive(Clone, Debug)]
pub struct BoneData {
    pub name: String,
    pub parent: Option<usize>,
    pub length: f64,
    pub setup: Transform,
    pub inherit: Inherit,
    pub skin_required: bool,
}

#[derive(Clone, Debug)]
pub struct SlotData {
    pub name: String,
    pub bone: usize,
    pub attachment: Option<NameId>,
    pub color: [f64; 4],
    pub dark: Option<[f64; 3]>,
    pub blend: Blend,
    /// The default skin's attachments for this slot.
    pub attachments: Vec<Attachment>,
}

#[derive(Clone, Copy, Debug)]
pub struct Weight {
    pub bone: usize,
    pub x: f64,
    pub y: f64,
    pub weight: f64,
}

/// Vertices of a mesh-like attachment: plain (x, y per vertex, in the slot bone's space) or
/// weighted to several bones.
#[derive(Clone, Debug)]
pub enum Vertices {
    Plain(Vec<f64>),
    Weighted(Vec<Vec<Weight>>),
}

impl Vertices {
    /// Floats a deform key covers: one x/y pair per vertex, or per bone weight.
    pub fn deform_len(&self) -> usize {
        match self {
            Vertices::Plain(v) => v.len(),
            Vertices::Weighted(w) => w.iter().map(|v| v.len() * 2).sum(),
        }
    }
}

#[derive(Clone, Debug)]
pub struct Sequence {
    pub count: i64,
    pub start: i64,
    pub digits: usize,
    pub setup: i64,
    /// Frame image names (`image` + zero-padded `start + i`), precomputed.
    pub frames: Vec<NameId>,
}

#[derive(Clone, Debug)]
pub enum AttachmentKind {
    Region { offset: Transform, width: f64, height: f64 },
    Mesh { uvs: Vec<f64>, triangles: Vec<u32>, hull: usize, vertices: Vertices, width: f64, height: f64 },
    LinkedMesh { parent: NameId, skin: Option<String>, deform: bool, width: f64, height: f64 },
    BoundingBox { vertices: Vertices },
    Path { vertices: Vertices, closed: bool, constant_speed: bool, lengths: Vec<f64> },
    Clipping { vertices: Vertices, end: Option<usize> },
    Point { offset: Transform },
}

#[derive(Clone, Debug)]
pub struct Attachment {
    pub name: NameId,
    /// Image (atlas region) shown: the attachment's path, else its name.
    pub image: NameId,
    pub color: [f64; 4],
    pub kind: AttachmentKind,
    pub sequence: Option<Sequence>,
}

#[derive(Clone, Debug, Default)]
pub struct SkinData {
    pub name: String,
    pub slots: Vec<(usize, Vec<Attachment>)>,
    pub bones: Vec<usize>,
    pub ik: Vec<usize>,
    /// Names of the transform, path, physics and other constraints listed by the skin.
    pub constraints: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct IkData {
    pub name: String,
    pub order: f64,
    pub skin_required: bool,
    pub bones: Vec<usize>,
    pub target: usize,
    pub mix: f64,
    pub softness: f64,
    pub bend_positive: bool,
    pub compress: bool,
    pub stretch: bool,
    pub uniform: bool,
}

/// Transform constraint properties, in this order everywhere.
pub const PROPS: usize = 6; // rotate, x, y, scaleX, scaleY, shearY
pub const P_ROTATE: usize = 0;
pub const P_X: usize = 1;
pub const P_Y: usize = 2;
pub const P_SCALE_X: usize = 3;
pub const P_SCALE_Y: usize = 4;
pub const P_SHEAR_Y: usize = 5;

#[derive(Clone, Debug)]
pub struct PropTarget {
    pub prop: usize,
    pub offset: f64,
    pub max: f64,
    pub scale: f64,
}

#[derive(Clone, Debug)]
pub struct PropMap {
    pub from: usize,
    pub offset: f64,
    pub to: Vec<PropTarget>,
}

#[derive(Clone, Debug)]
pub struct TransformData {
    pub source: usize,
    pub offsets: [f64; PROPS],
    pub mix: [f64; PROPS],
    pub props: Vec<PropMap>,
    pub local_source: bool,
    pub local_target: bool,
    pub additive: bool,
    pub clamp: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PositionMode {
    Fixed,
    Percent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SpacingMode {
    Length,
    Fixed,
    Percent,
    Proportional,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RotateMode {
    Tangent,
    Chain,
    ChainScale,
}

#[derive(Clone, Debug)]
pub struct PathData {
    pub slot: usize,
    pub position_mode: PositionMode,
    pub spacing_mode: SpacingMode,
    pub rotate_mode: RotateMode,
    pub offset_rotation: f64,
    pub setup: PathState,
}

#[derive(Clone, Copy, Debug, Default)]
pub struct PathState {
    pub position: f64,
    pub spacing: f64,
    pub mix_rotate: f64,
    pub mix_x: f64,
    pub mix_y: f64,
}

/// Physics values keys can animate, in this order.
pub const PHYSICS_VALUES: [&str; 7] = ["inertia", "strength", "damping", "mass", "wind", "gravity", "mix"];

#[derive(Clone, Debug)]
pub struct PhysicsData {
    pub bone: usize,
    /// Weights of x, y, rotate, scaleX, shearX.
    pub x: f64,
    pub y: f64,
    pub rotate: f64,
    pub scale_x: f64,
    pub shear_x: f64,
    pub limit: f64,
    pub fps: f64,
    pub globals: [bool; 7],
    /// inertia, strength, damping, mass, wind, gravity, mix.
    pub setup: [f64; 7],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Property {
    Rotate,
    X,
    Y,
    ScaleX,
    ScaleY,
    ShearY,
}

#[derive(Clone, Debug)]
pub struct SliderData {
    pub animation: usize,
    pub bone: Option<usize>,
    pub property: Property,
    pub scale: f64,
    pub offset: f64,
    pub local: bool,
    pub looping: bool,
    pub additive: bool,
    /// time, mix.
    pub setup: [f64; 2],
}

#[derive(Clone, Debug)]
pub enum ConstraintKind {
    Transform(TransformData),
    Path(PathData),
    Physics(PhysicsData),
    Slider(SliderData),
}

/// A transform, path, physics or slider constraint (IK constraints are in `SkeletonData::ik`).
#[derive(Clone, Debug)]
pub struct ConstraintData {
    pub name: String,
    pub order: f64,
    pub skin_required: bool,
    pub bones: Vec<usize>,
    pub kind: ConstraintKind,
}

#[derive(Clone, Debug)]
pub struct EventData {
    pub name: String,
    pub int: i64,
    pub float: f64,
    pub string: Option<String>,
    pub audio: Option<String>,
    pub volume: f64,
    pub balance: f64,
}

// ---- animations --------------------------------------------------------------------------------

#[derive(Clone, Debug)]
pub struct Key {
    pub time: f64,
    pub values: Vec<f64>,
    pub curve: Curve,
}

/// Bone channels in application order.
pub const CH_ROTATE: usize = 0;
pub const CH_TRANSLATE: usize = 1;
pub const CH_TRANSLATE_X: usize = 2;
pub const CH_TRANSLATE_Y: usize = 3;
pub const CH_SCALE: usize = 4;
pub const CH_SCALE_X: usize = 5;
pub const CH_SCALE_Y: usize = 6;
pub const CH_SHEAR: usize = 7;
pub const CH_SHEAR_X: usize = 8;
pub const CH_SHEAR_Y: usize = 9;

#[derive(Clone, Debug, Default)]
pub struct BoneTimeline {
    pub bone: usize,
    pub channels: [Vec<Key>; 10],
    pub inherit: Vec<(f64, Inherit)>,
}

#[derive(Clone, Debug, Default)]
pub struct SlotTimeline {
    pub slot: usize,
    pub attachment: Vec<(f64, Option<NameId>)>,
    pub color: Vec<Key>,
    pub rgb: Vec<Key>,
    pub alpha: Vec<Key>,
    pub rgba2: Vec<Key>,
    pub rgb2: Vec<Key>,
}

#[derive(Clone, Debug)]
pub struct DeformKey {
    pub time: f64,
    pub offset: usize,
    pub vertices: Vec<f64>,
    pub curve: Curve,
}

#[derive(Clone, Debug)]
pub struct DeformTimeline {
    /// Skin name, or None for the default skin (then the active skin is searched first).
    pub skin: Option<String>,
    pub slot: usize,
    pub attachment: NameId,
    pub keys: Vec<DeformKey>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SequenceMode {
    Hold,
    Once,
    Loop,
    PingPong,
    OnceReverse,
    LoopReverse,
    PingPongReverse,
}

#[derive(Clone, Debug)]
pub struct SequenceKey {
    pub time: f64,
    pub mode: SequenceMode,
    pub index: i64,
    pub delay: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct SequenceTimeline {
    pub skin: Option<String>,
    pub slot: usize,
    pub attachment: NameId,
    pub keys: Vec<SequenceKey>,
}

#[derive(Clone, Debug)]
pub struct EventKey {
    pub time: f64,
    pub name: String,
    pub int: Option<i64>,
    pub float: Option<f64>,
    pub string: Option<String>,
    pub volume: Option<f64>,
    pub balance: Option<f64>,
}

#[derive(Clone, Debug)]
pub struct IkKey {
    pub time: f64,
    pub mix: f64,
    pub softness: f64,
    pub bend_positive: bool,
    pub compress: bool,
    pub stretch: bool,
}

#[derive(Clone, Debug)]
pub struct IkTimeline {
    pub constraint: usize,
    pub keys: Vec<IkKey>,
}

/// Keys of one transform, path, physics or slider constraint, by constraint index.
#[derive(Clone, Debug, Default)]
pub struct ConstraintTimeline {
    pub constraint: usize,
    /// Transform: 6 mixes per key. Path: `position`, `spacing`, `mix` (3 values). Slider: `time`,
    /// `mix`. Physics: one list per physics value (own keys), then global keys.
    pub transform: Vec<RawKey>,
    pub position: Vec<RawKey>,
    pub spacing: Vec<RawKey>,
    pub path_mix: Vec<RawKey>,
    pub slider_time: Vec<RawKey>,
    pub slider_mix: Vec<RawKey>,
    pub physics: [Vec<RawKey>; 7],
    pub physics_global: [Vec<RawKey>; 7],
}

#[derive(Clone, Debug, Default)]
pub struct Animation {
    pub name: String,
    pub duration: f64,
    pub bones: Vec<BoneTimeline>,
    pub slots: Vec<SlotTimeline>,
    pub deform: Vec<DeformTimeline>,
    pub sequences: Vec<SequenceTimeline>,
    pub draw_order: Vec<(f64, Option<Vec<(usize, i64)>>)>,
    pub events: Vec<EventKey>,
    pub ik: Vec<IkTimeline>,
    pub constraints: Vec<ConstraintTimeline>,
    /// True when the file has transform, path, physics or slider keys (gates their sampling).
    pub has_constraint_keys: bool,
}

// ---- skeleton -----------------------------------------------------------------------------------

#[derive(Clone, Debug, Default)]
pub struct SkeletonData {
    pub version: Option<String>,
    pub bones: Vec<BoneData>,
    pub slots: Vec<SlotData>,
    pub skins: Vec<SkinData>,
    pub ik: Vec<IkData>,
    pub constraints: Vec<ConstraintData>,
    pub events: Vec<EventData>,
    pub animations: Vec<Animation>,
    /// Interned names (attachments and images).
    pub names: Vec<String>,
    pub name_ids: HashMap<String, NameId>,
    /// Format warnings found while reading.
    pub warnings: Vec<String>,
}

impl SkeletonData {
    pub fn intern(&mut self, name: &str) -> NameId {
        if let Some(&id) = self.name_ids.get(name) {
            return id;
        }
        let id = self.names.len() as NameId;
        self.names.push(name.to_string());
        self.name_ids.insert(name.to_string(), id);
        id
    }

    pub fn name(&self, id: NameId) -> &str {
        &self.names[id as usize]
    }

    pub fn name_id(&self, name: &str) -> Option<NameId> {
        self.name_ids.get(name).copied()
    }

    pub fn find_bone(&self, name: &str) -> Option<usize> {
        self.bones.iter().position(|b| b.name == name)
    }

    pub fn find_slot(&self, name: &str) -> Option<usize> {
        self.slots.iter().position(|s| s.name == name)
    }

    pub fn find_skin(&self, name: &str) -> Option<usize> {
        self.skins.iter().position(|s| s.name == name)
    }

    pub fn find_animation(&self, name: &str) -> Option<usize> {
        self.animations.iter().position(|a| a.name == name)
    }

    /// Attachments a skin defines for a slot (`None` = the default skin).
    pub fn skin_attachments(&self, slot: usize, skin: Option<usize>) -> &[Attachment] {
        match skin {
            None => self.slots.get(slot).map(|s| s.attachments.as_slice()).unwrap_or(&[]),
            Some(k) => self.skins.get(k).and_then(|s| s.slots.iter().find(|(i, _)| *i == slot)).map(|(_, a)| a.as_slice()).unwrap_or(&[]),
        }
    }

    /// Resolves an attachment by slot and name: `skin` first, then the default skin.
    pub fn attachment(&self, slot: usize, name: Option<NameId>, skin: Option<usize>) -> Option<&Attachment> {
        let name = name?;
        if skin.is_some() {
            if let Some(a) = self.skin_attachments(slot, skin).iter().find(|a| a.name == name) {
                return Some(a);
            }
        }
        self.slots.get(slot)?.attachments.iter().find(|a| a.name == name)
    }

    /// The mesh holding the geometry of `att`: itself, or the parent of a linked mesh.
    pub fn mesh_source<'a>(&'a self, slot: usize, att: &'a Attachment, active_skin: Option<usize>) -> Option<&'a Attachment> {
        match &att.kind {
            AttachmentKind::LinkedMesh { parent, skin, .. } => {
                let skin_index = skin.as_deref().and_then(|s| if s == "default" { None } else { self.find_skin(s) });
                let in_skin = if skin.as_deref().is_some_and(|s| s != "default") && skin_index.is_none() {
                    None
                } else {
                    self.skin_attachments(slot, skin_index).iter().find(|a| a.name == *parent)
                };
                let found = in_skin.or_else(|| self.attachment(slot, Some(*parent), active_skin))?;
                matches!(found.kind, AttachmentKind::Mesh { .. }).then_some(found)
            }
            _ => Some(att),
        }
    }
}
