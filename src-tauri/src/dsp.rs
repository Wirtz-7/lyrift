use std::sync::{Arc, RwLock};

use biquad::{Biquad, Coefficients, DirectForm2Transposed, ToHertz, Type};
use rodio::Source;
use serde::{Deserialize, Serialize};

pub const BAND_FREQS: [f64; 10] = [
    32.0, 64.0, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

pub fn db_to_lin(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}

#[derive(Clone, Serialize, Deserialize)]
pub struct EqSettings {
    pub enabled: bool,
    /// dB
    pub preamp: f64,
    /// dB per band, aligned with BAND_FREQS
    pub gains: [f64; 10],
}

impl Default for EqSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preamp: 0.0,
            gains: [0.0; 10],
        }
    }
}

pub struct EqShared {
    pub gen: u64,
    pub settings: EqSettings,
}

impl EqShared {
    pub fn new() -> Arc<RwLock<Self>> {
        Arc::new(RwLock::new(Self {
            gen: 0,
            settings: EqSettings::default(),
        }))
    }
}

pub struct EqSource<I> {
    input: I,
    shared: Arc<RwLock<EqShared>>,
    gen: u64,
    enabled: bool,
    preamp: f64,
    filters: [DirectForm2Transposed<f64, f64>; 10],
}

impl<I: Source<Item = f32>> EqSource<I> {
    pub fn new(input: I, shared: Arc<RwLock<EqShared>>) -> Self {
        let mut s = Self {
            input,
            shared,
            gen: u64::MAX, // force rebuild on first sample
            enabled: false,
            preamp: 1.0,
            filters: [Self::unity(44100.0); 10],
        };
        s.sync();
        s
    }

    // ponytail: unity via 0 dB peaking keeps a single code path
    fn unity(rate: f64) -> DirectForm2Transposed<f64, f64> {
        let c = Coefficients::<f64>::from_params(
            Type::PeakingEQ(0.0),
            rate.hz(),
            (rate * 0.25).max(1.0).hz(),
            1.0,
        )
        .expect("unity coeffs");
        DirectForm2Transposed::new(c)
    }

    fn sync(&mut self) {
        let Ok(g) = self.shared.read() else { return };
        if g.gen == self.gen {
            return;
        }
        let rate = f64::from(self.input.sample_rate().get());
        self.gen = g.gen;
        self.enabled = g.settings.enabled;
        self.preamp = db_to_lin(g.settings.preamp);
        for (i, f) in self.filters.iter_mut().enumerate() {
            // Nyquist guard: park bands above 0.49 * rate at 0 dB
            let gain = if BAND_FREQS[i] < rate * 0.49 {
                g.settings.gains[i]
            } else {
                0.0
            };
            let c = Coefficients::<f64>::from_params(
                Type::PeakingEQ(gain),
                rate.hz(),
                BAND_FREQS[i].hz(),
                1.0,
            );
            *f = match c {
                Ok(c) => DirectForm2Transposed::new(c),
                Err(_) => Self::unity(rate),
            };
        }
    }
}

impl<I: Source<Item = f32>> Iterator for EqSource<I> {
    type Item = f32;
    fn next(&mut self) -> Option<f32> {
        let x = self.input.next()?;
        self.sync();
        if !self.enabled {
            return Some(x);
        }
        let mut y = x as f64 * self.preamp;
        for f in self.filters.iter_mut() {
            y = f.run(y);
        }
        Some(y as f32)
    }
}

impl<I: Source<Item = f32>> Source for EqSource<I> {
    fn current_span_len(&self) -> Option<usize> {
        self.input.current_span_len()
    }
    fn channels(&self) -> rodio::ChannelCount {
        self.input.channels()
    }
    fn sample_rate(&self) -> rodio::SampleRate {
        self.input.sample_rate()
    }
    fn total_duration(&self) -> Option<std::time::Duration> {
        self.input.total_duration()
    }
    fn try_seek(&mut self, pos: std::time::Duration) -> Result<(), rodio::source::SeekError> {
        let r = self.input.try_seek(pos)?;
        // zero filter states to avoid post-seek transients
        for f in self.filters.iter_mut() {
            f.s1 = 0.0;
            f.s2 = 0.0;
        }
        Ok(r)
    }
}
