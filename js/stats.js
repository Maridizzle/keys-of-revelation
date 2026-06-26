/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — stats.js
   Phase 5: Session history, personal bests, lifetime totals.
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

var Stats = (function() {

  var HISTORY_STORE  = 'sessions';
  var BESTS_STORE    = 'bests';
  var LIFETIME_STORE = 'lifetime';
  var MAX_HISTORY    = 20;

  var db = null;

  /* ── Save Session ─────────────────────────────────── */
  function saveSession(report, callback) {
    if (!db) { if (callback) callback('DB not ready'); return; }

    /* 1. Save session record */
    var tx      = db.transaction(HISTORY_STORE, 'readwrite');
    var store   = tx.objectStore(HISTORY_STORE);
    var request = store.add(report);

    request.onsuccess = function() {
      pruneHistory(function() {
        updateBests(report, function() {
          updateLifetime(report, function() {
            if (callback) callback(null);
          });
        });
      });
    };

    request.onerror = function(e) {
      if (callback) callback(e.target.error.message);
    };
  }

  /* ── Prune to MAX_HISTORY ─────────────────────────── */
  function pruneHistory(callback) {
    var tx      = db.transaction(HISTORY_STORE, 'readwrite');
    var store   = tx.objectStore(HISTORY_STORE);
    var records = [];
    var cursor  = store.openCursor();

    cursor.onsuccess = function(e) {
      var c = e.target.result;
      if (c) { records.push({ id: c.value.id }); c.continue(); }
      else {
        if (records.length > MAX_HISTORY) {
          var toDelete = records.length - MAX_HISTORY;
          var tx2 = db.transaction(HISTORY_STORE, 'readwrite');
          var s2  = tx2.objectStore(HISTORY_STORE);
          for (var i = 0; i < toDelete; i++) {
            s2.delete(records[i].id);
          }
          tx2.oncomplete = function() { if (callback) callback(); };
          tx2.onerror    = function() { if (callback) callback(); };
        } else {
          if (callback) callback();
        }
      }
    };

    cursor.onerror = function() { if (callback) callback(); };
  }

  /* ── Update Personal Bests ────────────────────────── */
  function updateBests(report, callback) {
    getBests(function(err, current) {
      var bests = current || {
        key:        'bests',
        wpm:        0,
        accuracy:   0,
        streak:     0
      };

      var changed = false;

      if (report.wpm > bests.wpm) {
        bests.wpm = report.wpm;
        changed = true;
      }
      if (report.accuracy > bests.accuracy) {
        bests.accuracy = report.accuracy;
        changed = true;
      }
      if (report.bestStreak > bests.streak) {
        bests.streak = report.bestStreak;
        changed = true;
      }

      if (!changed) { if (callback) callback(); return; }

      var tx      = db.transaction(BESTS_STORE, 'readwrite');
      var store   = tx.objectStore(BESTS_STORE);
      var request = store.put(bests);
      request.onsuccess = function() { if (callback) callback(); };
      request.onerror   = function() { if (callback) callback(); };
    });
  }

  /* ── Update Lifetime Totals ───────────────────────── */
  function updateLifetime(report, callback) {
    getLifetime(function(err, current) {
      var totals = current || {
        key:          'totals',
        totalWords:   0,
        totalColors:  0,
        totalSessions: 0,
        totalErrors:  0
      };

      totals.totalWords    += report.correctWords || 0;
      totals.totalColors   += report.colorsFilled || 0;
      totals.totalSessions += 1;
      totals.totalErrors   += report.errors || 0;

      var tx      = db.transaction(LIFETIME_STORE, 'readwrite');
      var store   = tx.objectStore(LIFETIME_STORE);
      var request = store.put(totals);
      request.onsuccess = function() { if (callback) callback(); };
      request.onerror   = function() { if (callback) callback(); };
    });
  }

  /* ── Get History ──────────────────────────────────── */
  function getHistory(callback) {
    if (!db) { callback('DB not ready', null); return; }

    var tx      = db.transaction(HISTORY_STORE, 'readonly');
    var store   = tx.objectStore(HISTORY_STORE);
    var records = [];
    var request = store.openCursor(null, 'prev'); /* newest first */

    request.onsuccess = function(e) {
      var cursor = e.target.result;
      if (cursor && records.length < MAX_HISTORY) {
        records.push(cursor.value);
        cursor.continue();
      } else {
        callback(null, records);
      }
    };

    request.onerror = function(e) {
      callback(e.target.error.message, null);
    };
  }

  /* ── Get Personal Bests ───────────────────────────── */
  function getBests(callback) {
    if (!db) { callback('DB not ready', null); return; }

    var tx      = db.transaction(BESTS_STORE, 'readonly');
    var store   = tx.objectStore(BESTS_STORE);
    var request = store.get('bests');

    request.onsuccess = function(e) {
      callback(null, e.target.result || null);
    };
    request.onerror = function(e) {
      callback(e.target.error.message, null);
    };
  }

  /* ── Get Lifetime Totals ──────────────────────────── */
  function getLifetime(callback) {
    if (!db) { callback('DB not ready', null); return; }

    var tx      = db.transaction(LIFETIME_STORE, 'readonly');
    var store   = tx.objectStore(LIFETIME_STORE);
    var request = store.get('totals');

    request.onsuccess = function(e) {
      callback(null, e.target.result || null);
    };
    request.onerror = function(e) {
      callback(e.target.error.message, null);
    };
  }

  /* ── Format Elapsed Time ──────────────────────────── */
  function formatTime(ms) {
    if (!ms || ms <= 0) return '0:00';
    var totalSec = Math.floor(ms / 1000);
    var min = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    return min + ':' + (sec < 10 ? '0' : '') + sec;
  }

  /* ── Render History Screen ────────────────────────── */
  function renderHistoryScreen() {
    var container = document.getElementById('history-content');
    if (!container) return;

    container.innerHTML = '<div class="history-loading">Loading...</div>';

    getHistory(function(err, sessions) {
      if (err || !sessions || sessions.length === 0) {
        container.innerHTML = '<div class="history-empty">No sessions recorded yet. Play a game first.</div>';
        return;
      }

      var html = '';
      html += '<div class="history-table">';
      html += '<div class="history-header-row">';
      html += '  <span>DATE</span>';
      html += '  <span>PACK</span>';
      html += '  <span>LIST</span>';
      html += '  <span>WPM</span>';
      html += '  <span>ACC</span>';
      html += '  <span>STREAK</span>';
      html += '  <span>COLORS</span>';
      html += '  <span>TIME</span>';
      html += '</div>';

      for (var i = 0; i < sessions.length; i++) {
        var s = sessions[i];
        html += '<div class="history-row">';
        html += '  <span class="history-date">'   + escapeHtml(s.date || '--')                                           + '</span>';
        html += '  <span class="history-pack">'   + escapeHtml(s.pack || '--')                                           + '</span>';
        html += '  <span class="history-list">'   + escapeHtml((s.wordList || '--').toUpperCase())                       + '</span>';
        html += '  <span class="history-stat">'   + (s.wpm        || 0)                                                  + '</span>';
        html += '  <span class="history-stat">'   + (s.accuracy   || 0) + '%'                                            + '</span>';
        html += '  <span class="history-stat">'   + (s.bestStreak || 0)                                                  + '</span>';
        html += '  <span class="history-stat">'   + (s.colorsFilled || 0) + ' / ' + (s.totalColors || 0)                + '</span>';
        html += '  <span class="history-time">'   + formatTime(s.elapsedMs)                                              + '</span>';
        html += '</div>';
      }

      html += '</div>';
      container.innerHTML = html;
    });
  }

  /* ── Escape helper ────────────────────────────────── */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  /* ── Init ───────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function() {
    AppDB.onReady(function(err, database) {
      if (err) { console.error(err); return; }
      db = database;

      /* Re-render history when screen becomes active */
      window._screenHandlers.push(function(id) {
        if (id === 'screen-history') renderHistoryScreen();
      });
    });
  });

  /* ── Public API ───────────────────────────────────── */
  return {
    saveSession:    saveSession,
    getHistory:     getHistory,
    getBests:       getBests,
    getLifetime:    getLifetime,
    formatTime:     formatTime,
    renderHistory:  renderHistoryScreen
  };

})();
