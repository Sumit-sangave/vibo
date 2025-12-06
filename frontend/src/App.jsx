import React, { useEffect, useState, useRef } from 'react'
import axios from 'axios'

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000'



function formatTime(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function App() {
  const [tracks, setTracks] = useState([])
  const [file, setFile] = useState(null)
  const [title, setTitle] = useState('')
  const [tagsInput, setTagsInput] = useState('')
  const [tagSuggestions, setTagSuggestions] = useState([])
  const [showTagSuggestions, setShowTagSuggestions] = useState(false)
  const [coverFile, setCoverFile] = useState(null)
  const tagsInputRef = useRef(null)
  const [highlightedSuggestion, setHighlightedSuggestion] = useState(-1)
  const [prompt, setPrompt] = useState('')
  const [playlist, setPlaylist] = useState(null)
  const [topTracks, setTopTracks] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [durations, setDurations] = useState({})
  const [playing, setPlaying] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [volume, setVolume] = useState(1)
  const audioRef = useRef(null)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [lightMode, setLightMode] = useState(localStorage.getItem('mm_light') === '1')
  const [modalTrack, setModalTrack] = useState(null)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [nowPlayingExpanded, setNowPlayingExpanded] = useState(false)
  const [showTopModal, setShowTopModal] = useState(false)
  const [showFavModal, setShowFavModal] = useState(false)
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('mm_favs') || '[]') } catch(e){ return [] }
  })
  const [npProgress, setNpProgress] = useState(0)
  const [npDuration, setNpDuration] = useState(0)

  useEffect(() => {
    fetchTracks()
    fetchTopTracks()
    // apply theme
    if (localStorage.getItem('mm_light') === '1') document.documentElement.classList.add('light')
    else document.documentElement.classList.remove('light')

    // restore saved queue
    try {
      const saved = localStorage.getItem('mm_playlist')
      if (saved) {
        const p = JSON.parse(saved)
        setPlaylist(p)
      }
      const idx = localStorage.getItem('mm_index')
      if (idx) setCurrentIndex(Number(idx))
    } catch (e) {}
  }, [])

  useEffect(() => {
    if (!playlist || !playlist.items || playlist.items.length === 0) return
    // when currentIndex changes, play selected item
    const item = playlist.items[currentIndex]
    if (!item) return
    const url = item.track.url
    if (!url) return
    audioRef.current.src = url
    audioRef.current.volume = volume
    audioRef.current
      .play()
      .then(() => setPlaying(true))
      .catch((e) => console.warn('play prevented', e))
    // update global currentTrack to match playlist selection
    try { setCurrentTrack(item.track) } catch(e){}
  }, [currentIndex, playlist])

  useEffect(() => {
    const a = audioRef.current
    if (!a) return
    const onTime = () => {
      setNpDuration(a.duration || 0)
      setNpProgress(a.currentTime || 0)
    }
    const onLoaded = () => {
      setNpDuration(a.duration || 0)
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('loadedmetadata', onLoaded)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('loadedmetadata', onLoaded)
    }
  }, [audioRef.current])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  async function fetchTracks() {
    try {
      const res = await axios.get(`${BACKEND}/api/tracks/`)
      setTracks(res.data)
      // load durations for tracks
      res.data.forEach((t) => {
        if (t.url) {
          const a = new Audio()
          a.src = t.url
          a.addEventListener('loadedmetadata', () => {
            setDurations((d) => ({ ...d, [t.id]: a.duration }))
          })
          a.addEventListener('error', () => {
            // ignore
          })
        }
      })
    } catch (err) {
      console.error(err)
      setError('Failed to fetch tracks')
    }
  }

  async function fetchTopTracks() {
    try {
      const res = await axios.get(`${BACKEND}/api/stats/top-tracks/`)
      setTopTracks(res.data)
    } catch (err) {
      console.error(err)
    }
  }

  function saveFavorites(next){
    try{ localStorage.setItem('mm_favs', JSON.stringify(next)) }catch(e){}
  }

  function toggleFavorite(track){
    setFavorites((prev)=>{
      const exists = prev.find(t=>t.id===track.id)
      let next
      if(exists){ next = prev.filter(t=>t.id!==track.id) }
      else { next = [track, ...prev] }
      saveFavorites(next)
      return next
    })
  }

  function isFavorite(trackId){
    return favorites.some(t=>t.id===trackId)
  }

  async function upload(e) {
    e.preventDefault()
    if (!file) return
    setLoading(true)
    setError(null)
    setUploadProgress(0)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (coverFile) fd.append('cover', coverFile)
      fd.append('title', title)
      // attach tags as JSON array
      const tagList = tagsInput.split(',').map(s => s.trim()).filter(Boolean)
      if (tagList.length) fd.append('tags', JSON.stringify(tagList))
      await axios.post(`${BACKEND}/api/tracks/upload/`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const p = Math.round((progressEvent.loaded * 100) / progressEvent.total)
            setUploadProgress(p)
          }
        },
      })
      setFile(null)
      setTitle('')
      setTagsInput('')
      setCoverFile(null)
      await fetchTracks()
    } catch (err) {
      console.error(err)
      setError('Upload failed')
    } finally {
      setLoading(false)
      setUploadProgress(0)
    }
  }

  async function deleteTrack(id) {
    if (!confirm('Delete this track?')) return
    try {
      await axios.delete(`${BACKEND}/api/tracks/${id}/`)
      await fetchTracks()
      fetchTopTracks()
    } catch (err) {
      console.error(err)
      setError('Failed to delete')
    }
  }

  function toggleLight() {
    const next = !lightMode
    setLightMode(next)
    if (next) {
      document.documentElement.classList.add('light')
      localStorage.setItem('mm_light', '1')
    } else {
      document.documentElement.classList.remove('light')
      localStorage.removeItem('mm_light')
    }
  }

  // tag suggestions (debounced)
  const tagTimer = useRef(null)
  function onTagsInputChange(v) {
    setTagsInput(v)
    setShowTagSuggestions(true)
    setHighlightedSuggestion(-1)
    if (tagTimer.current) clearTimeout(tagTimer.current)
    tagTimer.current = setTimeout(async () => {
      if (!v || v.trim().length === 0) { setTagSuggestions([]); return }
      try {
        const last = v.split(',').pop().trim()
        if (!last) { setTagSuggestions([]); return }
        const res = await axios.get(`${BACKEND}/api/tags/?q=${encodeURIComponent(last)}`)
        setTagSuggestions(res.data || [])
      } catch (e) { setTagSuggestions([]) }
    }, 250)
  }

  function onTagsKeyDown(e) {
    if (!showTagSuggestions || !tagSuggestions || tagSuggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedSuggestion((i) => Math.min((i === -1 ? -1 : i) + 1, tagSuggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedSuggestion((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (highlightedSuggestion >= 0 && highlightedSuggestion < tagSuggestions.length) {
        e.preventDefault()
        pickSuggestion(tagSuggestions[highlightedSuggestion])
      }
    } else if (e.key === 'Escape') {
      setShowTagSuggestions(false)
    }
  }

  function pickSuggestion(s) {
    const parts = tagsInput.split(',').map(p=>p.trim()).filter(Boolean)
    if (!parts.includes(s)) parts.push(s)
    setTagsInput(parts.join(', '))
    setTagSuggestions([])
    setShowTagSuggestions(false)
  }

  async function generateMix(e) {
    e.preventDefault()
    if (!prompt) return
    setLoading(true)
    setError(null)
    try {
      const res = await axios.post(`${BACKEND}/api/generate-mix/`, { prompt })
      setPlaylist(res.data)
      try { localStorage.setItem('mm_playlist', JSON.stringify(res.data)) } catch(e) {}
      setCurrentIndex(0)
      fetchTopTracks()
    } catch (err) {
      console.error(err)
      setError('Failed to generate mix')
    } finally {
      setLoading(false)
    }
  }

  function togglePlayPause() {
    if (!audioRef.current) return
    if (audioRef.current.paused) {
      audioRef.current.play().then(() => setPlaying(true)).catch(() => {})
    } else {
      audioRef.current.pause(); setPlaying(false)
    }
  }

  function nextTrack() {
    if (!playlist || !playlist.items) return
    if (shuffle) {
      const idx = Math.floor(Math.random() * playlist.items.length)
      setCurrentIndex(idx)
      return
    }
    setCurrentIndex((i) => (i + 1) % playlist.items.length)
  }

  function prevTrack() {
    if (!playlist || !playlist.items) return
    setCurrentIndex((i) => (i - 1 + playlist.items.length) % playlist.items.length)
  }

  function onEnded() {
    nextTrack()
  }

  useEffect(() => {
    try { localStorage.setItem('mm_index', String(currentIndex)) } catch(e) {}
  }, [currentIndex])

  return (
    <div className="app-root">
      <div className="floating-icons" aria-hidden>
        <span>🎵</span>
        <span>🎶</span>
        <span>♪</span>
        <span>🎧</span>
        <span>💿</span>
        <span>🔊</span>
      </div>
      <nav className="navbar">
        <div className="nav-left">
          <div className="logo">Vibo</div>
          <ul className="nav-links">
            <li>Home</li>
            <li>Favorite</li>
            <li>Top</li>
          </ul>
        </div>
        
        <div className="nav-right">
          <div className="nav-actions">
            <button className="icon-btn small" onClick={() => setShowFavModal(true)} title="Favorites">Favs</button>
            <button className="icon-btn small theme-toggle" onClick={toggleLight} title="Toggle theme">{lightMode ? '🌞' : '🌙'}</button>
          </div>
        </div>
      </nav>

      <div className="hero">
        <div className="logo">Vibo</div>
        <div>
          <h1 className="title">Vibo</h1>
          <div className="subtitle">Upload your tracks — generate mood-based mixes — play instantly</div>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="grid">
        <div>
          <section className="card">
            <div className="section-title"><h2>Upload Track</h2></div>
            <form onSubmit={upload} className="upload-form">
              <input type="text" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
              <input ref={tagsInputRef} onKeyDown={onTagsKeyDown} type="text" placeholder="tags (comma separated e.g. calm,focus)" value={tagsInput} onChange={(e) => onTagsInputChange(e.target.value)} />
              {showTagSuggestions && tagSuggestions.length>0 && (
                <ul className="tag-suggestions" role="listbox">
                  {tagSuggestions.map((s,i)=> (
                    <li key={i} role="option" aria-selected={highlightedSuggestion===i} className={highlightedSuggestion===i? 'highlighted':''} onMouseEnter={() => setHighlightedSuggestion(i)} onMouseDown={(ev)=>{ev.preventDefault(); pickSuggestion(s)}}>#{s}</li>
                  ))}
                </ul>
              )}
              <label className="file-drop" htmlFor="coverInput">
                <input id="coverInput" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files[0])} style={{display:'none'}} />
                <div className="file-drop-inner">
                  <div className="file-cta">Upload cover</div>
                  <div className="file-hint">PNG, JPG — recommended 300x300</div>
                </div>
                {coverFile && (
                  <div className="file-preview">
                    <img src={URL.createObjectURL(coverFile)} alt="cover preview" />
                    <div className="file-name">{coverFile.name}</div>
                  </div>
                )}
              </label>

              <label className="file-drop" htmlFor="audioInput">
                <input id="audioInput" type="file" accept="audio/*" onChange={(e) => setFile(e.target.files[0])} style={{display:'none'}} />
                <div className="file-drop-inner">
                  <div className="file-cta">Choose audio</div>
                  <div className="file-hint">MP3 / WAV / M4A — max 20MB</div>
                </div>
                {file && (
                  <div className="file-preview">
                    <div className="file-icon">♪</div>
                    <div className="file-name">{file.name}</div>
                  </div>
                )}
              </label>
              <button className="btn" type="submit" disabled={loading}>{loading ? 'Uploading...' : 'Upload'}</button>
            </form>
            {uploadProgress > 0 && (
              <div className="progress">
                <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
              </div>
            )}
          </section>

          <section className="card">
            {/* Tracks removed from left column and moved to the right aside per user request */}
          </section>

          <section className="card playlist-card">
            <div className="section-title"><h2>Generate Mix</h2></div>
            <form onSubmit={generateMix} className="gen-form">
              <input type="text" placeholder="mood prompt (e.g. calm focus)" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
              <button className="btn" type="submit" disabled={loading}>{loading ? 'Generating...' : 'Generate Mix'}</button>
            </form>

            {playlist && (
              <div className="playlist">
                <h3 style={{marginTop:12}}>Playlist: {playlist.prompt}</h3>
                <ol>
                  {playlist.items.map((it, idx) => (
                    <li key={idx} className={idx === currentIndex ? 'playing' : ''} onClick={() => { setCurrentIndex(idx); if (it.track && it.track.url) { audioRef.current.src = it.track.url; audioRef.current.play().catch(()=>{}); setPlaying(true) } }}>
                      <div style={{display:'flex',alignItems:'center',gap:10}}>
                        <div style={{width:8,height:8,background: idx===currentIndex? 'var(--accent2)':'transparent',borderRadius:4}} />
                        <div>{it.track.title} <span className="weight">(w:{it.weight})</span></div>
                      </div>
                    </li>
                  ))}
                </ol>
                <div className="controls">
                  <button className="icon-btn" onClick={prevTrack}>Prev</button>
                  <button className="icon-btn play" onClick={togglePlayPause}>{playing ? 'Pause' : 'Play'}</button>
                  <button className="icon-btn" onClick={nextTrack}>Next</button>
                  <button className={`icon-btn shuffle-btn ${shuffle ? 'active' : ''}`} title="Shuffle" onClick={() => setShuffle(s => !s)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 3h5v5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M4 20h5l7-8h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M20 4l-7 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                  <label style={{color:'var(--muted)'}} className="volume">Vol <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => setVolume(Number(e.target.value))} /></label>
                </div>
              </div>
            )}
          </section>
        </div>

        <aside>
          <section className="card">
            <div className="section-title"><h2>Tracks</h2></div>
            <ul className="track-list">
              {tracks.map((t) => (
                <li key={t.id} className="track-item" onClick={() => {
                  // play on click and open modal card
                  if (t.url) {
                    audioRef.current.src = t.url
                    audioRef.current.play().catch(() => {})
                    setPlaying(true)
                  }
                  setModalTrack(t)
                  setCurrentTrack(t)
                }}>
                  <div className="track-meta">
                    <div className="art">
                      {t.cover_url ? (
                        <img src={t.cover_url} alt={t.title} />
                      ) : (
                        <div className="art-placeholder">♪</div>
                      )}
                    </div>
                    <div className="track-info">
                      <strong>{t.title}</strong>
                      <div className="meta">{durations[t.id] ? formatTime(durations[t.id]) : '—'}</div>
                      {t.tags && t.tags.length > 0 && (
                        <div style={{marginTop:6}}>{t.tags.map((tg, i) => (<span key={i} style={{fontSize:12,opacity:0.8,marginRight:8}}>#{tg}</span>))}</div>
                      )}
                    </div>
                  </div>
                  <div className="track-actions">
                    <button className={`icon-btn fav ${isFavorite(t.id)?'active':''}`} title="Add to favorites" onClick={(ev)=>{ev.stopPropagation(); toggleFavorite(t)}}>
                      {isFavorite(t.id) ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M12 21s-7-4.5-9.5-7.5C-1 7 5 3 12 8c7-5 13 1 9.5 5.5C19 16.5 12 21 12 21z"/></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 1 0-7.8 7.8L12 21l8.8-8.8a5.5 5.5 0 0 0 0-7.6z"/></svg>
                      )}
                    </button>
                    <button className="icon-btn trash" title="Delete" onClick={(ev) => { ev.stopPropagation(); deleteTrack(t.id) }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 6h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M8 6v14a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M10 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card topcard">
            <div className="section-title"><h2>Top Tracks</h2></div>
            <ol className="top-tracks">
              {topTracks.map((t) => (
                <li key={t.id} className="top-track-item" onClick={() => { if(t.url){ audioRef.current.src = t.url; audioRef.current.play().catch(()=>{}); setPlaying(true); } setModalTrack(t); setCurrentTrack(t) }}>
                  <div className="top-art">{t.cover_url ? <img src={t.cover_url} alt={t.title} /> : <div className="art-placeholder">♪</div>}</div>
                  <div className="top-info">
                    <div className="top-title">{t.title}</div>
                    <div className="meta">used: {t.times_selected}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      {/* modal card for clicked track */}
      {modalTrack && (
        <div className="modal-overlay" onClick={() => setModalTrack(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setModalTrack(null)} aria-label="Close">✕</button>
            <div className="modal-art">
              {modalTrack.cover_url ? <img src={modalTrack.cover_url} alt={modalTrack.title} /> : <div className="art-placeholder">♪</div>}
            </div>
            <div className="modal-info">
              <h3>{modalTrack.title}</h3>
              {modalTrack.tags && modalTrack.tags.length>0 && <div className="modal-tags">{modalTrack.tags.map((tg,i)=>(<span key={i}>#{tg}</span>))}</div>}
              <div style={{marginTop:12}}>
                <button className="btn" onClick={() => { if(modalTrack.url){ audioRef.current.src = modalTrack.url; audioRef.current.play().catch(()=>{}); setPlaying(true) } }}>Play</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top tracks modal */}
      {showTopModal && (
        <div className="modal-overlay" onClick={() => setShowTopModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTopModal(false)} aria-label="Close">✕</button>
            <div style={{flex:1}}>
              <h3>Top Tracks</h3>
              <div style={{marginTop:12}}>
                {topTracks.length===0 && <div style={{color:'var(--muted)'}}>No data yet</div>}
                <ol className="top-tracks">
                  {topTracks.map((t)=> (
                    <li key={t.id} className="top-track-item" onClick={() => { if(t.url){ audioRef.current.src = t.url; audioRef.current.play().catch(()=>{}); setPlaying(true); } setModalTrack(t); setCurrentTrack(t); setShowTopModal(false) }}>
                      <div className="top-art">{t.cover_url ? <img src={t.cover_url} alt={t.title} /> : <div className="art-placeholder">♪</div>}</div>
                      <div className="top-info"><div className="top-title">{t.title}</div><div className="meta">used: {t.times_selected}</div></div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Favorites modal */}
      {showFavModal && (
        <div className="modal-overlay" onClick={() => setShowFavModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowFavModal(false)} aria-label="Close">✕</button>
            <div style={{flex:1}}>
              <h3>Favorites</h3>
              <div style={{marginTop:12}}>
                {favorites.length===0 && <div style={{color:'var(--muted)'}}>No favorites yet</div>}
                <ol className="top-tracks">
                  {favorites.map((t)=> (
                    <li key={t.id} className="top-track-item">
                      <div className="top-art">{t.cover_url ? <img src={t.cover_url} alt={t.title} /> : <div className="art-placeholder">♪</div>}</div>
                      <div className="top-info"><div className="top-title">{t.title}</div><div className="meta">{t.tags && t.tags.length? t.tags.join(', '): ''}</div></div>
                      <div style={{marginLeft:'auto', display:'flex', gap:8}}>
                        <button className="icon-btn" onClick={() => { if(t.url){ audioRef.current.src = t.url; audioRef.current.play().catch(()=>{}); setPlaying(true) } setModalTrack(t); setCurrentTrack(t); setShowFavModal(false) }}>Play</button>
                        <button className="icon-btn" onClick={() => toggleFavorite(t)}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* hidden native audio element - playback controlled via custom UI */}
      <audio ref={audioRef} onEnded={onEnded} style={{display:'none'}} />

      {/* Now playing bar */}
      {playlist && playlist.items && playlist.items.length > 0 && (
        <div className={`now-playing ${nowPlayingExpanded ? 'expanded' : ''}`} onClick={() => setNowPlayingExpanded(s => !s)}>
          <div className="np-art">
            {currentTrack && currentTrack.cover_url ? (
              <img src={currentTrack.cover_url} alt={currentTrack.title} />
            ) : (
              '♪'
            )}
          </div>
          <div className="np-main">
            <div className="np-title">{currentTrack ? currentTrack.title : (playlist && playlist.items && playlist.items[currentIndex] ? playlist.items[currentIndex].track.title : '')}</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>{playlist ? playlist.prompt : ''}</div>

            {nowPlayingExpanded && currentTrack && (
              <div className="np-expanded-details">
                {currentTrack.tags && currentTrack.tags.length > 0 && (
                  <div className="np-tags">{currentTrack.tags.map((tg,i)=>(<span key={i}>#{tg}</span>))}</div>
                )}
                <div style={{marginTop:10}}>
                  <button className="btn" onClick={(e)=>{ e.stopPropagation(); if(currentTrack.url){ audioRef.current.src = currentTrack.url; audioRef.current.play().catch(()=>{}); setPlaying(true) } }}>Play</button>
                  <button className="btn" style={{marginLeft:8}} onClick={(e)=>{ e.stopPropagation(); setNowPlayingExpanded(false) }}>Close</button>
                </div>
              </div>
            )}
          </div>
          <div className="np-controls" onClick={(e)=>e.stopPropagation()}>
            <button className="icon-btn" onClick={prevTrack}>Prev</button>
            <button className="icon-btn play" onClick={togglePlayPause}>{playing ? 'Pause' : 'Play'}</button>
            <button className="icon-btn" onClick={nextTrack}>Next</button>
          </div>
          <div className="np-progress"><i style={{width: npDuration ? `${(npProgress/npDuration)*100}%` : '0%'}} /></div>
        </div>
      )}
    </div>
  )
}
