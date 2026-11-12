// SPDX-License-Identifier: MIT OR Apache-2.0
//! A small JSON value type and parser. Objects keep their key order, which the skeleton format
//! relies on (animations, skins and timelines are listed in file order).

use std::fmt;

#[derive(Clone, Debug, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

static NULL: Json = Json::Null;

impl Json {
    /// The value of `key` in an object (`Null` when missing or not an object).
    pub fn get(&self, key: &str) -> &Json {
        match self {
            Json::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v).unwrap_or(&NULL),
            _ => &NULL,
        }
    }

    pub fn has(&self, key: &str) -> bool {
        !self.get(key).is_null()
    }

    pub fn is_null(&self) -> bool {
        matches!(self, Json::Null)
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Json::Num(n) => Some(*n),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            Json::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_array(&self) -> &[Json] {
        match self {
            Json::Arr(a) => a,
            _ => &[],
        }
    }

    /// Object entries in file order (empty for anything else).
    pub fn entries(&self) -> &[(String, Json)] {
        match self {
            Json::Obj(e) => e,
            _ => &[],
        }
    }

    pub fn is_array(&self) -> bool {
        matches!(self, Json::Arr(_))
    }

    pub fn is_object(&self) -> bool {
        matches!(self, Json::Obj(_))
    }

    /// Number at `key`, or `def`.
    pub fn num(&self, key: &str, def: f64) -> f64 {
        self.get(key).as_f64().unwrap_or(def)
    }

    /// JavaScript-style truthiness of `key` (`!!value`).
    pub fn truthy(&self, key: &str) -> bool {
        match self.get(key) {
            Json::Null => false,
            Json::Bool(b) => *b,
            Json::Num(n) => *n != 0.0 && !n.is_nan(),
            Json::Str(s) => !s.is_empty(),
            _ => true,
        }
    }

    /// Boolean at `key`, or `def` when missing (`value ?? def`).
    pub fn flag(&self, key: &str, def: bool) -> bool {
        match self.get(key) {
            Json::Null => def,
            _ => self.truthy(key),
        }
    }

    pub fn str_or<'a>(&'a self, key: &str, def: &'a str) -> &'a str {
        self.get(key).as_str().unwrap_or(def)
    }

    /// Sets `key` in an object (keeping its position when it exists); no effect otherwise.
    pub fn set(&mut self, key: &str, value: Json) {
        if let Json::Obj(entries) = self {
            if let Some(e) = entries.iter_mut().find(|(k, _)| k == key) {
                e.1 = value;
            } else {
                entries.push((key.to_string(), value));
            }
        }
    }

    pub fn remove(&mut self, key: &str) -> Option<Json> {
        if let Json::Obj(entries) = self {
            if let Some(i) = entries.iter().position(|(k, _)| k == key) {
                return Some(entries.remove(i).1);
            }
        }
        None
    }

    pub fn obj() -> Json {
        Json::Obj(Vec::new())
    }

    /// Parses JSON text.
    pub fn parse(text: &str) -> Result<Json, ParseError> {
        let mut p = Parser { s: text.as_bytes(), i: 0 };
        p.skip_bom();
        p.ws();
        let v = p.value(0)?;
        p.ws();
        if p.i != p.s.len() {
            return Err(p.err("unexpected data after the JSON value"));
        }
        Ok(v)
    }
}

#[derive(Debug, Clone)]
pub struct ParseError {
    pub message: String,
    pub offset: usize,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at byte {}", self.message, self.offset)
    }
}

impl std::error::Error for ParseError {}

struct Parser<'a> {
    s: &'a [u8],
    i: usize,
}

const MAX_DEPTH: usize = 512;

