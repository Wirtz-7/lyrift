use rusqlite::Connection;
use std::path::Path;

const SCHEMA_VERSION: i64 = 1;

const SCHEMA_V1: &str = "
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
    );";

pub fn open(path: &Path) -> rusqlite::Result<Connection> {
    let mut conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    if version < SCHEMA_VERSION {
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA_V1)?;
        tx.pragma_update(None, "user_version", SCHEMA_VERSION)?;
        tx.commit()?;
    }
    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_has_current_version() {
        let conn = open(Path::new(":memory:")).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn adopts_legacy_schema_without_losing_data() {
        let path = std::env::temp_dir().join(format!("lyrift-db-{}.sqlite", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch(SCHEMA_V1).unwrap();
        legacy
            .execute(
                "INSERT INTO settings(key, value) VALUES ('volume', '0.25')",
                [],
            )
            .unwrap();
        drop(legacy);

        let conn = open(&path).unwrap();
        let version: i64 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        let volume: String = conn
            .query_row("SELECT value FROM settings WHERE key = 'volume'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        assert_eq!(volume, "0.25");
        drop(conn);
        std::fs::remove_file(path).unwrap();
    }
}
