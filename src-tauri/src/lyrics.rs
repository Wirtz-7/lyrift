use std::path::Path;

use lofty::prelude::{ItemKey, TaggedFileExt};
use lofty::probe::Probe;
use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LyricDto {
    Synced { lines: Vec<LineDto> },
    Plain { text: String },
    None,
}

#[derive(Serialize, Clone, Debug)]
pub struct LineDto {
    pub time: f64,
    pub text: String,
}

fn parse_lrc(text: &str) -> Option<Vec<LineDto>> {
    let lyrics = lrc::Lyrics::from_str(text).ok()?;
    let lines: Vec<LineDto> = lyrics
        .get_timed_lines()
        .iter()
        .map(|(t, s)| LineDto {
            time: t.get_timestamp() as f64 / 1000.0,
            text: s.to_string(),
        })
        .collect();
    if lines.is_empty() {
        None
    } else {
        Some(lines)
    }
}

/// priority: sidecar .lrc > embedded lyrics text (LRC-parseable) > plain > none.
/// ponytail: lofty keeps ID3v2 SYLT frames as unparsed binary and never exposes
/// them, so embedded *synced* lyrics are skipped; upgrade path is hand-parsing
/// SYLT bytes from the file if it ever matters.
pub fn load_lyrics(path: &Path) -> LyricDto {
    for ext in ["lrc", "LRC"] {
        let p = path.with_extension(ext);
        if let Ok(bytes) = std::fs::read(&p) {
            let text = String::from_utf8_lossy(&bytes).into_owned();
            if let Some(lines) = parse_lrc(&text) {
                return LyricDto::Synced { lines };
            }
            if !text.trim().is_empty() {
                return LyricDto::Plain { text };
            }
        }
    }
    if let Ok(f) = Probe::open(path).and_then(|p| p.read()) {
        let tag = f.primary_tag().or_else(|| f.first_tag());
        if let Some(text) = tag.and_then(|t| t.get_string(&ItemKey::Lyrics)) {
            if let Some(lines) = parse_lrc(text) {
                return LyricDto::Synced { lines };
            }
            if !text.trim().is_empty() {
                return LyricDto::Plain { text: text.to_string() };
            }
        }
    }
    LyricDto::None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sidecar_lrc_wins_and_parses() {
        let dir = std::env::temp_dir().join(format!("lyrift-lrc-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let audio = dir.join("song.flac");
        std::fs::write(&audio, b"fake").unwrap();
        std::fs::write(
            dir.join("song.lrc"),
            "[00:01.50] first line\n[00:05.00] second line\n",
        )
        .unwrap();

        match load_lyrics(&audio) {
            LyricDto::Synced { lines } => {
                assert_eq!(lines.len(), 2);
                assert!((lines[0].time - 1.5).abs() < 1e-6);
                assert_eq!(lines[1].text, "second line");
            }
            other => panic!("expected synced, got {other:?}"),
        }

        std::fs::remove_file(dir.join("song.lrc")).unwrap();
        // no sidecar, no tags -> none
        assert!(matches!(load_lyrics(&audio), LyricDto::None));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
