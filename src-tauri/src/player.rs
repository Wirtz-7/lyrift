use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use lofty::prelude::{ItemKey, TaggedFileExt};
use lofty::probe::Probe;
use rodio::decoder::DecoderBuilder;
use rodio::source::{LimitSettings, Source};
use rodio::{DeviceSinkBuilder, MixerDeviceSink, Player};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::dsp::{db_to_lin, EqShared, EqSource};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEvent {
    pub track_id: Option<i64>,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrackChanged {
    pub index: usize,
    pub id: i64,
}

#[derive(Deserialize, Clone)]
pub struct QueueItemDto {
    pub id: i64,
    pub path: String,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RepeatMode {
    Off,
    All,
    One,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RgMode {
    Off,
    Track,
    Album,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AudioSettings {
    pub eq: crate::dsp::EqSettings,
    pub replay_gain: RgMode,
}

struct QueueItem {
    id: i64,
    path: String,
}

struct QueueState {
    items: Vec<QueueItem>,
    index: usize,
    shuffle: bool,
    repeat: RepeatMode,
    preloaded: bool,
    pending: Option<usize>,
    history: Vec<(i64, String)>,
}

impl Default for QueueState {
    fn default() -> Self {
        Self {
            items: vec![],
            index: 0,
            shuffle: false,
            repeat: RepeatMode::Off,
            preloaded: false,
            pending: None,
            history: vec![],
        }
    }
}

pub struct PlayerService {
    // keeps the audio device alive
    _device: MixerDeviceSink,
    player: Player,
    queue: Mutex<QueueState>,
    eq: Arc<RwLock<EqShared>>,
    rg: Mutex<RgMode>,
    duration: Mutex<f64>,
    db: Arc<Mutex<rusqlite::Connection>>,
    ticks: Mutex<u32>,
    pending_seek: Mutex<Option<f64>>,
}

fn parse_db(tag: Option<&lofty::tag::Tag>, key: &ItemKey) -> Option<f64> {
    let s = tag.and_then(|t| t.get_string(key))?;
    s.split_whitespace().next()?.parse().ok()
}

fn parse_peak(tag: Option<&lofty::tag::Tag>, key: &ItemKey) -> Option<f64> {
    let v = parse_db(tag, key)?;
    if v > 0.0 && v <= 1.0 {
        Some(v)
    } else {
        None
    }
}

fn replay_gain_lin(tag: Option<&lofty::tag::Tag>, mode: RgMode) -> f64 {
    if mode == RgMode::Off {
        return 1.0;
    }
    let (gain, peak) = if mode == RgMode::Track {
        (
            parse_db(tag, &ItemKey::ReplayGainTrackGain),
            parse_peak(tag, &ItemKey::ReplayGainTrackPeak),
        )
    } else {
        (
            parse_db(tag, &ItemKey::ReplayGainAlbumGain),
            parse_peak(tag, &ItemKey::ReplayGainAlbumPeak),
        )
    };
    let Some(gain) = gain else { return 1.0 };
    let mut lin = db_to_lin(gain);
    // never amplify into clipping using the stored peak
    if let Some(peak) = peak {
        lin = lin.min(1.0 / peak);
    }
    lin
}

impl PlayerService {
    pub fn new(db: Arc<Mutex<rusqlite::Connection>>) -> Result<Self, String> {
        // ponytail: fixed 4096-frame buffer; WSLg's virtual RDP sink crackles
        // with cpal's small default buffer. Revisit only if latency matters.
        let device = DeviceSinkBuilder::from_default_device()
            .map_err(|e| e.to_string())?
            .with_buffer_size(rodio::cpal::BufferSize::Fixed(4096))
            .open_stream()
            .map_err(|e| e.to_string())?;
        let player = Player::connect_new(device.mixer());
        Ok(Self {
            _device: device,
            player,
            queue: Mutex::new(QueueState::default()),
            eq: EqShared::new(),
            rg: Mutex::new(RgMode::Off),
            duration: Mutex::new(0.0),
            db,
            ticks: Mutex::new(0),
            pending_seek: Mutex::new(None),
        })
    }

    fn build_source(
        &self,
        path: &str,
    ) -> Result<(Box<dyn Source<Item = f32> + Send>, f64), String> {
        let file = File::open(path).map_err(|e| format!("无法打开音频文件: {e}"))?;
        let decoder = DecoderBuilder::new()
            .with_data(BufReader::new(file))
            .with_seekable(true)
            .with_gapless(true)
            .build()
            .map_err(|e| format!("解码失败: {e}"))?;
        let duration = decoder
            .total_duration()
            .map(|d| d.as_secs_f64())
            .unwrap_or(0.0);

        let tag = Probe::open(path)
            .ok()
            .and_then(|p| p.read().ok())
            .and_then(|f| f.primary_tag().cloned().or_else(|| f.first_tag().cloned()));
        let rg = replay_gain_lin(tag.as_ref(), *self.rg.lock().unwrap());

        let chain: Box<dyn Source<Item = f32> + Send> = Box::new(
            EqSource::new(decoder.amplify(rg as f32), self.eq.clone()).limit(LimitSettings {
                threshold: -1.0,
                knee_width: 6.0,
                attack: Duration::from_millis(5),
                release: Duration::from_millis(50),
            }),
        );
        Ok((chain, duration))
    }

    fn next_index(q: &QueueState, from: usize) -> Option<usize> {
        if q.items.is_empty() {
            return None;
        }
        if q.shuffle && q.items.len() > 1 {
            let mut n = from;
            while n == from {
                n = (std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.subsec_nanos() as usize)
                    .unwrap_or(0))
                    % q.items.len();
            }
            return Some(n);
        }
        let n = from + 1;
        if n < q.items.len() {
            Some(n)
        } else if q.repeat == RepeatMode::All {
            Some(0)
        } else {
            None
        }
    }

    /// append a decoded next track for gapless handoff
    fn preload(&self, q: &mut QueueState) {
        q.preloaded = false;
        q.pending = None;
        let Some(n) = Self::next_index(q, q.index) else {
            return;
        };
        if q.repeat == RepeatMode::One || n == q.index {
            return;
        }
        let Some(item) = q.items.get(n) else { return };
        if let Ok((src, _)) = self.build_source(&item.path) {
            self.player.append(src);
            q.preloaded = true;
            q.pending = Some(n);
        }
    }

    fn load_at(&self, index: usize, emit: &Option<&AppHandle>) -> Result<f64, String> {
        let (path, id) = {
            let q = self.queue.lock().unwrap();
            let item = q.items.get(index).ok_or("队列越界")?;
            (item.path.clone(), item.id)
        };
        let (src, duration) = self.build_source(&path)?;
        self.player.clear();
        self.player.append(src);
        self.player.play();
        *self.duration.lock().unwrap() = duration;
        *self.pending_seek.lock().unwrap() = None;
        {
            let mut q = self.queue.lock().unwrap();
            q.index = index;
            q.history.insert(0, (id, path.clone()));
            q.history.truncate(100);
            self.preload(&mut q);
        }
        self.persist();
        if let Some(app) = emit {
            let _ = app.emit("track-changed", TrackChanged { index, id });
        }
        Ok(duration)
    }

    pub fn play_queue(
        &self,
        items: Vec<QueueItemDto>,
        index: usize,
    ) -> Result<PlaybackEvent, String> {
        {
            let mut q = self.queue.lock().unwrap();
            q.items = items
                .into_iter()
                .map(|i| QueueItem {
                    id: i.id,
                    path: i.path,
                })
                .collect();
        }
        self.load_at(index, &None)?;
        Ok(self.snapshot())
    }

    pub fn next(&self, app: &AppHandle) -> PlaybackEvent {
        let n = {
            let q = self.queue.lock().unwrap();
            Self::next_index(&q, q.index)
        };
        if let Some(n) = n {
            let _ = self.load_at(n, &Some(app));
        } else {
            self.player.pause();
        }
        self.snapshot()
    }

    pub fn prev(&self, app: &AppHandle) -> PlaybackEvent {
        if self.player.get_pos() > Duration::from_secs(3) {
            let _ = self.player.try_seek(Duration::ZERO);
            return self.snapshot();
        }
        let (p, len) = {
            let q = self.queue.lock().unwrap();
            (q.index, q.items.len())
        };
        if len == 0 {
            return self.snapshot();
        }
        let n = if p == 0 {
            if self.queue.lock().unwrap().repeat == RepeatMode::All {
                len - 1
            } else {
                0
            }
        } else {
            p - 1
        };
        let _ = self.load_at(n, &Some(app));
        self.snapshot()
    }

    pub fn toggle(&self) -> PlaybackEvent {
        if self.player.is_paused() {
            self.player.play();
            if let Some(pos) = self.pending_seek.lock().unwrap().take() {
                let _ = self.player.try_seek(Duration::from_secs_f64(pos));
            }
        } else {
            self.player.pause();
        }
        self.snapshot()
    }

    pub fn seek(&self, pos: f64) -> Result<PlaybackEvent, String> {
        let pos = pos.max(0.0);
        if self.player.is_paused() {
            // ponytail: rodio 0.22 never polls the source while paused, so a
            // seek here would block forever; defer until resume.
            *self.pending_seek.lock().unwrap() = Some(pos);
            return Ok(self.snapshot());
        }
        self.player
            .try_seek(Duration::from_secs_f64(pos))
            .map_err(|e| format!("seek 失败: {e}"))?;
        Ok(self.snapshot())
    }

    pub fn set_volume(&self, v: f64) -> PlaybackEvent {
        let v = v.clamp(0.0, 1.0);
        self.player.set_volume(v as f32);
        crate::library::set_setting(&self.db, "volume", &v.to_string());
        self.snapshot()
    }

    pub fn set_shuffle(&self, on: bool) {
        self.queue.lock().unwrap().shuffle = on;
    }

    pub fn set_repeat(&self, mode: RepeatMode) {
        self.queue.lock().unwrap().repeat = mode;
    }

    pub fn set_eq(&self, settings: crate::dsp::EqSettings) {
        if let Ok(mut g) = self.eq.write() {
            if let Ok(json) = serde_json::to_string(&settings) {
                crate::library::set_setting(&self.db, "eq", &json);
            }
            g.settings = settings;
            g.gen += 1;
        }
    }

    pub fn set_replay_gain(&self, mode: RgMode) {
        *self.rg.lock().unwrap() = mode;
        crate::library::set_setting(&self.db, "rg", &format!("{mode:?}").to_lowercase());
    }

    pub fn audio_settings(&self) -> AudioSettings {
        AudioSettings {
            eq: self
                .eq
                .read()
                .map(|g| g.settings.clone())
                .unwrap_or_default(),
            replay_gain: *self.rg.lock().unwrap(),
        }
    }

    fn persist(&self) {
        let q = self.queue.lock().unwrap();
        let queue: Vec<(i64, String)> = q.items.iter().map(|i| (i.id, i.path.clone())).collect();
        let history = q.history.clone();
        let index = q.index;
        drop(q);
        let position = self.player.get_pos().as_secs_f64();
        crate::library::save_queue_state(&self.db, &queue, index, &history, position);
    }

    /// apply persisted settings and queue (paused) at startup
    pub fn restore(&self) -> Option<crate::library::RestoreDto> {
        if let Some(eq_json) = crate::library::get_setting(&self.db, "eq") {
            if let Ok(eq) = serde_json::from_str::<crate::dsp::EqSettings>(&eq_json) {
                self.set_eq(eq);
            }
        }
        if let Some(rg) = crate::library::get_setting(&self.db, "rg") {
            let mode = match rg.as_str() {
                "track" => RgMode::Track,
                "album" => RgMode::Album,
                _ => RgMode::Off,
            };
            *self.rg.lock().unwrap() = mode;
        }
        let volume = crate::library::get_setting(&self.db, "volume")
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.8);
        self.player.set_volume(volume as f32);

        let dto = crate::library::load_queue_state(&self.db)?;
        if dto.queue.is_empty() {
            return Some(dto);
        }
        {
            let mut q = self.queue.lock().unwrap();
            q.items = dto
                .queue
                .iter()
                .map(|t| QueueItem {
                    id: t.id,
                    path: t.path.clone(),
                })
                .collect();
            q.history = dto.history.iter().map(|t| (t.id, t.path.clone())).collect();
        }
        let index = dto.index.max(0) as usize;
        if let Ok((src, duration)) = {
            let q = self.queue.lock().unwrap();
            q.items
                .get(index)
                .map(|i| i.path.clone())
                .map(|p| self.build_source(&p))
                .unwrap_or(Err("empty".into()))
        } {
            self.player.clear();
            self.player.append(src);
            self.player.pause();
            *self.duration.lock().unwrap() = duration;
            let _ = self
                .player
                .try_seek(std::time::Duration::from_secs_f64(dto.position));
            let mut q = self.queue.lock().unwrap();
            q.index = index;
        }
        Some(dto)
    }

    pub fn snapshot(&self) -> PlaybackEvent {
        let (track_id, duration) = {
            let q = self.queue.lock().unwrap();
            (q.items.get(q.index).map(|i| i.id), *self.duration.lock().unwrap())
        };
        let position = self
            .pending_seek
            .lock()
            .unwrap()
            .unwrap_or_else(|| self.player.get_pos().as_secs_f64());
        PlaybackEvent {
            track_id,
            position,
            duration,
            playing: !self.player.is_paused() && !self.player.empty(),
        }
    }

    /// emitter-thread tick: gapless promotion + auto-advance
    pub fn tick(&self, app: &AppHandle) {
        let mut ticks = self.ticks.lock().unwrap();
        *ticks += 1;
        let do_persist = (*ticks).is_multiple_of(20);
        drop(ticks);
        if do_persist {
            self.persist();
        }
        let promote = {
            let q = self.queue.lock().unwrap();
            q.preloaded && self.player.len() == 1
        };
        if promote {
            let (n, id) = {
                let mut q = self.queue.lock().unwrap();
                let Some(n) = q.pending else { return };
                q.index = n;
                q.preloaded = false;
                q.pending = None;
                (n, q.items[n].id)
            };
            let _ = app.emit("track-changed", TrackChanged { index: n, id });
            let mut q = self.queue.lock().unwrap();
            self.preload(&mut q);
            return;
        }
        if self.player.empty() {
            let has = !self.queue.lock().unwrap().items.is_empty();
            if !has {
                return;
            }
            let (repeat_one, idx) = {
                let q = self.queue.lock().unwrap();
                (q.repeat == RepeatMode::One, q.index)
            };
            if repeat_one {
                let _ = self.load_at(idx, &Some(app));
            } else {
                let n = {
                    let q = self.queue.lock().unwrap();
                    Self::next_index(&q, q.index)
                };
                if let Some(n) = n {
                    let _ = self.load_at(n, &Some(app));
                }
            }
        }
    }
}

pub fn spawn_emitter(service: Arc<PlayerService>, app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        service.tick(&app);
        let _ = app.emit("playback", service.snapshot());
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav_bytes(secs: u32) -> Vec<u8> {
        let rate = 8000u32;
        let n = rate * secs;
        let data_len = n * 2;
        let mut v = Vec::new();
        v.extend_from_slice(b"RIFF");
        v.extend_from_slice(&(36 + data_len).to_le_bytes());
        v.extend_from_slice(b"WAVEfmt ");
        v.extend_from_slice(&16u32.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&1u16.to_le_bytes());
        v.extend_from_slice(&rate.to_le_bytes());
        v.extend_from_slice(&(rate * 2).to_le_bytes());
        v.extend_from_slice(&2u16.to_le_bytes());
        v.extend_from_slice(&16u16.to_le_bytes());
        v.extend_from_slice(b"data");
        v.extend_from_slice(&data_len.to_le_bytes());
        for i in 0..n {
            let s = ((i as f64 * 0.05).sin() * 1000.0) as i16;
            v.extend_from_slice(&s.to_le_bytes());
        }
        v
    }

    #[test]
    fn plays_and_seeks_through_default_device() {
        let dir = std::env::temp_dir().join(format!("lyrift-play-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let wav = dir.join("tone.wav");
        std::fs::write(&wav, wav_bytes(3)).unwrap();

        let db = Arc::new(Mutex::new(
            crate::database::open(std::path::Path::new(":memory:")).unwrap(),
        ));
        let svc = PlayerService::new(db).expect("open default audio device");
        let ev = svc
            .play_queue(
                vec![QueueItemDto {
                    id: 1,
                    path: wav.to_string_lossy().into_owned(),
                }],
                0,
            )
            .expect("load wav");
        assert!(ev.playing);

        std::thread::sleep(Duration::from_millis(700));
        let ev = svc.snapshot();
        assert!(
            ev.position > 0.2,
            "position should advance, got {}",
            ev.position
        );

        svc.seek(1.5).expect("seek");
        let ev = svc.snapshot();
        assert!((ev.position - 1.5).abs() < 0.4, "seek pos {}", ev.position);

        let ev = svc.toggle();
        assert!(!ev.playing);
        let ev = svc.toggle();
        assert!(ev.playing);

        svc.set_volume(0.3);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn replay_gain_peak_clamp() {
        // +6 dB gain with peak 0.5 must clamp to 2.0 (1/0.5), not 4x
        use lofty::tag::{ItemValue, Tag, TagItem};
        let mut tag = Tag::new(lofty::tag::TagType::Id3v2);
        tag.push(TagItem::new(
            ItemKey::ReplayGainTrackGain,
            ItemValue::Text("6.0 dB".into()),
        ));
        tag.push(TagItem::new(
            ItemKey::ReplayGainTrackPeak,
            ItemValue::Text("0.5".into()),
        ));
        let lin = replay_gain_lin(Some(&tag), RgMode::Track);
        // +6 dB ~= 1.995x, below the 1/0.5 = 2.0 peak clamp
        assert!((lin - db_to_lin(6.0)).abs() < 1e-6, "lin={lin}");
        // a hot +12 dB tag must clamp to 1/peak
        let mut hot = Tag::new(lofty::tag::TagType::Id3v2);
        hot.push(lofty::tag::TagItem::new(
            ItemKey::ReplayGainTrackGain,
            lofty::tag::ItemValue::Text("12.0 dB".into()),
        ));
        hot.push(lofty::tag::TagItem::new(
            ItemKey::ReplayGainTrackPeak,
            lofty::tag::ItemValue::Text("0.5".into()),
        ));
        assert!((replay_gain_lin(Some(&hot), RgMode::Track) - 2.0).abs() < 1e-6);
        assert!((replay_gain_lin(Some(&tag), RgMode::Off) - 1.0).abs() < 1e-6);
    }
}
