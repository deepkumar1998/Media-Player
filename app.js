(() => {
  'use strict';

  const STORAGE_KEY = 'pulse_media_player_prefs_v1';
  const PLAYBACK_KEY = 'pulse_last_playback_v1';
  const IDB_NAME = 'pulse_media_db';
  const IDB_STORE = 'handles';
  const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
  const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a', 'opus', 'weba', 'wma']);
  const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'ogv', 'avi']);
  const SUB_EXTS = new Set(['srt', 'vtt']);

  const EQ_FREQS = [60, 230, 910, 3600, 14000];
  const EQ_LABELS = ['60Hz', '230Hz', '910Hz', '3.6k', '14k'];
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0],
    bass: [7, 4, 0, -1, 0],
    vocal: [-2, -1, 4, 5, 2],
    electronic: [5, 3, -1, 3, 5],
    rock: [5, 2, -1, 3, 4],
    acoustic: [3, 2, 1, 3, 2],
  };

  // DOM Elements
  const $ = (id) => document.getElementById(id);
  const appShell = $('app');
  const stage = $('stage');
  const media = $('mediaElement');
  const emptyState = $('emptyState');
  const dropOverlay = $('dropOverlay');
  const stageToast = $('stageToast');
  const headerTrackTitle = $('headerTrackTitle');
  const statusDot = $('statusDot');

  const audioTitle = $('audioTitle');
  const audioSubtitle = $('audioSubtitle');
  const discArt = $('discArt');
  const visCanvas = $('visualizerCanvas');
  const visCtx = visCanvas.getContext('2d');
  const visModeBar = $('visualizerModeBar');

  const seekBar = $('seekBar');
  const seekWrap = $('seekWrap');
  const seekTooltip = $('seekTooltip');
  const seekBuffered = $('seekBuffered');
  const currentTimeLabel = $('currentTimeLabel');
  const durationLabel = $('durationLabel');

  const btnPlayPause = $('btnPlayPause');
  const iconPlay = $('iconPlay');
  const iconPause = $('iconPause');
  const btnPrev = $('btnPrev');
  const btnNext = $('btnNext');
  const btnSkipBack = $('btnSkipBack');
  const btnSkipForward = $('btnSkipForward');
  const btnShuffle = $('btnShuffle');
  const btnLoop = $('btnLoop');
  const btnMute = $('btnMute');
  const iconVolHigh = $('iconVolHigh');
  const iconVolMuted = $('iconVolMuted');
  const volumeBar = $('volumeBar');
  const btnSpeed = $('btnSpeed');
  const btnEqualizer = $('btnEqualizer');
  const btnSubtitlesToggle = $('btnSubtitlesToggle');
  const btnSnapshot = $('btnSnapshot');
  const btnPip = $('btnPip');
  const btnFullscreen = $('btnFullscreen');

  const eqPanel = $('eqPanel');
  const eqBandsEl = $('eqBands');
  const eqPresetSelect = $('eqPresetSelect');

  const playlistSidebar = $('playlistSidebar');
  const btnToggleSidebar = $('btnToggleSidebar');
  const queueCount = $('queueCount');
  const queueSearch = $('queueSearch');
  const queueList = $('queueList');

  const fileInput = $('fileInput');
  const folderInput = $('folderInput');
  const subtitleInput = $('subtitleInput');
  const btnResumeLastFolder = $('btnResumeLastFolder');

  const urlModal = $('urlModal');
  const urlForm = $('urlForm');
  const urlInput = $('urlInput');
  const shortcutsModal = $('shortcutsModal');

  // Application State
  const state = {
    queue: [],
    currentIndex: -1,
    shuffle: false,
    loopMode: 'off', // 'off' | 'all' | 'one'
    speedIndex: 3, // 1x
    volume: 0.85,
    muted: false,
    visMode: 'bars', // 'bars' | 'wave' | 'radial'
    eqPreset: 'flat',
    eqGains: [0, 0, 0, 0, 0],
    subtitlesEnabled: true,
    sidebarOpen: window.innerWidth > 780,
    collapsedFolders: new Set(),
    isSeeking: false,
    pendingSeekTime: null,
    lastProgressSave: 0,
    toastTimer: null,
    idleTimer: null,
    subTrackUrl: null,
  };

  // Web Audio API State
  let audioCtx = null;
  let analyser = null;
  let eqFilters = [];
  let sourceNode = null;
  let visRafId = null;
  let freqData = null;
  let timeData = null;

  // --- Persistence ---
  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (typeof prefs.volume === 'number') state.volume = Math.min(1, Math.max(0, prefs.volume));
      if (typeof prefs.muted === 'boolean') state.muted = prefs.muted;
      if (typeof prefs.shuffle === 'boolean') state.shuffle = prefs.shuffle;
      if (['off', 'all', 'one'].includes(prefs.loopMode)) state.loopMode = prefs.loopMode;
      if (typeof prefs.speedIndex === 'number' && SPEEDS[prefs.speedIndex]) state.speedIndex = prefs.speedIndex;
      if (['bars', 'wave', 'radial'].includes(prefs.visMode)) state.visMode = prefs.visMode;
      if (typeof prefs.eqPreset === 'string') state.eqPreset = prefs.eqPreset;
      if (Array.isArray(prefs.eqGains) && prefs.eqGains.length === 5) state.eqGains = prefs.eqGains;
      if (typeof prefs.sidebarOpen === 'boolean' && window.innerWidth > 780) {
        state.sidebarOpen = prefs.sidebarOpen;
      }
    } catch {
      // Ignore malformed storage
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          volume: state.volume,
          muted: state.muted,
          shuffle: state.shuffle,
          loopMode: state.loopMode,
          speedIndex: state.speedIndex,
          visMode: state.visMode,
          eqPreset: state.eqPreset,
          eqGains: state.eqGains,
          sidebarOpen: state.sidebarOpen,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  function saveLastPlayback() {
    const item = state.queue[state.currentIndex];
    if (!item || !item.relPath) return;
    try {
      localStorage.setItem(
        PLAYBACK_KEY,
        JSON.stringify({
          relPath: item.relPath,
          currentTime: Number.isFinite(media.currentTime) ? media.currentTime : 0,
        })
      );
    } catch {
      // Ignore storage quota errors
    }
  }

  function loadLastPlayback() {
    try {
      const raw = localStorage.getItem(PLAYBACK_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function openHandlesDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(IDB_STORE)) {
          req.result.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveLastFolderHandle(handle) {
    try {
      const db = await openHandlesDB();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(handle, 'lastFolder');
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // Ignore if browser restricts handle persistence
    }
  }

  async function loadLastFolderHandle() {
    try {
      const db = await openHandlesDB();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get('lastFolder');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function readDirectoryHandle(dirHandle, prefix = dirHandle.name) {
    const collected = [];
    for await (const [name, entry] of dirHandle.entries()) {
      const relPath = `${prefix}/${name}`;
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        collected.push({ file, relativePath: relPath });
      } else if (entry.kind === 'directory') {
        const nested = await readDirectoryHandle(entry, relPath);
        collected.push(...nested);
      }
    }
    return collected;
  }

  async function loadFolderFromHandle(handle, autoPlay = false) {
    const files = await readDirectoryHandle(handle);
    const saved = loadLastPlayback();
    handleFiles(files, { autoPlayFirst: false });

    if (state.queue.length > 0) {
      let targetIdx = 0;
      if (saved && saved.relPath) {
        const foundIdx = state.queue.findIndex((item) => item.relPath === saved.relPath);
        if (foundIdx >= 0) {
          targetIdx = foundIdx;
          if (typeof saved.currentTime === 'number' && saved.currentTime > 0) {
            state.pendingSeekTime = saved.currentTime;
          }
        }
      }
      playIndex(targetIdx, autoPlay);
      btnResumeLastFolder.classList.add('hidden');
      showToast(`Loaded folder: ${handle.name}`);
    }
  }

  async function openFolderPicker() {
    if (typeof window.showDirectoryPicker === 'function') {
      try {
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        await saveLastFolderHandle(handle);
        clearQueue();
        await loadFolderFromHandle(handle, true);
      } catch (err) {
        if (err && err.name !== 'AbortError') {
          folderInput.click();
        }
      }
      return;
    }
    folderInput.click();
  }

  async function restoreLastFolderOnStartup() {
    const handle = await loadLastFolderHandle();
    if (!handle || typeof handle.queryPermission !== 'function') return;

    try {
      const perm = await handle.queryPermission({ mode: 'read' });
      if (perm === 'granted') {
        await loadFolderFromHandle(handle, false);
        return;
      }

      if (perm === 'prompt') {
        btnResumeLastFolder.textContent = `Resume "${handle.name}"`;
        btnResumeLastFolder.classList.remove('hidden');
        btnResumeLastFolder.onclick = async () => {
          try {
            const granted = await handle.requestPermission({ mode: 'read' });
            if (granted === 'granted') {
              await loadFolderFromHandle(handle, true);
            }
          } catch {
            showToast('Permission denied for saved folder');
          }
        };
      }
    } catch {
      // Ignore stale or inaccessible folder handles
    }
  }

  // --- Helpers ---
  function formatTime(sec) {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const total = Math.floor(sec);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function showToast(msg) {
    stageToast.textContent = msg;
    stageToast.classList.add('visible');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => stageToast.classList.remove('visible'), 1600);
  }

  function getExt(name) {
    const idx = name.lastIndexOf('.');
    return idx >= 0 ? name.slice(idx + 1).toLowerCase() : '';
  }

  function inferKind(fileOrUrl, mime = '') {
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    const ext = getExt(fileOrUrl.split('?')[0]);
    if (AUDIO_EXTS.has(ext)) return 'audio';
    if (VIDEO_EXTS.has(ext)) return 'video';
    return 'video';
  }

  function isMediaFile(file) {
    const ext = getExt(file.name);
    return (
      file.type.startsWith('audio/') ||
      file.type.startsWith('video/') ||
      AUDIO_EXTS.has(ext) ||
      VIDEO_EXTS.has(ext)
    );
  }

  // --- Web Audio API & Equalizer ---
  function initAudioEngine() {
    if (audioCtx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      audioCtx = new AudioContextClass();
      sourceNode = audioCtx.createMediaElementSource(media);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;

      eqFilters = EQ_FREQS.map((freq, idx) => {
        const filter = audioCtx.createBiquadFilter();
        filter.type = idx === 0 ? 'lowshelf' : idx === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.1;
        filter.gain.value = state.eqGains[idx] || 0;
        return filter;
      });

      let node = sourceNode;
      for (const filter of eqFilters) {
        node.connect(filter);
        node = filter;
      }
      node.connect(analyser);
      analyser.connect(audioCtx.destination);

      freqData = new Uint8Array(analyser.frequencyBinCount);
      timeData = new Uint8Array(analyser.fftSize);
    } catch {
      // If cross-origin or browser restriction prevents Web Audio routing, native playback still works
      audioCtx = null;
    }
  }

  function resumeAudioCtx() {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  }

  function applyEqGains() {
    eqFilters.forEach((filter, i) => {
      filter.gain.value = state.eqGains[i] || 0;
    });
    const inputs = eqBandsEl.querySelectorAll('input[type="range"]');
    const labels = eqBandsEl.querySelectorAll('.eq-band-db');
    inputs.forEach((input, i) => {
      input.value = state.eqGains[i];
      labels[i].textContent = `${state.eqGains[i] > 0 ? '+' : ''}${state.eqGains[i]}dB`;
    });
    eqPresetSelect.value = state.eqPreset;
    savePrefs();
  }

  function buildEqUI() {
    eqBandsEl.innerHTML = '';
    EQ_LABELS.forEach((label, idx) => {
      const band = document.createElement('div');
      band.className = 'eq-band';

      const dbLabel = document.createElement('span');
      dbLabel.className = 'eq-band-db';
      dbLabel.textContent = `${state.eqGains[idx] > 0 ? '+' : ''}${state.eqGains[idx]}dB`;

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '-12';
      slider.max = '12';
      slider.step = '1';
      slider.value = String(state.eqGains[idx]);
      slider.setAttribute('aria-label', `${label} gain`);
      slider.addEventListener('input', () => {
        state.eqGains[idx] = Number(slider.value);
        state.eqPreset = 'custom';
        applyEqGains();
      });

      const freqLabel = document.createElement('span');
      freqLabel.className = 'eq-band-freq';
      freqLabel.textContent = label;

      band.append(dbLabel, slider, freqLabel);
      eqBandsEl.appendChild(band);
    });
    eqPresetSelect.value = state.eqPreset;
  }

  // --- Visualizer ---
  function resizeCanvas() {
    const rect = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    visCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
    visCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
    visCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function stopVisualizer() {
    if (visRafId) {
      cancelAnimationFrame(visRafId);
      visRafId = null;
    }
  }

  function startVisualizer() {
    if (visRafId) return;
    const render = () => {
      if (!stage.classList.contains('audio-mode') || media.paused) {
        visRafId = null;
        return;
      }
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      visCtx.clearRect(0, 0, w, h);

      if (analyser && freqData) {
        if (state.visMode === 'bars') {
          analyser.getByteFrequencyData(freqData);
          const count = 48;
          const barW = Math.max(3, (w * 0.72) / count - 3);
          const startX = (w - count * (barW + 3)) / 2;
          for (let i = 0; i < count; i++) {
            const val = freqData[i] / 255;
            const barH = Math.max(4, val * (h * 0.34));
            const x = startX + i * (barW + 3);
            const y = h - barH - 24;
            const grad = visCtx.createLinearGradient(x, y, x, h - 24);
            grad.addColorStop(0, '#818cf8');
            grad.addColorStop(1, 'rgba(56, 189, 248, 0.25)');
            visCtx.fillStyle = grad;
            visCtx.beginPath();
            visCtx.roundRect(x, y, barW, barH, 3);
            visCtx.fill();
          }
        } else if (state.visMode === 'wave') {
          analyser.getByteTimeDomainData(timeData);
          visCtx.lineWidth = 2.5;
          visCtx.strokeStyle = '#818cf8';
          visCtx.beginPath();
          const slice = w / timeData.length;
          for (let i = 0; i < timeData.length; i++) {
            const v = timeData[i] / 128.0;
            const y = (v * h) / 2;
            const x = i * slice;
            if (i === 0) visCtx.moveTo(x, y);
            else visCtx.lineTo(x, y);
          }
          visCtx.stroke();
        } else if (state.visMode === 'radial') {
          analyser.getByteFrequencyData(freqData);
          const cx = w / 2;
          const cy = h / 2 - 34;
          const baseR = 82;
          const count = 64;
          for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
            const amp = (freqData[i % freqData.length] / 255) * 65;
            const x1 = cx + Math.cos(angle) * baseR;
            const y1 = cy + Math.sin(angle) * baseR;
            const x2 = cx + Math.cos(angle) * (baseR + amp);
            const y2 = cy + Math.sin(angle) * (baseR + amp);
            visCtx.strokeStyle = `hsla(${225 + (i / count) * 45}, 88%, 68%, 0.8)`;
            visCtx.lineWidth = 3;
            visCtx.beginPath();
            visCtx.moveTo(x1, y1);
            visCtx.lineTo(x2, y2);
            visCtx.stroke();
          }
        }
      }
      visRafId = requestAnimationFrame(render);
    };
    visRafId = requestAnimationFrame(render);
  }

  // --- Subtitles (.srt -> .vtt) ---
  function srtToVtt(srtText) {
    const normalized = srtText.replace(/\r+/g, '').trim();
    const converted = normalized.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    return `WEBVTT\n\n${converted}\n`;
  }

  function attachSubtitleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let content = String(reader.result || '');
      if (getExt(file.name) === 'srt') {
        content = srtToVtt(content);
      }
      clearSubtitles();
      const blob = new Blob([content], { type: 'text/vtt' });
      state.subTrackUrl = URL.createObjectURL(blob);
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = file.name;
      track.srclang = 'en';
      track.src = state.subTrackUrl;
      track.default = true;
      media.appendChild(track);
      state.subtitlesEnabled = true;
      if (media.textTracks[0]) {
        media.textTracks[0].mode = 'showing';
      }
      btnSubtitlesToggle.classList.remove('hidden');
      btnSubtitlesToggle.classList.add('active');
      showToast(`Subtitles loaded: ${file.name}`);
    };
    reader.readAsText(file);
  }

  function clearSubtitles() {
    media.querySelectorAll('track').forEach((t) => t.remove());
    if (state.subTrackUrl) {
      URL.revokeObjectURL(state.subTrackUrl);
      state.subTrackUrl = null;
    }
    btnSubtitlesToggle.classList.add('hidden');
  }

  function toggleSubtitles() {
    const track = media.textTracks[0];
    if (!track) return;
    state.subtitlesEnabled = !state.subtitlesEnabled;
    track.mode = state.subtitlesEnabled ? 'showing' : 'hidden';
    btnSubtitlesToggle.classList.toggle('active', state.subtitlesEnabled);
    showToast(state.subtitlesEnabled ? 'Subtitles On' : 'Subtitles Off');
  }

  // --- Playlist & Playback ---
  function addItemsToQueue(items, autoPlayFirst = false) {
    if (!items.length) return;
    const wasEmpty = state.queue.length === 0;
    const firstAddedIndex = state.queue.length;
    state.queue.push(...items);
    renderQueue();
    if (wasEmpty || autoPlayFirst) {
      playIndex(firstAddedIndex);
    } else {
      showToast(`Added ${items.length} item${items.length > 1 ? 's' : ''} to queue`);
    }
  }

  const naturalCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function compareMediaPaths(pathA, pathB) {
    const partsA = pathA.split('/').filter(Boolean);
    const partsB = pathB.split('/').filter(Boolean);
    const len = Math.min(partsA.length, partsB.length);

    for (let i = 0; i < len; i++) {
      const isFileA = i === partsA.length - 1;
      const isFileB = i === partsB.length - 1;

      // At the same directory level, folders come before files
      if (isFileA !== isFileB) {
        return isFileA ? 1 : -1;
      }

      const cmp = naturalCollator.compare(partsA[i], partsB[i]);
      if (cmp !== 0) return cmp;
    }

    return partsA.length - partsB.length;
  }

  function handleFiles(fileList, { autoPlayFirst = true } = {}) {
    const entries = Array.from(fileList || []).map((entry) => {
      const file = entry.file || entry;
      const relPath = entry.relativePath || file.webkitRelativePath || file.name;
      return { file, relPath: relPath.replace(/^\/+/, '') };
    });

    entries.sort((a, b) => compareMediaPaths(a.relPath, b.relPath));

    const mediaItems = [];
    let subFile = null;

    for (const { file, relPath } of entries) {
      const ext = getExt(file.name);
      if (SUB_EXTS.has(ext)) {
        subFile = file;
      } else if (isMediaFile(file)) {
        const lastSlash = relPath.lastIndexOf('/');
        const folder = lastSlash >= 0 ? relPath.slice(0, lastSlash) : '';
        mediaItems.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: file.name.replace(/\.[^/.]+$/, ''),
          fileName: file.name,
          folder,
          relPath,
          kind: inferKind(file.name, file.type),
          src: URL.createObjectURL(file),
          isObjectUrl: true,
          duration: null,
        });
      }
    }

    if (mediaItems.length) {
      addItemsToQueue(mediaItems, autoPlayFirst && state.currentIndex === -1);
    }
    if (subFile) {
      attachSubtitleFile(subFile);
    }
    if (!mediaItems.length && !subFile && entries.length) {
      showToast('No supported media files found');
    }
  }

  async function readEntryFiles(entry) {
    if (entry.isFile) {
      return new Promise((resolve) =>
        entry.file(
          (file) => resolve([{ file, relativePath: (entry.fullPath || file.name).replace(/^\/+/, '') }]),
          () => resolve([])
        )
      );
    }
    if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve) => {
        const all = [];
        const readBatch = () => {
          reader.readEntries((batch) => {
            if (!batch.length) resolve(all);
            else {
              all.push(...batch);
              readBatch();
            }
          }, () => resolve(all));
        };
        readBatch();
      });
      entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return naturalCollator.compare(a.name, b.name);
      });
      const nested = await Promise.all(entries.map(readEntryFiles));
      return nested.flat();
    }
    return [];
  }

  function playIndex(index, autoPlay = true) {
    if (index < 0 || index >= state.queue.length) return;
    state.currentIndex = index;
    const item = state.queue[index];

    if (item.folder) {
      const parts = item.folder.split('/').filter(Boolean);
      let acc = '';
      for (const part of parts) {
        acc = acc ? `${acc}/${part}` : part;
        state.collapsedFolders.delete(acc);
      }
    }

    emptyState.classList.add('hidden');
    headerTrackTitle.textContent = item.title;
    document.title = `${item.title} — Pulse`;

    const isAudio = item.kind === 'audio';
    stage.classList.toggle('audio-mode', isAudio);
    audioTitle.textContent = item.title;
    audioSubtitle.textContent = item.fileName || 'Streaming Audio';
    btnSnapshot.classList.toggle('hidden', isAudio);
    btnPip.classList.toggle('hidden', isAudio);

    media.src = item.src;
    media.playbackRate = SPEEDS[state.speedIndex];
    media.volume = state.volume;
    media.muted = state.muted;

    initAudioEngine();
    resumeAudioCtx();

    if (autoPlay) {
      media.play().catch(() => {
        // Autoplay might be blocked if not user-initiated
      });
    }

    saveLastPlayback();
    renderQueue();
  }

  function playNext(fromEnded = false) {
    if (!state.queue.length) return;
    if (fromEnded && state.loopMode === 'one') {
      media.currentTime = 0;
      media.play().catch(() => {});
      return;
    }

    if (state.shuffle && state.queue.length > 1) {
      let nextIdx = state.currentIndex;
      while (nextIdx === state.currentIndex) {
        nextIdx = Math.floor(Math.random() * state.queue.length);
      }
      playIndex(nextIdx);
      return;
    }

    const nextIdx = state.currentIndex + 1;
    if (nextIdx < state.queue.length) {
      playIndex(nextIdx);
    } else if (state.loopMode === 'all') {
      playIndex(0);
    }
  }

  function playPrev() {
    if (!state.queue.length) return;
    if (media.currentTime > 3) {
      media.currentTime = 0;
      return;
    }
    const prevIdx = state.currentIndex - 1;
    if (prevIdx >= 0) {
      playIndex(prevIdx);
    } else if (state.loopMode === 'all') {
      playIndex(state.queue.length - 1);
    } else {
      media.currentTime = 0;
    }
  }

  function removeQueueItem(index) {
    const [removed] = state.queue.splice(index, 1);
    if (removed && removed.isObjectUrl) {
      URL.revokeObjectURL(removed.src);
    }
    if (index === state.currentIndex) {
      if (state.queue.length === 0) {
        resetPlayer();
      } else {
        playIndex(Math.min(index, state.queue.length - 1));
      }
    } else if (index < state.currentIndex) {
      state.currentIndex -= 1;
    }
    renderQueue();
  }

  function clearQueue() {
    state.queue.forEach((item) => {
      if (item.isObjectUrl) URL.revokeObjectURL(item.src);
    });
    state.queue = [];
    resetPlayer();
    renderQueue();
  }

  function resetPlayer() {
    media.pause();
    media.removeAttribute('src');
    media.load();
    clearSubtitles();
    state.currentIndex = -1;
    stage.classList.remove('audio-mode');
    emptyState.classList.remove('hidden');
    headerTrackTitle.textContent = 'No media loaded';
    document.title = 'Pulse — Lightweight Media Player';
    currentTimeLabel.textContent = '0:00';
    durationLabel.textContent = '0:00';
    seekBar.value = '0';
    seekBuffered.style.width = '0%';
    updatePlayStateUI();
  }

  function buildQueueTree(items, filter) {
    const root = { folders: new Map(), items: [] };

    items.forEach((item, idx) => {
      if (filter && !item.title.toLowerCase().includes(filter) && !(item.folder || '').toLowerCase().includes(filter)) {
        return;
      }

      const parts = item.folder ? item.folder.split('/').filter(Boolean) : [];
      let node = root;
      let pathAcc = '';

      for (const part of parts) {
        pathAcc = pathAcc ? `${pathAcc}/${part}` : part;
        if (!node.folders.has(part)) {
          node.folders.set(part, { name: part, path: pathAcc, folders: new Map(), items: [] });
        }
        node = node.folders.get(part);
      }

      node.items.push({ item, idx });
    });

    return root;
  }

  function countTreeItems(node) {
    let total = node.items.length;
    for (const child of node.folders.values()) {
      total += countTreeItems(child);
    }
    return total;
  }

  function renderQueueNode(node, depth, isSearching) {
    for (const folderNode of node.folders.values()) {
      const isCollapsed = !isSearching && state.collapsedFolders.has(folderNode.path);
      const totalItems = countTreeItems(folderNode);

      const folderRow = document.createElement('li');
      folderRow.className = `queue-folder-row${isCollapsed ? ' collapsed' : ''}`;
      folderRow.style.paddingLeft = `${10 + depth * 14}px`;
      folderRow.title = folderNode.path;
      folderRow.innerHTML = `
        <svg class="folder-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        <svg class="folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span class="folder-name"></span>
        <span class="folder-count">${totalItems}</span>
      `;
      folderRow.querySelector('.folder-name').textContent = folderNode.name;
      folderRow.addEventListener('click', () => {
        if (state.collapsedFolders.has(folderNode.path)) {
          state.collapsedFolders.delete(folderNode.path);
        } else {
          state.collapsedFolders.add(folderNode.path);
        }
        renderQueue();
      });

      queueList.appendChild(folderRow);

      if (!isCollapsed) {
        renderQueueNode(folderNode, depth + 1, isSearching);
      }
    }

    for (const { item, idx } of node.items) {
      const li = document.createElement('li');
      li.className = `queue-item${idx === state.currentIndex ? ' active' : ''}`;
      li.style.paddingLeft = `${10 + depth * 14}px`;
      li.addEventListener('click', () => playIndex(idx));

      const kind = document.createElement('span');
      kind.className = 'queue-kind';
      kind.textContent = item.kind === 'audio' ? 'AUD' : 'VID';

      const meta = document.createElement('div');
      meta.className = 'queue-meta';
      const title = document.createElement('div');
      title.className = 'queue-title';
      title.textContent = item.title;
      const sub = document.createElement('div');
      sub.className = 'queue-sub';
      sub.textContent = item.duration ? formatTime(item.duration) : item.kind.toUpperCase();
      meta.append(title, sub);

      const removeBtn = document.createElement('button');
      removeBtn.className = 'queue-remove';
      removeBtn.title = 'Remove';
      removeBtn.innerHTML = '&times;';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeQueueItem(idx);
      });

      li.append(kind, meta, removeBtn);
      queueList.appendChild(li);
    }
  }

  function renderQueue() {
    const filter = queueSearch.value.trim().toLowerCase();
    queueCount.textContent = String(state.queue.length);
    queueList.innerHTML = '';

    const tree = buildQueueTree(state.queue, filter);
    renderQueueNode(tree, 0, Boolean(filter));
  }

  // --- UI Sync ---
  function updatePlayStateUI() {
    const playing = !media.paused && !media.ended && Boolean(media.currentSrc);
    iconPlay.classList.toggle('hidden', playing);
    iconPause.classList.toggle('hidden', !playing);
    statusDot.classList.toggle('playing', playing);
    discArt.classList.toggle('spinning', playing);
    if (playing && stage.classList.contains('audio-mode')) {
      startVisualizer();
    } else {
      stopVisualizer();
    }
  }

  function updateVolumeUI() {
    volumeBar.value = String(state.muted ? 0 : state.volume);
    const isMuted = state.muted || state.volume === 0;
    iconVolHigh.classList.toggle('hidden', isMuted);
    iconVolMuted.classList.toggle('hidden', !isMuted);
  }

  function updateLoopShuffleUI() {
    btnShuffle.classList.toggle('active', state.shuffle);
    btnLoop.classList.toggle('active', state.loopMode !== 'off');
    btnLoop.classList.toggle('loop-one', state.loopMode === 'one');
    const labels = { off: 'Loop: Off', all: 'Loop: All', one: 'Loop: One' };
    btnLoop.title = labels[state.loopMode];
  }

  function updateSidebarUI() {
    playlistSidebar.classList.toggle('collapsed', !state.sidebarOpen);
    btnToggleSidebar.classList.toggle('active', state.sidebarOpen);
  }

  function togglePlayPause() {
    if (!media.currentSrc) {
      if (state.queue.length) playIndex(0);
      else fileInput.click();
      return;
    }
    resumeAudioCtx();
    if (media.paused) media.play().catch(() => {});
    else media.pause();
  }

  function cycleSpeed(dir = 1) {
    state.speedIndex = (state.speedIndex + dir + SPEEDS.length) % SPEEDS.length;
    const rate = SPEEDS[state.speedIndex];
    media.playbackRate = rate;
    btnSpeed.textContent = `${rate}x`;
    savePrefs();
    showToast(`Speed: ${rate}x`);
  }

  function handleFullscreenOrientation() {
    const isFs = Boolean(document.fullscreenElement || document.webkitFullscreenElement);
    const isMobile = window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) <= 780;
    if (!isMobile || !screen.orientation) return;

    if (isFs) {
      if (typeof screen.orientation.lock === 'function') {
        screen.orientation.lock('landscape').catch(() => {});
      }
    } else {
      try {
        if (typeof screen.orientation.unlock === 'function') {
          screen.orientation.unlock();
        }
      } catch {
        // Ignore if orientation was not locked
      }
    }
  }

  document.addEventListener('fullscreenchange', handleFullscreenOrientation);
  document.addEventListener('webkitfullscreenchange', handleFullscreenOrientation);

  function toggleFullscreen() {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document).catch?.(() => {});
      return;
    }
    const reqFs = appShell.requestFullscreen || appShell.webkitRequestFullscreen;
    if (reqFs) {
      Promise.resolve(reqFs.call(appShell)).catch(() => {
        if (typeof media.webkitEnterFullscreen === 'function') {
          media.webkitEnterFullscreen();
        }
      });
    } else if (typeof media.webkitEnterFullscreen === 'function') {
      media.webkitEnterFullscreen();
    }
  }

  function captureSnapshot() {
    if (!media.videoWidth || !media.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = media.videoWidth;
    canvas.height = media.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(media, 0, 0, canvas.width, canvas.height);
    const link = document.createElement('a');
    const name = state.queue[state.currentIndex]?.title || 'snapshot';
    link.download = `${name}-${Math.floor(media.currentTime)}s.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('Frame captured');
  }

  // --- Event Listeners ---
  media.addEventListener('play', updatePlayStateUI);
  media.addEventListener('pause', () => {
    updatePlayStateUI();
    saveLastPlayback();
  });
  media.addEventListener('ended', () => {
    updatePlayStateUI();
    playNext(true);
  });

  media.addEventListener('loadedmetadata', () => {
    durationLabel.textContent = formatTime(media.duration);
    if (state.pendingSeekTime !== null && Number.isFinite(media.duration)) {
      media.currentTime = Math.min(state.pendingSeekTime, Math.max(0, media.duration - 0.5));
      currentTimeLabel.textContent = formatTime(media.currentTime);
      seekBar.value = String(Math.round((media.currentTime / media.duration) * 1000));
      state.pendingSeekTime = null;
    }
    if (state.currentIndex >= 0 && state.queue[state.currentIndex]) {
      state.queue[state.currentIndex].duration = media.duration;
      renderQueue();
    }
  });

  media.addEventListener('timeupdate', () => {
    if (state.isSeeking || !Number.isFinite(media.duration) || media.duration <= 0) return;
    currentTimeLabel.textContent = formatTime(media.currentTime);
    seekBar.value = String(Math.round((media.currentTime / media.duration) * 1000));
    const now = Date.now();
    if (now - state.lastProgressSave > 2000) {
      state.lastProgressSave = now;
      saveLastPlayback();
    }
  });

  media.addEventListener('progress', () => {
    if (!Number.isFinite(media.duration) || media.duration <= 0 || !media.buffered.length) return;
    const end = media.buffered.end(media.buffered.length - 1);
    seekBuffered.style.width = `${Math.min(100, (end / media.duration) * 100)}%`;
  });

  media.addEventListener('error', () => {
    showToast('Could not play this media format or URL');
  });

  media.addEventListener('click', togglePlayPause);
  media.addEventListener('dblclick', toggleFullscreen);

  // Seek interactions
  seekBar.addEventListener('input', () => {
    state.isSeeking = true;
    if (Number.isFinite(media.duration)) {
      const target = (Number(seekBar.value) / 1000) * media.duration;
      currentTimeLabel.textContent = formatTime(target);
    }
  });

  seekBar.addEventListener('change', () => {
    if (Number.isFinite(media.duration)) {
      media.currentTime = (Number(seekBar.value) / 1000) * media.duration;
    }
    state.isSeeking = false;
  });

  seekWrap.addEventListener('mousemove', (e) => {
    if (!Number.isFinite(media.duration) || media.duration <= 0) return;
    const rect = seekWrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    seekTooltip.textContent = formatTime(ratio * media.duration);
    seekTooltip.style.left = `${ratio * 100}%`;
  });

  // Transport buttons
  btnPlayPause.addEventListener('click', togglePlayPause);
  btnPrev.addEventListener('click', playPrev);
  btnNext.addEventListener('click', () => playNext(false));
  btnSkipBack.addEventListener('click', () => {
    media.currentTime = Math.max(0, media.currentTime - 10);
  });
  btnSkipForward.addEventListener('click', () => {
    media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
  });

  btnShuffle.addEventListener('click', () => {
    state.shuffle = !state.shuffle;
    updateLoopShuffleUI();
    savePrefs();
    showToast(state.shuffle ? 'Shuffle On' : 'Shuffle Off');
  });

  btnLoop.addEventListener('click', () => {
    const order = ['off', 'all', 'one'];
    state.loopMode = order[(order.indexOf(state.loopMode) + 1) % order.length];
    updateLoopShuffleUI();
    savePrefs();
    showToast(btnLoop.title);
  });

  btnMute.addEventListener('click', () => {
    state.muted = !state.muted;
    media.muted = state.muted;
    updateVolumeUI();
    savePrefs();
  });

  volumeBar.addEventListener('input', () => {
    state.volume = Number(volumeBar.value);
    state.muted = state.volume === 0;
    media.volume = state.volume;
    media.muted = state.muted;
    updateVolumeUI();
    savePrefs();
  });

  stage.addEventListener(
    'wheel',
    (e) => {
      if (!media.currentSrc) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.05 : -0.05;
      state.volume = Math.min(1, Math.max(0, +(state.volume + delta).toFixed(2)));
      state.muted = state.volume === 0;
      media.volume = state.volume;
      media.muted = state.muted;
      updateVolumeUI();
      savePrefs();
      showToast(`Volume: ${Math.round(state.volume * 100)}%`);
    },
    { passive: false }
  );

  btnSpeed.addEventListener('click', () => cycleSpeed(1));
  btnEqualizer.addEventListener('click', () => {
    eqPanel.classList.toggle('hidden');
    btnEqualizer.classList.toggle('active', !eqPanel.classList.contains('hidden'));
  });
  btnSubtitlesToggle.addEventListener('click', toggleSubtitles);
  btnSnapshot.addEventListener('click', captureSnapshot);
  btnFullscreen.addEventListener('click', toggleFullscreen);

  btnPip.addEventListener('click', async () => {
    if (!document.pictureInPictureEnabled || !media.currentSrc) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await media.requestPictureInPicture();
    } catch {
      showToast('Picture-in-Picture unavailable');
    }
  });

  // EQ preset select
  eqPresetSelect.addEventListener('change', () => {
    const preset = eqPresetSelect.value;
    if (EQ_PRESETS[preset]) {
      state.eqPreset = preset;
      state.eqGains = [...EQ_PRESETS[preset]];
      applyEqGains();
    }
  });

  // Visualizer mode chips
  visModeBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-vis]');
    if (!btn) return;
    state.visMode = btn.dataset.vis;
    visModeBar.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === btn));
    savePrefs();
  });

  // Sidebar & File Pickers
  btnToggleSidebar.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen;
    updateSidebarUI();
    savePrefs();
  });

  $('btnAddFiles').addEventListener('click', () => fileInput.click());
  $('btnEmptyOpenFiles').addEventListener('click', () => fileInput.click());
  $('btnAddFolder').addEventListener('click', openFolderPicker);
  $('btnEmptyOpenFolder').addEventListener('click', openFolderPicker);
  window.addEventListener('beforeunload', saveLastPlayback);
  $('btnAddSubtitle').addEventListener('click', () => subtitleInput.click());
  $('btnClearQueue').addEventListener('click', clearQueue);
  queueSearch.addEventListener('input', renderQueue);

  fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  folderInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    e.target.value = '';
  });

  subtitleInput.addEventListener('change', (e) => {
    if (e.target.files[0]) attachSubtitleFile(e.target.files[0]);
    e.target.value = '';
  });

  // Modals
  $('btnOpenUrl').addEventListener('click', () => {
    urlModal.classList.remove('hidden');
    urlInput.focus();
  });

  $('btnShortcuts').addEventListener('click', () => shortcutsModal.classList.remove('hidden'));

  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => $(btn.dataset.closeModal).classList.add('hidden'));
  });

  [urlModal, shortcutsModal].forEach((modal) => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
  });

  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = urlInput.value.trim();
    if (!url) return;
    const cleanName = decodeURIComponent(url.split('/').pop().split('?')[0] || 'Remote Stream');
    addItemsToQueue(
      [
        {
          id: `${Date.now()}`,
          title: cleanName,
          fileName: url,
          kind: inferKind(url),
          src: url,
          isObjectUrl: false,
          duration: null,
        },
      ],
      true
    );
    urlInput.value = '';
    urlModal.classList.add('hidden');
  });

  // Drag & Drop (supports files & folders)
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    dropOverlay.classList.add('visible');
  });

  window.addEventListener('dragover', (e) => e.preventDefault());

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.classList.remove('visible');
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    dropOverlay.classList.remove('visible');
    const items = Array.from(e.dataTransfer?.items || []);
    const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
    if (entries.length) {
      const files = (await Promise.all(entries.map(readEntryFiles))).flat();
      handleFiles(files);
    } else if (e.dataTransfer?.files?.length) {
      handleFiles(e.dataTransfer.files);
    }
  });

  // Fullscreen idle cursor/controls hide
  appShell.addEventListener('mousemove', () => {
    appShell.classList.remove('controls-idle');
    clearTimeout(state.idleTimer);
    if (document.fullscreenElement) {
      state.idleTimer = setTimeout(() => appShell.classList.add('controls-idle'), 2400);
    }
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      fileInput.click();
      return;
    }

    switch (e.key.toLowerCase()) {
      case ' ':
      case 'k':
        e.preventDefault();
        togglePlayPause();
        break;
      case 'arrowleft':
        e.preventDefault();
        media.currentTime = Math.max(0, media.currentTime - 5);
        break;
      case 'arrowright':
        e.preventDefault();
        media.currentTime = Math.min(media.duration || 0, media.currentTime + 5);
        break;
      case 'j':
        media.currentTime = Math.max(0, media.currentTime - 10);
        break;
      case 'l':
        media.currentTime = Math.min(media.duration || 0, media.currentTime + 10);
        break;
      case 'arrowup':
        e.preventDefault();
        state.volume = Math.min(1, +(state.volume + 0.05).toFixed(2));
        state.muted = false;
        media.volume = state.volume;
        media.muted = false;
        updateVolumeUI();
        savePrefs();
        showToast(`Volume: ${Math.round(state.volume * 100)}%`);
        break;
      case 'arrowdown':
        e.preventDefault();
        state.volume = Math.max(0, +(state.volume - 0.05).toFixed(2));
        state.muted = state.volume === 0;
        media.volume = state.volume;
        media.muted = state.muted;
        updateVolumeUI();
        savePrefs();
        showToast(`Volume: ${Math.round(state.volume * 100)}%`);
        break;
      case 'm':
        btnMute.click();
        break;
      case 'f':
        toggleFullscreen();
        break;
      case 'p':
        btnToggleSidebar.click();
        break;
      case 'n':
        playNext(false);
        break;
      case 'b':
        playPrev();
        break;
      case '[':
        cycleSpeed(-1);
        break;
      case ']':
        cycleSpeed(1);
        break;
      case 'c':
        toggleSubtitles();
        break;
      case '?':
        shortcutsModal.classList.toggle('hidden');
        break;
      case 'escape':
        urlModal.classList.add('hidden');
        shortcutsModal.classList.add('hidden');
        eqPanel.classList.add('hidden');
        btnEqualizer.classList.remove('active');
        break;
    }
  });

  // --- Init ---
  loadPrefs();
  buildEqUI();
  media.volume = state.volume;
  media.muted = state.muted;
  btnSpeed.textContent = `${SPEEDS[state.speedIndex]}x`;
  visModeBar.querySelectorAll('.chip').forEach((c) => {
    c.classList.toggle('active', c.dataset.vis === state.visMode);
  });
  updateVolumeUI();
  updateLoopShuffleUI();
  updateSidebarUI();
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(stage);
  restoreLastFolderOnStartup();
})();
