(function () {
  'use strict';

  // ---- Constantes de almacenamiento ----
  const STORAGE_KEYS = {
    players: 'asistencia_players',
    sessions: 'asistencia_sessions',
    matches: 'asistencia_matches',
    lastSelectedDate: 'asistencia_last_date'
  };

  // ---- Estado en memoria ----
  let players = [];
  let sessions = [];
  let matches = [];

  // ---- Utilidades ----
  function generateId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEYS.players, JSON.stringify(players));
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    localStorage.setItem(STORAGE_KEYS.matches, JSON.stringify(matches));
  }

  function loadState() {
    try {
      const p = JSON.parse(localStorage.getItem(STORAGE_KEYS.players) || '[]');
      const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || '[]');
      const m = JSON.parse(localStorage.getItem(STORAGE_KEYS.matches) || '[]');
      if (Array.isArray(p)) players = p; else players = [];
      if (Array.isArray(s)) sessions = s; else sessions = [];
      if (Array.isArray(m)) matches = m; else matches = [];
    } catch (e) {
      players = [];
      sessions = [];
      matches = [];
    }
    // Normaliza: ordena jugadores por nombre
    players.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    // Normaliza: ordena sesiones por fecha asc
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    // Normaliza formato de asistencia: de array a objeto { [playerId]: 'A'|'F'|'FJ'|'T' }
    sessions = sessions.map((ses) => {
      const next = { ...ses };
      const att = ses.attendance;
      if (Array.isArray(att)) {
        const obj = {};
        att.forEach((pid) => {
          obj[pid] = 'A';
        });
        next.attendance = obj;
      } else if (!att || typeof att !== 'object') {
        next.attendance = {};
      }
      return next;
    });
    // Para partidos en modo entradas, ordena por creación asc
    matches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  }

  function formatDateHuman(yyyyMMdd) {
    if (!yyyyMMdd) return '';
    const [y, m, d] = yyyyMMdd.split('-').map(Number);
    try {
      const dt = new Date(Date.UTC(y, m - 1, d));
      const formatter = new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return formatter.format(dt);
    } catch {
      return yyyyMMdd;
    }
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  }

  function findSessionByDate(dateStr) {
    return sessions.find(s => s.date === dateStr) || null;
  }

  function upsertSession(newSession) {
    const idx = sessions.findIndex(s => s.date === newSession.date);
    if (idx >= 0) {
      sessions[idx] = { ...sessions[idx], ...newSession };
    } else {
      sessions.push(newSession);
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date));
    saveState();
  }

  function removePlayerAndCleanup(playerId) {
    players = players.filter(p => p.id !== playerId);
    // Limpia asistencia en sesiones
    sessions = sessions.map((s) => {
      const next = { ...s };
      const att = next.attendance;
      if (Array.isArray(att)) {
        next.attendance = att.filter((id) => id !== playerId);
      } else if (att && typeof att === 'object') {
        const obj = { ...att };
        delete obj[playerId];
        next.attendance = obj;
      } else {
        next.attendance = {};
      }
      return next;
    });
    // Limpia estadísticas en partidos
    // Soporta dos formatos:
    // 1) Formato antiguo por fecha con stats por jugador { date, stats: { [playerId]: {...} } }
    // 2) Formato actual de entradas por jugador { playerId, goals, assists, ... }
    matches = matches.reduce((acc, item) => {
      if (item && typeof item === 'object') {
        if ('playerId' in item) {
          if (item.playerId !== playerId) acc.push(item);
        } else if ('stats' in item) {
          const nextStats = { ...(item.stats || {}) };
          delete nextStats[playerId];
          // solo conservar si quedan estadísticas de algún jugador
          if (Object.keys(nextStats).length > 0) {
            acc.push({ ...item, stats: nextStats });
          }
        } else {
          acc.push(item);
        }
      }
      return acc;
    }, []);
    saveState();
  }

  function computeStats(rangeFrom, rangeTo) {
    // Filtra sesiones por rango
    const filtered = sessions.filter(s => {
      if (rangeFrom && s.date < rangeFrom) return false;
      if (rangeTo && s.date > rangeTo) return false;
      return true;
    });
    const totalSessions = filtered.length;
    const countersByPlayer = new Map();
    players.forEach(p => countersByPlayer.set(p.id, { A: 0, F: 0, FJ: 0, T: 0 }));
    filtered.forEach(s => {
      const att = s.attendance;
      if (Array.isArray(att)) {
        att.forEach(pid => {
          const c = countersByPlayer.get(pid);
          if (c) c.A += 1;
        });
      } else if (att && typeof att === 'object') {
        Object.entries(att).forEach(([pid, status]) => {
          const c = countersByPlayer.get(pid);
          if (!c) return;
          if (status === 'A') c.A += 1;
          else if (status === 'F') c.F += 1;
          else if (status === 'FJ') c.FJ += 1;
          else if (status === 'T') c.T += 1;
        });
      }
    });
    const rows = players.map(p => {
      const c = countersByPlayer.get(p.id) || { A: 0, F: 0, FJ: 0, T: 0 };
      const total = totalSessions;
      return { player: p, total, ...c };
    });
    // Orden por A desc, luego F asc, luego nombre
    rows.sort((a, b) => {
      if (b.A !== a.A) return b.A - a.A;
      if (a.F !== b.F) return a.F - b.F;
      return a.player.name.localeCompare(b.player.name, 'es', { sensitivity: 'base' });
    });
    return { totalSessions, rows };
  }

  // ---- Partidos: utilidades (modo entrada por jugador) ----
  function addMatchEntry(entry) {
    matches.push(entry);
    matches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    saveState();
  }

  function computeMatchStats() {
    const totalsByPlayer = new Map();
    players.forEach(p => totalsByPlayer.set(p.id, { goals: 0, assists: 0, yellows: 0, reds: 0, minutes: 0, games: 0 }));
    matches.forEach(ent => {
      const agg = totalsByPlayer.get(ent.playerId);
      if (!agg) return;
      const goals = Number(ent.goals) || 0;
      const assists = Number(ent.assists) || 0;
      const yellows = Number(ent.yellows) || 0;
      const reds = Number(ent.reds) || 0;
      const minutes = Number(ent.minutes) || 0;
      agg.goals += goals;
      agg.assists += assists;
      agg.yellows += yellows;
      agg.reds += reds;
      agg.minutes += minutes;
      if (minutes > 0 || goals > 0 || assists > 0 || yellows > 0 || reds > 0) {
        agg.games += 1;
      }
    });
    const rows = players.map(p => {
      const t = totalsByPlayer.get(p.id) || { goals: 0, assists: 0, yellows: 0, reds: 0, minutes: 0, games: 0 };
      const denom = t.games > 0 ? t.games * (config.matchMinutes || 80) : 0;
      const percent = denom > 0 ? Math.round(Math.min(100, (t.minutes / denom) * 100)) : 0;
      return { player: p, percent, ...t };
    });
    rows.sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      if (b.assists !== a.assists) return b.assists - a.assists;
      if (b.minutes !== a.minutes) return b.minutes - a.minutes;
      return a.player.name.localeCompare(b.player.name, 'es', { sensitivity: 'base' });
    });
    return { rows };
  }

  // ---- DOM refs ----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const tabsNav = $('.tabs-nav');
  const tabSections = $$('.tab-section');

  // Jugadores
  const formAddPlayer = $('#form-add-player');
  const inputPlayerName = $('#player-name');
  const playersList = $('#players-list');
  const playersEmpty = $('#players-empty');

  // Entrenamientos
  const formSession = $('#form-session');
  const inputSessionDate = $('#session-date');
  const attendanceList = $('#attendance-list');
  const attendanceEmpty = $('#attendance-empty');

  // Estadísticas
  const formStatsFilter = $('#form-stats-filter');
  const inputStatsFrom = $('#stats-from');
  const inputStatsTo = $('#stats-to');
  const statsTable = $('#stats-table');
  const statsTbody = $('#stats-table tbody');
  const statsEmpty = $('#stats-empty');
  const statsDetail = $('#stats-detail');
  const statsDetailEmpty = $('#stats-detail-empty');
  const statsDetailList = $('#stats-detail-list');
  const recentSessionsList = $('#recent-sessions');
  const btnStatsClear = $('#stats-clear');

  // Footer
  const btnReset = $('#reset-data');
  const appFooter = document.querySelector('.app-footer');
  const btnOpenSettings = $('#open-settings');
  const settingsModal = $('#settings-modal');
  const settingsForm = $('#settings-form');
  const inputCfgMatchMinutes = $('#cfg-match-minutes');
  const selectCfgTheme = $('#cfg-theme');
  const inputCfgBg = $('#cfg-bg-color');
  const inputCfgPrimary = $('#cfg-primary-color');
  const btnSettingsResetColors = $('#settings-reset-colors');
  const selectCfgCloudEnabled = $('#cfg-cloud-enabled');
  const textareaCfgFirebase = $('#cfg-firebase-json');
  const btnSettingsClose = $('#settings-close');

  let config = { matchMinutes: 80, theme: 'dark', bg: null, primary: null };

  // ---- Firebase / Cloud Sync ----
  const STORAGE_KEYS_CLOUD = {
    cloudEnabled: 'asistencia_cloud_enabled',
    firebaseConfig: 'asistencia_firebase_config'
  };
  let cloud = {
    enabled: false,
    app: null,
    auth: null,
    db: null,
    firebaseConfig: null
  };

  // Configuración de Firebase por defecto (para nuevos usuarios)
  const DEFAULT_FIREBASE_CONFIG = {
    "apiKey": "AIzaSyCiKwHtQ_TUMe5mCv5WVsA64ELoloSr8Tk",
    "authDomain": "futstats-b68d4.firebaseapp.com",
    "projectId": "futstats-b68d4",
    "storageBucket": "futstats-b68d4.firebasestorage.app",
    "messagingSenderId": "678718806192",
    "appId": "1:678718806192:web:2a8c76736e2eccf4e9c375",
    "measurementId": "G-1RS15E65BY"
  };

  let isApplyingCloudSnapshot = false;

  // Inicializar Firebase si está habilitado
  async function initFirebaseIfEnabled() {
    if (!cloud.enabled || !cloud.firebaseConfig) return;
    
    try {
      // Importar Firebase dinámicamente
      if (!window.firebase) {
        const script = document.createElement('script');
        script.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
        
        const authScript = document.createElement('script');
        authScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js';
        document.head.appendChild(authScript);
        
        await new Promise((resolve, reject) => {
          authScript.onload = resolve;
          authScript.onerror = reject;
        });
      }

      // Inicializar Firebase
      if (!cloud.app) {
        cloud.app = firebase.initializeApp(cloud.firebaseConfig);
        cloud.db = firebase.firestore(cloud.app);
        cloud.auth = firebase.auth(cloud.app);
      }

      // Autenticación anónima
      if (!cloud.auth.currentUser) {
        await cloud.auth.signInAnonymously();
      }

      // Iniciar sincronización
      startCloudSync();
      
      console.log('Firebase inicializado correctamente');
    } catch (error) {
      console.error('Error inicializando Firebase:', error);
      alert('Error al conectar con Firebase: ' + error.message);
    }
  }

  // Iniciar sincronización en tiempo real
  function startCloudSync() {
    if (!cloud.enabled || !cloud.db) return;

    console.log('Iniciando sincronización en la nube...');

    // Sincronizar jugadores
    cloud.db.collection('players').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const playerData = change.doc.data();
          const existingIndex = players.findIndex(p => p.id === playerData.id);
          
          if (existingIndex >= 0) {
            // Actualizar jugador existente
            players[existingIndex] = { ...players[existingIndex], ...playerData };
          } else {
            // Añadir nuevo jugador
            players.push(playerData);
          }
        } else if (change.type === 'removed') {
          const playerId = change.doc.id;
          players = players.filter(p => p.id !== playerId);
        }
      });
      
      // Ordenar y guardar
      players.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      saveState();
      
      // Refrescar UI
      renderPlayersList();
      renderAttendanceList();
      renderMatchPlayerForm();
      renderMatchStats();
      renderRecentMatchEntries();
    });

    // Sincronizar sesiones
    cloud.db.collection('sessions').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const sessionData = change.doc.data();
          const existingIndex = sessions.findIndex(s => s.id === sessionData.id);
          
          if (existingIndex >= 0) {
            sessions[existingIndex] = { ...sessions[existingIndex], ...sessionData };
          } else {
            sessions.push(sessionData);
          }
        } else if (change.type === 'removed') {
          const sessionId = change.doc.id;
          sessions = sessions.filter(s => s.id !== sessionId);
        }
      });
      
      // Ordenar por fecha y guardar
      sessions.sort((a, b) => new Date(b.date) - new Date(a.date));
      saveState();
      
      // Refrescar UI
      renderStats();
      renderRecentSessions();
      if (inputSessionDate.value) {
        renderAttendanceList();
      }
    });

    // Sincronizar entradas de partido
    cloud.db.collection('matchEntries').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const matchData = change.doc.data();
          const existingIndex = matches.findIndex(m => m.id === matchData.id);
          
          if (existingIndex >= 0) {
            matches[existingIndex] = { ...matches[existingIndex], ...matchData };
          } else {
            matches.push(matchData);
          }
        } else if (change.type === 'removed') {
          const matchId = change.doc.id;
          matches = matches.filter(m => m.id !== matchId);
        }
      });
      
      // Guardar y refrescar UI
      saveState();
      renderMatchStats();
      renderRecentMatchEntries();
    });

    console.log('Sincronización en la nube iniciada');
  }

  // Sincronizar datos locales a la nube
  async function syncDataToCloud() {
    if (!cloud.enabled || !cloud.db) return;
    
    console.log('Sincronizando datos locales a la nube...');
    
    try {
      // Marcar que estamos aplicando cambios de la nube
      isApplyingCloudSnapshot = true;
      
      // Sincronizar jugadores
      const playersBatch = cloud.db.batch();
      players.forEach(player => {
        const docRef = cloud.db.collection('players').doc(player.id);
        playersBatch.set(docRef, player);
      });
      await playersBatch.commit();
      
      // Sincronizar sesiones
      const sessionsBatch = cloud.db.batch();
      sessions.forEach(session => {
        const docRef = cloud.db.collection('sessions').doc(session.id);
        sessionsBatch.set(docRef, session);
      });
      await sessionsBatch.commit();
      
      // Sincronizar entradas de partido
      const matchesBatch = cloud.db.batch();
      matches.forEach(match => {
        const docRef = cloud.db.collection('matchEntries').doc(match.id);
        matchesBatch.set(docRef, match);
      });
      await matchesBatch.commit();
      
      console.log('Datos sincronizados a la nube correctamente');
    } catch (error) {
      console.error('Error sincronizando a la nube:', error);
      alert('Error al sincronizar datos: ' + error.message);
    } finally {
      isApplyingCloudSnapshot = false;
    }
  }

  // Cargar configuración de la nube
  function loadCloudConfig() {
    try {
      const enabled = localStorage.getItem(STORAGE_KEYS_CLOUD.cloudEnabled) === '1';
      cloud.enabled = enabled;
      
      const firebaseConfig = localStorage.getItem(STORAGE_KEYS_CLOUD.firebaseConfig);
      if (firebaseConfig) {
        cloud.firebaseConfig = JSON.parse(firebaseConfig);
      } else {
        // Si no hay configuración guardada, usar la por defecto
        cloud.firebaseConfig = DEFAULT_FIREBASE_CONFIG;
        console.log('Usando configuración de Firebase por defecto');
      }
    } catch (error) {
      console.error('Error cargando configuración de la nube:', error);
      // En caso de error, usar configuración por defecto
      cloud.firebaseConfig = DEFAULT_FIREBASE_CONFIG;
    }
  }

  // Guardar configuración de la nube
  function saveCloudConfig() {
    try {
      localStorage.setItem(STORAGE_KEYS_CLOUD.cloudEnabled, cloud.enabled ? '1' : '0');
      if (cloud.firebaseConfig) {
        localStorage.setItem(STORAGE_KEYS_CLOUD.firebaseConfig, JSON.stringify(cloud.firebaseConfig));
      } else {
        localStorage.removeItem(STORAGE_KEYS_CLOUD.firebaseConfig);
      }
    } catch (error) {
      console.error('Error guardando configuración de la nube:', error);
    }
  }

  // Partidos (form por jugador)
  const formMatchPlayer = $('#form-match-player');
  const selectMatchPlayer = $('#match-player');
  const inputMatchGoals = $('#match-goals');
  const inputMatchAssists = $('#match-assists');
  const inputMatchYellows = $('#match-yellows');
  const inputMatchReds = $('#match-reds');
  const inputMatchMinutes = $('#match-minutes');
  const recentMatchEntries = $('#recent-match-entries');

  // Estadísticas de Partidos
  const formMStatsFilter = $('#form-mstats-filter');
  const inputMStatsFrom = $('#mstats-from');
  const inputMStatsTo = $('#mstats-to');
  const mstatsTable = $('#mstats-table');
  const mstatsTbody = $('#mstats-table tbody');
  const mstatsEmpty = $('#mstats-empty');
  const btnMStatsClear = $('#mstats-clear');

  let mstatsSort = { key: 'goals', dir: 'desc' };

  // ---- Navegación de pestañas ----
  function onTabClick(e) {
    const btn = e.target.closest('button[data-target]');
    if (!btn) return;
    const targetId = btn.getAttribute('data-target');
    $$('.tab-btn', tabsNav).forEach(b => b.classList.toggle('is-active', b === btn));
    tabSections.forEach(sec => sec.classList.toggle('is-active', sec.id === targetId));
    if (appFooter) appFooter.style.display = targetId === 'tab-jugadores' ? 'flex' : 'none';
    if (targetId === 'tab-entrenamientos') {
      renderAttendanceList();
    } else if (targetId === 'tab-estadisticas') {
      renderStats();
      renderRecentSessions();
    } else if (targetId === 'tab-partidos') {
      renderMatchPlayerForm();
      renderRecentMatchEntries();
    } else if (targetId === 'tab-estadisticas-partidos') {
      renderMatchStats();
    }
    // Inicia sync en segundo plano si se ha activado
    if (cloud.enabled && cloud.db) startCloudSync();
  }

  tabsNav.addEventListener('click', onTabClick);

  // ---- Render Jugadores ----
  function renderPlayersList() {
    playersEmpty.classList.toggle('is-hidden', players.length > 0);
    playersList.innerHTML = '';
    players.forEach(p => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'row-actions';

      const title = document.createElement('div');
      title.textContent = p.name;
      left.appendChild(title);

      const btnEdit = document.createElement('button');
      btnEdit.className = 'btn';
      btnEdit.textContent = 'Renombrar';
      btnEdit.addEventListener('click', () => {
        const newName = prompt('Nuevo nombre para el jugador:', p.name);
        if (newName && newName.trim()) {
          p.name = newName.trim();
          players.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
          saveState();
          
          // Sincronizar cambio con Firebase
          if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
            cloud.db.collection('players').doc(p.id).set(p).catch((error) => {
              console.error('Error sincronizando cambio de nombre a la nube:', error);
            });
          }
          
          renderPlayersList();
          renderAttendanceList();
          renderStats();
          renderMatchPlayerForm();
          renderMatchStats();
          renderRecentMatchEntries();
        }
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
        const confirmed = confirm(`¿Eliminar a "${p.name}"? Se quitará de todas las asistencias.`);
        if (confirmed) {
          removePlayerAndCleanup(p.id);
          renderPlayersList();
          renderAttendanceList();
          renderStats();
          if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
            cloud.db.collection('players').doc(p.id).delete().catch((error) => {
              console.error('Error eliminando jugador de la nube:', error);
            });
          }
          renderMatchPlayerForm();
          renderMatchStats();
          renderRecentMatchEntries();
        }
      });

      right.appendChild(btnEdit);
      right.appendChild(btnDelete);
      li.appendChild(left);
      li.appendChild(right);
      playersList.appendChild(li);
    });
  }

  formAddPlayer.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = (inputPlayerName.value || '').trim();
    if (!name) return;
    const exists = players.some(p => p.name.toLowerCase() === name.toLowerCase());
    if (exists && !confirm('Ya existe un jugador con ese nombre. ¿Añadir de todas formas?')) {
      return;
    }
    const player = {
      id: generateId('player'),
      name,
      createdAt: Date.now()
    };
    players.push(player);
    players.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    saveState();
          if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
        cloud.db.collection('players').doc(player.id).set(player).catch((error) => {
          console.error('Error sincronizando jugador a la nube:', error);
        });
      }
    inputPlayerName.value = '';
    renderPlayersList();
    renderAttendanceList();
    renderStats();
    renderMatchPlayerForm();
    renderMatchStats();
    renderRecentMatchEntries();
  });

  // ---- Render Entrenamientos / Asistencia ----
  function renderAttendanceList() {
    attendanceList.innerHTML = '';
    const hasPlayers = players.length > 0;
    attendanceEmpty.style.display = hasPlayers ? 'none' : 'block';
    if (!hasPlayers) return;

    // Cabecera de controles
    const headerLi = document.createElement('li');
    headerLi.style.display = 'flex';
    headerLi.style.justifyContent = 'space-between';
    headerLi.style.alignItems = 'center';
    headerLi.style.background = 'transparent';
    headerLi.style.border = 'none';
    const headerText = document.createElement('div');
    headerText.textContent = 'Marcar asistencia';
    const headerActions = document.createElement('div');
    headerActions.className = 'row-actions';
    const btnAllA = document.createElement('button');
    btnAllA.className = 'btn';
    btnAllA.textContent = 'Todos A';
    btnAllA.addEventListener('click', () => {
      $$('#attendance-list input[type="radio"][value="A"]').forEach(r => { r.checked = true; r.dispatchEvent(new Event('change')); });
    });
    const btnAllF = document.createElement('button');
    btnAllF.className = 'btn';
    btnAllF.textContent = 'Todos F';
    btnAllF.addEventListener('click', () => {
      $$('#attendance-list input[type="radio"][value="F"]').forEach(r => { r.checked = true; r.dispatchEvent(new Event('change')); });
    });
    headerActions.appendChild(btnAllA);
    headerActions.appendChild(btnAllF);
    headerLi.appendChild(headerText);
    headerLi.appendChild(headerActions);
    attendanceList.appendChild(headerLi);

    const selectedDate = inputSessionDate.value;
    const existing = selectedDate ? findSessionByDate(selectedDate) : null;
    const attendanceStatuses = existing && existing.attendance && typeof existing.attendance === 'object'
      ? existing.attendance
      : (existing && Array.isArray(existing.attendance)
        ? Object.fromEntries(existing.attendance.map(pid => [pid, 'A']))
        : {});

    players.forEach(p => {
      const li = document.createElement('li');
      li.classList.add('checklist-item');
      const nameDiv = document.createElement('div');
      nameDiv.textContent = p.name;
      const right = document.createElement('div');
      const group = document.createElement('div');
      group.className = 'radio-group';
      const name = `att_${p.id}`;
      const current = attendanceStatuses[p.id] || 'A';
      ['A','F','FJ','T'].forEach(code => {
        const wrap = document.createElement('div');
        wrap.className = 'radio';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = code;
        input.dataset.playerId = p.id;
        input.checked = current === code;
        const rid = `att_${p.id}_${code}`;
        input.id = rid;
        const label = document.createElement('label');
        label.setAttribute('for', rid);
        label.textContent = code;
        wrap.appendChild(input);
        wrap.appendChild(label);
        group.appendChild(wrap);
      });
      li.appendChild(nameDiv);
      right.appendChild(group);
      li.appendChild(right);
      attendanceList.appendChild(li);
    });
  }

  // Guardar/editar sesión
  formSession.addEventListener('submit', (e) => {
    e.preventDefault();
    const date = inputSessionDate.value;
    if (!date) return;
    const attendance = {};
    players.forEach(p => {
      const checked = document.querySelector(`input[name="att_${p.id}"]:checked`);
      attendance[p.id] = checked ? checked.value : 'A';
    });

    const existing = findSessionByDate(date);
    if (existing) {
      const ok = confirm('Ya existe una sesión en esa fecha. ¿Deseas sobrescribirla?');
      if (!ok) return;
    }
    const session = {
      id: existing ? existing.id : generateId('session'),
      date,
      attendance
    };
    upsertSession(session);
    if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
      cloud.db.collection('sessions').doc(session.id).set(session).catch((error) => {
        console.error('Error sincronizando sesión a la nube:', error);
      });
    }
    localStorage.setItem(STORAGE_KEYS.lastSelectedDate, date);
    renderStats();
    renderRecentSessions();
  });

  // Cambiar fecha carga asistencia previa
  inputSessionDate.addEventListener('change', () => {
    const date = inputSessionDate.value;
    if (!date) return;
    localStorage.setItem(STORAGE_KEYS.lastSelectedDate, date);
    const existing = findSessionByDate(date);
    renderAttendanceList();
  });

  // ---- Render Estadísticas ----
  function renderStats() {
    const from = inputStatsFrom.value || null;
    const to = inputStatsTo.value || null;
    const { totalSessions, rows } = computeStats(from, to);
    statsTbody.innerHTML = '';
    statsEmpty.classList.toggle('is-hidden', totalSessions > 0);
    statsTable.style.display = totalSessions > 0 ? 'table' : 'none';
    // limpia detalle
    if (statsDetailList) statsDetailList.innerHTML = '';
    if (statsDetailEmpty) statsDetailEmpty.style.display = '';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td');
      const nameBtn = document.createElement('button');
      nameBtn.className = 'btn';
      nameBtn.textContent = r.player.name;
      nameBtn.addEventListener('click', () => renderPlayerAttendanceDetail(r.player.id, from, to));
      tdName.appendChild(nameBtn);
      const tdTotal = document.createElement('td'); tdTotal.textContent = String(r.total);
      const tdA = document.createElement('td'); tdA.textContent = String(r.A);
      const tdF = document.createElement('td'); tdF.textContent = String(r.F);
      const tdFJ = document.createElement('td'); tdFJ.textContent = String(r.FJ);
      const tdT = document.createElement('td'); tdT.textContent = String(r.T);
      tr.appendChild(tdName);
      tr.appendChild(tdTotal);
      tr.appendChild(tdA);
      tr.appendChild(tdF);
      tr.appendChild(tdFJ);
      tr.appendChild(tdT);
      statsTbody.appendChild(tr);
    });
  }

  function renderPlayerAttendanceDetail(playerId, from, to) {
    if (!statsDetailList || !statsDetailEmpty) return;
    const filtered = sessions.filter(s => {
      if (from && s.date < from) return false;
      if (to && s.date > to) return false;
      return true;
    });
    const rows = [];
    filtered.forEach(s => {
      const att = s.attendance;
      let status = null;
      if (Array.isArray(att)) {
        status = att.includes(playerId) ? 'A' : 'F';
      } else if (att && typeof att === 'object') {
        status = att[playerId] || 'F';
      }
      if (status && status !== 'A') {
        rows.push({ date: s.date, status });
      }
    });
    rows.sort((a, b) => a.date.localeCompare(b.date));
    statsDetailList.innerHTML = '';
    if (rows.length === 0) {
      statsDetailEmpty.textContent = 'No hay faltas o retrasos en el rango seleccionado.';
      statsDetailEmpty.style.display = '';
      return;
    }
    statsDetailEmpty.style.display = 'none';
    rows.forEach(r => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      left.textContent = `${formatDateHuman(r.date)} ${r.status}`;
      li.appendChild(left);
      statsDetailList.appendChild(li);
    });
  }

  function renderRecentSessions() {
    const items = [...sessions].sort((a, b) => b.date.localeCompare(a.date));
    recentSessionsList.innerHTML = '';
    items.forEach(s => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'row-actions';
      const title = document.createElement('div');
      title.textContent = formatDateHuman(s.date);
      const meta = document.createElement('div');
      meta.className = 'meta';
      const totalPlayers = players.length;
      let attended = 0;
      if (Array.isArray(s.attendance)) {
        attended = s.attendance.length;
      } else if (s.attendance && typeof s.attendance === 'object') {
        attended = Object.values(s.attendance).filter(v => v === 'A').length;
      }
      meta.textContent = `${attended}/${totalPlayers} asistieron`;
      left.appendChild(title);
      left.appendChild(meta);

      const btnLoad = document.createElement('button');
      btnLoad.className = 'btn';
      btnLoad.textContent = 'Cargar';
      btnLoad.addEventListener('click', () => {
        inputSessionDate.value = s.date;
        // Cambiar a pestaña entrenamientos
        const btn = $(`.tab-btn[data-target="tab-entrenamientos"]`);
        btn && btn.click();
        renderAttendanceList();
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
        if (confirm(`¿Eliminar la sesión del ${formatDateHuman(s.date)}?`)) {
          const sessionId = s.id;
          sessions = sessions.filter(x => x.id !== sessionId);
          saveState();
          
          // Sincronizar eliminación con Firebase
          if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
            cloud.db.collection('sessions').doc(sessionId).delete().catch((error) => {
              console.error('Error eliminando sesión de la nube:', error);
            });
          }
          
          renderStats();
          renderRecentSessions();
          // Si la fecha actual es ésta, refresca lista
          if (inputSessionDate.value === s.date) {
            renderAttendanceList();
          }
        }
      });

      right.appendChild(btnLoad);
      right.appendChild(btnDelete);
      li.appendChild(left);
      li.appendChild(right);
      recentSessionsList.appendChild(li);
    });
  }

  // ---- Render Partidos (poblado de select) ----
  function renderMatchPlayerForm() {
    if (!selectMatchPlayer) return;
    selectMatchPlayer.innerHTML = '';
    players.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      selectMatchPlayer.appendChild(opt);
    });
  }

  function renderRecentMatchEntries() {
    if (!recentMatchEntries) return;
    const items = matches.slice(-10).reverse();
    recentMatchEntries.innerHTML = '';
    items.forEach(ent => {
      const player = players.find(p => p.id === ent.playerId);
      if (!player) return; // si el jugador fue eliminado, no mostrar entrada huérfana
      const li = document.createElement('li');
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'row-actions';
      const title = document.createElement('div');
      title.textContent = player.name;
      const meta = document.createElement('div'); meta.className = 'meta';
      meta.textContent = `G:${ent.goals} A:${ent.assists} TA:${ent.yellows} TR:${ent.reds} Min:${ent.minutes}`;
      left.appendChild(title);
      left.appendChild(meta);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
        const idx = matches.findIndex(m => m === ent);
        if (idx >= 0) {
          const entryId = ent.id;
          matches.splice(idx, 1);
          saveState();
          
          // Sincronizar eliminación con Firebase
          if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
            cloud.db.collection('matchEntries').doc(entryId).delete().catch((error) => {
              console.error('Error eliminando entrada de partido de la nube:', error);
            });
          }
          
          renderMatchStats();
          renderRecentMatchEntries();
        }
      });

      right.appendChild(btnDelete);
      li.appendChild(left);
      li.appendChild(right);
      recentMatchEntries.appendChild(li);
    });
  }

  function renderMatchStats() {
    if (!mstatsTbody || !mstatsTable || !mstatsEmpty) return;
    const from = inputMStatsFrom ? (inputMStatsFrom.value || null) : null;
    const to = inputMStatsTo ? (inputMStatsTo.value || null) : null;
    let { rows } = computeMatchStats(from, to);
    // ordenar
    const { key, dir } = mstatsSort;
    rows.sort((a, b) => {
      if (key === 'player') {
        return a.player.name.localeCompare(b.player.name, 'es', { sensitivity: 'base' }) * (dir === 'asc' ? 1 : -1);
      }
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      return (dir === 'asc' ? (av - bv) : (bv - av));
    });
    mstatsTbody.innerHTML = '';
    const hasMatches = matches.length > 0 && rows.some(r => {
      // oculta jugadores eliminados (nunca estarán en rows) y muestra si hay datos
      return r.games > 0 || r.goals > 0 || r.assists > 0 || r.minutes > 0 || r.yellows > 0 || r.reds > 0;
    });
    mstatsEmpty.classList.toggle('is-hidden', hasMatches);
    mstatsTable.style.display = hasMatches ? 'table' : 'none';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      const tdName = document.createElement('td'); tdName.textContent = r.player.name;
      const tdGoals = document.createElement('td'); tdGoals.textContent = String(r.goals);
      const tdAst = document.createElement('td'); tdAst.textContent = String(r.assists);
      const tdY = document.createElement('td'); tdY.textContent = String(r.yellows);
      const tdR = document.createElement('td'); tdR.textContent = String(r.reds);
      const tdMin = document.createElement('td'); tdMin.textContent = String(r.minutes);
      const tdPct = document.createElement('td'); tdPct.textContent = `${r.percent}%`;
      const tdGames = document.createElement('td'); tdGames.textContent = String(r.games);
      tr.appendChild(tdName);
      tr.appendChild(tdGoals);
      tr.appendChild(tdAst);
      tr.appendChild(tdY);
      tr.appendChild(tdR);
      tr.appendChild(tdMin);
      tr.appendChild(tdPct);
      tr.appendChild(tdGames);
      mstatsTbody.appendChild(tr);
    });
  }

  // Click ordenar cabeceras mstats
  if (mstatsTable) {
    const thead = mstatsTable.querySelector('thead');
    if (thead) {
      thead.addEventListener('click', (e) => {
        const th = e.target.closest('th[data-key]');
        if (!th) return;
        const key = th.getAttribute('data-key');
        if (mstatsSort.key === key) {
          mstatsSort.dir = mstatsSort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          mstatsSort.key = key;
          mstatsSort.dir = key === 'player' ? 'asc' : 'desc';
        }
        renderMatchStats();
      });
    }
  }

  // Filtros
  formStatsFilter.addEventListener('input', () => {
    renderStats();
  });
  btnStatsClear.addEventListener('click', () => {
    inputStatsFrom.value = '';
    inputStatsTo.value = '';
    renderStats();
  });

  // ---- Exportar / Importar / Reset ----
  // Exportar/Importar eliminados según solicitud

  btnReset.addEventListener('click', () => {
    const ok = confirm('Esto borrará todos los jugadores, entrenamientos y partidos guardados en este navegador. ¿Continuar?');
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEYS.players);
    localStorage.removeItem(STORAGE_KEYS.sessions);
    localStorage.removeItem(STORAGE_KEYS.matches);
    localStorage.removeItem(STORAGE_KEYS.lastSelectedDate);
    loadState();
    renderAll();
  });

  // Configuración
  function loadConfig() {
    try {
      const raw = localStorage.getItem('asistencia_config');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.matchMinutes === 'number') {
        config.matchMinutes = parsed.matchMinutes;
      }
      if (parsed && typeof parsed.theme === 'string') config.theme = parsed.theme;
      if (parsed && typeof parsed.bg === 'string') config.bg = parsed.bg;
      if (parsed && typeof parsed.primary === 'string') config.primary = parsed.primary;
    } catch {}
  }
  function saveConfig() {
    localStorage.setItem('asistencia_config', JSON.stringify(config));
  }

  function applyThemeFromConfig() {
    const root = document.documentElement;
    // Presets
    const presets = {
      dark: { bg: '#0f1220', primary: '#6ee7b7' },
      light: { bg: '#f1f5f9', primary: '#2563eb' },
      club: { bg: '#0b1226', primary: '#00b4d8' }
    };
    const base = presets[config.theme] || presets.dark;
    const bg = config.theme === 'custom' ? (config.bg || base.bg) : base.bg;
    const primary = config.theme === 'custom' ? (config.primary || base.primary) : base.primary;
    root.style.setProperty('--bg', bg);
    root.style.setProperty('--primary', primary);
    root.style.setProperty('--primary-700', primary);
    document.body.style.background = `radial-gradient(1200px 800px at 20% -10%, #182037 0%, ${bg} 40%), radial-gradient(1000px 700px at 100% 0%, #11213b 0%, ${bg} 40%), ${bg}`;
  }

  if (btnOpenSettings && settingsModal && settingsForm && inputCfgMatchMinutes && btnSettingsClose) {
    // Botón de sincronización manual
    const btnSyncToCloud = document.getElementById('sync-to-cloud');
    if (btnSyncToCloud) {
      btnSyncToCloud.addEventListener('click', async () => {
        if (!cloud.enabled || !cloud.db) {
          alert('Activa la sincronización en la nube primero');
          return;
        }
        
        try {
          btnSyncToCloud.textContent = 'Sincronizando...';
          btnSyncToCloud.disabled = true;
          await syncDataToCloud();
          alert('Datos sincronizados correctamente a la nube');
        } catch (error) {
          alert('Error al sincronizar: ' + error.message);
        } finally {
          btnSyncToCloud.textContent = 'Sincronizar datos a la nube';
          btnSyncToCloud.disabled = false;
        }
      });
    }
    btnOpenSettings.addEventListener('click', () => {
      // Carga último estado desde localStorage antes de pintar
      loadCloudConfig();
      inputCfgMatchMinutes.value = String(config.matchMinutes);
      if (selectCfgTheme) selectCfgTheme.value = config.theme || 'dark';
      if (inputCfgBg) inputCfgBg.value = config.bg || '#0f1220';
      if (inputCfgPrimary) inputCfgPrimary.value = config.primary || '#6ee7b7';
      if (selectCfgCloudEnabled) selectCfgCloudEnabled.value = cloud.enabled ? '1' : '0';
      if (textareaCfgFirebase) textareaCfgFirebase.value = cloud.firebaseConfig ? JSON.stringify(cloud.firebaseConfig) : '';
      settingsModal.hidden = false;
    });
    btnSettingsClose.addEventListener('click', () => {
      settingsModal.hidden = true;
    });
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mm = Math.max(1, parseInt(inputCfgMatchMinutes.value, 10) || 80);
      config.matchMinutes = mm;
      if (selectCfgTheme) config.theme = selectCfgTheme.value || 'dark';
      if (inputCfgBg) config.bg = inputCfgBg.value;
      if (inputCfgPrimary) config.primary = inputCfgPrimary.value;
      // Cloud
      if (selectCfgCloudEnabled) {
        const enabled = selectCfgCloudEnabled.value === '1';
        cloud.enabled = enabled;
        try {
          localStorage.setItem(STORAGE_KEYS_CLOUD.cloudEnabled, enabled ? '1' : '0');
        } catch {}
      }
      if (textareaCfgFirebase) {
        try {
          const val = textareaCfgFirebase.value.trim();
          if (val) {
            const cfg = JSON.parse(val);
            cloud.firebaseConfig = cfg;
            try { localStorage.setItem(STORAGE_KEYS_CLOUD.firebaseConfig, JSON.stringify(cfg)); } catch {}
          } else {
            // Si está vacío, usar configuración por defecto
            cloud.firebaseConfig = DEFAULT_FIREBASE_CONFIG;
            try { localStorage.removeItem(STORAGE_KEYS_CLOUD.firebaseConfig); } catch {}
          }
        } catch (err) {
          alert('Config JSON inválido. Revisa el formato.');
          return;
        }
      }
      saveConfig();
      saveCloudConfig();
      applyThemeFromConfig();
      renderMatchStats();
      // Inicia Firebase si procede
      await initFirebaseIfEnabled();
      settingsModal.hidden = true;
    });
    if (btnSettingsResetColors) {
      btnSettingsResetColors.addEventListener('click', () => {
        config.bg = null;
        config.primary = null;
        config.theme = 'dark';
        saveConfig();
        if (selectCfgTheme) selectCfgTheme.value = 'dark';
        if (inputCfgBg) inputCfgBg.value = '#0f1220';
        if (inputCfgPrimary) inputCfgPrimary.value = '#6ee7b7';
        applyThemeFromConfig();
      });
    }
  }

  // Guardar entrada de partido por jugador
  if (formMatchPlayer) {
    formMatchPlayer.addEventListener('submit', (e) => {
      e.preventDefault();
      const playerId = selectMatchPlayer ? selectMatchPlayer.value : '';
      if (!playerId) return;
      const entry = {
        id: generateId('mentry'),
        createdAt: Date.now(),
        playerId,
        goals: Math.max(0, parseInt(inputMatchGoals.value, 10) || 0),
        assists: Math.max(0, parseInt(inputMatchAssists.value, 10) || 0),
        yellows: Math.max(0, parseInt(inputMatchYellows.value, 10) || 0),
        reds: Math.max(0, parseInt(inputMatchReds.value, 10) || 0),
        minutes: Math.max(0, parseInt(inputMatchMinutes.value, 10) || 0)
      };
      addMatchEntry(entry);
      if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
        cloud.db.collection('matchEntries').doc(entry.id).set(entry).catch((error) => {
          console.error('Error sincronizando entrada de partido a la nube:', error);
        });
      }
      renderMatchStats();
      renderRecentMatchEntries();
      // Limpiar a 0 manteniendo el jugador seleccionado
      inputMatchGoals.value = '0';
      inputMatchAssists.value = '0';
      inputMatchYellows.value = '0';
      inputMatchReds.value = '0';
      inputMatchMinutes.value = '0';
    });
  }

  // No hay fecha ni filtros de partidos en este modo

  // ---- Inicialización ----
  function renderAll() {
    renderPlayersList();
    // Intenta mantener la fecha seleccionada
    const lastDate = localStorage.getItem(STORAGE_KEYS.lastSelectedDate);
    inputSessionDate.value = lastDate || todayISO();
    const existing = findSessionByDate(inputSessionDate.value);
    renderAttendanceList();
    renderStats();
    renderRecentSessions();
    // Partidos (form por jugador)
    renderMatchPlayerForm();
    renderMatchStats();
    renderRecentMatchEntries();
  }

  function init() {
    loadState();
    loadConfig();
    loadCloudConfig();
    
    // Para nuevos usuarios, activar automáticamente la sincronización
    const isFirstTime = !localStorage.getItem(STORAGE_KEYS_CLOUD.cloudEnabled);
    if (isFirstTime) {
      cloud.enabled = true;
      localStorage.setItem(STORAGE_KEYS_CLOUD.cloudEnabled, '1');
      console.log('Primera vez: activando sincronización automáticamente');
    }
    
    // Fecha por defecto
    const lastDate = localStorage.getItem(STORAGE_KEYS.lastSelectedDate);
    inputSessionDate.value = lastDate || todayISO();
    renderAll();
    applyThemeFromConfig();
    // Mostrar el botón de borrar solo en Jugadores al inicio
    const activeSection = document.querySelector('.tab-section.is_active');
    if (appFooter) appFooter.style.display = activeSection && activeSection.id === 'tab-jugadores' ? 'flex' : 'none';
    
    // Inicializar Firebase si está habilitado
    if (cloud.enabled) {
      initFirebaseIfEnabled();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();


