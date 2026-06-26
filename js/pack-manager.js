/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — pack-manager.js
   Phase 2: Pack import, storage, and management.
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

var STORE_NAME = 'packs';
var db         = null;

window.activePack = null;

/* ── DB functions use shared AppDB connection ───────── */

function savePack(pack, callback) {
  var tx      = db.transaction(STORE_NAME, 'readwrite');
  var store   = tx.objectStore(STORE_NAME);
  var request = store.put(pack);
  request.onsuccess = function()    { callback(null); };
  request.onerror   = function(e)   { callback(e.target.error.message); };
}

function deletePack(id, callback) {
  var tx      = db.transaction(STORE_NAME, 'readwrite');
  var store   = tx.objectStore(STORE_NAME);
  var request = store.delete(id);
  request.onsuccess = function()    { callback(null); };
  request.onerror   = function(e)   { callback(e.target.error.message); };
}

/* Use cursor instead of getAll() for broader compatibility */
function getAllPacks(callback) {
  var tx      = db.transaction(STORE_NAME, 'readonly');
  var store   = tx.objectStore(STORE_NAME);
  var packs   = [];
  var request = store.openCursor();

  request.onsuccess = function(e) {
    var cursor = e.target.result;
    if (cursor) {
      packs.push(cursor.value);
      cursor.continue();
    } else {
      callback(null, packs);
    }
  };

  request.onerror = function(e) {
    callback(e.target.error.message, null);
  };
}

/* ── CSV Parser ─────────────────────────────────────── */

/* Handles both tab-separated and quoted comma-separated formats */
function parseCSVLine(line, sep) {
  if (sep === '\t') {
    return line.split('\t');
  }

  /* Quoted comma-separated: walk char by char */
  var cols     = [];
  var current  = '';
  var inQuotes = false;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      cols.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cols.push(current.trim());
  return cols;
}

function parseColorCSV(csvText) {
  var lines    = csvText.trim().split('\n');
  var colorMap = {};

  if (lines.length < 2) return colorMap;

  /* Detect separator: tab or comma */
  var sep = lines[0].indexOf('\t') !== -1 ? '\t' : ',';

  /* Skip header row */
  for (var i = 1; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;

    var cols = parseCSVLine(line, sep);
    var id   = cols[0] ? cols[0].trim() : null;
    var name = cols[1] ? cols[1].trim() : '';
    var hex  = cols[2] ? cols[2].trim() : null;

    if (id && hex && hex.charAt(0) === '#') {
      colorMap[id] = { hex: hex, name: name };
    }
  }

  return colorMap;
}

/* ── Import Error Display ───────────────────────────── */

