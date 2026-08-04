use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use lofty::picture::MimeType;
use lofty::prelude::{AudioFile, ItemKey, TaggedFileExt};
use lofty::probe::Probe;
use rusqlite::{params, Connection};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

const AUDIO_EXTS: [&str; 7] = ["mp3", "flac", "wav", "ogg", "oga", "m4a", "aac"];

pub fn is_audio(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrackDto {
    pub id: i64,
    pub path: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: f64,
    pub track_number: Option<i32>,
    pub year: Option<i32>,
    pub cover: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct FolderDto {
    pub id: i64,
    pub path: String,
}

#[derive(Serialize, Clone)]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
}

fn emit_progress(app: Option<&AppHandle>, done: usize, total: usize) {
    if let Some(app) = app {
        let _ = app.emit("scan-progress", ScanProgress { done, total });
    }
}

fn mtime_of(p: &Path) -> i64 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn folder_paths(db: &Arc<Mutex<Connection>>) -> Vec<PathBuf> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare("SELECT path FROM folders") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| r.get::<_, String>(0))
        .map(|rows| rows.filter_map(|r| r.ok().map(PathBuf::from)).collect())
        .unwrap_or_default()
}

pub fn list_folders(db: &Arc<Mutex<Connection>>) -> Vec<FolderDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare("SELECT id, path FROM folders ORDER BY id") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| {
        Ok(FolderDto { id: r.get(0)?, path: r.get(1)? })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn list_tracks(db: &Arc<Mutex<Connection>>) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT id, path, title, artist, album, duration, track_number, year, cover
         FROM tracks ORDER BY album, track_number, title",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| {
        Ok(TrackDto {
            id: r.get(0)?,
            path: r.get(1)?,
            title: r.get(2)?,
            artist: r.get(3)?,
            album: r.get(4)?,
            duration: r.get(5)?,
            track_number: r.get(6)?,
            year: r.get(7)?,
            cover: r.get(8)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

fn save_cover(data: &[u8], mime: &MimeType, dir: &Path) -> Option<String> {
    let ext = match mime {
        MimeType::Png => "png",
        MimeType::Jpeg => "jpg",
        MimeType::Bmp => "bmp",
        _ => return None,
    };
    let mut h = DefaultHasher::new();
    data.hash(&mut h);
    let path = dir.join(format!("{:x}.{}", h.finish(), ext));
    if !path.exists() {
        std::fs::write(&path, data).ok()?;
    }
    Some(path.to_string_lossy().into_owned())
}

fn parse_one(
    path: &Path,
    mtime: i64,
    folder_id: i64,
    covers: &Path,
) -> Result<(String, String, String, String, f64, Option<i32>, Option<i32>, Option<String>, i64, i64), String>
{
    let tagged = Probe::open(path)
        .map_err(|e| e.to_string())?
        .read()
        .map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let get = |k: &ItemKey| {
        tag.and_then(|t| t.get_string(k))
            .map(|s| s.to_string())
            .unwrap_or_default()
    };
    let title = {
        let t = get(&ItemKey::TrackTitle);
        if t.is_empty() {
            path.file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "未知标题".into())
        } else {
            t
        }
    };
    let artist = {
        let a = get(&ItemKey::TrackArtist);
        if a.is_empty() { get(&ItemKey::AlbumArtist) } else { a }
    };
    let artist = if artist.is_empty() { "未知歌手".into() } else { artist };
    let album = {
        let a = get(&ItemKey::AlbumTitle);
        if a.is_empty() { "未知专辑".into() } else { a }
    };
    let track_number = get(&ItemKey::TrackNumber)
        .split('/')
        .next()
        .and_then(|v| v.trim().parse().ok());
    let year = get(&ItemKey::Year).trim().parse().ok();
    let duration = tagged.properties().duration().as_secs_f64();
    let cover = tag
        .and_then(|t| t.pictures().first())
        .and_then(|pic| pic.mime_type().and_then(|m| save_cover(pic.data(), m, covers)));
    Ok((
        path.to_string_lossy().into_owned(),
        title,
        artist,
        album,
        duration,
        track_number,
        year,
        cover,
        mtime,
        folder_id,
    ))
}

pub fn scan_folder(
    conn: &Connection,
    folder_id: i64,
    folder: &Path,
    covers: &Path,
    app: Option<&AppHandle>,
) -> Result<usize, String> {
    let files: Vec<PathBuf> = WalkDir::new(folder)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
        .map(|e| e.into_path())
        .filter(|p| p.is_file() && is_audio(p))
        .collect();
    let total = files.len();

    // existing rows for mtime skip
    let mut known: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    {
        let mut stmt = conn
            .prepare("SELECT path, mtime FROM tracks WHERE folder_id = ?1")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([folder_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for r in rows {
            if let Ok((p, m)) = r {
                known.insert(p, m);
            }
        }
    }

    let mut scanned: Vec<String> = Vec::with_capacity(total);
    let mut up = conn
        .prepare(
            "INSERT INTO tracks(path, title, artist, album, duration, track_number, year, cover, mtime, folder_id)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
             ON CONFLICT(path) DO UPDATE SET
               title=excluded.title, artist=excluded.artist, album=excluded.album,
               duration=excluded.duration, track_number=excluded.track_number,
               year=excluded.year, cover=excluded.cover, mtime=excluded.mtime,
               folder_id=excluded.folder_id",
        )
        .map_err(|e| e.to_string())?;

    for (done, file) in files.iter().enumerate() {
        let path_str = file.to_string_lossy().into_owned();
        let mtime = mtime_of(file);
        scanned.push(path_str.clone());
        // skip unchanged files
        if known.get(&path_str) == Some(&mtime) {
            continue;
        }
        match parse_one(file, mtime, folder_id, covers) {
            Ok(row) => {
                up.execute(params![
                    row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9
                ])
                .map_err(|e| e.to_string())?;
            }
            Err(_) => {
                // unparseable file: keep a minimal row so it still shows up
                up.execute(params![
                    path_str,
                    file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
                    "未知歌手",
                    "未知专辑",
                    0.0,
                    None::<i32>,
                    None::<i32>,
                    None::<String>,
                    mtime,
                    folder_id
                ])
                .map_err(|e| e.to_string())?;
            }
        }
        if done % 10 == 0 {
            emit_progress(app, done, total);
        }
    }
    drop(up);

    // safe delete: only after a successful scan, remove rows that vanished
    let json = serde_json::to_string(&scanned).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM tracks WHERE folder_id = ?1 AND path NOT IN (SELECT value FROM json_each(?2))",
        params![folder_id, json],
    )
    .map_err(|e| e.to_string())?;

    emit_progress(app, total, total);
    Ok(total)
}

pub fn add_folder(
    db: &Arc<Mutex<Connection>>,
    path: &Path,
    covers: &Path,
    app: Option<&AppHandle>,
) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO folders(path, added_at) VALUES (?1, ?2) ON CONFLICT(path) DO NOTHING",
        params![path.to_string_lossy(), now],
    )
    .map_err(|e| e.to_string())?;
    let id: i64 = conn
        .query_row("SELECT id FROM folders WHERE path = ?1", [path.to_string_lossy()], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    scan_folder(&conn, id, path, covers, app)?;
    Ok(())
}

pub fn remove_folder(db: &Arc<Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM folders WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rescan_all(db: &Arc<Mutex<Connection>>, covers: &Path, app: Option<&AppHandle>) -> Result<(), String> {
    let folders = list_folders(db);
    for f in &folders {
        let conn = db.lock().map_err(|e| e.to_string())?;
        let _ = scan_folder(&conn, f.id, Path::new(&f.path), covers, app);
    }
    if let Some(app) = app {
        let _ = app.emit("library-changed", ());
    }
    Ok(())
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
    fn scan_upsert_and_safe_delete() {
        let dir = std::env::temp_dir().join(format!("lyrift-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("one.wav"), wav_bytes(1)).unwrap();
        std::fs::write(dir.join("two.wav"), wav_bytes(1)).unwrap();
        let covers = dir.join("covers");
        std::fs::create_dir_all(&covers).unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE folders(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, added_at INTEGER NOT NULL);
             CREATE TABLE tracks(id INTEGER PRIMARY KEY, path TEXT UNIQUE NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL DEFAULT '', album TEXT NOT NULL DEFAULT '', duration REAL NOT NULL DEFAULT 0, track_number INTEGER, year INTEGER, cover TEXT, mtime INTEGER NOT NULL, folder_id INTEGER NOT NULL);",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO folders(path, added_at) VALUES (?1, 0)",
            [dir.to_string_lossy()],
        )
        .unwrap();

        let n = scan_folder(&conn, 1, &dir, &covers, None).unwrap();
        assert_eq!(n, 2);
        let rows = list_tracks_raw(&conn);
        assert_eq!(rows.len(), 2);
        let first_id = rows[0].0;

        // idempotent rescan keeps ids
        scan_folder(&conn, 1, &dir, &covers, None).unwrap();
        let rows2 = list_tracks_raw(&conn);
        assert_eq!(rows2.len(), 2);
        assert!(rows2.iter().any(|r| r.0 == first_id));

        // safe delete after removing a file
        std::fs::remove_file(dir.join("two.wav")).unwrap();
        scan_folder(&conn, 1, &dir, &covers, None).unwrap();
        let rows3 = list_tracks_raw(&conn);
        assert_eq!(rows3.len(), 1);
        assert!(rows3[0].1.ends_with("one.wav"));

        std::fs::remove_dir_all(&dir).unwrap();
    }

    fn list_tracks_raw(conn: &Connection) -> Vec<(i64, String)> {
        let mut stmt = conn.prepare("SELECT id, path FROM tracks").unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .filter_map(|r| r.ok())
            .collect()
    }
}
