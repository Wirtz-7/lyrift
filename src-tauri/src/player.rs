use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;

use lofty::prelude::{ItemKey, TaggedFileExt};
use lofty::probe::Probe;
use rodio::cpal::traits::{DeviceTrait, HostTrait};
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
    pending: Option<(usize, f64)>,
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

struct AudioOutput {
    device: MixerDeviceSink,
    player: Player,
    device_key: String,
}

fn output_device_key(device: &rodio::cpal::Device) -> String {
    device
        .id()
        .map(|id| id.to_string())
        .or_else(|_| device.description().map(|d| d.name().to_owned()))
        .unwrap_or_default()
}

fn open_audio_output(device: rodio::cpal::Device) -> Result<AudioOutput, String> {
    let device_key = output_device_key(&device);
    // ponytail: fixed 4096-frame buffer; WSLg's virtual RDP sink crackles
    // with cpal's small default buffer. Revisit only if latency matters.
    let device = DeviceSinkBuilder::from_device(device)
        .map_err(|e| e.to_string())?
        .with_buffer_size(rodio::cpal::BufferSize::Fixed(4096))
        .open_stream()
        .map_err(|e| e.to_string())?;
    let player = Player::connect_new(device.mixer());
    Ok(AudioOutput {
        device,
        player,
        device_key,
    })
}

fn open_default_audio_output() -> Result<AudioOutput, String> {
    let device = rodio::cpal::default_host()
        .default_output_device()
        .ok_or("未找到默认音频输出设备")?;
    open_audio_output(device)
}

