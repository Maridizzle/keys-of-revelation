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
  var _labels      = {};     /* colorID → [non-path label elements] */
  var _zoneCanvas  = null;   /* raster layer under the SVG holding all color */
  var _zoneCtx     = null;
  var _flickerCanvas = null; /* pooled raster layer above the SVG for the blink */
  var _flickerCtx    = null;
  var _flickerHideTimer = null;
  var _hasTransforms = false; /* any transform attrs in the SVG? */
  var _committed   = [];     /* [{ colorID, hex }] fills applied so far */
  var _svgCommitted = false; /* fills written back into the SVG element */
  var _resizeHandler = null;
  var _perfHUD     = null;   /* ?perf=1 diagnostics */
  var _perfLongTask = '-';

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
    _labels       = {};
    _committed    = [];
    _svgCommitted = false;
    if (_flickerHideTimer) { clearTimeout(_flickerHideTimer); _flickerHideTimer = null; }

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
      if (!cid) continue;
      if (!seen[cid]) {
        seen[cid] = true;
        ordered.push(cid);
      }
      /* Non-path elements with a colorID are the zone's number labels */
      if (allPaths[i].tagName.toLowerCase() !== 'path') {
        if (!_labels[cid]) _labels[cid] = [];
        _labels[cid].push(allPaths[i]);
      }
    }

    _hasTransforms = !!_svgEl.querySelector('[transform]');

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
          /* fill-rule may live in the style attribute (MimiPanda exports
             declare style="...fill-rule:evenodd...") or as a presentation
             attribute; canvas must honor it or compound cell paths smear
             solid over their holes */
          var fr = p.style.fillRule || p.getAttribute('fill-rule');
          if (fr === 'evenodd') entry.fillRule = 'evenodd';
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

    /* Pooled flicker layer above the SVG -- reused for every reveal so
       no DOM nodes are created or destroyed while typing */
    _flickerCanvas = document.createElement('canvas');
    _flickerCanvas.className = 'flicker-canvas';
    _flickerCanvas.style.visibility = 'hidden';
    _flickerCtx = _flickerCanvas.getContext('2d');
    _flickerCanvas.addEventListener('animationend', hideFlicker);
    canvasEl.appendChild(_flickerCanvas);

    initPerfHUD();

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

    var t0 = _perfHUD ? performance.now() : 0;
    var entries = _zones[colorID] || [];

    /* Paint the zone onto the raster layer. Canvas is immediate-mode:
       cost is a handful of Path2D fills no matter how large the pack
       is, and the vector scene above is never invalidated -- so the
       next word is typeable immediately. */
    _committed.push({ colorID: colorID, hex: hex });
    paintZones(_zoneCtx, _zoneCanvas, entries, hex);

    /* Flicker effect: the pooled canvas above the SVG shows the zone in
       grey and blinks away, exposing the color underneath. One opacity
       animation on one element -- runs on the compositor for free. */
    flickerZone(entries);

    if (_perfHUD) updatePerfHUD(performance.now() - t0);

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
  function paintZones(ctx, canvas, entries, color) {
    if (!ctx || !canvas) return;
    var rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    var dpr = window.devicePixelRatio || 1;

    /* getScreenCTM maps user units to client pixels, including viewBox
       scaling and any ancestor transforms. Without transforms in the
       document every path shares the root matrix -- compute it once. */
    var shared = _hasTransforms ? null : (_svgEl && _svgEl.getScreenCTM());

    ctx.fillStyle = color;
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      if (!entry.p2d) continue;
      var m = shared || entry.el.getScreenCTM();
      if (!m) continue;
      ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr,
                       (m.e - rect.left) * dpr, (m.f - rect.top) * dpr);
      ctx.fill(entry.p2d, entry.fillRule);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  /* Resize canvases to their box, repaint grey underlay + committed fills */
  function redrawZoneCanvas() {
    if (!_zoneCanvas) return;
    var rect = _zoneCanvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    var dpr = window.devicePixelRatio || 1;
    _zoneCanvas.width  = Math.round(rect.width * dpr);
    _zoneCanvas.height = Math.round(rect.height * dpr);
    if (_flickerCanvas) {
      _flickerCanvas.width  = _zoneCanvas.width;
      _flickerCanvas.height = _zoneCanvas.height;
      hideFlicker();
    }

    var all = [];
    for (var cid in _zones) {
      if (_zones.hasOwnProperty(cid)) all = all.concat(_zones[cid]);
    }
    paintZones(_zoneCtx, _zoneCanvas, all, UNFILLED_COLOR);

    for (var i = 0; i < _committed.length; i++) {
      paintZones(_zoneCtx, _zoneCanvas, _zones[_committed[i].colorID] || [], _committed[i].hex);
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
      /* Painted zones no longer need their number labels */
      var labels = _labels[_committed[i].colorID] || [];
      for (var t = 0; t < labels.length; t++) {
        labels[t].style.display = 'none';
      }
    }
  }

  /* ── Reveal Flicker ───────────────────────────────── */
  function flickerZone(entries) {
    if (!_flickerCanvas || !_flickerCtx || entries.length === 0) return;

    /* If a previous flicker is still running, this simply takes over the
       canvas -- the previous zone's color is already committed beneath */
    _flickerCtx.setTransform(1, 0, 0, 1, 0, 0);
    _flickerCtx.clearRect(0, 0, _flickerCanvas.width, _flickerCanvas.height);
    paintZones(_flickerCtx, _flickerCanvas, entries, UNFILLED_COLOR);

    _flickerCanvas.style.visibility = 'visible';
    _flickerCanvas.style.animation  = 'none';
    /* restart the animation without forcing a synchronous reflow */
    requestAnimationFrame(function() {
      if (!_flickerCanvas) return;
      _flickerCanvas.style.animation = 'greyFlickerOut 350ms ease forwards';
    });

    if (_flickerHideTimer) clearTimeout(_flickerHideTimer);
    /* Fallback in case animationend never fires (tab hidden etc.) */
    _flickerHideTimer = setTimeout(hideFlicker, 600);
  }

  function hideFlicker() {
    if (!_flickerCanvas) return;
    _flickerCanvas.style.visibility = 'hidden';
    _flickerCanvas.style.animation  = 'none';
  }

  /* ── Toast ────────────────────────────────────────── */
  function showToast(name, hex) {
    var toast = document.getElementById('color-toast');
    if (!toast) return;

    toast.textContent  = name;
    toast.style.color  = hex;
    toast.style.textShadow = '0 0 10px ' + hex;

    /* Restart the transition without forcing a synchronous reflow */
    toast.classList.remove('color-toast--visible');
    requestAnimationFrame(function() {
      toast.classList.add('color-toast--visible');
    });

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(function() {
      toast.classList.remove('color-toast--visible');
    }, TOAST_DURATION);
  }

  /* ── Perf HUD (?perf=1) ───────────────────────────── */
  function initPerfHUD() {
    if (window.location.search.indexOf('perf=1') === -1 || _perfHUD) return;
    _perfHUD = document.createElement('div');
    _perfHUD.style.cssText = 'position:fixed;top:4px;left:4px;z-index:9999;'
      + 'font:11px/1.5 monospace;color:#5f5;background:rgba(0,0,0,0.75);'
      + 'padding:4px 8px;pointer-events:none;white-space:pre';
    document.body.appendChild(_perfHUD);
    updatePerfHUD(0);
    try {
      new PerformanceObserver(function(list) {
        var es = list.getEntries();
        var last = es[es.length - 1];
        _perfLongTask = Math.round(last.duration) + 'ms @' + (last.startTime / 1000).toFixed(1) + 's';
      }).observe({ entryTypes: ['longtask'] });
    } catch (e) {}
  }

  function updatePerfHUD(revealMs) {
    if (!_perfHUD) return;
    _perfHUD.textContent = 'reveal js: ' + revealMs.toFixed(1) + 'ms\n'
      + 'last long task: ' + _perfLongTask;
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
