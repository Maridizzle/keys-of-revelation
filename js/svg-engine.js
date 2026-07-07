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
  var _zones       = {};     /* colorID → [{ el, p2d, fillRule }] built at load */
  var _zoneCanvas  = null;   /* raster layer under the SVG holding all color */
  var _zoneCtx     = null;
  var _committed   = [];     /* [{ colorID, hex }] fills applied so far */
  var _svgCommitted = false; /* fills written back into the SVG element */
  var _resizeHandler = null;

  /* ── Constants ────────────────────────────────────── */
  var UNFILLED_COLOR = '#d0d0d0';
  var TOAST_DURATION = 1600; /* ms */

  /* ── Load Pack ────────────────────────────────────── */
  function loadPack(pack, canvasEl) {
    if (_resizeHandler) {
      window.removeEventListener('resize', _resizeHandler);
      _resizeHandler = null;
    }

    _canvasEl     = canvasEl;
    _colorMap     = pack.colorMap;
    _fillQueue    = [];
    _filledCount  = 0;
    _zones        = {};
    _committed    = [];
    _svgCommitted = false;

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

    /* One pass over all paths:
       - zone paths (have a colorID) become transparent in the SVG; their
         color lives on the raster canvas underneath, so revealing a zone
         never repaints the (potentially huge) vector scene
       - other paths get the grey wash as before */
    var paths = _svgEl.querySelectorAll('path');
    for (var j = 0; j < paths.length; j++) {
      var p   = paths[j];
      p.style.transition = 'none';
      var cid = p.getAttribute('metadata-colorID');
      if (cid) {
        p.style.fill = 'none';
        if (!_zones[cid]) _zones[cid] = [];
        var entry = { el: p, p2d: null, fillRule: 'nonzero' };
        try {
          entry.p2d = new Path2D(p.getAttribute('d') || '');
          if (p.getAttribute('fill-rule') === 'evenodd') entry.fillRule = 'evenodd';
        } catch (e) { entry.p2d = null; }
        _zones[cid].push(entry);
      } else {
        /* Grey-wash only painted shapes (hides the source image's own
           colors); a path with fill="none" is line art and must stay
           transparent or it would occlude the color layer beneath.
           No fill attribute at all means SVG's default black = painted. */
        var attrFill  = p.getAttribute('fill');
        var styleFill = p.style.fill;
        var isLineArt = (attrFill === 'none' && !styleFill) || styleFill === 'none';
        if (!isLineArt) p.style.fill = UNFILLED_COLOR;
      }
    }

    /* Raster color layer under the SVG */
    _zoneCanvas = document.createElement('canvas');
    _zoneCanvas.className = 'zone-canvas';
    _zoneCtx = _zoneCanvas.getContext('2d');
    canvasEl.appendChild(_zoneCanvas);

    /* Inject SVG into canvas */
    canvasEl.appendChild(_svgEl);

    /* Size the raster layer and paint the grey underlay once the SVG is
       live (getScreenCTM needs a rendered element) */
    redrawZoneCanvas();
    _resizeHandler = redrawZoneCanvas;
    window.addEventListener('resize', _resizeHandler);

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

    var entries = _zones[colorID] || [];

    /* Paint the zone onto the raster layer. Canvas is immediate-mode:
       cost is a handful of Path2D fills no matter how large the pack
       is, and the vector scene above is never invalidated -- so the
       next word is typeable immediately. */
    _committed.push({ colorID: colorID, hex: hex });
    paintZones(entries, hex);

    /* Flicker effect: a grey copy of the zone sits on top and blinks
       away. Animating opacity on many SVG paths forces the browser to
       repaint the entire image every animation frame; animating one
       overlay element instead runs on the compositor for free. */
    spawnRevealOverlay(entries);

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

  /* ── Zone Canvas Painting ─────────────────────────── */
  function paintZones(entries, color) {
    if (!_zoneCtx || !_zoneCanvas) return;
    var rect = _zoneCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    var dpr = window.devicePixelRatio || 1;

    _zoneCtx.fillStyle = color;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.p2d) continue;
      /* getScreenCTM maps the path's user units to client pixels,
         including viewBox scaling and any ancestor transforms */
      var m = entry.el.getScreenCTM();
      if (!m) continue;
      _zoneCtx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr,
                            (m.e - rect.left) * dpr, (m.f - rect.top) * dpr);
      _zoneCtx.fill(entry.p2d, entry.fillRule);
    }
    _zoneCtx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* Resize canvas to its box, repaint grey underlay + all committed fills */
  function redrawZoneCanvas() {
    if (!_zoneCanvas) return;
    var rect = _zoneCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    var dpr = window.devicePixelRatio || 1;
    _zoneCanvas.width  = Math.round(rect.width * dpr);
    _zoneCanvas.height = Math.round(rect.height * dpr);

    var all = [];
    for (var cid in _zones) {
      if (_zones.hasOwnProperty(cid)) all = all.concat(_zones[cid]);
    }
    paintZones(all, UNFILLED_COLOR);

    for (var i = 0; i < _committed.length; i++) {
      paintZones(_zones[_committed[i].colorID] || [], _committed[i].hex);
    }
  }

  /* Write committed fills back into the SVG element itself. Runs once,
     at a non-typing moment (complete screen / export), so the big
     vector repaint never lands on a keystroke. Forcing opacity to 1
     overrides any partial opacity baked into the source file, which
     otherwise muddies the colors against the dark background. */
  function commitFillsToSVG() {
    if (_svgCommitted) return;
    _svgCommitted = true;
    /* Unfilled zones become solid grey, matching how they look over the
       play canvas (matters when quitting before the image is complete) */
    for (var cid in _zones) {
      if (!_zones.hasOwnProperty(cid)) continue;
      for (var k = 0; k < _zones[cid].length; k++) {
        var uel = _zones[cid][k].el;
        uel.style.fill        = UNFILLED_COLOR;
        uel.style.opacity     = '1';
        uel.style.fillOpacity = '1';
      }
    }
    for (var i = 0; i < _committed.length; i++) {
      var entries = _zones[_committed[i].colorID] || [];
      for (var j = 0; j < entries.length; j++) {
        var el = entries[j].el;
        el.style.fill        = _committed[i].hex;
        el.style.opacity     = '1';
        el.style.fillOpacity = '1';
      }
    }
  }

  /* ── Reveal Overlay ───────────────────────────────── */
  function spawnRevealOverlay(entries) {
    if (!_canvasEl || !_svgEl || entries.length === 0) return;

    var ns      = 'http://www.w3.org/2000/svg';
    var overlay = document.createElementNS(ns, 'svg');
    var viewBox = _svgEl.getAttribute('viewBox');
    var par     = _svgEl.getAttribute('preserveAspectRatio');

    if (viewBox) overlay.setAttribute('viewBox', viewBox);
    if (par)     overlay.setAttribute('preserveAspectRatio', par);
    overlay.setAttribute('class', 'reveal-overlay');

    for (var i = 0; i < entries.length; i++) {
      var clone = entries[i].el.cloneNode(true);
      clone.style.fill = UNFILLED_COLOR;
      /* neutralize any opacity baked into the source path so the grey
         cover starts fully solid */
      clone.style.opacity     = '1';
      clone.style.fillOpacity = '1';
      overlay.appendChild(clone);
    }

    _canvasEl.appendChild(overlay);

    var removed = false;
    function remove() {
      if (removed) return;
      removed = true;
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }
    overlay.addEventListener('animationend', remove);
    /* Fallback in case animationend never fires (tab hidden etc.) */
    setTimeout(remove, 600);
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
    commitFillsToSVG();
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