pub struct PlayerService {
    audio: Mutex<AudioOutput>,
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
        Ok(Self {
            audio: Mutex::new(open_default_audio_output()?),
            queue: Mutex::new(QueueState::default()),
            eq: EqShared::new(),
            rg: Mutex::new(RgMode::Off),
            duration: Mutex::new(0.0),
            db,
            ticks: Mutex::new(0),
            pending_seek: Mutex::new(None),
        })
    }

    fn with_player<T>(&self, f: impl FnOnce(&Player) -> T) -> T {
        f(&self.audio.lock().unwrap().player)
    }

    fn refresh_output_device(&self, force: bool) -> Result<bool, String> {
        let device = rodio::cpal::default_host()
            .default_output_device()
            .ok_or("未找到默认音频输出设备")?;
        let device_key = output_device_key(&device);
        if !force && self.audio.lock().unwrap().device_key == device_key {
            return Ok(false);
        }

        let current = {
            let q = self.queue.lock().unwrap();
            q.items
                .get(q.index)
                .map(|item| (item.id, item.path.clone()))
        };
        let source = current
            .as_ref()
            .map(|(_, path)| self.build_source(path))
            .transpose()?;
        let replacement = open_audio_output(device)?;

        let current_now = {
            let q = self.queue.lock().unwrap();
            q.items
                .get(q.index)
                .map(|item| (item.id, item.path.clone()))
        };
        if current_now != current {
            return Ok(false);
        }

        let pending = *self.pending_seek.lock().unwrap();
        let mut audio = self.audio.lock().unwrap();
        if !force && audio.device_key == replacement.device_key {
            return Ok(false);
        }
        let position = pending.unwrap_or_else(|| audio.player.get_pos().as_secs_f64());
        let paused = audio.player.is_paused();
        let volume = audio.player.volume();

        replacement
            .player
            .set_volume(if paused { volume } else { 0.0 });
        if paused {
            replacement.player.pause();
        }
        if let Some((source, duration)) = source {
            replacement.player.append(source);
            if !paused {
                replacement
                    .player
                    .try_seek(Duration::from_secs_f64(position))
                    .map_err(|e| format!("切换输出设备时 seek 失败: {e}"))?;
                replacement.player.set_volume(volume);
            }
            *self.duration.lock().unwrap() = duration;
        }

        audio.device.log_on_drop(false);
        *audio = replacement;
        drop(audio);
        *self.pending_seek.lock().unwrap() = paused.then_some(position);

        let mut q = self.queue.lock().unwrap();
        q.preloaded = false;
        q.pending = None;
        self.preload(&mut q);
        Ok(true)
    }

    fn build_source(
        &self,
        path: &str,
    ) -> Result<(Box<dyn Source<Item = f32> + Send>, f64), String> {
        let file = File::open(path).map_err(|e| format!("无法打开音频文件: {e}"))?;
        let byte_len = file
            .metadata()
            .map_err(|e| format!("无法读取音频文件大小: {e}"))?
            .len();
        let decoder = DecoderBuilder::new()
            .with_data(BufReader::new(file))
            .with_byte_len(byte_len)
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
        if let Ok((src, duration)) = self.build_source(&item.path) {
            self.with_player(|player| player.append(src));
            q.preloaded = true;
            q.pending = Some((n, duration));
        }
    }

    fn promote_preloaded(&self) -> Option<TrackChanged> {
        let (index, id, duration) = {
            let mut q = self.queue.lock().unwrap();
            let (index, duration) = q.pending?;
            let item = q.items.get(index)?;
            let (id, path) = (item.id, item.path.clone());
            q.index = index;
            q.preloaded = false;
            q.pending = None;
            q.history.insert(0, (id, path.clone()));
            q.history.truncate(100);
            (index, id, duration)
        };
        *self.duration.lock().unwrap() = duration;
        *self.pending_seek.lock().unwrap() = None;
        self.persist();
        Some(TrackChanged { index, id })
    }

    fn load_at(&self, index: usize, emit: &Option<&AppHandle>) -> Result<f64, String> {
        let (path, id) = {
            let q = self.queue.lock().unwrap();
            let item = q.items.get(index).ok_or("队列越界")?;
            (item.path.clone(), item.id)
        };
        let (src, duration) = self.build_source(&path)?;
        self.with_player(|player| {
            player.clear();
            player.append(src);
            player.play();
        });
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
            self.with_player(Player::pause);
        }
        self.snapshot()
    }

    pub fn prev(&self, app: &AppHandle) -> PlaybackEvent {
        let restarted = self.with_player(|player| {
            if player.get_pos() > Duration::from_secs(3) {
                let _ = player.try_seek(Duration::ZERO);
                true
            } else {
                false
            }
        });
        if restarted {
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
        if self.with_player(Player::is_paused) {
            let pending = self.pending_seek.lock().unwrap().take();
            self.with_player(|player| {
                player.play();
                if let Some(pos) = pending {
                    let _ = player.try_seek(Duration::from_secs_f64(pos));
                }
            });
        } else {
            self.with_player(Player::pause);
        }
        self.snapshot()
    }

    pub fn seek(&self, pos: f64) -> Result<PlaybackEvent, String> {
        let pos = pos.max(0.0);
        if self.with_player(Player::is_paused) {
            // ponytail: rodio 0.22 never polls the source while paused, so a
            // seek here would block forever; defer until resume.
            *self.pending_seek.lock().unwrap() = Some(pos);
            return Ok(self.snapshot());
        }
        self.with_player(|player| player.try_seek(Duration::from_secs_f64(pos)))
            .map_err(|e| format!("seek 失败: {e}"))?;
        Ok(self.snapshot())
    }

    pub fn set_volume(&self, v: f64) -> PlaybackEvent {
        let v = v.clamp(0.0, 1.0);
        self.with_player(|player| player.set_volume(v as f32));
        crate::library::set_setting(&self.db, "volume", &v.to_string());
        if v > 0.0 {
            crate::library::set_setting(&self.db, "last_volume", &v.to_string());
        }
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
        let pending = *self.pending_seek.lock().unwrap();
        let position =
            pending.unwrap_or_else(|| self.with_player(|player| player.get_pos().as_secs_f64()));
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
        let last_volume = crate::library::get_setting(&self.db, "last_volume")
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(if volume > 0.0 { volume } else { 0.8 });
        self.with_player(|player| player.set_volume(volume as f32));

        let dto =
            crate::library::load_queue_state(&self.db).unwrap_or(crate::library::RestoreDto {
                volume,
                last_volume,
                ..Default::default()
            });
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
            self.with_player(|player| {
                player.clear();
                player.append(src);
                player.pause();
            });
            *self.duration.lock().unwrap() = duration;
            *self.pending_seek.lock().unwrap() = Some(dto.position.max(0.0));
            let mut q = self.queue.lock().unwrap();
            q.index = index;
            self.preload(&mut q);
        }
        Some(dto)
    }

    pub fn snapshot(&self) -> PlaybackEvent {
        let (track_id, duration) = {
            let q = self.queue.lock().unwrap();
            (
                q.items.get(q.index).map(|i| i.id),
                *self.duration.lock().unwrap(),
            )
        };
        let pending = *self.pending_seek.lock().unwrap();
        let (player_position, paused, empty) = self.with_player(|player| {
            (
                player.get_pos().as_secs_f64(),
                player.is_paused(),
                player.empty(),
            )
        });
        PlaybackEvent {
            track_id,
            position: pending.unwrap_or(player_position),
            duration,
            playing: !paused && !empty,
        }
    }

    /// emitter-thread tick: gapless promotion + auto-advance
    pub fn tick(&self, app: &AppHandle) {
        let mut ticks = self.ticks.lock().unwrap();
        *ticks += 1;
        let do_persist = (*ticks).is_multiple_of(20);
        let check_output = (*ticks).is_multiple_of(4);
        drop(ticks);
        if do_persist {
            self.persist();
        }
        let promote = {
            let q = self.queue.lock().unwrap();
            q.preloaded && self.with_player(|player| player.len()) == 1
        };
        if promote {
            if let Some(change) = self.promote_preloaded() {
                let _ = app.emit("track-changed", change);
                let mut q = self.queue.lock().unwrap();
                self.preload(&mut q);
            }
        } else if self.with_player(Player::empty) {
            let (repeat_one, idx, has) = {
                let q = self.queue.lock().unwrap();
                (q.repeat == RepeatMode::One, q.index, !q.items.is_empty())
            };
            if repeat_one && has {
                let _ = self.load_at(idx, &Some(app));
            } else if has {
                let n = {
                    let q = self.queue.lock().unwrap();
                    Self::next_index(&q, q.index)
                };
                if let Some(n) = n {
                    let _ = self.load_at(n, &Some(app));
                }
            }
        }
        if check_output {
            if let Err(error) = self.refresh_output_device(false) {
                eprintln!("无法切换默认音频输出设备: {error}");
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
        let first = dir.join("first.wav");
        let wav = dir.join("tone.wav");
        std::fs::write(&first, wav_bytes(1)).unwrap();
        std::fs::write(&wav, wav_bytes(3)).unwrap();

        let db = Arc::new(Mutex::new(
            crate::database::open(std::path::Path::new(":memory:")).unwrap(),
        ));
        {
            let conn = db.lock().unwrap();
            conn.execute(
                "INSERT INTO folders(id, path, added_at) VALUES (1, ?1, 0)",
                [dir.to_string_lossy()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tracks(id, path, title, mtime, folder_id) VALUES (1, ?1, 'first', 0, 1)",
                [first.to_string_lossy()],
            )
            .unwrap();
            conn.execute(
                "INSERT INTO tracks(id, path, title, mtime, folder_id) VALUES (2, ?1, 'tone', 0, 1)",
                [wav.to_string_lossy()],
            )
            .unwrap();
        }
        let svc = PlayerService::new(db.clone()).expect("open default audio device");
        svc.set_volume(0.25);
        svc.set_volume(0.0);
        let empty = svc.restore().expect("restore settings without a queue");
        assert!(empty.queue.is_empty());
        assert_eq!(empty.volume, 0.0);
        assert!((empty.last_volume - 0.25).abs() < 1e-6);

        let ev = svc
            .play_queue(
                vec![
                    QueueItemDto {
                        id: 1,
                        path: first.to_string_lossy().into_owned(),
                    },
                    QueueItemDto {
                        id: 2,
                        path: wav.to_string_lossy().into_owned(),
                    },
                ],
                0,
            )
            .expect("load queue");
        assert!(ev.playing);

        svc.set_volume(0.3);
        std::thread::sleep(Duration::from_millis(200));
        let before_switch = svc.snapshot().position;
        assert!(!svc.refresh_output_device(false).unwrap());
        assert!(svc.refresh_output_device(true).unwrap());
        let after_switch = svc.snapshot();
        assert!(after_switch.playing);
        assert_eq!(after_switch.track_id, Some(1));
        assert!(
            (after_switch.position - before_switch).abs() < 0.4,
            "device switch moved from {before_switch} to {}",
            after_switch.position
        );
        assert!((svc.with_player(Player::volume) - 0.3).abs() < 1e-6);
        assert!(svc.queue.lock().unwrap().preloaded);
        assert_eq!(svc.with_player(Player::len), 2);

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        while svc.with_player(|player| player.len()) != 1 && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        assert_eq!(
            svc.with_player(|player| player.len()),
            1,
            "preloaded track should take over"
        );
        let change = svc.promote_preloaded().expect("promote preloaded track");
        assert_eq!((change.index, change.id), (1, 2));
        assert!((*svc.duration.lock().unwrap() - 3.0).abs() < 0.01);
        assert_eq!(svc.queue.lock().unwrap().history[0].0, 2);

        std::thread::sleep(Duration::from_millis(300));
        let ev = svc.snapshot();
        assert_eq!(ev.track_id, Some(2));
        assert!(
            ev.position > 0.1,
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
        svc.set_volume(0.0);
        assert!(!svc.toggle().playing);
        svc.persist();
        drop(svc);

        let restored = PlayerService::new(db).expect("reopen default audio device");
        let state = restored.restore().expect("restore persisted queue");
        assert_eq!(state.queue.len(), 2);
        assert_eq!(state.volume, 0.0);
        assert!((state.last_volume - 0.3).abs() < 1e-6);
        let ev = restored.snapshot();
        assert!(!ev.playing);
        assert!((ev.position - state.position).abs() < 1e-6);
        restored.persist();
        let persisted = crate::library::load_queue_state(&restored.db).unwrap();
        assert!((persisted.position - state.position).abs() < 1e-6);
        assert!(restored.toggle().playing);

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
