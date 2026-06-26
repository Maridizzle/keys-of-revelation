/* ═══════════════════════════════════════════════════════
   THE KEYS OF REVELATION — ui.js
   Phase 1: Screen navigation.
   Updated: multi-handler screen change system + difficulty screen.
   Signed: Maridizzle
═══════════════════════════════════════════════════════ */

/* Multiple modules can register screen change callbacks */
window._screenHandlers = [];

function showScreen(id) {
  var screens = document.querySelectorAll('.screen');
  for (var i = 0; i < screens.length; i++) {
    screens[i].classList.remove('screen--active');
  }
  var target = document.getElementById(id);
  if (target) {
    target.classList.add('screen--active');
  }
  for (var j = 0; j < window._screenHandlers.length; j++) {
    window._screenHandlers[j](id);
  }
}

/* ── Difficulty Screen ──────────────────────────────── */

function buildDifficultyButtons() {
  var grid = document.getElementById('difficulty-grid');
  if (!grid) return;

  if (typeof WORD_LISTS === 'undefined' || Object.keys(WORD_LISTS).length === 0) {
    grid.innerHTML = '<div class="difficulty-empty">No word lists found.<br>Run wordlist-builder.html and add wordlists.js to the js/ folder.</div>';
    return;
  }

  var keys     = Object.keys(WORD_LISTS);
  var hasWords = false;
  for (var i = 0; i < keys.length; i++) {
    if (WORD_LISTS[keys[i]].length > 0) { hasWords = true; break; }
  }

  if (!hasWords) {
    grid.innerHTML = '<div class="difficulty-empty">Word lists are empty.<br>Run wordlist-builder.html to populate them.</div>';
    return;
  }

  var html = '';
  for (var j = 0; j < keys.length; j++) {
    var key   = keys[j];
    var count = WORD_LISTS[key].length;
    if (count === 0) continue;
    html += '<div class="difficulty-card" data-list="' + key + '">';
    html += '  <div class="difficulty-card__name">' + key.toUpperCase() + '</div>';
    html += '  <div class="difficulty-card__count">' + count + ' words</div>';
    html += '</div>';
  }

  grid.innerHTML = html;

  var cards = grid.querySelectorAll('.difficulty-card');
  for (var k = 0; k < cards.length; k++) {
    (function(card) {
      card.addEventListener('click', function() {
        window.activeListKey = card.getAttribute('data-list');
        showScreen('screen-picture');
      });
    })(cards[k]);
  }
}

/* ── Init ───────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', function() {

  /* Wire all data-goto triggers */
  var triggers = document.querySelectorAll('[data-goto]');
  for (var i = 0; i < triggers.length; i++) {
    (function(el) {
      el.addEventListener('click', function() {
        /* Save active mode if element has data-mode */
        var mode = el.getAttribute('data-mode');
        if (mode) window.activeMode = mode;
        showScreen(el.getAttribute('data-goto'));
      });
    })(triggers[i]);
  }

  /* Wire speed duration cards */
  var durationCards = document.querySelectorAll('.setup-duration-card');
  for (var j = 0; j < durationCards.length; j++) {
    (function(card) {
      card.addEventListener('click', function() {
        window.speedDuration = parseInt(card.getAttribute('data-duration'), 10);
        showScreen('screen-difficulty');
      });
    })(durationCards[j]);
  }

  /* Register difficulty screen handler */
  window._screenHandlers.push(function(id) {
    if (id === 'screen-difficulty') buildDifficultyButtons();
  });

});
