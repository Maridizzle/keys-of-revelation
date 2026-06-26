/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — game.js
   Phase 4 + 6: All game modes.
   Modes: picture, speed, precision, zen
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

var Game = (function() {

  /* ── State ────────────────────────────────────────── */
  var _mode             = 'picture';
  var _words            = [];
  var _wordIndex        = 0;
  var _currentWord      = '';

  var _correctWords     = 0;
  var _errorCount       = 0;
  var _streak           = 0;
  var _bestStreak       = 0;
  var _wordsSinceLastFill = 0;
  var _score            = 0;     /* precision mode */

  var _startTime        = null;
  var _sessionTimer     = null;  /* WPM update interval */
  var _countdownTimer   = null;  /* speed mode countdown */
  var _timeLimit        = 60;    /* speed mode seconds */
  var _timeRemaining    = 60;

  var _running          = false;

  var WORDS_PER_FILL    = 2;
  var POINTS_CORRECT    = 10;
  var POINTS_WRONG      = -5;

  /* ── Shuffle ──────────────────────────────────────── */
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  /* ── Stat panel visibility per mode ──────────────── */
  function configureStatPanels(mode) {
    var allStats = ['stat-wpm', 'stat-timer', 'stat-score',
                    'stat-streak', 'stat-words',
                    'stat-accuracy', 'stat-errors', 'stat-colors'];

    /* Show all by default */
    for (var i = 0; i < allStats.length; i++) {
      var el = document.getElementById(allStats[i]);
      if (el) el.parentNode.style.display = 'flex';
    }

    /* Mode-specific overrides */
    function hide(id) {
      var el = document.getElementById(id);
      if (el) el.parentNode.style.display = 'none';
    }

    if (mode === 'picture') {
      hide('stat-timer');
      hide('stat-score');
    } else if (mode === 'speed') {
      hide('stat-score');
      hide('stat-streak');
    } else if (mode === 'precision') {
      hide('stat-timer');
      hide('stat-wpm');
    } else if (mode === 'zen') {
      hide('stat-timer');
      hide('stat-score');
      hide('stat-wpm');
      hide('stat-accuracy');
    }
  }

  /* ── Start Session ────────────────────────────────── */
  function start() {
    if (!window.activePack) {
      showScreen('screen-packs');
      return;
    }

    _mode = window.activeMode || 'picture';
    _timeLimit = window.speedDuration || 60;

    var listKey = window.activeListKey || Object.keys(WORD_LISTS)[0];
    var rawList = getWordList(listKey);

    if (!rawList || rawList.length === 0) {
      alert('Word list is empty. Please populate wordlists.js first.');
      return;
    }

    /* Load SVG */
    var canvas = document.getElementById('svg-canvas');
    var loaded = SVGEngine.loadPack(window.activePack, canvas);
    if (!loaded) return;

    /* Reset state */
    _words              = shuffle(rawList);
    _wordIndex          = 0;
    _correctWords       = 0;
    _errorCount         = 0;
    _streak             = 0;
    _bestStreak         = 0;
    _wordsSinceLastFill = 0;
    _score              = 0;
    _startTime          = null;
    _timeRemaining      = _timeLimit;
    _running            = true;

    /* Configure stat panels for this mode */
    configureStatPanels(_mode);

    /* Reset displays */
    setStatDisplay('stat-wpm',      '0');
    setStatDisplay('stat-streak',   '0');
    setStatDisplay('stat-words',    '0');
    setStatDisplay('stat-accuracy', '100%');
    setStatDisplay('stat-errors',   '0');
    setStatDisplay('stat-colors',   '0');
    setStatDisplay('stat-score',    '0');
    setStatDisplay('stat-timer',    formatCountdown(_timeLimit));
    updateColorProgress();
    updatePackNameDisplay();

    serveWord();

    var input = document.getElementById('typing-input');
    if (input) { input.value = ''; input.focus(); }
  }

  /* ── Serve Word ───────────────────────────────────── */
  function serveWord() {
    if (_wordIndex >= _words.length) {
      _words     = shuffle(_words);
      _wordIndex = 0;
    }
    _currentWord = _words[_wordIndex];
    _wordIndex++;

    var display = document.getElementById('word-display');
    if (display) display.textContent = _currentWord;

    var input = document.getElementById('typing-input');
    if (input) {
      input.value = '';
      input.classList.remove('typing-input--error');
    }
  }

  /* ── Handle Input ─────────────────────────────────── */
  function handleInput(e) {
    if (!_running) return;

    var input = e.target;
    var typed = input.value;

    /* Start timer on first keystroke */
    if (!_startTime && typed.length > 0) {
      _startTime = Date.now();
      startSessionTimer();
      if (_mode === 'speed') startCountdown();
    }

    var submitted      = false;
    var submittedValue = typed;

    if (e.type === 'keydown' && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      submittedValue = typed.trim();
      submitted = true;
    }

    /* Live prefix check */
    if (!submitted) {
      var isPrefix = _currentWord.indexOf(typed) === 0;
      if (typed.length > 0 && !isPrefix) {
        input.classList.add('typing-input--error');
        if (_mode !== 'zen') {
          _errorCount++;
          setStatDisplay('stat-errors', String(_errorCount));
          updateAccuracy();
        }
      } else {
        input.classList.remove('typing-input--error');
      }
      return;
    }

    /* Word submitted */
    input.classList.remove('typing-input--error');

    if (submittedValue === _currentWord) {
      _correctWords++;
      _streak++;
      if (_streak > _bestStreak) _bestStreak = _streak;
      _wordsSinceLastFill++;

      if (_mode === 'precision') {
        _score += POINTS_CORRECT;
        setStatDisplay('stat-score', String(_score));
      }

      setStatDisplay('stat-words',  String(_correctWords));
      setStatDisplay('stat-streak', String(_streak));
      updateAccuracy();
      triggerFillIfReady();
      serveWord();

    } else {
      _errorCount++;
      _streak = 0;

      if (_mode === 'precision') {
        _score += POINTS_WRONG;
        setStatDisplay('stat-score', String(_score));
      }

      setStatDisplay('stat-errors', String(_errorCount));
      setStatDisplay('stat-streak', '0');
      updateAccuracy();
      input.value = '';
      input.classList.add('typing-input--error');
      setTimeout(function() {
        input.classList.remove('typing-input--error');
      }, 600);
    }
  }

  /* ── Fill Trigger ─────────────────────────────────── */
  function triggerFillIfReady() {
    if (_wordsSinceLastFill >= WORDS_PER_FILL && !SVGEngine.isComplete()) {
      _wordsSinceLastFill = 0;
      var result = SVGEngine.fillNextZone();
      if (result) {
        setStatDisplay('stat-colors', String(result.filled));
        updateColorProgress();
        if (result.complete && _mode === 'picture') {
          endSession();
        }
      }
    }
  }

  /* ── Session Timer (WPM updates) ──────────────────── */
  function startSessionTimer() {
    if (_sessionTimer) clearInterval(_sessionTimer);
    _sessionTimer = setInterval(function() {
      if (!_running) return;
      updateWPM();
    }, 500);
  }

  /* ── Speed Countdown ──────────────────────────────── */
  function startCountdown() {
    if (_countdownTimer) clearInterval(_countdownTimer);
    _timeRemaining = _timeLimit;

    _countdownTimer = setInterval(function() {
      if (!_running) { clearInterval(_countdownTimer); return; }
      _timeRemaining--;
      setStatDisplay('stat-timer', formatCountdown(_timeRemaining));
      if (_timeRemaining <= 0) {
        clearInterval(_countdownTimer);
        endSession();
      }
    }, 1000);
  }

  function formatCountdown(secs) {
    var s = Math.max(0, secs);
    var m = Math.floor(s / 60);
    var r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }

  function stopTimers() {
    if (_sessionTimer)   { clearInterval(_sessionTimer);   _sessionTimer   = null; }
    if (_countdownTimer) { clearInterval(_countdownTimer); _countdownTimer = null; }
  }

  /* ── WPM / Accuracy ───────────────────────────────── */
  function updateWPM() {
    if (!_startTime || _correctWords === 0) return;
    var elapsedMin = (Date.now() - _startTime) / 60000;
    if (elapsedMin <= 0) return;
    setStatDisplay('stat-wpm', String(Math.round(_correctWords / elapsedMin)));
  }

  function updateAccuracy() {
    if (_mode === 'zen') return;
    var total = _correctWords + _errorCount;
    if (total === 0) { setStatDisplay('stat-accuracy', '100%'); return; }
    setStatDisplay('stat-accuracy', Math.round((_correctWords / total) * 100) + '%');
  }

  /* ── Display Helpers ──────────────────────────────── */
  function setStatDisplay(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function updateColorProgress() {
    var el = document.getElementById('color-progress');
    if (el) {
      el.textContent = SVGEngine.getFilledZones() + ' / ' + SVGEngine.getTotalZones() + ' colors';
    }
  }

  function updatePackNameDisplay() {
    var el = document.getElementById('pack-name-display');
    if (el && window.activePack) {
      var modeLabel = (_mode || 'picture').toUpperCase();
      el.textContent = window.activePack.name + '  /  ' + modeLabel;
    }
  }

  /* ── End Session ──────────────────────────────────── */
  function endSession() {
    if (!_running) return;
    _running = false;
    stopTimers();
    updateWPM();

    var elapsedMs  = _startTime ? (Date.now() - _startTime) : 0;
    var elapsedMin = elapsedMs / 60000;
    var finalWPM   = (elapsedMin > 0 && _correctWords > 0)
      ? Math.round(_correctWords / elapsedMin) : 0;

    var totalAttempts = _correctWords + _errorCount;
    var finalAccuracy = totalAttempts > 0
      ? Math.round((_correctWords / totalAttempts) * 100) : 100;

    window.lastSessionReport = {
      date:         new Date().toLocaleString(),
      mode:         _mode,
      pack:         window.activePack ? window.activePack.name : 'Unknown',
      wordList:     window.activeListKey || 'Unknown',
      wpm:          finalWPM,
      accuracy:     finalAccuracy,
      correctWords: _correctWords,
      errors:       _errorCount,
      bestStreak:   _bestStreak,
      score:        _score,
      colorsFilled: SVGEngine.getFilledZones(),
      totalColors:  SVGEngine.getTotalZones(),
      elapsedMs:    elapsedMs
    };

    if (typeof Stats !== 'undefined') {
      Stats.saveSession(window.lastSessionReport, function(err) {
        if (err) console.error('Stats save error:', err);
      });
    }

    setTimeout(function() { showScreen('screen-complete'); }, 400);
  }

  /* ── Quit (called by QUIT button) ─────────────────── */
  function quit() {
    if (_running) {
      endSession();
    } else {
      showScreen('screen-modes');
    }
  }

  /* ── Stop (navigating away mid-session) ───────────── */
  function stop() {
    _running = false;
    stopTimers();
  }

  /* ── Init ───────────────────────────────────────────── */
  document.addEventListener('DOMContentLoaded', function() {
    var input = document.getElementById('typing-input');
    if (input) {
      input.addEventListener('input',   handleInput);
      input.addEventListener('keydown', handleInput);
    }

    window._screenHandlers.push(function(id) {
      if (id === 'screen-picture') {
        start();
      } else if (_running) {
        stop();
      }

      /* Inject finished SVG into complete screen */
      if (id === 'screen-complete') {
        var container = document.getElementById('complete-svg-container');
        if (container) {
          container.innerHTML = '';
          var svg = SVGEngine.getCompletedSVG();
          if (svg) {
            svg.setAttribute('width',  '100%');
            svg.setAttribute('height', '100%');
            container.appendChild(svg);
          }
        }
        var nameEl = document.getElementById('complete-pack-name');
        if (nameEl && window.activePack) {
          nameEl.textContent = window.activePack.name
            + '  /  ' + (_mode || 'picture').toUpperCase();
        }
      }
    });
  });

  /* ── Public API ───────────────────────────────────── */
  return {
    start:     start,
    stop:      stop,
    quit:      quit,
    getReport: function() { return window.lastSessionReport; }
  };

})();
