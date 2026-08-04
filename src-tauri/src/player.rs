use std::fs::File;
use std::io::BufReader;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use rodio::decoder::DecoderBuilder;
use rodio::source::Source;
use rodio::{DeviceSinkBuilder, MixerDeviceSink, Player};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PlaybackEvent {
    pub track_id: Option<i64>,
    pub position: f64,
    pub duration: f64,
    pub playing: bool,
}

struct CurrentInfo {
    id: i64,
    duration: f64,
}

pub struct PlayerService {
    // keeps the audio device alive
    _device: MixerDeviceSink,
    player: Player,
    current: Mutex<Option<CurrentInfo>>,
    ended_sent: Mutex<bool>,
}

impl PlayerService {
    pub fn new() -> Result<Self, String> {
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
            current: Mutex::new(None),
            ended_sent: Mutex::new(true),
        })
    }

    pub fn load(&self, id: i64, path: &str) -> Result<PlaybackEvent, String> {
        let file = File::open(path).map_err(|e| format!("无法打开音频文件: {e}"))?;
        let decoder = DecoderBuilder::new()
            .with_data(BufReader::new(file))
            .with_seekable(true)
            .with_gapless(true)
            .build()
            .map_err(|e| format!("解码失败: {e}"))?;
        let duration = decoder.total_duration().map(|d| d.as_secs_f64()).unwrap_or(0.0);
        self.player.clear();
        self.player.append(decoder);
        self.player.play();
        *self.current.lock().unwrap() = Some(CurrentInfo { id, duration });
        *self.ended_sent.lock().unwrap() = false;
        Ok(self.snapshot())
    }

    pub fn toggle(&self) -> PlaybackEvent {
        if self.player.is_paused() {
            self.player.play();
        } else {
            self.player.pause();
        }
        self.snapshot()
    }

    pub fn seek(&self, pos: f64) -> Result<PlaybackEvent, String> {
        self.player
            .try_seek(Duration::from_secs_f64(pos.max(0.0)))
            .map_err(|e| format!("seek 失败: {e}"))?;
        Ok(self.snapshot())
    }

    pub fn set_volume(&self, v: f64) -> PlaybackEvent {
        self.player.set_volume(v.clamp(0.0, 1.0) as f32);
        self.snapshot()
    }

    pub fn snapshot(&self) -> PlaybackEvent {
        let current = self.current.lock().unwrap();
        PlaybackEvent {
            track_id: current.as_ref().map(|c| c.id),
            position: self.player.get_pos().as_secs_f64(),
            duration: current.as_ref().map(|c| c.duration).unwrap_or(0.0),
            playing: !self.player.is_paused() && !self.player.empty(),
        }
    }

    /// called by the emitter thread; returns true exactly once per track end
    pub fn take_ended(&self) -> bool {
        if self.player.empty() && self.current.lock().unwrap().is_some() {
            let mut sent = self.ended_sent.lock().unwrap();
            if !*sent {
                *sent = true;
                return true;
            }
        }
        false
    }
}

pub fn spawn_emitter(service: Arc<PlayerService>, app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        let _ = app.emit("playback", service.snapshot());
        if service.take_ended() {
            let _ = app.emit("track-ended", ());
        }
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

        let svc = PlayerService::new().expect("open default audio device");
        let ev = svc.load(1, wav.to_str().unwrap()).expect("load wav");
        assert!(ev.playing);
        assert!((ev.duration - 3.0).abs() < 0.2);

        std::thread::sleep(Duration::from_millis(700));
        let ev = svc.snapshot();
        assert!(ev.position > 0.2, "position should advance, got {}", ev.position);

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
}
