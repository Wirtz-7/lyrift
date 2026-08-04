use std::path::Path;

use lofty::aac::AacFile;
use lofty::config::ParseOptions;
use lofty::file::{AudioFile, FileType};
use lofty::flac::FlacFile;
use lofty::id3::v2::{
    Frame, Id3v2Tag, SyncTextContentType, SynchronizedTextFrame, TimestampFormat,
};
use lofty::iff::wav::WavFile;
use lofty::mpeg::{Layer, MpegFile, MpegVersion};
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub translation: Option<String>,
}

fn merge_translations(lines: impl IntoIterator<Item = LineDto>) -> Vec<LineDto> {
    let mut merged: Vec<LineDto> = vec![];
    for line in lines {
        if let Some(previous) = merged.last_mut() {
            if (previous.time - line.time).abs() < 0.001 {
                let translation = previous.translation.get_or_insert_with(String::new);
                if !translation.is_empty() {
                    translation.push('\n');
                }
                translation.push_str(&line.text);
                continue;
            }
        }
        merged.push(line);
    }
    merged
}

fn parse_lrc(text: &str) -> Option<Vec<LineDto>> {
    let lyrics = lrc::Lyrics::from_str(text).ok()?;
    let lines = merge_translations(lyrics.get_timed_lines().iter().map(|(t, s)| LineDto {
        time: t.get_timestamp() as f64 / 1000.0,
        text: s.to_string(),
        translation: None,
    }));
    if lines.is_empty() {
        None
    } else {
        Some(lines)
    }
}

fn sylt_lines(tag: Option<&Id3v2Tag>, mpeg_frame_seconds: Option<f64>) -> Option<Vec<LineDto>> {
    for frame in tag? {
        let Frame::Binary(binary) = frame else {
            continue;
        };
        if binary.id().as_str() != "SYLT" {
            continue;
        }
        let Ok(sylt) = SynchronizedTextFrame::parse(&binary.data, binary.flags()) else {
            continue;
        };
        if sylt.content_type != SyncTextContentType::Lyrics {
            continue;
        }
        let seconds_per_tick = match sylt.timestamp_format {
            TimestampFormat::MS => 0.001,
            TimestampFormat::MPEG => {
                let Some(frame_seconds) = mpeg_frame_seconds else {
                    continue;
                };
                frame_seconds
            }
        };
        let mut lines: Vec<_> = sylt
            .content
            .into_iter()
            .filter(|(_, text)| !text.trim().is_empty())
            .map(|(time, text)| LineDto {
                time: f64::from(time) * seconds_per_tick,
                text,
                translation: None,
            })
            .collect();
        lines.sort_by(|a, b| a.time.total_cmp(&b.time));
        let lines = merge_translations(lines);
        if !lines.is_empty() {
            return Some(lines);
        }
    }
    None
}

fn embedded_sylt(path: &Path) -> Option<Vec<LineDto>> {
    let probe = Probe::open(path).ok()?.guess_file_type().ok()?;
    let file_type = probe.file_type()?;
    let mut reader = probe.into_inner();
    match file_type {
        FileType::Mpeg => {
            let file = MpegFile::read_from(&mut reader, ParseOptions::new()).ok()?;
            let properties = file.properties();
            let samples = match (*properties.layer(), *properties.version()) {
                (Layer::Layer1, _) => 384,
                (Layer::Layer2, _) | (Layer::Layer3, MpegVersion::V1) => 1152,
                (Layer::Layer3, _) => 576,
            };
            let rate = properties.sample_rate();
            let frame_seconds = (rate > 0).then(|| f64::from(samples) / f64::from(rate));
            sylt_lines(file.id3v2(), frame_seconds)
        }
        FileType::Aac => {
            let file =
                AacFile::read_from(&mut reader, ParseOptions::new().read_properties(false)).ok()?;
            sylt_lines(file.id3v2(), None)
        }
        FileType::Flac => {
            let file = FlacFile::read_from(&mut reader, ParseOptions::new().read_properties(false))
                .ok()?;
            sylt_lines(file.id3v2(), None)
        }
        FileType::Wav => {
            let file =
                WavFile::read_from(&mut reader, ParseOptions::new().read_properties(false)).ok()?;
            sylt_lines(file.id3v2(), None)
        }
        _ => None,
    }
}

/// priority: sidecar .lrc > ID3v2 SYLT > embedded LRC text > plain > none.
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
    if let Some(lines) = embedded_sylt(path) {
        return LyricDto::Synced { lines };
    }
    if let Ok(f) = Probe::open(path).and_then(|p| p.read()) {
        let tag = f.primary_tag().or_else(|| f.first_tag());
        if let Some(text) = tag.and_then(|t| t.get_string(&ItemKey::Lyrics)) {
            if let Some(lines) = parse_lrc(text) {
                return LyricDto::Synced { lines };
            }
            if !text.trim().is_empty() {
                return LyricDto::Plain {
                    text: text.to_string(),
                };
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
            "[00:01.50] first line\n[00:01.50] translated line\n[00:05.00] second line\n",
        )
        .unwrap();

        match load_lyrics(&audio) {
            LyricDto::Synced { lines } => {
                assert_eq!(lines.len(), 2);
                assert!((lines[0].time - 1.5).abs() < 1e-6);
                assert_eq!(lines[0].translation.as_deref(), Some("translated line"));
                assert_eq!(lines[1].text, "second line");
            }
            other => panic!("expected synced, got {other:?}"),
        }

        std::fs::remove_file(dir.join("song.lrc")).unwrap();
        // no sidecar, no tags -> none
        assert!(matches!(load_lyrics(&audio), LyricDto::None));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn reads_embedded_sylt_from_a_real_file() {
        use lofty::config::WriteOptions;
        use lofty::id3::v2::{BinaryFrame, FrameId};
        use lofty::prelude::TagExt;
        use lofty::TextEncoding;

        let dir = std::env::temp_dir().join(format!("lyrift-sylt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let audio = dir.join("song.wav");
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&36u32.to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&8_000u32.to_le_bytes());
        wav.extend_from_slice(&16_000u32.to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&0u32.to_le_bytes());
        std::fs::write(&audio, wav).unwrap();

        let sylt = SynchronizedTextFrame::new(
            TextEncoding::UTF8,
            *b"eng",
            TimestampFormat::MS,
            SyncTextContentType::Lyrics,
            None,
            vec![(1_500, "first line".into()), (5_000, "second line".into())],
        );
        let mut tag = Id3v2Tag::new();
        tag.insert(Frame::Binary(BinaryFrame::new(
            FrameId::new("SYLT").unwrap(),
            sylt.as_bytes().unwrap(),
        )));
        tag.save_to_path(&audio, WriteOptions::new()).unwrap();

        match load_lyrics(&audio) {
            LyricDto::Synced { lines } => {
                assert_eq!(lines.len(), 2);
                assert!((lines[0].time - 1.5).abs() < 1e-6);
                assert_eq!(lines[1].text, "second line");
            }
            other => panic!("expected synced, got {other:?}"),
        }

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
