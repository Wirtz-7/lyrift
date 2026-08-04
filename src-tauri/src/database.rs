use rusqlite::Connection;
use std::path::Path;

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         PRAGMA foreign_keys=ON;
         CREATE TABLE IF NOT EXISTS folders(
           id INTEGER PRIMARY KEY,
           path TEXT UNIQUE NOT NULL,
           added_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tracks(
           id INTEGER PRIMARY KEY,
           path TEXT UNIQUE NOT NULL,
           title TEXT NOT NULL,
           artist TEXT NOT NULL DEFAULT '',
           album TEXT NOT NULL DEFAULT '',
           duration REAL NOT NULL DEFAULT 0,
           track_number INTEGER,
           year INTEGER,
           cover TEXT,
           mtime INTEGER NOT NULL,
           folder_id INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS favorites(
           track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS playlists(
           id INTEGER PRIMARY KEY,
           name TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS playlist_items(
           playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
           track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
           position INTEGER NOT NULL,
           PRIMARY KEY(playlist_id, position)
         );
         CREATE TABLE IF NOT EXISTS settings(
           key TEXT PRIMARY KEY,
           value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS queue_state(
           id INTEGER PRIMARY KEY CHECK (id = 1),
           queue TEXT NOT NULL,
           queue_index INTEGER NOT NULL,
           history TEXT NOT NULL,
           position REAL NOT NULL DEFAULT 0
         );",
    )?;
    Ok(conn)
}
