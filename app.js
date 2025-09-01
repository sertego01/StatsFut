(function () {
  'use strict';

  // ---- Constantes de almacenamiento ----
  const STORAGE_KEYS = {
    players: 'asistencia_players',
    sessions: 'asistencia_sessions',
    matches: 'asistencia_matches',
    convocations: 'asistencia_convocations',
    rivals: 'asistencia_rivals',
    matchResults: 'asistencia_matchResults',
    lastSelectedDate: 'asistencia_last_date'
  };

  // ---- Estado en memoria ----
  let players = [];
  let sessions = [];
  let matches = [];
  let convocations = [];

  // ---- Utilidades ----
  function generateId(prefix) {
    return `${prefix}_${Math.random().toString(36).slice(2, 8)}_${Date.now().toString(36)}`;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEYS.players, JSON.stringify(players));
    localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
    localStorage.setItem(STORAGE_KEYS.matches, JSON.stringify(matches));
    localStorage.setItem(STORAGE_KEYS.convocations, JSON.stringify(convocations));
    localStorage.setItem(STORAGE_KEYS.rivals, JSON.stringify(rivals));
    localStorage.setItem(STORAGE_KEYS.matchResults, JSON.stringify(matchResults));
  }

  function loadState() {
    try {
      console.log('loadState ejecutándose...');
      const p = JSON.parse(localStorage.getItem(STORAGE_KEYS.players) || '[]');
      const s = JSON.parse(localStorage.getItem(STORAGE_KEYS.sessions) || '[]');
      const m = JSON.parse(localStorage.getItem(STORAGE_KEYS.matches) || '[]');
      const c = JSON.parse(localStorage.getItem(STORAGE_KEYS.convocations) || '[]');
      const r = JSON.parse(localStorage.getItem(STORAGE_KEYS.rivals) || '[]');
      const mr = JSON.parse(localStorage.getItem(STORAGE_KEYS.matchResults) || '[]');
      
      console.log('Datos del localStorage:', { p: p.length, s: s.length, m: m.length, c: c.length, r: r.length, mr: mr.length });
      
      if (Array.isArray(p)) players = p; else players = [];
      if (Array.isArray(s)) sessions = s; else sessions = [];
      if (Array.isArray(m)) matches = m; else matches = [];
      if (Array.isArray(c)) convocations = c; else convocations = [];
      if (Array.isArray(r)) rivals = r; else rivals = [];
      if (Array.isArray(mr)) matchResults = mr; else matchResults = [];
      
      console.log('Datos asignados a variables:', { players: players.length, sessions: sessions.length, matches: matches.length });
    } catch (e) {
      console.error('Error en loadState:', e);
      players = [];
      sessions = [];
      matches = [];
      convocations = [];
      rivals = [];
      matchResults = [];
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

  async function addConvocation(convocation) {
    // Añadir a la lista local
    convocations.push(convocation);
    convocations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    saveState();
    
    // Sincronizar con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('convocations').doc(convocation.id).set(convocation);
      } catch (error) {
        console.error('Error sincronizando convocatoria con Firebase:', error);
      }
    }
  }

  function findConvocationByDate(dateStr) {
    return convocations.find(c => c.date === dateStr) || null;
  }

  async function upsertConvocation(newConvocation) {
    const idx = convocations.findIndex(c => c.date === newConvocation.date);
    if (idx >= 0) {
      // Mantener el ID original si es una edición
      newConvocation.id = convocations[idx].id;
      newConvocation.createdAt = convocations[idx].createdAt;
      convocations[idx] = { ...convocations[idx], ...newConvocation };
    } else {
      convocations.push(newConvocation);
    }
    convocations.sort((a, b) => (a.date).localeCompare(b.date));
    saveState();
    
    // Sincronizar con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('convocations').doc(newConvocation.id).set(newConvocation);
      } catch (error) {
        console.error('Error sincronizando convocatoria con Firebase:', error);
      }
    }
  }

  function computeMatchStats() {
    const totalsByPlayer = new Map();
    players.forEach(p => totalsByPlayer.set(p.id, { goals: 0, assists: 0, yellows: 0, reds: 0, minutes: 0, convocations: 0 }));
    
    // Contar convocatorias
    convocations.forEach(conv => {
      Object.entries(conv.players).forEach(([playerId, status]) => {
        if (status === 'C') {
          const agg = totalsByPlayer.get(playerId);
          if (agg) agg.convocations += 1;
        }
      });
    });
    
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
    });
    
    const rows = players.map(p => {
      const t = totalsByPlayer.get(p.id) || { goals: 0, assists: 0, yellows: 0, reds: 0, minutes: 0, convocations: 0 };
      const denom = t.convocations > 0 ? t.convocations * (config.matchMinutes || 80) : 0;
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
  // Auth UI
  const btnOpenLogin = $('#open-login');
  const btnLogout = $('#logout-btn');
  const loginModal = $('#login-modal');
  const loginForm = $('#login-form');
  const inputLoginEmail = $('#login-email');
  const inputLoginPassword = $('#login-password');
  const btnLoginClose = $('#login-close');
  const loginError = $('#login-error');

  let config = { matchMinutes: 80, theme: 'dark', bg: null, primary: null };
  let isAuthenticated = false;

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
  let isApplyingCloudSnapshot = false;
  let cloudSyncStarted = false;
  let initialSyncCompleted = false;

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

  

  // Inicializar Firebase para cargar datos
  async function initFirebaseIfEnabled() {
    if (!cloud.firebaseConfig) return;
    
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
        
        const authCompatScript = document.createElement('script');
        authCompatScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-auth-compat.js';
        document.head.appendChild(authCompatScript);
        
        await new Promise((resolve, reject) => {
          authCompatScript.onload = resolve;
          authCompatScript.onerror = reject;
        });

        const firestoreCompatScript = document.createElement('script');
        firestoreCompatScript.src = 'https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore-compat.js';
        document.head.appendChild(firestoreCompatScript);
        
        await new Promise((resolve, reject) => {
          firestoreCompatScript.onload = resolve;
          firestoreCompatScript.onerror = reject;
        });
      }

      // Inicializar Firebase
      if (!cloud.app) {
        cloud.app = firebase.initializeApp(cloud.firebaseConfig);
        cloud.db = firebase.firestore(cloud.app);
        cloud.auth = firebase.auth(cloud.app);
      }

      // Cargar datos desde Firebase siempre (con o sin autenticación)
      // Para usuarios no autenticados: solo lectura
      // Para usuarios autenticados: lectura y escritura
      startCloudSync();
      

    } catch (error) {
      console.error('Error inicializando Firebase:', error);
      alert('Error al conectar con Firebase: ' + error.message);
    }
  }

  // Iniciar sincronización en tiempo real
  function startCloudSync() {
    if (!cloud.db) return;
    if (cloudSyncStarted) return;
    cloudSyncStarted = true;



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
      
      // Mostrar mensaje de datos cargados

    }, (error) => {
      console.error('Error cargando jugadores desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando datos desde localStorage...');
        loadState();
        renderPlayersList();
        renderAttendanceList();
        renderMatchPlayerForm();
        renderMatchStats();
        renderRecentMatchEntries();
      }
    });

    // Sincronizar sesiones
    cloud.db.collection('sessions').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      // En la sincronización inicial, solo cargar datos si no hay datos locales
      // Pero permitir que se actualicen si hay cambios en Firebase
      if (!initialSyncCompleted && sessions.length > 0) {
        initialSyncCompleted = true;
        return;
      }
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const sessionData = change.doc.data();
          const existingIndex = sessions.findIndex(s => s.id === sessionData.id);
          
          if (existingIndex >= 0) {
            // Solo actualizar si hay cambios reales
            const existing = sessions[existingIndex];
            const hasChanges = JSON.stringify(existing) !== JSON.stringify(sessionData);
            
            if (hasChanges) {
              sessions[existingIndex] = { ...existing, ...sessionData };
            }
          } else {
            // Verificar que no sea un duplicado por fecha
            const isDuplicate = sessions.some(s => s.date === sessionData.date);
            
            if (!isDuplicate) {
            sessions.push(sessionData);
            }
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
    }, (error) => {
      console.error('Error cargando sesiones desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando sesiones desde localStorage...');
        loadState();
        renderStats();
        renderRecentSessions();
        if (inputSessionDate.value) {
          renderAttendanceList();
        }
      }
    });

    // Sincronizar entradas de partido
    cloud.db.collection('matchEntries').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      // En la sincronización inicial, solo cargar datos si no hay datos locales
      // Pero permitir que se actualicen si hay cambios en Firebase
      if (!initialSyncCompleted && matches.length > 0) {
        initialSyncCompleted = true;
        return;
      }
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const matchData = change.doc.data();
          const existingIndex = matches.findIndex(m => m.id === matchData.id);
          
          if (existingIndex >= 0) {
            // Solo actualizar si hay cambios reales
            const existing = matches[existingIndex];
            const hasChanges = JSON.stringify(existing) !== JSON.stringify(matchData);
            
            if (hasChanges) {
              matches[existingIndex] = { ...existing, ...matchData };
            }
          } else {
            // Verificar que no sea un duplicado por otros campos
            const isDuplicate = matches.some(m => 
              m.playerId === matchData.playerId && 
              m.date === matchData.date &&
              m.goals === matchData.goals &&
              m.assists === matchData.assists &&
              m.minutes === matchData.minutes
            );
            
            if (!isDuplicate) {
            matches.push(matchData);
            }
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
      
      // Marcar sincronización inicial como completada
      if (!initialSyncCompleted) {
        initialSyncCompleted = true;
      }
    }, (error) => {
      console.error('Error cargando entradas de partido desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando partidos desde localStorage...');
        loadState();
        renderMatchStats();
        renderRecentMatchEntries();
      }
    });

    // Sincronizar rivales
    cloud.db.collection('rivals').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      // En la sincronización inicial, solo cargar datos si no hay datos locales
      if (!initialSyncCompleted && rivals.length > 0) {
        return;
      }
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const rivalData = change.doc.data();
          const existingIndex = rivals.findIndex(r => r.id === rivalData.id);
          
          if (existingIndex >= 0) {
            // Solo actualizar si hay cambios reales
            const existing = rivals[existingIndex];
            const hasChanges = JSON.stringify(existing) !== JSON.stringify(rivalData);
            
            if (hasChanges) {
              rivals[existingIndex] = { ...existing, ...rivalData };
            }
          } else {
            // Verificar que no sea un duplicado por nombre
            const isDuplicate = rivals.some(r => r.name === rivalData.name);
            
            if (!isDuplicate) {
              rivals.push(rivalData);
            }
          }
        } else if (change.type === 'removed') {
          const rivalId = change.doc.id;
          rivals = rivals.filter(r => r.id !== rivalId);
        }
      });
      
      // Ordenar por nombre y guardar
      rivals.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
      saveState();
      
      // Refrescar UI
      renderRivalsList();
      renderCalendar();
    }, (error) => {
      console.error('Error cargando rivales desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando rivales desde localStorage...');
        loadState();
        renderRivalsList();
        renderCalendar();
      }
    });

    // Sincronizar resultados de partidos (para el calendario)
    cloud.db.collection('matchResults').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      // En la sincronización inicial, solo cargar datos si no hay datos locales
      if (!initialSyncCompleted && matchResults.length > 0) {
        return;
      }
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const resultData = change.doc.data();
          const existingIndex = matchResults.findIndex(r => r.id === resultData.id);
          
          if (existingIndex >= 0) {
            // Solo actualizar si hay cambios reales
            const existing = matchResults[existingIndex];
            const hasChanges = JSON.stringify(existing) !== JSON.stringify(resultData);
            
            if (hasChanges) {
              matchResults[existingIndex] = { ...existing, ...resultData };
            }
          } else {
            // Verificar que no sea un duplicado por rival y jornada
            const isDuplicate = matchResults.some(r => 
              r.rivalId === resultData.rivalId && 
              r.journey === resultData.journey
            );
            
            if (!isDuplicate) {
              matchResults.push(resultData);
            }
          }
        } else if (change.type === 'removed') {
          const resultId = change.doc.id;
          matchResults = matchResults.filter(r => r.id !== resultId);
        }
      });
      
      // Guardar y refrescar UI
      saveState();
      renderCalendar();
      renderRivalsList(); // Para actualizar las jornadas mostradas en cada rival
    }, (error) => {
      console.error('Error cargando resultados de partidos desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando resultados desde localStorage...');
        loadState();
        renderCalendar();
        renderRivalsList();
      }
    });

    // Sincronizar convocatorias
    cloud.db.collection('convocations').onSnapshot((snapshot) => {
      if (isApplyingCloudSnapshot) return;
      
      // En la sincronización inicial, solo cargar datos si no hay datos locales
      if (!initialSyncCompleted && convocations.length > 0) {
        return;
      }
      
      const changes = snapshot.docChanges();
      changes.forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const convocationData = change.doc.data();
          const existingIndex = convocations.findIndex(c => c.id === convocationData.id);
          
          if (existingIndex >= 0) {
            // Solo actualizar si hay cambios reales
            const existing = convocations[existingIndex];
            const hasChanges = JSON.stringify(existing) !== JSON.stringify(convocationData);
            
            if (hasChanges) {
              convocations[existingIndex] = { ...existing, ...convocationData };
            }
          } else {
            // Verificar que no sea un duplicado por fecha
            const isDuplicate = convocations.some(c => c.date === convocationData.date);
            
            if (!isDuplicate) {
              convocations.push(convocationData);
            }
          }
        } else if (change.type === 'removed') {
          const convocationId = change.doc.id;
          convocations = convocations.filter(c => c.id !== convocationId);
        }
      });
      
      // Ordenar por fecha y guardar
      convocations.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      saveState();
      
      // Refrescar UI
      renderConvocationList();
      renderRecentConvocations();
      renderStats(); // Para actualizar estadísticas de convocatorias
    }, (error) => {
      console.error('Error cargando convocatorias desde Firebase:', error);
      if (error.code === 'permission-denied') {
        console.log('Permisos denegados, cargando convocatorias desde localStorage...');
        loadState();
        renderConvocationList();
        renderRecentConvocations();
        renderStats();
      }
    });

  }

  // Sincronizar datos locales a la nube
  async function syncDataToCloud() {
    if (!cloud.enabled || !cloud.db) return;
    if (!isAuthenticated) return;
    

    
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
      

    } catch (error) {
      console.error('Error sincronizando a la nube:', error);
      alert('Error al sincronizar datos: ' + error.message);
    } finally {
      isApplyingCloudSnapshot = false;
    }
  }

  // ---- Auth: control de visibilidad/edición ----
  function applyAuthRestrictions() {
    // Tabs restringidas
    const restrictedTargets = ['tab-jugadores','tab-entrenamientos','tab-partidos','tab-rivales','tab-calendario'];
    const allTabButtons = Array.from(document.querySelectorAll('.tab-btn'));
    allTabButtons.forEach(btn => {
      const target = btn.getAttribute('data-target');
      const isRestricted = restrictedTargets.includes(target);
      // Mostrar solo estadísticas y login si no está autenticado
      if (!isAuthenticated) {
        if (target === 'tab-estadisticas' || target === 'tab-estadisticas-partidos') {
          btn.style.display = '';
        } else {
          btn.style.display = 'none';
        }
      } else {
        // autenticado: mostrar todos
        btn.style.display = '';
      }
    });

    // Ajustar textos de los botones de estadísticas y hacerlos ocupar todo el ancho cuando NO hay sesión
    const btnStatsTrain = document.querySelector('.tab-btn[data-target="tab-estadisticas"]');
    const btnStatsMatch = document.querySelector('.tab-btn[data-target="tab-estadisticas-partidos"]');
    if (!isAuthenticated) {
      if (btnStatsTrain) {
        btnStatsTrain.textContent = 'Estadísticas de entrenamientos';
        btnStatsTrain.style.width = '100%';
      }
      if (btnStatsMatch) {
        btnStatsMatch.textContent = 'Estadísticas de partidos';
        btnStatsMatch.style.width = '100%';
      }
    } else {
      if (btnStatsTrain) { btnStatsTrain.textContent = 'Estadísticas'; btnStatsTrain.style.width = ''; }
      if (btnStatsMatch) { btnStatsMatch.textContent = 'Estadísticas'; btnStatsMatch.style.width = ''; }
    }

    // Forzar filas de pestañas a 1 columna cuando solo queda un botón visible (modo sin sesión)
    const tabRows = Array.from(document.querySelectorAll('.tabs-nav .tabs-row'));
    tabRows.forEach(row => {
      const visibleButtons = Array.from(row.querySelectorAll('.tab-btn')).filter(b => b.style.display !== 'none');
      if (!isAuthenticated) {
        row.style.gridTemplateColumns = '1fr';
      } else {
        // Restaurar layout por defecto
        row.style.gridTemplateColumns = '';
      }
    });

    // Botón de iniciar sesión ocupa todo el ancho (cuando se muestra)
    const authActions = document.querySelector('.auth-actions');
    if (authActions && btnOpenLogin) {
      if (!isAuthenticated) {
        btnOpenLogin.style.width = '100%';
      } else {
        btnOpenLogin.style.width = '';
      }
    }
    // Si la pestaña activa es restringida y no está autenticado, saltar a estadísticas
    const activeBtn = document.querySelector('.tab-btn.is-active');
    const activeTarget = activeBtn ? activeBtn.getAttribute('data-target') : null;
    if (!isAuthenticated && ['tab-jugadores','tab-entrenamientos','tab-partidos'].includes(activeTarget)) {
      const statsBtn = document.querySelector('.tab-btn[data-target="tab-estadisticas"]') || document.querySelector('.tab-btn[data-target="tab-estadisticas-partidos"]');
      if (statsBtn) statsBtn.click();
    }
    
    // Footer: mostrar siempre en todas las pestañas
    if (appFooter) appFooter.style.display = 'flex';
    
    // Botones de auth
    if (btnOpenLogin) btnOpenLogin.style.display = isAuthenticated ? 'none' : '';
    if (btnLogout) btnLogout.style.display = isAuthenticated ? '' : 'none';
    
    // Botón "Borrar todo" solo visible con sesión iniciada
    const btnResetData = document.getElementById('reset-data');
    if (btnResetData) {
      btnResetData.style.display = isAuthenticated ? '' : 'none';
    }
    
    // Botón "Configuración" solo visible con sesión iniciada
    const btnSettings = document.getElementById('open-settings');
    if (btnSettings) {
      btnSettings.style.display = isAuthenticated ? '' : 'none';
    }
    
          // Ocultar cards de sesiones cuando no hay sesión iniciada
      const trainingCards = document.querySelectorAll('#tab-entrenamientos .card');
      trainingCards.forEach(card => {
        // Ocultar todas las cards excepto las que contengan estadísticas
        if (!card.querySelector('.stats-table') && !card.querySelector('#stats-card')) {
          card.style.display = isAuthenticated ? '' : 'none';
        }
      });
      
      // Ocultar específicamente la card de sesiones recientes cuando no hay sesión
      const recentSessionsCard = document.querySelector('#recent-sessions-card');
      if (recentSessionsCard) {
        recentSessionsCard.style.display = isAuthenticated ? '' : 'none';
      }
      
      // Si no está autenticado, mostrar mensaje de instrucción en estadísticas
      if (!isAuthenticated && document.getElementById('stats-table')) {
        renderStats();
      }
    
    // Ajustar layout del footer según autenticación
    const footerTopRow = document.querySelector('.footer-top-row');
    if (footerTopRow) {
      if (isAuthenticated) {
        footerTopRow.classList.remove('single-button');
      } else {
        footerTopRow.classList.add('single-button');
      }
    }
  }

  function setupAuthUI() {
    if (btnOpenLogin && loginModal && loginForm && inputLoginEmail && inputLoginPassword) {
      btnOpenLogin.addEventListener('click', () => {
        loginError && (loginError.textContent = '');
        loginModal.hidden = false;
      });
      if (btnLoginClose) btnLoginClose.addEventListener('click', () => { loginModal.hidden = true; });
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError && (loginError.textContent = '');
        const email = inputLoginEmail.value.trim();
        const password = inputLoginPassword.value;
        if (!email || !password) return;
        try {
          await initFirebaseIfEnabled();
          if (!cloud.auth) throw new Error('Auth no disponible');
          await cloud.auth.signInWithEmailAndPassword(email, password);
          isAuthenticated = true;
          
          // Limpiar datos locales y cargar desde Firebase
          clearLocalStorageData();
          
          applyAuthRestrictions();
          loginModal.hidden = true;
          
          // refrescar datos visibles
          renderPlayersList();
          renderAttendanceList();
          renderStats();
          renderMatchPlayerForm();
          renderMatchStats();
          renderRecentMatchEntries();
        } catch (err) {
          console.error(err);
          if (loginError) loginError.textContent = err.message || 'Error al iniciar sesión';
        }
      });
    }
    if (btnLogout) {
      btnLogout.addEventListener('click', async () => {
        try {
          if (cloud.auth && cloud.auth.currentUser) {
            await cloud.auth.signOut();
          }
        } catch {}
        isAuthenticated = false;
        
        // Cargar datos del localStorage cuando se cierra sesión
        loadState();
        
        applyAuthRestrictions();
      });
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
  const inputMatchDate = $('#match-date');
  const selectMatchPlayer = $('#match-player');
  const inputMatchGoals = $('#match-goals');
  const inputMatchAssists = $('#match-assists');
  const inputMatchYellows = $('#match-yellows');
  const inputMatchReds = $('#match-reds');
  const inputMatchMinutes = $('#match-minutes');
  const recentMatchEntries = $('#recent-match-entries');

  // Convocatorias
  const recentConvocations = $('#recent-convocations');
  const formConvocation = $('#form-convocation');
  const inputConvocationDate = $('#convocation-date');
  const convocationList = $('#convocation-list');
  const convocationEmpty = $('#convocation-empty');

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

    if (targetId === 'tab-entrenamientos') {
      renderAttendanceList();
    } else if (targetId === 'tab-estadisticas') {
      renderStats();
      renderRecentSessions();
      
      // Si no está autenticado, asegurar que se muestre el mensaje de instrucción
      if (!isAuthenticated) {
        renderStats();
      }
    } else if (targetId === 'tab-partidos') {
      renderMatchPlayerForm();
      renderRecentMatchEntries();
      renderRecentConvocations();
    } else if (targetId === 'tab-estadisticas-partidos') {
      renderMatchStats();
    }
    // Inicia sync en segundo plano si se ha activado y no está ya iniciado
    if (cloud.enabled && cloud.db && !cloudSyncStarted) {
      startCloudSync();
    }
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
    
    console.log('renderStats ejecutándose:', { 
      isAuthenticated, 
      from, 
      to, 
      sessionsCount: sessions.length,
      playersCount: players.length 
    });
    
    // Si no está autenticado y no hay fechas seleccionadas, mostrar mensaje de instrucción
    if (!isAuthenticated && !from && !to) {
      statsTbody.innerHTML = '';
      statsEmpty.classList.toggle('is-hidden', false);
      statsEmpty.classList.add('instruction');
      statsTable.style.display = 'none';
      statsEmpty.textContent = 'Selecciona un rango de fechas y haz clic en "Buscar" para ver las estadísticas.';
      
      // Limpiar detalle
      if (statsDetailList) statsDetailList.innerHTML = '';
      if (statsDetailEmpty) statsDetailEmpty.style.display = '';
      
      // Resetear título del detalle
      const statsDetailTitle = document.getElementById('stats-detail-title');
      if (statsDetailTitle) {
        statsDetailTitle.textContent = 'Detalle de sesiones';
      }
      return;
    }
    
    const { totalSessions, rows } = computeStats(from, to);
    statsTbody.innerHTML = '';
    statsEmpty.classList.toggle('is-hidden', totalSessions > 0);
    statsTable.style.display = totalSessions > 0 ? 'table' : 'none';
    
    // Quitar clase de instrucción si hay datos
    if (totalSessions > 0) {
      statsEmpty.classList.remove('instruction');
    }
    
    // Si no hay sesiones en el rango seleccionado
    if (totalSessions === 0) {
      statsEmpty.classList.remove('instruction');
      if (from || to) {
        statsEmpty.textContent = 'No hay sesiones registradas en el rango de fechas seleccionado.';
      } else {
        statsEmpty.textContent = 'No hay sesiones registradas.';
      }
    }
    
    // Limpiar detalle
    if (statsDetailList) statsDetailList.innerHTML = '';
    if (statsDetailEmpty) statsDetailEmpty.style.display = '';
    
    // Resetear título del detalle
    const statsDetailTitle = document.getElementById('stats-detail-title');
    if (statsDetailTitle) {
      statsDetailTitle.textContent = 'Detalle de sesiones';
    }
    
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
    
    // Obtener el nombre del jugador
    const player = players.find(p => p.id === playerId);
    const playerName = player ? player.name : 'Jugador desconocido';
    
    // Actualizar el título con el nombre del jugador
    const statsDetailTitle = document.getElementById('stats-detail-title');
    if (statsDetailTitle) {
      statsDetailTitle.textContent = `Detalle de sesiones - ${playerName}`;
    }
    
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
      statsDetailEmpty.textContent = `No hay faltas o retrasos de ${playerName} en el rango seleccionado.`;
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
    if (!selectMatchPlayer || !inputMatchDate) return;
    
    const selectedDate = inputMatchDate.value;
    if (!selectedDate) {
      // Si no hay fecha seleccionada, mostrar todos los jugadores
    selectMatchPlayer.innerHTML = '';
      const defaultOpt = document.createElement('option');
      defaultOpt.value = '';
      defaultOpt.textContent = 'Selecciona una fecha primero';
      defaultOpt.disabled = true;
      selectMatchPlayer.appendChild(defaultOpt);
      return;
    }
    
    // Buscar convocatoria para esa fecha
    const convocation = findConvocationByDate(selectedDate);
    if (!convocation) {
      // Si no hay convocatoria para esa fecha, mostrar mensaje
      selectMatchPlayer.innerHTML = '';
      const noConvOpt = document.createElement('option');
      noConvOpt.value = '';
      noConvOpt.textContent = 'No hay convocatoria para esta fecha';
      noConvOpt.disabled = true;
      selectMatchPlayer.appendChild(noConvOpt);
      return;
    }
    
    // Filtrar solo jugadores convocados
    selectMatchPlayer.innerHTML = '';
    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Selecciona un jugador convocado';
    defaultOpt.disabled = true;
    selectMatchPlayer.appendChild(defaultOpt);
    
    players.forEach(p => {
      if (convocation.players[p.id] === 'C') {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      selectMatchPlayer.appendChild(opt);
      }
    });
  }

  function renderConvocationList() {
    if (!convocationList || !convocationEmpty) return;
    
    const selectedDate = inputConvocationDate.value;
    if (!selectedDate) {
      convocationEmpty.textContent = 'Selecciona una fecha para registrar la convocatoria.';
      convocationEmpty.style.display = '';
      convocationList.innerHTML = '';
      return;
    }

    const existing = findConvocationByDate(selectedDate);
    const convocationStatuses = existing ? existing.players : {};

    convocationEmpty.style.display = 'none';
    convocationList.innerHTML = '';

    // No mostrar validaciones en tiempo real, solo al guardar

    players.forEach(p => {
      const li = document.createElement('li');
      const nameDiv = document.createElement('div');
      nameDiv.textContent = p.name;
      const right = document.createElement('div');
      const group = document.createElement('div');
      group.className = 'radio-group radio-cn';
      
      const name = `conv_${p.id}`;
      const current = convocationStatuses[p.id] || 'C';
      
      ['C', 'NC'].forEach(code => {
        const wrap = document.createElement('div');
        wrap.className = 'radio';
        const input = document.createElement('input');
        input.type = 'radio';
        input.name = name;
        input.value = code;
        input.dataset.playerId = p.id;
        input.checked = current === code;
        const rid = `conv_${p.id}_${code}`;
        input.id = rid;
        const label = document.createElement('label');
        label.setAttribute('for', rid);
        label.textContent = code;
        
        // No deshabilitar en tiempo real, permitir que el usuario haga cambios
        
        wrap.appendChild(input);
        wrap.appendChild(label);
        group.appendChild(wrap);
        
        // No re-renderizar en tiempo real para evitar perder cambios del usuario
      });
      
      li.appendChild(nameDiv);
      right.appendChild(group);
      li.appendChild(right);
      convocationList.appendChild(li);
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
       li.className = 'recent-match-item';
       
      const left = document.createElement('div');
       left.className = 'match-info';
       
      const right = document.createElement('div');
       right.className = 'match-actions';
       
       // Contenedor para nombre y fecha en la misma línea
       const nameDateRow = document.createElement('div');
       nameDateRow.className = 'name-date-row';
       
       // Nombre del jugador
      const title = document.createElement('div');
       title.className = 'player-name';
      title.textContent = player.name;
       
       // Fecha del partido
       const date = document.createElement('div');
       date.className = 'match-date';
       date.textContent = formatDateHuman(ent.date);
       
       // Estadísticas del partido
       const meta = document.createElement('div');
       meta.className = 'match-stats';
       meta.textContent = `G:${ent.goals} A:${ent.assists} 🟨:${ent.yellows} 🟥:${ent.reds} Min:${ent.minutes}`;
       
       nameDateRow.appendChild(title);
       nameDateRow.appendChild(date);
       left.appendChild(nameDateRow);
      left.appendChild(meta);

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
         // Confirmar eliminación antes de proceder
         if (confirm(`¿Estás seguro de que quieres eliminar el partido de ${player.name} del ${formatDateHuman(ent.date)}? Esta acción no se puede deshacer.`)) {
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
        }
      });

      right.appendChild(btnDelete);
      li.appendChild(left);
      li.appendChild(right);
      recentMatchEntries.appendChild(li);
    });
  }

  function renderRecentConvocations() {
    if (!recentConvocations) return;
    const items = convocations.slice(-10).reverse();
    recentConvocations.innerHTML = '';
    
    items.forEach(conv => {
      const li = document.createElement('li');
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'row-actions';
      
      const title = document.createElement('div');
      title.textContent = formatDateHuman(conv.date);
      
      const meta = document.createElement('div');
      meta.className = 'meta';
      
      // Contar jugadores convocados
      const convocadosCount = Object.values(conv.players).filter(status => status === 'C').length;
      const totalPlayers = Object.keys(conv.players).length;
      
              meta.textContent = `${convocadosCount}/${totalPlayers} convocados`;
      
      left.appendChild(title);
      left.appendChild(meta);

      const btnLoad = document.createElement('button');
      btnLoad.className = 'btn';
      btnLoad.textContent = 'Cargar';
      btnLoad.addEventListener('click', () => {
        inputConvocationDate.value = conv.date;
        renderConvocationList();
      });

      const btnDelete = document.createElement('button');
      btnDelete.className = 'btn danger';
      btnDelete.textContent = 'Eliminar';
      btnDelete.addEventListener('click', () => {
        if (confirm(`¿Eliminar la convocatoria del ${formatDateHuman(conv.date)}?`)) {
          const idx = convocations.findIndex(c => c.id === conv.id);
          if (idx >= 0) {
            const convocationId = conv.id;
            convocations.splice(idx, 1);
            saveState();
            
            // Sincronizar eliminación con Firebase
            if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
              cloud.db.collection('convocations').doc(convocationId).delete().catch((error) => {
                console.error('Error eliminando convocatoria de la nube:', error);
              });
            }
            
            renderMatchStats();
            renderRecentConvocations();
          }
        }
      });

      right.appendChild(btnLoad);
      right.appendChild(btnDelete);
      li.appendChild(left);
      li.appendChild(right);
      recentConvocations.appendChild(li);
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
    const hasMatches = (matches.length > 0 || convocations.length > 0) && rows.some(r => {
      // oculta jugadores eliminados (nunca estarán en rows) y muestra si hay datos
      return r.convocations > 0 || r.goals > 0 || r.assists > 0 || r.minutes > 0 || r.yellows > 0 || r.reds > 0;
    });
    mstatsEmpty.classList.toggle('is-hidden', hasMatches);
    mstatsTable.style.display = hasMatches ? 'table' : 'none';
    rows.forEach(r => {
      const tr = document.createElement('tr');
      
      // Crear celda del nombre con clickeable
      const tdName = document.createElement('td');
      const nameSpan = document.createElement('span');
      nameSpan.textContent = r.player.name;
      nameSpan.className = 'player-name-clickable';
      nameSpan.onclick = () => showPlayerDetailedStats(r);
      tdName.appendChild(nameSpan);
      
      const tdGoals = document.createElement('td'); tdGoals.textContent = String(r.goals);
      const tdAst = document.createElement('td'); tdAst.textContent = String(r.assists);
      const tdY = document.createElement('td'); tdY.textContent = String(r.yellows);
      const tdR = document.createElement('td'); tdR.textContent = String(r.reds);
      const tdMin = document.createElement('td'); tdMin.textContent = String(r.minutes);
      const tdPct = document.createElement('td'); tdPct.textContent = `${r.percent}%`;
      const tdConvocations = document.createElement('td'); tdConvocations.textContent = String(r.convocations);
      
      tr.appendChild(tdName);
      tr.appendChild(tdGoals);
      tr.appendChild(tdAst);
      tr.appendChild(tdY);
      tr.appendChild(tdR);
      tr.appendChild(tdMin);
      tr.appendChild(tdPct);
      tr.appendChild(tdConvocations);
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
    // Solo renderizar automáticamente si está autenticado
    if (isAuthenticated) {
      renderStats();
    }
  });
  
  // Botón de buscar (para usuarios no autenticados)
  const btnStatsSearch = document.getElementById('stats-search');
  if (btnStatsSearch) {
    btnStatsSearch.addEventListener('click', () => {
      renderStats();
    });
  }
  
  btnStatsClear.addEventListener('click', () => {
    inputStatsFrom.value = '';
    inputStatsTo.value = '';
    renderStats();
  });

  // ---- Exportar / Importar / Reset ----
  // Exportar/Importar eliminados según solicitud

  btnReset.addEventListener('click', async () => {
    // ⚠️ CONFIRMACIÓN CRÍTICA: Borrado total de la base de datos
    const ok = confirm(
      '🚨 ¡ATENCIÓN! Esto borrará ABSOLUTAMENTE TODO:\n\n' +
      '⚠️ Esta acción NO SE PUEDE DESHACER\n' +
      '⚠️ Los datos se perderán PERMANENTEMENTE\n\n' +
      '¿Estás 100% seguro de que quieres continuar?'
    );
    
    if (!ok) return;
    
    // Tercera confirmación: escribir "BORRAR" para confirmar
    const userInput = prompt(
      '🚨 CONFIRMACIÓN FINAL CRÍTICA:\n\n' +
      'Para confirmar que quieres ELIMINAR TODA LA BASE DE DATOS,\n' +
      'escribe exactamente la palabra: BORRAR\n\n' +
      'Esta es tu última oportunidad de cancelar.'
    );
    
    if (userInput !== 'BORRAR') {
      alert('❌ Operación cancelada. La base de datos está a salvo.');
      return;
    }
    
    try {
      // Cambiar texto del botón
      btnReset.textContent = '🗑️ Borrando todo...';
      btnReset.disabled = true;
      
      // 1. BORRAR DE FIREBASE (si está disponible)
      if (cloud.enabled && cloud.db && isAuthenticated) {
        // Borrar todas las colecciones
        const collections = [
          { name: 'players', description: 'Jugadores' },
          { name: 'sessions', description: 'Sesiones de entrenamiento' },
          { name: 'matchEntries', description: 'Entradas de partidos' },
          { name: 'convocations', description: 'Convocatorias' },
          { name: 'rivals', description: 'Rivales' },
          { name: 'matchResults', description: 'Resultados de partidos' }
        ];
        
        let totalDeleted = 0;
        
        for (const collection of collections) {
          try {
            const snapshot = await cloud.db.collection(collection.name).get();
            const batch = cloud.db.batch();
            
            snapshot.docs.forEach(doc => {
              batch.delete(doc.ref);
            });
            
            await batch.commit();
            totalDeleted += snapshot.docs.length;
          } catch (error) {
            console.error(`❌ Error borrando ${collection.description}:`, error);
          }
        }
      }
      
      // 2. BORRAR DEL LOCALSTORAGE
      const keysToRemove = [
        STORAGE_KEYS.players,
        STORAGE_KEYS.sessions,
        STORAGE_KEYS.matches,
        STORAGE_KEYS.convocations,
        STORAGE_KEYS.rivals,
        STORAGE_KEYS.matchResults,
        STORAGE_KEYS.lastSelectedDate
      ];
      
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
      });
      
      // 3. RESETEAR VARIABLES EN MEMORIA
      players = [];
      sessions = [];
      matches = [];
      convocations = [];
      rivals = [];
      matchResults = [];
      
      // 4. MOSTRAR MENSAJE DE ÉXITO DETALLADO
      const firebaseStatus = cloud.enabled && cloud.db && isAuthenticated ? '✅ Firebase (nube)' : '⚠️ Firebase (no disponible)';
      
      // 5. RECARGAR LA PÁGINA
      setTimeout(() => {
        window.location.reload();
      }, 2000);
      
    } catch (error) {
      console.error('❌ Error durante el borrado:', error);
      alert('❌ Error durante el borrado: ' + error.message);
      
      // Restaurar botón
      btnReset.textContent = 'Borrar todo';
      btnReset.disabled = false;
    }
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

    // Botón de limpieza del localStorage
    const btnClearLocalStorage = document.getElementById('clear-local-storage');
    if (btnClearLocalStorage) {
      btnClearLocalStorage.addEventListener('click', () => {
        if (confirm('⚠️ ¿Estás seguro de que quieres limpiar el localStorage?\n\nEsto eliminará todos los datos duplicados y forzará la recarga desde Firebase.\n\nLos datos de la nube NO se perderán.')) {
          try {
            btnClearLocalStorage.textContent = 'Limpiando...';
            btnClearLocalStorage.disabled = true;
            
            // Limpiar localStorage
            clearLocalStorageData();
            
            // Recargar página para aplicar cambios
            setTimeout(() => {
              window.location.reload();
            }, 1000);
            
          } catch (error) {
            alert('Error al limpiar: ' + error.message);
            btnClearLocalStorage.textContent = '🧹 Limpiar localStorage (Eliminar duplicados)';
            btnClearLocalStorage.disabled = false;
          }
        }
      });
    }
    btnOpenSettings.addEventListener('click', () => {
      // Mostrar estado actual de la configuración
      inputCfgMatchMinutes.value = String(config.matchMinutes);
      if (selectCfgTheme) selectCfgTheme.value = config.theme || 'dark';
      if (inputCfgBg) inputCfgBg.value = config.bg || '#0f1220';
      if (inputCfgPrimary) inputCfgPrimary.value = config.primary || '#6ee7b7';
      if (selectCfgCloudEnabled) selectCfgCloudEnabled.value = cloud.enabled ? '1' : '0';
      if (textareaCfgFirebase) {
        // Si hay configuración personalizada, mostrarla; si no, dejar vacío (usará la por defecto)
        const customConfig = localStorage.getItem(STORAGE_KEYS_CLOUD.firebaseConfig);
        textareaCfgFirebase.value = customConfig || '';
      }
      
      // Mostrar/ocultar mensaje de estado de la nube
      const cloudStatus = document.getElementById('cloud-status');
      if (cloudStatus) {
        cloudStatus.style.display = cloud.enabled ? 'block' : 'none';
      }
      
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
      const date = inputMatchDate ? inputMatchDate.value : '';
      const playerId = selectMatchPlayer ? selectMatchPlayer.value : '';
      
      if (!date) {
        alert('Por favor, selecciona una fecha para el partido.');
        return;
      }
      
      if (!playerId) {
        alert('Por favor, selecciona un jugador.');
        return;
      }
      
      // Verificar que el jugador esté convocado para esa fecha
      const convocation = findConvocationByDate(date);
      if (!convocation) {
        alert('No hay convocatoria registrada para esa fecha.');
        return;
      }
      
      if (convocation.players[playerId] !== 'C') {
        alert('Este jugador no está convocado para el partido de esa fecha.');
        return;
      }
      
      // Verificar si ya existen datos para este jugador en esta fecha
      const existingEntry = findMatchEntryByPlayerAndDate(playerId, date);
      if (existingEntry) {
        const confirmed = confirm(`Ya existen datos para ${getPlayerName(playerId)} en la fecha ${formatDateHuman(date)}. ¿Deseas sobrescribirlos?`);
        if (!confirmed) return;
        
        // Actualizar entrada existente
        existingEntry.goals = Math.max(0, parseInt(inputMatchGoals.value, 10) || 0);
        existingEntry.assists = Math.max(0, parseInt(inputMatchAssists.value, 10) || 0);
        existingEntry.yellows = Math.max(0, parseInt(inputMatchYellows.value, 10) || 0);
        existingEntry.reds = Math.max(0, parseInt(inputMatchReds.value, 10) || 0);
        existingEntry.minutes = Math.max(0, parseInt(inputMatchMinutes.value, 10) || 0);
        existingEntry.updatedAt = Date.now();
        
        // Actualizar en el array local
        const entryIndex = matches.findIndex(e => e.id === existingEntry.id);
        if (entryIndex !== -1) {
          matches[entryIndex] = existingEntry;
        }
        
        // Sincronizar con la nube si está habilitada
        if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
          cloud.db.collection('matchEntries').doc(existingEntry.id).set(existingEntry).catch((error) => {
            console.error('Error sincronizando entrada de partido actualizada a la nube:', error);
          });
        }
        
        renderMatchStats();
        renderRecentMatchEntries();
        
        // Limpiar formulario
        inputMatchGoals.value = '0';
        inputMatchAssists.value = '0';
        inputMatchYellows.value = '0';
        inputMatchReds.value = '0';
        inputMatchMinutes.value = '0';
        return;
      }
      
      const entry = {
        id: generateId('mentry'),
        date,
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
      
      // Limpiar a 0 manteniendo la fecha y el jugador seleccionado
      inputMatchGoals.value = '0';
      inputMatchAssists.value = '0';
      inputMatchYellows.value = '0';
      inputMatchReds.value = '0';
      inputMatchMinutes.value = '0';
    });
  }

  // Guardar convocatoria
  if (formConvocation) {
    formConvocation.addEventListener('submit', (e) => {
      e.preventDefault();
      const date = inputConvocationDate.value;
      
      if (!date) {
        alert('Por favor, selecciona una fecha para el partido.');
        return;
      }
      
      // Verificar si ya existe una convocatoria para esa fecha
      const existingConvocation = findConvocationByDate(date);
      if (existingConvocation) {
        const confirmed = confirm(`Ya existe una convocatoria para el ${formatDateHuman(date)}. ¿Deseas sobrescribirla?`);
        if (!confirmed) return;
      }
      
      const players = {};
      document.querySelectorAll('#convocation-list input[type="radio"]:checked').forEach(radio => {
        const playerId = radio.dataset.playerId;
        players[playerId] = radio.value;
      });

      // Contar jugadores convocados
      const convocadosCount = Object.values(players).filter(status => status === 'C').length;
      
      // Validar máximo 18 jugadores convocados
      if (convocadosCount > 18) {
        alert(`No se puede guardar la convocatoria. Máximo 18 jugadores convocados. Actualmente: ${convocadosCount}`);
        return;
      }
      
      // Validar que al menos haya 11 jugadores convocados
      if (convocadosCount < 11) {
        alert(`Debe convocar al menos 11 jugadores. Actualmente: ${convocadosCount}`);
        return;
      }

      const convocation = {
        id: existingConvocation ? existingConvocation.id : generateId('convocation'),
        date,
        players,
        createdAt: existingConvocation ? existingConvocation.createdAt : Date.now()
      };
      
      upsertConvocation(convocation);
      if (cloud.enabled && cloud.db && !isApplyingCloudSnapshot) {
        cloud.db.collection('convocations').doc(convocation.id).set(convocation).catch((error) => {
          console.error('Error sincronizando convocatoria a la nube:', error);
        });
      }
      
      renderMatchStats();
      renderRecentConvocations();
      
      // Cerrar la card después de guardar
      closeCard('convocation-content');
      
      // Limpiar el formulario
      inputConvocationDate.value = '';
    });
  }

  // Event listener para fecha de convocatoria
  if (inputConvocationDate) {
    inputConvocationDate.addEventListener('change', () => {
      renderConvocationList();
    });
  }

  // Event listener para fecha del partido
  if (inputMatchDate) {
    inputMatchDate.addEventListener('change', () => {
      renderMatchPlayerForm();
    });
  }

  // Event listener para cerrar modal de estadísticas del jugador
  document.addEventListener('click', (e) => {
    const playerStatsModal = document.getElementById('player-stats-modal');
    if (playerStatsModal && !playerStatsModal.hidden && e.target === playerStatsModal) {
      playerStatsModal.hidden = true;
    }
  });

  // Event listener para cerrar modal de resultados de rivales
  document.addEventListener('click', (e) => {
    const rivalResultModal = document.getElementById('rival-result-modal');
    if (rivalResultModal && !rivalResultModal.hidden && e.target === rivalResultModal) {
      rivalResultModal.hidden = true;
    }
  });

  // Funcionalidad de cards colapsibles
  function setupCollapsibleCards() {
    const cardHeaders = document.querySelectorAll('.card-header[data-target]');
    
    cardHeaders.forEach((header, index) => {
      // Añadir indicador visual de que es clickeable
      header.style.cursor = 'pointer';
      header.style.userSelect = 'none';
      
      // Configurar estado inicial (cerrado por defecto)
      const targetId = header.getAttribute('data-target');
      const content = document.getElementById(targetId);
      if (content) {
        content.style.display = 'none';
        header.classList.remove('expanded');
      }
      
      // Configurar event listener
      header.addEventListener('click', () => {
        const targetId = header.getAttribute('data-target');
        const content = document.getElementById(targetId);
        
        if (content) {
          const isExpanded = content.style.display !== 'none';
          
          // Cambiar estado
          content.style.display = isExpanded ? 'none' : 'block';
          header.classList.toggle('expanded', !isExpanded);
        } else {
          console.error(`❌ No se encontró el contenido para: ${targetId}`);
        }
      });
    });
  }

  // Event listeners para rivales
  const formAddRival = document.getElementById('form-add-rival');
  if (formAddRival) {
    formAddRival.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const name = document.getElementById('rival-name').value.trim();
      const field = document.getElementById('rival-field').value.trim();
      const shieldFile = document.getElementById('rival-shield').files[0];
      
      if (!name || !field) {
        alert('Por favor, completa al menos el nombre del equipo y el campo.');
        return;
      }
      
      // Convertir archivos a base64
      const processFile = (file) => {
        return new Promise((resolve) => {
          if (!file) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.readAsDataURL(file);
        });
      };
      
      Promise.all([
        processFile(shieldFile)
      ]).then(([shieldBase64]) => {
        const rival = {
          id: generateId('rival'),
          name,
          field,
          shield: shieldBase64,
          createdAt: Date.now()
        };
        
        addRival(rival);
        
        // Limpiar formulario
        formAddRival.reset();
        
        // Renderizar lista actualizada
        renderRivalsList();
      });
    });
  }

  // Event listener para el formulario de resultados
  const formRivalResult = document.getElementById('form-rival-result');
  if (formRivalResult) {
    formRivalResult.addEventListener('submit', (e) => {
      e.preventDefault();
      
      // Obtener el rival del modal
      const rivalName = document.getElementById('rival-name-display').textContent;
      const rival = rivals.find(r => r.name === rivalName);
      
      if (!rival) {
        alert('Error: No se pudo identificar el rival.');
        return;
      }
      
      // Obtener todos los bloques de jornada
      const journeyBlocks = document.querySelectorAll('.journey-block');
      let hasValidJourney = false;
      
      // Eliminar jornadas existentes para este rival
      matchResults = matchResults.filter(r => r.rivalId !== rival.id);
      
      // Procesar cada bloque de jornada
      const journeyResults = [];
      const usedJourneys = new Set(); // Para verificar duplicados dentro del formulario
      
      journeyBlocks.forEach((block, index) => {
        const journeyNum = index + 1;
        const journey = document.getElementById(`match-journey-${journeyNum}`).value;
        const location = document.querySelector(`input[name="match-location-${journeyNum}"]:checked`)?.value;
        const date = document.getElementById(`match-date-${journeyNum}`).value;
        const result = document.getElementById(`match-result-${journeyNum}`).value.trim();
        const comments = document.getElementById(`match-comments-${journeyNum}`).value.trim();
        
        // Validar que la jornada esté completa (solo jornada y local/visitante son obligatorios)
        if (journey && location) {
          hasValidJourney = true;
          
                  // Verificar duplicados dentro del formulario (solo para jornadas de liga)
        if (journey !== 'A' && usedJourneys.has(journey)) {
          alert(`Error: La jornada ${journey} está duplicada en el formulario. Solo puede haber un partido por jornada de liga.`);
          return;
        }
        if (journey !== 'A') {
          usedJourneys.add(journey);
        }
          
          // Verificar si ya existe esta jornada en cualquier equipo (solo para jornadas de liga)
          if (journey !== 'A') {
            const existingJourney = findExistingJourneyGlobally(journey, block);
            if (existingJourney) {
              const rivalName = rivals.find(r => r.id === existingJourney.rivalId)?.name || 'otro equipo';
              alert(`Error: Ya existe un partido para la jornada ${journey} contra ${rivalName}. Solo puede haber un partido por jornada de liga en toda la competición.`);
              return;
            }
          }
          
          const matchResult = {
            id: generateId('result'),
            rivalId: rival.id,
            journey: journey,
            location: location,
            date: date || null,
            result: result || null,
            comments: comments || null,
            createdAt: Date.now()
          };
          
          journeyResults.push(matchResult);
        }
      });
      
      // Si hay errores de validación, no continuar
      if (journeyResults.length === 0) return;
      
      // Añadir todos los resultados válidos
      journeyResults.forEach(matchResult => {
        addMatchResult(matchResult);
      });
      
      // Cerrar modal
      document.getElementById('rival-result-modal').hidden = true;
      
      // Renderizar listas actualizadas
      renderRivalsList();
      renderCalendar();
    });
  }

  // Event listener para cerrar modal de resultados
  const btnRivalResultClose = document.getElementById('rival-result-close');
  if (btnRivalResultClose) {
    btnRivalResultClose.addEventListener('click', () => {
      document.getElementById('rival-result-modal').hidden = true;
    });
  }

  // Event listener para eliminar rival
  const btnDeleteRival = document.getElementById('delete-rival-btn');
  if (btnDeleteRival) {
    btnDeleteRival.addEventListener('click', async () => {
      const rivalName = document.getElementById('rival-name-display').textContent;
      const rival = rivals.find(r => r.name === rivalName);
      
      if (!rival) {
        alert('Error: No se pudo identificar el rival.');
        return;
      }
      
      if (confirm(`¿Estás seguro de que quieres eliminar el equipo "${rival.name}"? Esta acción también eliminará todos los partidos asociados y no se puede deshacer.`)) {
        try {
          // Obtener todos los resultados asociados ANTES de eliminarlos
          const resultsToDelete = matchResults.filter(r => r.rivalId === rival.id);
          const totalResults = resultsToDelete.length;
          
          // Sincronizar eliminación con Firebase si está disponible
          if (cloud.enabled && cloud.db && isAuthenticated) {
            try {
              // Eliminar rival de Firebase
              await cloud.db.collection('rivals').doc(rival.id).delete();
              
              // Eliminar resultados asociados de Firebase
              for (const result of resultsToDelete) {
                await cloud.db.collection('matchResults').doc(result.id).delete();
              }
            } catch (error) {
              console.error('Error eliminando rival de Firebase:', error);
              alert(`Error al eliminar de la nube: ${error.message}. Los datos locales se han eliminado.`);
            }
          }
          
          // Eliminar rival de la lista local
          rivals = rivals.filter(r => r.id !== rival.id);
          
          // Eliminar todos los resultados asociados de la lista local
          matchResults = matchResults.filter(r => r.rivalId !== rival.id);
          
          // Guardar cambios en localStorage
          saveState();
          
          // Cerrar modal
          document.getElementById('rival-result-modal').hidden = true;
          
          // Renderizar listas actualizadas
          renderRivalsList();
          renderCalendar();
          
        } catch (error) {
          console.error('Error durante la eliminación del rival:', error);
          alert(`Error durante la eliminación: ${error.message}`);
        }
      }
    });
  }

  // Función para cargar jornadas existentes
  function loadExistingJourneys(rival) {
    const existingResults = matchResults.filter(r => r.rivalId === rival.id);
    
    // Limpiar todos los bloques de jornada existentes (excepto el primero)
    const journeyBlocks = document.querySelectorAll('.journey-block');
    for (let i = 1; i < journeyBlocks.length; i++) {
      journeyBlocks[i].remove();
    }
    
    if (existingResults.length === 0) return;
    
    // Crear bloques adicionales si hay más de 1 jornada (ya tenemos 1 por defecto)
    while (existingResults.length > document.querySelectorAll('.journey-block').length) {
      addNewJourneyBlock();
    }
    
    // Cargar datos en todos los bloques existentes
    existingResults.forEach((result, index) => {
      const journeyNum = index + 1;
      
      // Cargar jornada
      const journeySelect = document.getElementById(`match-journey-${journeyNum}`);
      if (journeySelect) journeySelect.value = result.journey;
      
      // Cargar local/visitante
      const locationLocal = document.getElementById(`location-local-${journeyNum}`);
      const locationVisitante = document.getElementById(`location-visitante-${journeyNum}`);
      if (locationLocal && locationVisitante) {
        if (result.location === 'local') {
          locationLocal.checked = true;
        } else if (result.location === 'visitante') {
          locationVisitante.checked = true;
        }
      }
      
      // Cargar fecha (si existe)
      const dateInput = document.getElementById(`match-date-${journeyNum}`);
      if (dateInput && result.date) dateInput.value = result.date;
      
      // Cargar resultado (si existe)
      const resultInput = document.getElementById(`match-result-${journeyNum}`);
      if (resultInput && result.result) resultInput.value = result.result;
      
      // Cargar comentarios (si existen)
      const commentsInput = document.getElementById(`match-comments-${journeyNum}`);
      if (commentsInput && result.comments) commentsInput.value = result.comments;
    });
    
    // Configurar botones de eliminar para todos los bloques existentes
    const allJourneyBlocks = document.querySelectorAll('.journey-block');
    allJourneyBlocks.forEach((block, index) => {
      const journeyNum = index + 1;
      setupDeletePartidoButton(journeyNum);
      setupJourneyValidation(block);
    });
  }

  // Función para mejorar la compatibilidad con iOS en radio buttons
  function enhanceIOSCompatibility() {
    // Detectar si es iOS
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    
    if (isIOS) {
      // Añadir estilos CSS específicos para iOS
      const style = document.createElement('style');
      style.textContent = `
        .radio-group input[type="radio"] {
          -webkit-appearance: none;
          appearance: none;
          width: 24px;
          height: 24px;
          border: 2px solid var(--border);
          border-radius: 50%;
          background: var(--panel);
          position: relative;
          cursor: pointer;
          transition: all 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }
        
        .radio-group input[type="radio"]:checked {
          background: var(--primary);
          border-color: var(--primary);
          transform: scale(1.1);
        }
        
        .radio-group input[type="radio"]:checked::after {
          content: '';
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          width: 10px;
          height: 10px;
          background: white;
          border-radius: 50%;
        }
        
        .radio-group input[type="radio"]:active {
          transform: scale(0.95);
        }
        
        .radio-group label {
          cursor: pointer;
          user-select: none;
          -webkit-user-select: none;
          padding: 8px 12px;
          border-radius: 6px;
          transition: background-color 0.2s ease;
          -webkit-tap-highlight-color: transparent;
        }
        
        .radio-group label:hover {
          background-color: var(--panel);
        }
        
        .radio-group label:active {
          background-color: var(--border);
        }
        
        /* Mejorar el área táctil en iOS */
        .radio-group .radio {
          padding: 4px;
          margin: 2px;
          border-radius: 8px;
          transition: background-color 0.2s ease;
        }
        
        .radio-group .radio:hover {
          background-color: var(--panel);
        }
      `;
      document.head.appendChild(style);
    }
  }

  // Lógica automática para Local/Visitante
  function setupLocationLogic() {
    // Obtener todos los bloques de jornada
    const journeyBlocks = document.querySelectorAll('.journey-block');
    
    journeyBlocks.forEach((block, index) => {
      const journeyNum = index + 1;
      const locationLocal = block.querySelector(`input[id="location-local-${journeyNum}"]`);
      const locationVisitante = block.querySelector(`input[id="location-visitante-${journeyNum}"]`);
      
      if (locationLocal && locationVisitante) {
        // Limpiar event listeners anteriores
        const newLocal = locationLocal.cloneNode(true);
        const newVisitante = locationVisitante.cloneNode(true);
        
        
        // Añadir nuevos event listeners (compatibles con iOS)
        newLocal.addEventListener('click', () => {
          // Forzar el estado checked inmediatamente para iOS
          newLocal.checked = true;
          
          // Desmarcar el otro radio button
          newVisitante.checked = false;
          
          // Lógica automática: marcar Visitante en la siguiente jornada
          
        });
        
        newVisitante.addEventListener('click', () => {
          // Forzar el estado checked inmediatamente para iOS
          newVisitante.checked = true;
          
          // Desmarcar el otro radio button
          newLocal.checked = false;
          
          // Lógica automática: marcar Local en la siguiente jornada
          
        });
        
        // Establecer valores por defecto si no están marcados
        if (!newLocal.checked && !newVisitante.checked) {
          if (journeyNum % 2 === 1) {
            newLocal.checked = true;
            newVisitante.checked = false;
          } else {
            newLocal.checked = false;
            newVisitante.checked = true;
          }
        }
      }
    });
  }

  // Función para cerrar modales
  function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.hidden = true;
    }
  }

  // Función para cerrar cards colapsibles
  function closeCard(cardContentId) {
    const content = document.getElementById(cardContentId);
    const header = document.querySelector(`[data-target="${cardContentId}"]`);
    if (content && header) {
      content.style.display = 'none';
      header.classList.remove('expanded');
    }
  }

  // ---- Rivales y Calendario ----
  let rivals = [];
  let matchResults = [];

  // Función para añadir rival
  async function addRival(rival) {
    // Añadir a la lista local
    rivals.push(rival);
    rivals.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
    saveState();
    
    // Sincronizar con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('rivals').doc(rival.id).set(rival);
      } catch (error) {
        console.error('Error sincronizando rival con Firebase:', error);
      }
    }
  }

  // Función para añadir resultado de partido
  async function addMatchResult(result) {
    // Añadir a la lista local
    matchResults.push(result);
    // IMPORTANTE: No ordenar por fecha para mantener el orden de jornadas preestablecido
    // Las jornadas se mantienen en el orden que el usuario marca en el formulario
    saveState();
    
    // Sincronizar con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('matchResults').doc(result.id).set(result);
      } catch (error) {
        console.error('Error sincronizando resultado con Firebase:', error);
      }
    }
  }

  // Función para eliminar resultado de partido
  async function deleteMatchResult(resultId) {
    // Eliminar de la lista local
    matchResults = matchResults.filter(r => r.id !== resultId);
    saveState();
    
    // Sincronización eliminación con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('matchResults').doc(resultId).delete();
      } catch (error) {
        console.error('Error eliminando resultado de Firebase:', error);
      }
    }
  }

  // Función para eliminar rival y todos sus partidos asociados
  async function deleteRivalAndMatches(rivalId) {
    try {
      const rival = rivals.find(r => r.id === rivalId);
      if (!rival) {
        throw new Error('Rival no encontrado');
      }
      
      // Obtener todos los partidos asociados
      const matchesToDelete = matchResults.filter(r => r.rivalId === rivalId);
      const totalMatches = matchesToDelete.length;
      
      // Eliminar de Firebase si está disponible
      if (cloud.enabled && cloud.db && isAuthenticated) {
        try {
          // Eliminar rival de Firebase
          await cloud.db.collection('rivals').doc(rivalId).delete();
          
          // Eliminar partidos asociados de Firebase
          for (const match of matchesToDelete) {
            await cloud.db.collection('matchResults').doc(match.id).delete();
          }
        } catch (error) {
          console.error('Error eliminando rival de Firebase:', error);
          throw new Error(`Error al eliminar de la nube: ${error.message}`);
        }
      }
      
      // Eliminar de las listas locales
      rivals = rivals.filter(r => r.id !== rivalId);
      matchResults = matchResults.filter(r => r.rivalId !== rivalId);
      
      // Guardar cambios
      saveState();
      
      return {
        success: true,
        rivalName: rival.name,
        totalMatches,
        message: totalMatches > 0 
          ? `Equipo "${rival.name}" eliminado junto con ${totalMatches} partido${totalMatches > 1 ? 's' : ''} asociado${totalMatches > 1 ? 's' : ''}.`
          : `Equipo "${rival.name}" eliminado correctamente.`
      };
      
    } catch (error) {
      console.error('Error eliminando rival:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Función para eliminar convocatoria
  async function deleteConvocation(convocationId) {
    // Eliminar de la lista local
    convocations = convocations.filter(c => c.id !== convocationId);
    saveState();
    
    // Sincronizar eliminación con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        await cloud.db.collection('convocations').doc(convocationId).delete();
      } catch (error) {
        console.error('Error eliminando convocatoria de Firebase:', error);
      }
    }
  }

  // Función para limpiar duplicados
  function cleanDuplicates() {
    // Limpiar duplicados de partidos
    const uniqueMatches = [];
    const seenMatches = new Set();
    
    matches.forEach(match => {
      const key = `${match.playerId}-${match.date}-${match.goals}-${match.assists}-${match.minutes}`;
      if (!seenMatches.has(key)) {
        seenMatches.add(key);
        uniqueMatches.push(match);
      }
    });
    
    if (uniqueMatches.length !== matches.length) {
      matches = uniqueMatches;
      console.log(`Duplicados de partidos limpiados: ${matches.length} → ${uniqueMatches.length}`);
    }
    
    // Limpiar duplicados de sesiones
    const uniqueSessions = [];
    const seenSessions = new Set();
    
    sessions.forEach(session => {
      if (!seenSessions.has(session.date)) {
        seenSessions.add(session.date);
        uniqueSessions.push(session);
      }
    });
    
    if (uniqueSessions.length !== sessions.length) {
      sessions = uniqueSessions;
      console.log(`Duplicados de sesiones limpiados: ${sessions.length} → ${uniqueSessions.length}`);
    }
    
    // Limpiar duplicados de rivales
    const uniqueRivals = [];
    const seenRivals = new Set();
    
    rivals.forEach(rival => {
      if (!seenRivals.has(rival.name)) {
        seenRivals.add(rival.name);
        uniqueRivals.push(rival);
      }
    });
    
    if (uniqueRivals.length !== rivals.length) {
      rivals = uniqueRivals;
      console.log(`Duplicados de rivales limpiados: ${rivals.length} → ${uniqueRivals.length}`);
    }
    
    // Limpiar duplicados de resultados
    const uniqueResults = [];
    const seenResults = new Set();
    
    matchResults.forEach(result => {
      const key = `${result.rivalId}-${result.journey}`;
      if (!seenResults.has(key)) {
        seenResults.add(key);
        uniqueResults.push(result);
      }
    });
    
    if (uniqueResults.length !== matchResults.length) {
      matchResults = uniqueResults;
      console.log(`Duplicados de resultados limpiados: ${matchResults.length} → ${uniqueResults.length}`);
    }
    
    // Guardar estado limpio
    saveState();
  }

  // Función para eliminar jugador
  async function deletePlayer(playerId) {
    // Eliminar de la lista local
    players = players.filter(p => p.id !== playerId);
    
    // Eliminar de todas las sesiones
    sessions.forEach(session => {
      if (session.attendance && session.attendance[playerId]) {
        delete session.attendance[playerId];
      }
    });
    
    // Eliminar de todas las convocatorias
    convocations.forEach(convocation => {
      if (convocation.players && convocation.players[playerId]) {
        delete convocation.players[playerId];
      }
    });
    
    // Eliminar de todos los partidos
    matches = matches.filter(m => m.playerId !== playerId);
    
    saveState();
    
    // Sincronizar eliminación con Firebase si está disponible
    if (cloud.enabled && cloud.db && isAuthenticated) {
      try {
        // Eliminar jugador
        await cloud.db.collection('players').doc(playerId).delete();
        
        // Actualizar sesiones
        for (const session of sessions) {
          await cloud.db.collection('sessions').doc(session.id).set(session);
        }
        
        // Actualizar convocatorias
        for (const convocation of convocations) {
          await cloud.db.collection('convocations').doc(convocation.id).set(convocation);
        }
        
        // Eliminar partidos del jugador
        const playerMatches = matches.filter(m => m.playerId === playerId);
        for (const match of playerMatches) {
          await cloud.db.collection('matchEntries').doc(match.id).delete();
        }
      } catch (error) {
        console.error('Error eliminando jugador de Firebase:', error);
      }
    }
  }

  // Función para renderizar lista de rivales
  function renderRivalsList() {
    const rivalsList = document.getElementById('rivals-list');
    const rivalsEmpty = document.getElementById('rivals-empty');
    
    if (!rivalsList || !rivalsEmpty) return;
    
    if (rivals.length === 0) {
      rivalsEmpty.style.display = '';
      rivalsList.innerHTML = '';
      return;
    }
    
    rivalsEmpty.style.display = 'none';
    rivalsList.innerHTML = '';
    
    rivals.forEach(rival => {
      const li = document.createElement('li');
      li.className = 'rival-item';
      li.onclick = () => {
        openRivalResultModal(rival);
      };
      
      const shield = document.createElement('img');
      shield.className = 'rival-shield';
      shield.src = rival.shield || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjMzQzNDM0Ii8+Cjx0ZXh0IHg9IjMwIiB5PSIzNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjEyIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U0hJRUxEPC90ZXh0Pgo8L3N2Zz4K';
      shield.alt = `Escudo de ${rival.name}`;
      
      const info = document.createElement('div');
      info.className = 'rival-info';
      
      const name = document.createElement('h3');
      name.className = 'rival-name';
      name.textContent = rival.name;
      
      const field = document.createElement('p');
      field.className = 'rival-field';
      field.textContent = rival.field;
      
      const journeys = document.createElement('div');
      journeys.className = 'rival-journeys';
      
      // Mostrar jornadas programadas
      const rivalResults = matchResults.filter(r => r.rivalId === rival.id);
      rivalResults.forEach(result => {
        const badge = document.createElement('span');
        badge.className = `journey-badge ${result.location}`;
        if (result.journey === 'A') {
          badge.textContent = `A`;
        } else {
          badge.textContent = `J${result.journey}`;
        }
        journeys.appendChild(badge);
      });
      
      info.appendChild(name);
      info.appendChild(field);
      info.appendChild(journeys);
      
      li.appendChild(shield);
      li.appendChild(info);
      rivalsList.appendChild(li);
    });
  }

  // Función para abrir modal de resultado
  function openRivalResultModal(rival) {
    
    const modal = document.getElementById('rival-result-modal');
    const shieldDisplay = document.getElementById('rival-shield-display');
    const nameDisplay = document.getElementById('rival-name-display');
    const fieldDisplay = document.getElementById('rival-field-display');
    
    
    if (!modal || !shieldDisplay || !nameDisplay || !fieldDisplay) {
      console.error('Faltan elementos del modal');
      return;
    }
    
    // Actualizar información del rival
    shieldDisplay.src = rival.shield || 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjYwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjMzQzNDM0Ii8+Cjx0ZXh0IHg9IjMwIiB5PSIzNSIgZm9udC1mYW1pbHk9IkFyaWFsIiBmb250LXNpemU9IjMwIiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSI+U0hJRUxEPC90ZXh0Pgo8L3N2Zz4K';
    nameDisplay.textContent = rival.name;
    fieldDisplay.textContent = rival.field;
    
    // Limpiar formulario
    document.getElementById('form-rival-result').reset();
    
    // Cargar jornadas existentes si las hay
    loadExistingJourneys(rival);
    
    // Configurar lógica automática de Local/Visitante
    setupLocationLogic();
    
    // Limpiar todos los event listeners de botones de eliminar existentes
    clearDeleteButtonsListeners();
    
    // Configurar botón para añadir partido
    setupAddMatchButton();
    
    // Configurar TODOS los botones de eliminar y validaciones existentes
    const allJourneyBlocks = document.querySelectorAll('.journey-block');

    
    allJourneyBlocks.forEach((block, index) => {
      const journeyNum = index + 1;
      
      setupDeletePartidoButton(journeyNum);
      setupJourneyValidation(block);
    });
    
    // Mostrar modal
    modal.hidden = false;
  }

  // Función para renderizar calendario
  function renderCalendar() {
    const calendarList = document.getElementById('calendar-list');
    const calendarEmpty = document.getElementById('calendar-empty');
    
    if (!calendarList || !calendarEmpty) return;
    
    if (matchResults.length === 0) {
      calendarEmpty.style.display = '';
      calendarList.innerHTML = '';
      return;
    }
    
    calendarEmpty.style.display = 'none';
    calendarList.innerHTML = '';
    
    // Agrupar resultados por rival y mantener orden de jornadas
    const rivalGroups = {};
    matchResults.forEach(result => {
      if (!rivalGroups[result.rivalId]) {
        rivalGroups[result.rivalId] = [];
      }
      rivalGroups[result.rivalId].push(result);
    });
    
    // Ordenar por rival y luego por jornada (manteniendo el orden preestablecido)
    Object.keys(rivalGroups).forEach(rivalId => {
      const rival = rivals.find(r => r.id === rivalId);
      if (!rival) return;
      
      // Ordenar por jornada (mantener orden preestablecido)
      rivalGroups[rivalId].sort((a, b) => a.journey - b.journey);
    });
    
    // Ahora ordenar todos los resultados por fecha (de más antigua a más reciente)
    const allResults = [];
    Object.keys(rivalGroups).forEach(rivalId => {
      rivalGroups[rivalId].forEach(result => {
        allResults.push(result);
      });
    });
    
    // Ordenar por fecha, poniendo los que no tienen fecha al final
    allResults.sort((a, b) => {
      if (!a.date && !b.date) return 0; // Ambos sin fecha, mantener orden
      if (!a.date) return 1; // A sin fecha, poner al final
      if (!b.date) return -1; // B sin fecha, poner al final
      return new Date(a.date) - new Date(b.date); // Ordenar por fecha (antigua primero)
    });
    
    allResults.forEach(result => {
      const rival = rivals.find(r => r.id === result.rivalId);
      if (!rival) return;
      
      const item = document.createElement('div');
      item.className = 'calendar-item';
      
      const date = document.createElement('div');
      date.className = 'calendar-date';
      
      if (result.date) {
        const resultDate = new Date(result.date);
        const day = document.createElement('div');
        day.className = 'day';
        day.textContent = resultDate.getDate();
        
        const month = document.createElement('div');
        month.className = 'month';
        month.textContent = resultDate.toLocaleDateString('es-ES', { month: 'short' });
        
        date.appendChild(day);
        date.appendChild(month);
      } else {
        // Si no hay fecha, mostrar solo la jornada
        const day = document.createElement('div');
        day.className = 'day';
        day.textContent = `J${result.journey}`;
        
        const month = document.createElement('div');
        month.className = 'month';
        month.textContent = 'Sin fecha';
        
        date.appendChild(day);
        date.appendChild(month);
      }
        
      const match = document.createElement('div');
      match.className = 'calendar-match';
      match.style.cursor = 'pointer';
      
      const rivalName = document.createElement('h3');
      rivalName.className = 'calendar-rival';
      rivalName.textContent = rival.name;
      
      const details = document.createElement('p');
      details.className = 'calendar-details';
      if (result.journey === 'A') {
        details.textContent = `Amistoso - ${result.location === 'local' ? 'Local' : 'Visitante'}`;
      } else {
        details.textContent = `Jornada ${result.journey} - ${result.location === 'local' ? 'Local' : 'Visitante'}`;
      }
      
      match.appendChild(rivalName);
      match.appendChild(details);
      
      const resultDisplay = document.createElement('div');
      resultDisplay.className = 'calendar-result';
      resultDisplay.textContent = result.result || 'SR';
      
      // Hacer el partido clickeable para abrir el modal del rival
      match.addEventListener('click', () => {
        openRivalFromCalendar(rival.id);
      });
      
      item.appendChild(date);
      item.appendChild(match);
      item.appendChild(resultDisplay);
      
      calendarList.appendChild(item);
    });
  }

  // Función para abrir el modal de un rival desde el calendario
  function openRivalFromCalendar(rivalId) {
    // Cambiar a la pestaña de rivales
    const rivalesTab = document.getElementById('tab-rivales');
    if (rivalesTab) {
      rivalesTab.click();
    }
    
    // Esperar un momento para que se renderice la lista de rivales
    setTimeout(() => {
      // Buscar el rival en la lista y abrir su modal
      const rival = rivals.find(r => r.id === rivalId);
      if (rival) {
        openRivalResultModal(rival);
      }
    }, 100);
  }

  // Función para configurar el botón de añadir partido
  function setupAddMatchButton() {
    const addMatchBtn = document.getElementById('add-match-btn');
    if (!addMatchBtn) return;
    
    // Limpiar event listeners anteriores
    const newAddMatchBtn = addMatchBtn.cloneNode(true);
    addMatchBtn.parentNode.replaceChild(newAddMatchBtn, addMatchBtn);
    
    newAddMatchBtn.addEventListener('click', () => {
      addNewJourneyBlock();
    });
  }

  // Función para verificar si ya existe una jornada en cualquier equipo
  function findExistingJourneyGlobally(journey, excludeJourneyBlock = null) {
    // Los partidos amistosos pueden repetirse, no hay restricción
    if (journey === 'A') {
      return null;
    }
    
    // Buscar si ya existe esta jornada en cualquier equipo
    const existingJourney = matchResults.find(r => r.journey === journey);
    
    if (existingJourney) {
      // Si estamos editando, verificar que no sea el mismo partido
      if (excludeJourneyBlock) {
        const journeyInput = excludeJourneyBlock.querySelector('select[id^="match-journey-"]');
        const locationInputs = excludeJourneyBlock.querySelectorAll('input[name^="match-location-"]');
        
        if (journeyInput && locationInputs.length > 0) {
          const currentJourney = journeyInput.value;
          const currentLocation = Array.from(locationInputs).find(input => input.checked)?.value;
          
          // Si es la misma jornada y ubicación, no es un conflicto
          if (currentJourney === journey && currentLocation === existingJourney.location) {
            return null;
          }
        }
      }
      
      return existingJourney;
    }
    
    return null;
  }

  // Función para limpiar todos los event listeners de botones de eliminar
  function clearDeleteButtonsListeners() {
    const deleteButtons = document.querySelectorAll('.delete-partido-btn');
    deleteButtons.forEach(btn => {
      // Limpiar flags de configuración
      delete btn.dataset.deleteConfigured;
    });
    
    // Limpiar flags de validación de jornadas
    const journeySelects = document.querySelectorAll('select[id^="match-journey-"]');
    journeySelects.forEach(select => {
      delete select.dataset.validationConfigured;
    });
  }

  // Función para configurar event listeners específicos de un nuevo bloque
  function setupNewBlockEventListeners(journeyBlock, journeyNumber) {
    const locationLocal = journeyBlock.querySelector(`input[id="location-local-${journeyNumber}"]`);
    const locationVisitante = journeyBlock.querySelector(`input[id="location-visitante-${journeyNumber}"]`);
    
    if (!locationLocal || !locationVisitante) {
      console.warn(`No se encontraron radio buttons para jornada ${journeyNumber}`);
      return;
    }
    
    console.log(`Configurando event listeners para jornada ${journeyNumber}`);
    
    // Event listener para Local
    locationLocal.addEventListener('click', () => {
      // Forzar el estado checked inmediatamente para iOS
      locationLocal.checked = true;
      
      // Desmarcar el otro radio button
      locationVisitante.checked = false;
      
    });
    
    // Event listener para Visitante
    locationVisitante.addEventListener('click', () => {
      // Forzar el estado checked inmediatamente para iOS
      locationVisitante.checked = true;
      
      // Desmarcar el otro radio button
      locationLocal.checked = false;
      
    });
    
  }

  // Función para configurar validación de jornadas duplicadas
  function setupJourneyValidation(journeyBlock) {
    const journeySelect = journeyBlock.querySelector('select[id^="match-journey-"]');
    if (!journeySelect) {
      console.warn('No se encontró select de jornada para configurar validación');
      return;
    }
    
    // Verificar si ya tiene event listener para evitar duplicados
    if (journeySelect.dataset.validationConfigured) {
      return;
    }
    
    journeySelect.addEventListener('change', () => {
      const selectedJourney = journeySelect.value;
      if (!selectedJourney) return;
      
      // Verificar duplicados en el formulario actual (solo para jornadas de liga)
      const allJourneyBlocks = document.querySelectorAll('.journey-block');
      let isDuplicateInForm = false;
      
      if (selectedJourney !== 'A') {
        // Solo verificar duplicados para jornadas de liga, no para amistosos
        allJourneyBlocks.forEach(block => {
          if (block !== journeyBlock) {
            const otherJourneySelect = block.querySelector('select[id^="match-journey-"]');
            if (otherJourneySelect && otherJourneySelect.value === selectedJourney) {
              isDuplicateInForm = true;
            }
          }
        });
      }
      
      // Verificar si ya existe esta jornada en cualquier equipo
      const existingJourney = findExistingJourneyGlobally(selectedJourney, journeyBlock);
      
      // Mostrar advertencia si es duplicado
      if (isDuplicateInForm || existingJourney) {
        // Mostrar mensaje de error
        let errorMsg = journeyBlock.querySelector('.journey-error');
        if (!errorMsg) {
          errorMsg = document.createElement('div');
          errorMsg.className = 'journey-error';
          errorMsg.style.color = '#ef4444';
          errorMsg.style.fontSize = '0.8em';
          errorMsg.style.marginTop = '4px';
          journeyBlock.appendChild(errorMsg);
        }
        
        if (isDuplicateInForm) {
          errorMsg.textContent = `⚠️ La jornada ${selectedJourney} ya está seleccionada en otro partido de este formulario`;
        } else {
          const rivalName = rivals.find(r => r.id === existingJourney.rivalId)?.name || 'otro equipo';
          errorMsg.textContent = `⚠️ La jornada ${selectedJourney} ya está programada contra ${rivalName}`;
        }
      } else {
        // Eliminar mensaje de error
        const errorMsg = journeyBlock.querySelector('.journey-error');
        if (errorMsg) {
          errorMsg.remove();
        }
      }
    });
    
    // Marcar como configurado para evitar duplicados
    journeySelect.dataset.validationConfigured = 'true';
  }

  // Función para configurar botón de eliminar partido
  function setupDeletePartidoButton(partidoNumber) {
    // Buscar específicamente en el modal del rival
    const modalContent = document.querySelector('#rival-result-modal .modal-content');
    if (!modalContent) {
      console.warn(`Modal no encontrado para configurar botón de eliminar partido ${partidoNumber}`);
      return;
    }
    
    const deleteBtn = modalContent.querySelector(`[data-partido="${partidoNumber}"]`);
    if (!deleteBtn) {
      console.warn(`No se encontró botón de eliminar para partido ${partidoNumber}`);
      return;
    }
    
    // Verificar si ya tiene event listener para evitar duplicados
    if (deleteBtn.dataset.deleteConfigured) {
      return;
    }
    
    // Añadir el event listener
    deleteBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deletePartido(partidoNumber);
    });
    
    // Marcar como configurado para evitar duplicados
    deleteBtn.dataset.deleteConfigured = 'true';
  }

  // Función para eliminar un partido específico
  function deletePartido(partidoNumber) {

    
    const modalContent = document.querySelector('#rival-result-modal .modal-content');
    if (!modalContent) {
      console.error('No se encontró el modal content');
      return;
    }
    
    const journeyBlocks = modalContent.querySelectorAll('.journey-block');

    
    // No permitir eliminar si solo queda un partido
    if (journeyBlocks.length <= 1) {
      alert('No se puede eliminar el último partido. Debe haber al menos uno.');
      return;
    }
    
    const deleteBtn = modalContent.querySelector(`[data-partido="${partidoNumber}"]`);
    if (!deleteBtn) {
      console.error(`No se encontró botón de eliminar para partido ${partidoNumber}`);
      return;
    }
    
    const partidoBlock = deleteBtn.closest('.journey-block');
    if (!partidoBlock) {
      console.error(`No se encontró bloque de jornada para partido ${partidoNumber}`);
      return;
    }
    
    // Confirmar eliminación
    if (confirm(`¿Estás seguro de que quieres eliminar el Partido ${partidoNumber}?`)) {
      partidoBlock.remove();
      
      // Renumerar los partidos restantes
      renumberPartidos();
      
      // Reconfigurar la lógica de Local/Visitante
      setupLocationLogic();
    }
  }

  // Función para renumerar los partidos después de eliminar uno
  function renumberPartidos() {
    const journeyBlocks = document.querySelectorAll('.journey-block');
    
    journeyBlocks.forEach((block, index) => {
      const newNumber = index + 1;
      const header = block.querySelector('.journey-header');
      const title = header.querySelector('h4');
      const deleteBtn = header.querySelector('.delete-partido-btn');
      
      // Actualizar título
      title.textContent = `Partido ${newNumber}`;
      
      // Actualizar botón de eliminar
      deleteBtn.setAttribute('data-partido', newNumber);
      deleteBtn.title = `Eliminar partido ${newNumber}`;
      
      // Actualizar IDs de los campos
      const journeySelect = block.querySelector('select[id^="match-journey-"]');
      const locationLocal = block.querySelector('input[id^="location-local-"]');
      const locationVisitante = block.querySelector('input[id^="location-visitante-"]');
      const dateInput = block.querySelector('input[id^="match-date-"]');
      const resultInput = block.querySelector('input[id^="match-result-"]');
      const commentsInput = block.querySelector('textarea[id^="match-comments-"]');
      
      if (journeySelect) journeySelect.id = `match-journey-${newNumber}`;
      if (locationLocal) {
        locationLocal.id = `location-local-${newNumber}`;
        locationLocal.name = `match-location-${newNumber}`;
      }
      if (locationVisitante) {
        locationVisitante.id = `location-visitante-${newNumber}`;
        locationVisitante.name = `match-location-${newNumber}`;
      }
      if (dateInput) dateInput.id = `match-date-${newNumber}`;
      if (resultInput) resultInput.id = `match-result-${newNumber}`;
      if (commentsInput) commentsInput.id = `match-comments-${newNumber}`;
    });
    
    // Reconfigurar todos los botones de eliminar después de la renumeración
    journeyBlocks.forEach((block, index) => {
      const newNumber = index + 1;
      const deleteBtn = block.querySelector('.delete-partido-btn');
      if (deleteBtn) {
        // Limpiar event listeners anteriores
        const newDeleteBtn = deleteBtn.cloneNode(true);
        if (deleteBtn.parentNode) {
          deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
        }
        
        // Configurar el nuevo botón
        setupDeletePartidoButton(newNumber);
      }
      
      // Reconfigurar event listeners de Local/Visitante
      setupNewBlockEventListeners(block, newNumber);
    });
    
    // Reconfigurar la lógica automática de Local/Visitante
    setupLocationLogic();
  }

  // Función para añadir nuevo bloque de jornada
  function addNewJourneyBlock() {
    const modalContent = document.querySelector('#rival-result-modal .modal-content');
    const existingJourneyBlocks = modalContent.querySelectorAll('.journey-block');
    const modalActions = modalContent.querySelector('.modal-actions');
    
    if (!modalContent || !modalActions) return;
    
    // Crear nuevo bloque de jornada
    const newJourneyBlock = document.createElement('div');
    newJourneyBlock.className = 'journey-block';
    
    const journeyNumber = existingJourneyBlocks.length + 1;
    newJourneyBlock.innerHTML = `
      <div class="journey-header">
        <h4>Partido ${journeyNumber}</h4>
        <button type="button" class="btn-icon delete-partido-btn" data-partido="${journeyNumber}" title="Eliminar partido">
          🗑️
        </button>
      </div>
      <div class="match-info">
        <label>
          <span>Jornada</span>
          <select id="match-journey-${journeyNumber}" required>
            <option value="">Seleccionar jornada</option>
            <option value="A">Amistoso</option>
            <option value="1">Jornada 1</option>
            <option value="2">Jornada 2</option>
            <option value="3">Jornada 3</option>
            <option value="4">Jornada 4</option>
            <option value="5">Jornada 5</option>
            <option value="6">Jornada 6</option>
            <option value="7">Jornada 7</option>
            <option value="8">Jornada 8</option>
            <option value="9">Jornada 9</option>
            <option value="10">Jornada 10</option>
            <option value="11">Jornada 11</option>
            <option value="12">Jornada 12</option>
            <option value="13">Jornada 13</option>
            <option value="14">Jornada 14</option>
            <option value="15">Jornada 15</option>
            <option value="16">Jornada 16</option>
            <option value="17">Jornada 17</option>
            <option value="18">Jornada 18</option>
            <option value="19">Jornada 19</option>
            <option value="20">Jornada 20</option>
            <option value="21">Jornada 21</option>
            <option value="22">Jornada 22</option>
            <option value="23">Jornada 23</option>
            <option value="24">Jornada 24</option>
            <option value="25">Jornada 25</option>
            <option value="26">Jornada 26</option>
            <option value="27">Jornada 27</option>
            <option value="28">Jornada 28</option>
            <option value="29">Jornada 29</option>
            <option value="30">Jornada 30</option>
          </select>
        </label>
        <label>
          <span>Local/Visitante</span>
          <div class="radio-group">
            <div class="radio">
              <input type="radio" id="location-local-${journeyNumber}" name="match-location-${journeyNumber}" value="local" required />
              <label for="location-local-${journeyNumber}">Local</label>
            </div>
            <div class="radio">
              <input type="radio" id="location-visitante-${journeyNumber}" name="match-location-${journeyNumber}" value="visitante" />
              <label for="location-visitante-${journeyNumber}">Visitante</label>
            </div>
          </div>
        </label>
      </div>
      
      <div class="result-info">
        <label>
          <span>Fecha del partido</span>
          <input id="match-date-${journeyNumber}" name="match-date-${journeyNumber}" type="date" />
        </label>
        <label>
          <span>Resultado</span>
          <input id="match-result-${journeyNumber}" name="match-result-${journeyNumber}" type="text" placeholder="Ej: 2-1, 0-0, 3-2" />
        </label>
      </div>
      
      <label>
        <span>Comentarios</span>
        <textarea id="match-comments-${journeyNumber}" name="match-comments-${journeyNumber}" rows="3" placeholder="Información sobre el partido, rival, etc."></textarea>
      </label>
    `;
    
    // Insertar antes de los botones de acción
    modalActions.parentNode.insertBefore(newJourneyBlock, modalActions);
    
    // Configurar la lógica automática de Local/Visitante para el nuevo bloque
    setupLocationLogic();
    
    // Configurar el botón de eliminar para el nuevo bloque
    setupDeletePartidoButton(journeyNumber);
    
    // Configurar validación de jornadas duplicadas en tiempo real
    setupJourneyValidation(newJourneyBlock);
    
    // Configurar event listeners específicos para este nuevo bloque
    setupNewBlockEventListeners(newJourneyBlock, journeyNumber);
  }

  // Función para buscar entrada de partido por jugador y fecha
  function findMatchEntryByPlayerAndDate(playerId, date) {
    return matches.find(entry => entry.playerId === playerId && entry.date === date);
  }

  // Función para obtener nombre del jugador por ID
  function getPlayerName(playerId) {
    const player = players.find(p => p.id === playerId);
    return player ? player.name : 'Jugador desconocido';
  }

  // Función para mostrar estadísticas detalladas del jugador
  function showPlayerDetailedStats(playerStats) {
    const modal = document.getElementById('player-stats-modal');
    const title = document.getElementById('player-stats-title');
    
    if (!modal || !title) return;
    
    // Actualizar título
    title.textContent = `Estadísticas de ${playerStats.player.name}`;
    
    // Calcular estadísticas detalladas
    const stats = calculateDetailedPlayerStats(playerStats);
    
    // Actualizar valores en el modal
    document.getElementById('goals-per-minute').textContent = stats.minutesPerGoal;
    document.getElementById('assists-per-minute').textContent = stats.minutesPerAssist;
    document.getElementById('goals-assists-per-minute').textContent = stats.minutesPerGoalAssist;
    document.getElementById('offensive-efficiency').textContent = stats.offensiveEfficiency;
    
    document.getElementById('convocation-percentage').textContent = stats.convocationPercentage;
    document.getElementById('matches-played').textContent = stats.matchesPlayed;
    document.getElementById('total-minutes').textContent = stats.totalMinutes;
    document.getElementById('avg-minutes-per-match').textContent = stats.avgMinutesPerMatch;
    
    document.getElementById('total-yellows').textContent = stats.totalYellows;
    document.getElementById('total-reds').textContent = stats.totalReds;
    document.getElementById('cards-per-minute').textContent = stats.minutesPerCard;
    
    document.getElementById('total-goals').textContent = stats.totalGoals;
    document.getElementById('total-assists').textContent = stats.totalAssists;
    document.getElementById('total-goals-assists').textContent = stats.totalGoalsAssists;
    
    // Mostrar modal
    modal.hidden = false;
  }

  // Función para calcular estadísticas detalladas del jugador
  function calculateDetailedPlayerStats(playerStats) {
    const player = playerStats.player;
    const totalMinutes = playerStats.minutes || 0;
    const totalGoals = playerStats.goals || 0;
    const totalAssists = playerStats.assists || 0;
    const totalYellows = playerStats.yellows || 0;
    const totalReds = playerStats.reds || 0;
    const playerConvocations = playerStats.convocations || 0;
    
    // Calcular total de convocatorias posibles (todas las convocatorias registradas en el sistema)
    const totalPossibleConvocations = convocations.length;
    
    // Estadísticas de minutos por acción (cuántos minutos necesita para marcar/ayudar/recibir tarjeta)
    const minutesPerGoal = totalGoals > 0 ? (totalMinutes / totalGoals).toFixed(1) : 'N/A';
    const minutesPerAssist = totalAssists > 0 ? (totalMinutes / totalAssists).toFixed(1) : 'N/A';
    const minutesPerGoalAssist = (totalGoals + totalAssists) > 0 ? (totalMinutes / (totalGoals + totalAssists)).toFixed(1) : 'N/A';
    
    // Eficiencia ofensiva (G+A por cada 80 minutos)
    const offensiveEfficiency = totalMinutes > 0 ? ((totalGoals + totalAssists) / totalMinutes * 80).toFixed(2) : '0.00';
    
    // Porcentaje de convocatorias (partidos convocado / total convocatorias * 100)
    const convocationPercentage = totalPossibleConvocations > 0 ? 
      Math.round((playerConvocations / totalPossibleConvocations) * 100) : 0;
    
    // Partidos jugados (convocaciones donde jugó)
    const matchesPlayed = playerConvocations;
    
    // Promedio de minutos por partido
    const avgMinutesPerMatch = matchesPlayed > 0 ? Math.round(totalMinutes / matchesPlayed) : 0;
    
    // Minutos por tarjeta (cuántos minutos puede jugar sin recibir tarjeta)
    const minutesPerCard = (totalYellows + totalReds) > 0 ? (totalMinutes / (totalYellows + totalReds)).toFixed(1) : 'N/A';
    
    // Total G+A
    const totalGoalsAssists = totalGoals + totalAssists;
    
    return {
      minutesPerGoal: minutesPerGoal,
      minutesPerAssist: minutesPerAssist,
      minutesPerGoalAssist: minutesPerGoalAssist,
      offensiveEfficiency: `${offensiveEfficiency} G+A/80min`,
      convocationPercentage: `${convocationPercentage}%`,
      matchesPlayed: matchesPlayed,
      totalMinutes: `${totalMinutes} min`,
      avgMinutesPerMatch: `${avgMinutesPerMatch} min`,
      totalYellows: totalYellows,
      totalReds: totalReds,
      minutesPerCard: minutesPerCard,
      totalGoals: totalGoals,
      totalAssists: totalAssists,
      totalGoalsAssists: totalGoalsAssists
    };
  }

  // No hay fecha ni filtros de partidos en este modo

  // ---- Limpieza del localStorage ----
  function clearLocalStorageData() {
    // Contador de elementos eliminados
    let deletedCount = 0;
    
    // Lista de todas las claves a eliminar
    const keysToRemove = [
      STORAGE_KEYS.players,
      STORAGE_KEYS.sessions,
      STORAGE_KEYS.matches,
      STORAGE_KEYS.convocations,
      STORAGE_KEYS.rivals,
      STORAGE_KEYS.matchResults,
      STORAGE_KEYS.lastSelectedDate
    ];
    
    // Eliminar cada clave
    keysToRemove.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        deletedCount++;
      }
    });
    
    // Limpiar también configuraciones antiguas que puedan causar conflictos
    const oldKeys = [
      'asistencia_config',
      'asistencia_players_old',
      'asistencia_sessions_old',
      'asistencia_matches_old'
    ];
    
    oldKeys.forEach(key => {
      if (localStorage.getItem(key)) {
        localStorage.removeItem(key);
        deletedCount++;
      }
    });
    
    // Resetear variables en memoria solo si está autenticado
    if (isAuthenticated) {
      players = [];
      sessions = [];
      matches = [];
      convocations = [];
      rivals = [];
      matchResults = [];
    }
    
  }

  // ---- Inicialización ----
  function renderAll() {
    // Solo renderizar elementos que no dependan de datos
    setupCollapsibleCards();
    applyThemeFromConfig();
    
    // Mostrar mensaje de carga mientras se cargan los datos desde Firebase
    const loadingMessage = `
      <div class="loading">
        <div style="margin-bottom: 10px;">🔄 Cargando datos desde Firebase...</div>
        <div style="font-size: 0.9em; color: #888;">
          Los datos se cargan directamente desde la nube cada vez
        </div>
      </div>
    `;
    
    if (document.getElementById('players-list')) {
      document.getElementById('players-list').innerHTML = loadingMessage;
    }
    
    // Renderizar estadísticas con datos de fallback
    if (document.getElementById('stats-table')) {
      renderStats();
    }
  }

  function init() {
    // 🚀 CARGAR DATOS DESDE FIREBASE - Con fallback a localStorage
    // Los datos se cargarán desde Firebase, pero si hay permisos denegados, se usarán datos locales
    console.log('Inicializando aplicación - intentando cargar datos desde Firebase');
    
    // Cargar datos del localStorage como fallback inicial
    loadState();
    console.log('Datos de fallback cargados del localStorage:', { 
      players: players.length, 
      sessions: sessions.length, 
      matches: matches.length 
    });
    
    // Cargar configuración (mantener tema, Firebase, etc.)
    loadConfig();
    loadCloudConfig();
    
    // No limpiar localStorage automáticamente - los datos se cargan desde Firebase
    
    // Limpiar duplicados existentes
    cleanDuplicates();
    
    // Mejorar compatibilidad con iOS
    enhanceIOSCompatibility();
    
    // Para nuevos usuarios, activar automáticamente la sincronización
    const isFirstTime = !localStorage.getItem(STORAGE_KEYS_CLOUD.cloudEnabled);
    if (isFirstTime) {
      cloud.enabled = true;
      localStorage.setItem(STORAGE_KEYS_CLOUD.cloudEnabled, '1');

    }
    
    // Fecha por defecto (usar fecha actual ya que limpiamos lastSelectedDate)
    inputSessionDate.value = todayISO();
    
    // Establecer fechas por defecto para estadísticas
    if (inputStatsFrom) {
      inputStatsFrom.value = '2025-09-01'; // 1 de septiembre de 2025
    }
    if (inputStatsTo) {
      inputStatsTo.value = todayISO(); // Fecha de hoy
    }
    
    renderAll();
    applyThemeFromConfig();
    setupAuthUI();
    applyAuthRestrictions();
    
    // Inicializar Firebase para cargar datos
    initFirebaseIfEnabled();
    
    console.log('Inicialización completada. Los datos se cargarán desde Firebase.');
  }



  document.addEventListener('DOMContentLoaded', init);
})();