impl Parser<'_> {
    fn err(&self, message: &str) -> ParseError {
        ParseError { message: message.to_string(), offset: self.i }
    }

    fn skip_bom(&mut self) {
        if self.s.starts_with(&[0xef, 0xbb, 0xbf]) {
            self.i = 3;
        }
    }

    fn ws(&mut self) {
        while self.i < self.s.len() && matches!(self.s[self.i], b' ' | b'\t' | b'\n' | b'\r') {
            self.i += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.s.get(self.i).copied()
    }

    fn expect(&mut self, lit: &[u8]) -> Result<(), ParseError> {
        if self.s[self.i..].starts_with(lit) {
            self.i += lit.len();
            Ok(())
        } else {
            Err(self.err("invalid literal"))
        }
    }

    fn value(&mut self, depth: usize) -> Result<Json, ParseError> {
        if depth > MAX_DEPTH {
            return Err(self.err("JSON nested too deeply"));
        }
        match self.peek() {
            None => Err(self.err("unexpected end of JSON")),
            Some(b'{') => {
                self.i += 1;
                let mut entries = Vec::new();
                self.ws();
                if self.peek() == Some(b'}') {
                    self.i += 1;
                    return Ok(Json::Obj(entries));
                }
                loop {
                    self.ws();
                    if self.peek() != Some(b'"') {
                        return Err(self.err("expected a string key"));
                    }
                    let k = self.string()?;
                    self.ws();
                    if self.peek() != Some(b':') {
                        return Err(self.err("expected ':'"));
                    }
                    self.i += 1;
                    self.ws();
                    let v = self.value(depth + 1)?;
                    // Like JSON.parse: a repeated key keeps the last value, in the first position.
                    if let Some(e) = entries.iter_mut().find(|(ek, _): &&mut (String, Json)| *ek == k) {
                        e.1 = v;
                    } else {
                        entries.push((k, v));
                    }
                    self.ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b'}') => {
                            self.i += 1;
                            return Ok(Json::Obj(entries));
                        }
                        _ => return Err(self.err("expected ',' or '}'")),
                    }
                }
            }
            Some(b'[') => {
                self.i += 1;
                let mut items = Vec::new();
                self.ws();
                if self.peek() == Some(b']') {
                    self.i += 1;
                    return Ok(Json::Arr(items));
                }
                loop {
                    self.ws();
                    items.push(self.value(depth + 1)?);
                    self.ws();
                    match self.peek() {
                        Some(b',') => self.i += 1,
                        Some(b']') => {
                            self.i += 1;
                            return Ok(Json::Arr(items));
                        }
                        _ => return Err(self.err("expected ',' or ']'")),
                    }
                }
            }
            Some(b'"') => Ok(Json::Str(self.string()?)),
            Some(b't') => self.expect(b"true").map(|_| Json::Bool(true)),
            Some(b'f') => self.expect(b"false").map(|_| Json::Bool(false)),
            Some(b'n') => self.expect(b"null").map(|_| Json::Null),
            Some(_) => self.number(),
        }
    }

    fn number(&mut self) -> Result<Json, ParseError> {
        let start = self.i;
        while self.i < self.s.len() && matches!(self.s[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') {
            self.i += 1;
        }
        let text = std::str::from_utf8(&self.s[start..self.i]).map_err(|_| self.err("invalid number"))?;
        text.parse::<f64>().map(Json::Num).map_err(|_| ParseError { message: format!("invalid number '{text}'"), offset: start })
    }

    fn hex4(&mut self) -> Result<u32, ParseError> {
        if self.i + 4 > self.s.len() {
            return Err(self.err("invalid \\u escape"));
        }
        let text = std::str::from_utf8(&self.s[self.i..self.i + 4]).map_err(|_| self.err("invalid \\u escape"))?;
        let v = u32::from_str_radix(text, 16).map_err(|_| self.err("invalid \\u escape"))?;
        self.i += 4;
        Ok(v)
    }

    fn string(&mut self) -> Result<String, ParseError> {
        self.i += 1; // opening quote
        let mut out = Vec::new();
        loop {
            let Some(c) = self.peek() else { return Err(self.err("unterminated string")) };
            self.i += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let Some(e) = self.peek() else { return Err(self.err("unterminated string")) };
                    self.i += 1;
                    match e {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'b' => out.push(8),
                        b'f' => out.push(12),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let mut cp = self.hex4()?;
                            if (0xd800..0xdc00).contains(&cp) && self.s[self.i..].starts_with(b"\\u") {
                                let save = self.i;
                                self.i += 2;
                                let lo = self.hex4()?;
                                if (0xdc00..0xe000).contains(&lo) {
                                    cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
                                } else {
                                    self.i = save;
                                }
                            }
                            let ch = char::from_u32(cp).unwrap_or('\u{fffd}');
                            let mut buf = [0u8; 4];
                            out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                        }
                        _ => return Err(self.err("invalid escape")),
                    }
                }
                _ => out.push(c),
            }
        }
        String::from_utf8(out).map_err(|_| self.err("invalid UTF-8 in string"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_values_in_order() {
        let v = Json::parse(r#"{"b": [1, -2.5e2, true, null], "a": {"x": "hé\n"}, "b": 3}"#).unwrap();
        assert_eq!(v.entries().iter().map(|(k, _)| k.as_str()).collect::<Vec<_>>(), ["b", "a"]);
        assert_eq!(v.get("b").as_f64(), Some(3.0));
        assert_eq!(v.get("a").get("x").as_str(), Some("hé\n"));
        assert!(Json::parse("[1,]").is_err());
        assert!(Json::parse("{} x").is_err());
    }
}