function showImportError(msg) {
  var el = document.getElementById('pack-import-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

function clearImportError() {
  var el = document.getElementById('pack-import-error');
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

/* ── Zip Import ─────────────────────────────────────── */

function handleZipImport(file) {
  clearImportError();

  JSZip.loadAsync(file).then(function(zip) {

    /* Find pack.json anywhere in the zip */
    var packJsonFile = null;
    zip.forEach(function(path, entry) {
      if (!entry.dir && path.replace(/.*\//, '').toLowerCase() === 'pack.json') {
        packJsonFile = entry;
      }
    });

    if (!packJsonFile) {
      showImportError('Missing pack.json -- cannot read this pack.');
      return;
    }

    packJsonFile.async('string').then(function(jsonText) {
      var manifest;
      try {
        manifest = JSON.parse(jsonText);
      } catch(e) {
        showImportError('pack.json is not valid JSON.');
        return;
      }

      if (!manifest.name || !manifest.svg || !manifest.colors) {
        showImportError('pack.json is missing required fields: name, svg, colors.');
        return;
      }

      /* Find SVG and CSV by filename from manifest */
      var svgFile    = null;
      var colorsFile = null;

      zip.forEach(function(path, entry) {
        var filename = path.replace(/.*\//, '');
        if (filename === manifest.svg)    svgFile    = entry;
        if (filename === manifest.colors) colorsFile = entry;
      });

      if (!svgFile) {
        showImportError('SVG file not found in zip: ' + manifest.svg);
        return;
      }

      if (!colorsFile) {
        showImportError('Colors file not found in zip: ' + manifest.colors);
        return;
      }

      Promise.all([
        svgFile.async('string'),
        colorsFile.async('string')
      ]).then(function(results) {
        var svgText  = results[0];
        var csvText  = results[1];
        var colorMap = parseColorCSV(csvText);

        if (Object.keys(colorMap).length === 0) {
          showImportError('Could not parse any colors from ' + manifest.colors);
          return;
        }

        var pack = {
          id:          manifest.name,
          name:        manifest.name,
          description: manifest.description || '',
          svg:         svgText,
          colorMap:    colorMap,
          wordlist:    manifest.wordlist || 'default'
        };

        savePack(pack, function(err) {
          if (err) {
            showImportError('Storage error: ' + err);
            return;
          }
          document.getElementById('pack-file-input').value = '';
          renderPackList();
        });

      }).catch(function(e) {
        showImportError('Could not read pack files: ' + e.message);
      });

    }).catch(function(e) {
      showImportError('Could not read pack.json: ' + e.message);
    });

  }).catch(function(e) {
    showImportError('Could not open zip file: ' + e.message);
  });
}

/* ── Pack List Renderer ─────────────────────────────── */

function renderPackList() {
  if (!db) return;

  getAllPacks(function(err, packs) {
    var list = document.getElementById('pack-list');
    if (!list) return;

    if (err) {
      list.innerHTML = '<div class="pack-empty">Could not load packs: ' + err + '</div>';
      return;
    }

    if (!packs || packs.length === 0) {
      list.innerHTML = '<div class="pack-empty">No packs installed yet.</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < packs.length; i++) {
      var pack       = packs[i];
      var isActive   = window.activePack && window.activePack.id === pack.id;
      var colorCount = Object.keys(pack.colorMap).length;

      html += '<div class="pack-item' + (isActive ? ' pack-item--active' : '') + '">';
      html += '  <div class="pack-item__info">';
      html += '    <div class="pack-item__name">' + escapeHtml(pack.name);
      if (isActive) html += ' <span class="pack-active-badge">ACTIVE</span>';
      html += '    </div>';
      html += '    <div class="pack-item__meta">';
      if (pack.description) html += escapeHtml(pack.description) + ' &nbsp;&bull;&nbsp; ';
      html += colorCount + ' colors';
      html += '    </div>';
      html += '  </div>';
      html += '  <div class="pack-item__actions">';
      html += '    <button class="btn btn--primary btn--sm pack-select-btn" data-id="' + escapeAttr(pack.id) + '">SELECT</button>';
      html += '    <button class="btn btn--ghost btn--sm pack-delete-btn" data-id="' + escapeAttr(pack.id) + '">DELETE</button>';
      html += '  </div>';
      html += '</div>';
    }

    list.innerHTML = html;

    /* Wire SELECT buttons -- capture packs array in closure */
    (function(packsSnap) {
      var selectBtns = list.querySelectorAll('.pack-select-btn');
      for (var j = 0; j < selectBtns.length; j++) {
        (function(btn) {
          btn.addEventListener('click', function() {
            selectPackById(btn.getAttribute('data-id'), packsSnap);
          });
        })(selectBtns[j]);
      }

      var deleteBtns = list.querySelectorAll('.pack-delete-btn');
      for (var k = 0; k < deleteBtns.length; k++) {
        (function(btn) {
          btn.addEventListener('click', function() {
            deletePackById(btn.getAttribute('data-id'));
          });
        })(deleteBtns[k]);
      }
    })(packs);
  });
}

/* ── Select ─────────────────────────────────────────── */

function selectPackById(id, packs) {
  var pack = null;
  for (var i = 0; i < packs.length; i++) {
    if (packs[i].id === id) { pack = packs[i]; break; }
  }
  if (!pack) return;

  if (window.activePack && window.activePack.id !== id) {
    if (!confirm('"' + pack.name + '" will replace the active pack "' + window.activePack.name + '". Continue?')) {
      return;
    }
  }

  window.activePack = pack;
  renderPackList();
  showScreen('screen-modes');
}

/* ── Delete ─────────────────────────────────────────── */

function deletePackById(id) {
  if (!confirm('Delete this pack? This cannot be undone.')) return;

  deletePack(id, function(err) {
    if (err) {
      showImportError('Could not delete pack: ' + err);
      return;
    }
    if (window.activePack && window.activePack.id === id) {
      window.activePack = null;
    }
    renderPackList();
  });
}

/* ── Helpers ────────────────────────────────────────── */

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

/* ── Init ───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {
  AppDB.onReady(function(err, database) {
    if (err) {
      console.error('IndexedDB error:', err);
      return;
    }
    db = database;
    renderPackList();
  });

  var fileInput = document.getElementById('pack-file-input');
  if (fileInput) {
    fileInput.addEventListener('change', function() {
      if (fileInput.files && fileInput.files[0]) {
        handleZipImport(fileInput.files[0]);
      }
    });
  }

  /* Re-render list whenever packs screen becomes active */
  window._screenHandlers.push(function(id) {
    if (id === 'screen-packs') renderPackList();
  });
});
