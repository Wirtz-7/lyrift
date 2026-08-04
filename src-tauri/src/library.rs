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
        Ok(FolderDto {
            id: r.get(0)?,
            path: r.get(1)?,
        })
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

struct Parsed {
    path: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    track_number: Option<i32>,
    year: Option<i32>,
    cover: Option<String>,
    mtime: i64,
    folder_id: i64,
}

fn parse_one(path: &Path, mtime: i64, folder_id: i64, covers: &Path) -> Result<Parsed, String> {
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
        if a.is_empty() {
            get(&ItemKey::AlbumArtist)
        } else {
            a
        }
    };
    let artist = if artist.is_empty() {
        "未知歌手".into()
    } else {
        artist
    };
    let album = {
        let a = get(&ItemKey::AlbumTitle);
        if a.is_empty() {
            "未知专辑".into()
        } else {
            a
        }
    };
    let track_number = get(&ItemKey::TrackNumber)
        .split('/')
        .next()
        .and_then(|v| v.trim().parse().ok());
    let year = get(&ItemKey::Year).trim().parse().ok();
    let duration = tagged.properties().duration().as_secs_f64();
    let cover = tag.and_then(|t| t.pictures().first()).and_then(|pic| {
        pic.mime_type()
            .and_then(|m| save_cover(pic.data(), m, covers))
    });
    Ok(Parsed {
        path: path.to_string_lossy().into_owned(),
        title,
        artist,
        album,
        duration,
        track_number,
        year,
        cover,
        mtime,
        folder_id,
    })
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
            .query_map([folder_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })
            .map_err(|e| e.to_string())?;
        for (p, m) in rows.flatten() {
            known.insert(p, m);
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
                    row.path, row.title, row.artist, row.album, row.duration,
                    row.track_number, row.year, row.cover, row.mtime, row.folder_id
                ])
                .map_err(|e| e.to_string())?;
            }
            Err(_) => {
                // unparseable file: keep a minimal row so it still shows up
                up.execute(params![
                    path_str,
                    file.file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_default(),
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
        .query_row(
            "SELECT id FROM folders WHERE path = ?1",
            [path.to_string_lossy()],
            |r| r.get(0),
        )
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

pub fn rescan_all(
    db: &Arc<Mutex<Connection>>,
    covers: &Path,
    app: Option<&AppHandle>,
) -> Result<(), String> {
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

// ---------- step 9: queries, collections, settings, state persistence ----------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AlbumDto {
    pub name: String,
    pub artist: String,
    pub year: Option<i32>,
    pub cover: Option<String>,
    pub count: i64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ArtistDto {
    pub name: String,
    pub albums: i64,
    pub tracks: i64,
    pub cover: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct PlaylistDto {
    pub id: i64,
    pub name: String,
}

fn query_tracks(conn: &Connection, sql: &str, params: impl rusqlite::Params) -> Vec<TrackDto> {
    let mut stmt = match conn.prepare(sql) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map(params, |r| {
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

const TRACK_COLS: &str = "id, path, title, artist, album, duration, track_number, year, cover";

pub fn search_tracks(db: &Arc<Mutex<Connection>>, q: &str) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let like = format!("%{q}%");
    query_tracks(
        &conn,
        &format!(
            "SELECT {TRACK_COLS} FROM tracks
             WHERE title LIKE ?1 OR artist LIKE ?1 OR album LIKE ?1
             ORDER BY album, track_number, title"
        ),
        [like],
    )
}

pub fn albums(db: &Arc<Mutex<Connection>>) -> Vec<AlbumDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT album, artist, MAX(year), MAX(cover), COUNT(*)
         FROM tracks WHERE album != '' GROUP BY album, artist
         ORDER BY MAX(year) DESC, album",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| {
        Ok(AlbumDto {
            name: r.get(0)?,
            artist: r.get(1)?,
            year: r.get(2)?,
            cover: r.get(3)?,
            count: r.get(4)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn artists(db: &Arc<Mutex<Connection>>) -> Vec<ArtistDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare(
        "SELECT artist, COUNT(DISTINCT album), COUNT(*), MAX(cover)
         FROM tracks WHERE artist != '' GROUP BY artist ORDER BY artist",
    ) {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| {
        Ok(ArtistDto {
            name: r.get(0)?,
            albums: r.get(1)?,
            tracks: r.get(2)?,
            cover: r.get(3)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn tracks_by_album(db: &Arc<Mutex<Connection>>, album: &str, artist: &str) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    query_tracks(
        &conn,
        &format!(
            "SELECT {TRACK_COLS} FROM tracks WHERE album = ?1 AND artist = ?2
             ORDER BY track_number, title"
        ),
        params![album, artist],
    )
}

pub fn tracks_by_artist(db: &Arc<Mutex<Connection>>, artist: &str) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    query_tracks(
        &conn,
        &format!(
            "SELECT {TRACK_COLS} FROM tracks WHERE artist = ?1
             ORDER BY album, track_number, title"
        ),
        params![artist],
    )
}

pub fn toggle_favorite(db: &Arc<Mutex<Connection>>, id: i64) -> Result<bool, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let n = conn
        .execute("DELETE FROM favorites WHERE track_id = ?1", [id])
        .map_err(|e| e.to_string())?;
    if n > 0 {
        return Ok(false);
    }
    conn.execute("INSERT INTO favorites(track_id) VALUES (?1)", [id])
        .map_err(|e| e.to_string())?;
    Ok(true)
}

pub fn favorite_ids(db: &Arc<Mutex<Connection>>) -> Vec<i64> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare("SELECT track_id FROM favorites") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| r.get::<_, i64>(0))
        .map(|rows| rows.filter_map(|r| r.ok()).collect())
        .unwrap_or_default()
}

pub fn favorites(db: &Arc<Mutex<Connection>>) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    query_tracks(
        &conn,
        &format!(
            "SELECT t.{c} FROM tracks t JOIN favorites f ON f.track_id = t.id
             ORDER BY t.album, t.track_number",
            c = TRACK_COLS.replace(", ", ", t.").replace("t.id,", "id,")
        ),
        [],
    )
}

pub fn create_playlist(db: &Arc<Mutex<Connection>>, name: &str) -> Result<i64, String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let now = std::time::SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO playlists(name, created_at) VALUES (?1, ?2)",
        params![name, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_playlist(db: &Arc<Mutex<Connection>>, id: i64) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM playlists WHERE id = ?1", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn rename_playlist(db: &Arc<Mutex<Connection>>, id: i64, name: &str) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE playlists SET name = ?2 WHERE id = ?1",
        params![id, name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn playlists(db: &Arc<Mutex<Connection>>) -> Vec<PlaylistDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    let mut stmt = match conn.prepare("SELECT id, name FROM playlists ORDER BY id") {
        Ok(s) => s,
        Err(_) => return vec![],
    };
    stmt.query_map([], |r| {
        Ok(PlaylistDto {
            id: r.get(0)?,
            name: r.get(1)?,
        })
    })
    .map(|rows| rows.filter_map(|r| r.ok()).collect())
    .unwrap_or_default()
}

pub fn playlist_tracks(db: &Arc<Mutex<Connection>>, id: i64) -> Vec<TrackDto> {
    let conn = match db.lock() {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    query_tracks(
        &conn,
        "SELECT t.id, t.path, t.title, t.artist, t.album, t.duration, t.track_number, t.year, t.cover
             FROM playlist_items pi JOIN tracks t ON t.id = pi.track_id
             WHERE pi.playlist_id = ?1 ORDER BY pi.position",
        [id],
    )
}

pub fn playlist_add(db: &Arc<Mutex<Connection>>, pid: i64, tid: i64) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    let pos: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_items WHERE playlist_id = ?1",
            [pid],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO playlist_items(playlist_id, track_id, position) VALUES (?1, ?2, ?3)",
        params![pid, tid, pos],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn playlist_remove(db: &Arc<Mutex<Connection>>, pid: i64, tid: i64) -> Result<(), String> {
    let conn = db.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM playlist_items WHERE playlist_id = ?1 AND track_id = ?2",
        params![pid, tid],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_setting(db: &Arc<Mutex<Connection>>, key: &str, value: &str) {
    if let Ok(conn) = db.lock() {
        let _ = conn.execute(
            "INSERT INTO settings(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        );
    }
}

pub fn get_setting(db: &Arc<Mutex<Connection>>, key: &str) -> Option<String> {
    let conn = db.lock().ok()?;
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
        r.get(0)
    })
    .ok()
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RestoreDto {
    pub queue: Vec<TrackDto>,
    pub index: i64,
    pub history: Vec<TrackDto>,
    pub position: f64,
    pub volume: f64,
}

pub fn save_queue_state(
    db: &Arc<Mutex<Connection>>,
    queue: &[(i64, String)],
    index: usize,
    history: &[(i64, String)],
    position: f64,
) {
    let Ok(q) = serde_json::to_string(queue) else {
        return;
    };
    let Ok(h) = serde_json::to_string(history) else {
        return;
    };
    if let Ok(conn) = db.lock() {
        let _ = conn.execute(
            "INSERT INTO queue_state(id, queue, queue_index, history, position)
             VALUES (1, ?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET queue=excluded.queue,
               queue_index=excluded.queue_index, history=excluded.history,
               position=excluded.position",
            params![q, index as i64, h, position],
        );
    }
}

pub fn load_queue_state(db: &Arc<Mutex<Connection>>) -> Option<RestoreDto> {
    let conn = db.lock().ok()?;
    let (q, index, h, position): (String, i64, String, f64) = conn
        .query_row(
            "SELECT queue, queue_index, history, position FROM queue_state WHERE id = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .ok()?;
    let qv: Vec<(i64, String)> = serde_json::from_str(&q).ok()?;
    let hv: Vec<(i64, String)> = serde_json::from_str(&h).ok()?;
    let resolve = |v: Vec<(i64, String)>| -> Vec<TrackDto> {
        let mut out = vec![];
        for (_, path) in v {
            let mut rows = query_tracks(
                &conn,
                &format!("SELECT {TRACK_COLS} FROM tracks WHERE path = ?1"),
                [&path],
            );
            if let Some(r) = rows.pop() {
                out.push(r);
            }
        }
        out
    };
    Some(RestoreDto {
        queue: resolve(qv),
        index,
        history: resolve(hv),
        position,
        volume: get_setting(db, "volume")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0.8),
    })
}
