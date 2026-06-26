/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — db.js
   Shared IndexedDB connection. All modules use AppDB.onReady()
   instead of opening their own connections.
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

var AppDB = (function() {

  var DB_NAME    = 'KeysOfRevelation';
  var DB_VERSION = 2;
  var _db        = null;
  var _ready     = false;
  var _error     = null;
  var _callbacks = [];

  var STORES = {
    PACKS:    'packs',
    SESSIONS: 'sessions',
    BESTS:    'bests',
    LIFETIME: 'lifetime'
  };

  /* ── Queue callback or fire immediately if ready ──── */
  function onReady(callback) {
    if (_ready)  { callback(null, _db);   return; }
    if (_error)  { callback(_error, null); return; }
    _callbacks.push(callback);
  }

  function getDB() { return _db; }

  /* ── Single DB open -- all stores defined here ─────── */
  function init() {
    var request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = function(e) {
      var database = e.target.result;

      if (!database.objectStoreNames.contains('packs')) {
        database.createObjectStore('packs', { keyPath: 'id' });
      }

      if (!database.objectStoreNames.contains('sessions')) {
        var hs = database.createObjectStore('sessions', {
          keyPath: 'id', autoIncrement: true
        });
        hs.createIndex('date', 'date', { unique: false });
      }

      if (!database.objectStoreNames.contains('bests')) {
        database.createObjectStore('bests', { keyPath: 'key' });
      }

      if (!database.objectStoreNames.contains('lifetime')) {
        database.createObjectStore('lifetime', { keyPath: 'key' });
      }
    };

    request.onsuccess = function(e) {
      _db    = e.target.result;
      _ready = true;
      for (var i = 0; i < _callbacks.length; i++) {
        _callbacks[i](null, _db);
      }
      _callbacks = [];
    };

    request.onerror = function(e) {
      _error = 'DB error: ' + e.target.error.message;
      console.error(_error);
      for (var i = 0; i < _callbacks.length; i++) {
        _callbacks[i](_error, null);
      }
      _callbacks = [];
    };

    request.onblocked = function() {
      console.warn('DB upgrade blocked. Close other tabs running this app and refresh.');
    };
  }

  /* Auto-init on DOM ready */
  document.addEventListener('DOMContentLoaded', init);

  return {
    onReady: onReady,
    getDB:   getDB,
    STORES:  STORES
  };

})();
