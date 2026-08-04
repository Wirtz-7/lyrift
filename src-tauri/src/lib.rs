mod database;
mod dsp;
mod library;
mod lyrics;
mod player;

use std::path::PathBuf;
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

use notify::Watcher;
use tauri::{AppHandle, Emitter, Manager};

pub struct AppState {
    pub db: Arc<Mutex<rusqlite::Connection>>,
    pub covers_dir: PathBuf,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
    pub player: Arc<player::PlayerService>,
}

#[tauri::command]
fn search(q: String, state: tauri::State<AppState>) -> Vec<library::TrackDto> {
    library::search_tracks(&state.db, &q)
}

#[tauri::command]
fn albums(state: tauri::State<AppState>) -> Vec<library::AlbumDto> {
    library::albums(&state.db)
}

#[tauri::command]
fn artists(state: tauri::State<AppState>) -> Vec<library::ArtistDto> {
    library::artists(&state.db)
}

#[tauri::command]
fn album_tracks(
    album: String,
    artist: String,
    state: tauri::State<AppState>,
) -> Vec<library::TrackDto> {
    library::tracks_by_album(&state.db, &album, &artist)
}

#[tauri::command]
fn artist_tracks(artist: String, state: tauri::State<AppState>) -> Vec<library::TrackDto> {
    library::tracks_by_artist(&state.db, &artist)
}

#[tauri::command]
fn toggle_favorite(id: i64, state: tauri::State<AppState>) -> Result<bool, String> {
    library::toggle_favorite(&state.db, id)
}

#[tauri::command]
fn favorite_ids(state: tauri::State<AppState>) -> Vec<i64> {
    library::favorite_ids(&state.db)
}

#[tauri::command]
fn favorites(state: tauri::State<AppState>) -> Vec<library::TrackDto> {
    library::favorites(&state.db)
}

#[tauri::command]
fn create_playlist(name: String, state: tauri::State<AppState>) -> Result<i64, String> {
    library::create_playlist(&state.db, &name)
}

#[tauri::command]
fn delete_playlist(id: i64, state: tauri::State<AppState>) -> Result<(), String> {
    library::delete_playlist(&state.db, id)
}

#[tauri::command]
fn rename_playlist(id: i64, name: String, state: tauri::State<AppState>) -> Result<(), String> {
    library::rename_playlist(&state.db, id, &name)
}

#[tauri::command]
fn playlists(state: tauri::State<AppState>) -> Vec<library::PlaylistDto> {
    library::playlists(&state.db)
}

#[tauri::command]
fn playlist_tracks(id: i64, state: tauri::State<AppState>) -> Vec<library::TrackDto> {
    library::playlist_tracks(&state.db, id)
}

#[tauri::command]
fn playlist_add(pid: i64, tid: i64, state: tauri::State<AppState>) -> Result<(), String> {
    library::playlist_add(&state.db, pid, tid)
}

#[tauri::command]
fn playlist_remove(pid: i64, tid: i64, state: tauri::State<AppState>) -> Result<(), String> {
    library::playlist_remove(&state.db, pid, tid)
}

#[tauri::command]
fn restore(state: tauri::State<AppState>) -> library::RestoreDto {
    state.player.restore().unwrap_or_default()
}

#[tauri::command]
fn lyrics_for(path: String) -> lyrics::LyricDto {
    lyrics::load_lyrics(std::path::Path::new(&path))
}

#[tauri::command]
fn play_queue(
    items: Vec<player::QueueItemDto>,
    index: usize,
    state: tauri::State<AppState>,
) -> Result<player::PlaybackEvent, String> {
    state.player.play_queue(items, index)
}

#[tauri::command]
fn queue_next(state: tauri::State<AppState>, app: AppHandle) -> player::PlaybackEvent {
    state.player.next(&app)
}

#[tauri::command]
fn queue_prev(state: tauri::State<AppState>, app: AppHandle) -> player::PlaybackEvent {
    state.player.prev(&app)
}

#[tauri::command]
fn set_shuffle(on: bool, state: tauri::State<AppState>) {
    state.player.set_shuffle(on)
}

#[tauri::command]
fn set_repeat(mode: player::RepeatMode, state: tauri::State<AppState>) {
    state.player.set_repeat(mode)
}

