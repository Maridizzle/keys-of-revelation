/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — svg-engine.js
   Phase 3: SVG rendering, zone management, fill mechanic.
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

var SVGEngine = (function() {

  /* ── State ────────────────────────────────────────── */
  var _svgEl       = null;   /* injected SVG DOM element */
  var _colorMap    = {};     /* colorID → { hex, name } */
  var _fillQueue   = [];     /* ordered array of colorIDs to fill */
  var _filledCount = 0;      /* how many zones have been filled */
  var _canvasEl    = null;   /* the #svg-canvas container */
  var _elementCache = {};    /* colorID → [path elements] prebuilt at load time */

  /* ── Constants ────────────────────────────────────── */
  var UNFILLED_COLOR = '#d0d0d0';
  var TOAST_DURATION = 1600; /* ms */

  /* ── Load Pack ────────────────────────────────────── */
  function loadPack(pack, canvasEl) {
    _canvasEl     = canvasEl;
    _colorMap     = pack.colorMap;
    _fillQueue    = [];
    _filledCount  = 0;
    _elementCache = {};

    /* Clear canvas */
    canvasEl.innerHTML = '';

    /* Parse SVG string into DOM */
    var parser = new DOMParser();
    var doc    = parser.parseFromString(pack.svg, 'image/svg+xml');
    _svgEl     = doc.querySelector('svg');

    if (!_svgEl) {
      canvasEl.innerHTML = '<div class="canvas-empty"><p>Could not parse SVG.</p></div>';
      return false;
    }

    /* Fix viewBox before stripping dimensions so SVG scales correctly */
    var w = _svgEl.getAttribute('width')  || '2304';
    var h = _svgEl.getAttribute('height') || '2304';

    /* Only set viewBox if one does not already exist */
    if (!_svgEl.getAttribute('viewBox')) {
      /* Strip any units (px, pt etc) and use raw numbers */
      var vw = parseFloat(w) || 2304;
      var vh = parseFloat(h) || 2304;
      _svgEl.setAttribute('viewBox', '0 0 ' + vw + ' ' + vh);
    }

    /* Now safe to set responsive dimensions */
    _svgEl.removeAttribute('width');
    _svgEl.removeAttribute('height');
    _svgEl.setAttribute('width',  '100%');
    _svgEl.setAttribute('height', '100%');
    _svgEl.style.display = 'block';

    /* Collect all unique colorIDs in order */
    var seen    = {};
    var ordered = [];
    var allPaths = _svgEl.querySelectorAll('[metadata-colorID]');

    for (var i = 0; i < allPaths.length; i++) {
      var cid = allPaths[i].getAttribute('metadata-colorID');
      if (cid && !seen[cid]) {
        seen[cid] = true;
        ordered.push(cid);
      }
    }

    /* Sort numerically */
    ordered.sort(function(a, b) { return parseInt(a, 10) - parseInt(b, 10); });
    _fillQueue = ordered;

    /* Set all path fills to grey and build element cache in one pass */
    var paths = _svgEl.querySelectorAll('path');
    for (var j = 0; j < paths.length; j++) {
      var p   = paths[j];
      p.style.fill       = UNFILLED_COLOR;
      p.style.transition = 'none';
      var cid = p.getAttribute('metadata-colorID');
      if (cid) {
        if (!_elementCache[cid]) _elementCache[cid] = [];
        _elementCache[cid].push(p);
      }
    }

    /* Inject SVG into canvas */
    canvasEl.appendChild(_svgEl);

    /* Inject toast element */
    var toast = document.createElement('div');
    toast.id = 'color-toast';
    toast.className = 'color-toast';
    canvasEl.appendChild(toast);

    return true;
  }

  /* ── Fill Next Zone ───────────────────────────────── */
  function fillNextZone() {
    if (_filledCount >= _fillQueue.length) return null;

    var colorID  = _fillQueue[_filledCount];
    var colorDef = _colorMap[colorID];
    var hex      = colorDef ? colorDef.hex  : '#888888';
    var name     = colorDef ? colorDef.name : 'Color ' + colorID;

    /* Look up pre-cached paths for this colorID */
    var targets = _elementCache[colorID] || [];

    /* Pass 1: set fill and clear animation on all targets (no reflow yet) */
    for (var i = 0; i < targets.length; i++) {
      targets[i].style.fill      = hex;
      targets[i].style.animation = 'none';
    }

    /* One forced reflow flushes the 'none' state for all elements at once */
    if (targets.length > 0) void targets[0].offsetWidth;

    /* Pass 2: start animation on all targets */
    for (var k = 0; k < targets.length; k++) {
      targets[k].style.animation = 'colorFlicker 350ms ease forwards';
    }

    _filledCount++;

    /* Show toast */
    showToast(name, hex);

    return {
      colorID:      colorID,
      colorName:    name,
      hex:          hex,
      filled:       _filledCount,
      total:        _fillQueue.length,
      complete:     _filledCount >= _fillQueue.length
    };
  }

  /* ── Toast ────────────────────────────────────────── */
  function showToast(name, hex) {
    var toast = document.getElementById('color-toast');
    if (!toast) return;

    toast.textContent  = name;
    toast.style.color  = hex;
    toast.style.textShadow = '0 0 10px ' + hex;
    toast.classList.remove('color-toast--visible');

    /* Force reflow */
    void toast.offsetWidth;
    toast.classList.add('color-toast--visible');

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function() {
      toast.classList.remove('color-toast--visible');
    }, TOAST_DURATION);
  }

  /* ── Progress Helpers ─────────────────────────────── */
  function getTotalZones()  { return _fillQueue.length; }
  function getFilledZones() { return _filledCount; }
  function isComplete()     { return _filledCount >= _fillQueue.length; }
  function isLoaded()       { return _svgEl !== null; }

  function getCompletedSVG() {
    if (!_svgEl) return null;
    return _svgEl.cloneNode(true);
  }

  /* ── Public API ───────────────────────────────────── */
  return {
    loadPack:         loadPack,
    fillNextZone:     fillNextZone,
    getTotalZones:    getTotalZones,
    getFilledZones:   getFilledZones,
    isComplete:       isComplete,
    isLoaded:         isLoaded,
    getCompletedSVG:  getCompletedSVG
  };

})();