#[tauri::command]
fn set_eq(settings: crate::dsp::EqSettings, state: tauri::State<AppState>) {
    state.player.set_eq(settings)
}

#[tauri::command]
fn set_replay_gain(mode: player::RgMode, state: tauri::State<AppState>) {
    state.player.set_replay_gain(mode)
}

#[tauri::command]
fn audio_settings(state: tauri::State<AppState>) -> player::AudioSettings {
    state.player.audio_settings()
}

#[tauri::command]
fn toggle_play(state: tauri::State<AppState>) -> player::PlaybackEvent {
    state.player.toggle()
}

#[tauri::command]
fn seek(pos: f64, state: tauri::State<AppState>) -> Result<player::PlaybackEvent, String> {
    state.player.seek(pos)
}

#[tauri::command]
fn set_volume(volume: f64, state: tauri::State<AppState>) -> player::PlaybackEvent {
    state.player.set_volume(volume)
}

#[tauri::command]
fn list_folders(state: tauri::State<AppState>) -> Vec<library::FolderDto> {
    library::list_folders(&state.db)
}

#[tauri::command]
fn list_tracks(state: tauri::State<AppState>) -> Vec<library::TrackDto> {
    library::list_tracks(&state.db)
}

#[tauri::command]
fn add_folder(path: String, state: tauri::State<AppState>, app: AppHandle) -> Result<(), String> {
    let p = PathBuf::from(&path);
    library::add_folder(&state.db, &p, &state.covers_dir, Some(&app))?;
    if let Ok(mut w) = state.watcher.lock() {
        if let Some(w) = w.as_mut() {
            let _ = w.watch(&p, notify::RecursiveMode::Recursive);
        }
    }
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
fn remove_folder(id: i64, state: tauri::State<AppState>, app: AppHandle) -> Result<(), String> {
    library::remove_folder(&state.db, id)?;
    let _ = app.emit("library-changed", ());
    Ok(())
}

#[tauri::command]
fn rescan(state: tauri::State<AppState>, app: AppHandle) -> Result<(), String> {
    library::rescan_all(&state.db, &state.covers_dir, Some(&app))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let covers_dir = app.path().app_cache_dir()?.join("covers");
            std::fs::create_dir_all(&covers_dir)?;

            let db = Arc::new(Mutex::new(
                database::open(&data_dir.join("lyrift.db")).expect("open sqlite"),
            ));

            // directory watcher with debounce -> rescan
            let (tx, rx) = mpsc::channel::<()>();
            let cb_tx = tx.clone();
            let mut watcher =
                notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
                    if let Ok(ev) = res {
                        if ev.paths.iter().any(|p| library::is_audio(p)) {
                            let _ = cb_tx.send(());
                        }
                    }
                })
                .ok();
            if let Some(w) = watcher.as_mut() {
                // watch already-known folders at startup
                for f in library::folder_paths(&db) {
                    let _ = w.watch(&f, notify::RecursiveMode::Recursive);
                }
            }
            let w_db = db.clone();
            let w_app = app.handle().clone();
            let w_covers = covers_dir.clone();
            std::thread::spawn(move || {
                while rx.recv().is_ok() {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    while rx.try_recv().is_ok() {}
                    let _ = library::rescan_all(&w_db, &w_covers, Some(&w_app));
                }
            });

            let player =
                Arc::new(player::PlayerService::new(db.clone()).expect("open audio device"));
            player::spawn_emitter(player.clone(), app.handle().clone());

            app.manage(AppState {
                db,
                covers_dir,
                watcher: Mutex::new(watcher),
                player,
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_folders,
            list_tracks,
            add_folder,
            remove_folder,
            rescan,
            search,
            albums,
            artists,
            album_tracks,
            artist_tracks,
            toggle_favorite,
            favorite_ids,
            favorites,
            create_playlist,
            delete_playlist,
            rename_playlist,
            playlists,
            playlist_tracks,
            playlist_add,
            playlist_remove,
            restore,
            lyrics_for,
            play_queue,
            queue_next,
            queue_prev,
            set_shuffle,
            set_repeat,
            set_eq,
            set_replay_gain,
            audio_settings,
            toggle_play,
            seek,
            set_volume
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
