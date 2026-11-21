/* ==========================================================
   TFTdle — Infinite Champion Guessing Game
   Completely independent of QuizEngine / DataStore in app.js
   ========================================================== */

"use strict";

// ----------------------------------------------------------
// TFTdle Engine
// ----------------------------------------------------------
const TFTdle = {
  champions: [],
  target: null,
  guesses: [],
  maxGuesses: 8,
  gameOver: false,
  won: false,
  streak: 0,
  poolMode: "all", // "all" (Hard: All Sets) or "current" (Normal: Latest Set)
  currentSetNum: 18,

  async load() {
    const res = await fetch("tftdle_champions.json?v=2");
    if (!res.ok) throw new Error("Failed to load tftdle_champions.json");
    const raw = await res.json();
    this.champions = raw.filter((c) => c.cost >= 1 && c.cost <= 10);
    
    // Find the highest available set number for the "current" mode
    const setNums = this.champions.map((c) => c.set);
    if (setNums.length > 0) {
      this.currentSetNum = Math.max(...setNums);
    }

    this.streak = parseInt(localStorage.getItem("tftdle_streak") || "0", 10);
    this.newRound(this.poolMode);
  },

  activePool() {
    if (this.poolMode === "current") {
      return this.champions.filter((c) => c.set === this.currentSetNum);
    }
    return this.champions;
  },

  newRound(mode) {
    if (mode) this.poolMode = mode;
    this.guesses = [];
    this.gameOver = false;
    this.won = false;

    const pool = this.activePool();
    if (!pool.length) {
      this.target = this.champions[0] || null;
      return;
    }

    // Pick a random champion from active pool (different from last if possible)
    let nextTarget = pool[Math.floor(Math.random() * pool.length)];
    if (this.target && pool.length > 1 && nextTarget.id === this.target.id && nextTarget.set === this.target.set) {
      nextTarget = pool[Math.floor(Math.random() * pool.length)];
    }
    this.target = nextTarget;
  },

  submitGuess(champion) {
    if (this.gameOver || !champion) return false;
    const alreadyGuessed = this.guesses.some(
      (g) => g.id === champion.id && g.set === champion.set
    );
    if (alreadyGuessed) return false;

    this.guesses.push(champion);

    const isCorrect =
      champion.id === this.target.id && champion.set === this.target.set;

    if (isCorrect) {
      this.won = true;
      this.gameOver = true;
      this.streak++;
      localStorage.setItem("tftdle_streak", String(this.streak));
    } else if (this.guesses.length >= this.maxGuesses) {
      this.gameOver = true;
      this.won = false;
      this.streak = 0;
      localStorage.setItem("tftdle_streak", "0");
    }

    return true;
  },

  compare(guess) {
    const t = this.target;
    return {
      set:    _cmpNum(guess.set, t.set, 0),
      cost:   _cmpNum(guess.cost, t.cost, 1),
      range:  _cmpNum(guess.range, t.range, 1),
      traits: _cmpTraits(guess.traits, t.traits),
      gender: guess.gender === t.gender ? "match" : "wrong",
    };
  },
};

function _cmpNum(a, b, tol) {
  if (a === b) return "match";
  if (Math.abs(a - b) <= tol) return "close";
  return "wrong";
}

function _cmpTraits(gTraits, tTraits) {
  const gSet = new Set(gTraits);
  const tSet = new Set(tTraits);
  const overlap = [...gSet].filter((x) => tSet.has(x)).length;
  if (overlap === tSet.size && gSet.size === tSet.size) return "match";
  if (overlap > 0) return "close";
  return "wrong";
}

// ----------------------------------------------------------
// TFTdle UI
// ----------------------------------------------------------
const TFTdleUI = {
  _selected: null, // champion object of autocomplete selection

  init() {
    // Mode card click
    document.querySelectorAll(".mode-card[data-mode='tftdle']").forEach((btn) => {
      btn.addEventListener("click", () => TFTdleUI.show());
    });

    // Home button
    const btnHome = document.getElementById("btn-home");
    if (btnHome) {
      btnHome.addEventListener("click", () => {
        const s = document.getElementById("screen-tftdle");
        if (s) s.classList.add("hidden");
      });
    }

    // Toggle buttons (All Sets vs Current Set)
    const toggleContainer = document.getElementById("tftdle-mode-toggle");
    if (toggleContainer) {
      toggleContainer.querySelectorAll(".tftdle-toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const pool = btn.dataset.pool;
          if (pool === TFTdle.poolMode && !TFTdle.gameOver) return;
          toggleContainer.querySelectorAll(".tftdle-toggle-btn").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          TFTdle.newRound(pool);
          TFTdleUI._selected = null;
          const input = document.getElementById("tftdle-guess-input");
          if (input) input.value = "";
          TFTdleUI._render();
        });
      });
    }

    // Guess input events
    const input = document.getElementById("tftdle-guess-input");
    if (input) {
      input.addEventListener("input", () => TFTdleUI._updateAC());
      input.addEventListener("focus", () => TFTdleUI._updateAC());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") TFTdleUI._closeAC();
        if (e.key === "Enter") {
          e.preventDefault();
          TFTdleUI._submitSelected();
        }
      });
    }

    // Submit button
    const submitBtn = document.getElementById("tftdle-submit");
    if (submitBtn) {
      submitBtn.addEventListener("click", () => TFTdleUI._submitSelected());
    }

    // Close autocomplete on outside click
    document.addEventListener("click", (e) => {
      if (!e.target.closest("#tftdle-input-wrap")) TFTdleUI._closeAC();
    });
  },

  show() {
    // Hide other screens
    ["screen-home", "screen-quiz", "screen-results"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    const screen = document.getElementById("screen-tftdle");
    if (screen) screen.classList.remove("hidden");

    // Header state
    const btnHome = document.getElementById("btn-home");
    if (btnHome) btnHome.style.display = "flex";
    const scoreDisplay = document.getElementById("score-display");
    if (scoreDisplay) scoreDisplay.style.display = "none";

    this._render();
  },

  _render() {
    this._renderStreak();
    this._renderMeta();
    this._renderGrid();
    this._renderResult();
    this._setInputState();
  },

  _renderStreak() {
    const el = document.getElementById("tftdle-streak");
    if (!el) return;
    if (TFTdle.streak > 1) {
      el.textContent = "\uD83D\uDD25 " + TFTdle.streak + " streak";
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  },

  _renderMeta() {
    const left = TFTdle.maxGuesses - TFTdle.guesses.length;
    const el = document.getElementById("tftdle-meta");
    if (el) {
      const poolLabel = TFTdle.poolMode === "current" ? "Set " + TFTdle.currentSetNum : "All Sets";
      el.textContent = TFTdle.gameOver
        ? "Round finished (" + poolLabel + ")"
        : left + " guess" + (left !== 1 ? "es" : "") + " remaining (" + poolLabel + ")";
    }
  },

  _renderGrid() {
    const tbody = document.getElementById("tftdle-grid-body");
    if (!tbody) return;
    tbody.innerHTML = "";
    TFTdle.guesses.forEach((g) => {
      tbody.prepend(this._buildRow(g)); // newest on top
    });
  },

  _buildRow(champion) {
    const result = TFTdle.compare(champion);
    const isWin =
      champion.id === TFTdle.target.id && champion.set === TFTdle.target.set;

    const tr = document.createElement("tr");
    tr.className = "tftdle-row" + (isWin ? " tftdle-row--win" : "");

    // Portrait
    const tdImg = document.createElement("td");
    tdImg.className = "tftdle-cell tftdle-cell--portrait";
    const img = document.createElement("img");
    img.src = champion.image;
    img.alt = champion.name;
    img.className = "tftdle-portrait-img";
    img.addEventListener("error", () => {
      img.style.display = "none";
      tdImg.textContent = champion.name[0];
    });
    tdImg.appendChild(img);
    tr.appendChild(tdImg);

    // Name
    const tdName = document.createElement("td");
    tdName.className = "tftdle-cell";
    tdName.textContent = champion.name;
    tr.appendChild(tdName);

    // Set
    tr.appendChild(_makeCell("Set " + champion.set, result.set));

    // Cost (with direction arrow)
    const costArrow = _arrow(champion.cost, TFTdle.target.cost, result.cost);
    tr.appendChild(_makeCell(champion.cost + "g " + costArrow, result.cost));

    // Range
    const rangeArrow = _arrow(champion.range, TFTdle.target.range, result.range);
    tr.appendChild(_makeCell(champion.range + " " + rangeArrow, result.range));

    // Traits
    const tdTraits = document.createElement("td");
    tdTraits.className = "tftdle-cell tftdle-cell--traits " + result.traits;
    tdTraits.innerHTML = champion.traits
      .map((t) => '<span class="trait-chip">' + _esc(t) + "</span>")
      .join(" ");
    tr.appendChild(tdTraits);

    // Gender
    tr.appendChild(_makeCell(champion.gender, result.gender));

    return tr;
  },

  _renderResult() {
    const el = document.getElementById("tftdle-result");
    if (!el) return;
    if (!TFTdle.gameOver) { el.innerHTML = ""; return; }

    const t = TFTdle.target;
    const title = TFTdle.won ? "You got it!" : "Out of guesses!";
    const summary = TFTdle.won
      ? "<strong>" + _esc(t.name) + "</strong> — Set " + t.set +
        ", " + t.cost + "g, " + _esc(t.traits.join(", "))
      : "The answer was <strong>" + _esc(t.name) + "</strong> — Set " +
        t.set + ", " + t.cost + "g, " + _esc(t.traits.join(", "));

    const streakLine =
      TFTdle.won && TFTdle.streak > 0
        ? '<p class="tftdle-streak-line">\uD83D\uDD25 Current streak: ' + TFTdle.streak + "!</p>"
        : "";

    el.innerHTML =
      '<div class="tftdle-result-card ' +
      (TFTdle.won ? "tftdle-result--win" : "tftdle-result--loss") +
      '">' +
      '<img src="' + _esc(t.image) + '" alt="' + _esc(t.name) + '" ' +
      'class="tftdle-reveal-img" onerror="this.style.display=\'none\'">' +
      "<h3>" + title + "</h3>" +
      "<p>" + summary + "</p>" +
      streakLine +
      '<button id="tftdle-play-again" class="btn btn-primary tftdle-play-again-btn">Play Again / Next Champion</button>' +
      "</div>";

    const playAgainBtn = document.getElementById("tftdle-play-again");
    if (playAgainBtn) {
      playAgainBtn.addEventListener("click", () => {
        TFTdle.newRound();
        TFTdleUI._selected = null;
        const input = document.getElementById("tftdle-guess-input");
        if (input) input.value = "";
        TFTdleUI._render();
      });
    }
  },

  _setInputState() {
    const input = document.getElementById("tftdle-guess-input");
    const btn = document.getElementById("tftdle-submit");
    if (!input || !btn) return;

    if (TFTdle.gameOver) {
      input.disabled = true;
      btn.disabled = true;
      input.placeholder = "Round finished! Click 'Play Again' above.";
    } else {
      input.disabled = false;
      btn.disabled = true;
      input.placeholder = "Type a champion name (or scroll all matches)...";
      input.focus();
    }
  },

  // ---- Autocomplete ----

  _updateAC() {
    if (TFTdle.gameOver) {
      this._closeAC();
      return;
    }

    this._selected = null;
    const btn = document.getElementById("tftdle-submit");
    if (btn) btn.disabled = true;

    const input = document.getElementById("tftdle-guess-input");
    const q = (input ? input.value : "").trim().toLowerCase();
    const ac = document.getElementById("tftdle-ac");
    if (!ac) return;

    const guessedKeys = new Set(TFTdle.guesses.map((g) => g.id + "|" + g.set));
    const pool = TFTdle.activePool();

    // Show all matching unguessed champions without slicing
    const hits = pool
      .filter((c) => {
        if (guessedKeys.has(c.id + "|" + c.set)) return false;
        if (!q) return true; // if input is focused without query, allow browsing all pool champions
        return c.name.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (a.name.toLowerCase() === b.name.toLowerCase()) {
          return a.set - b.set;
        }
        return a.name.localeCompare(b.name);
      });

    if (!hits.length) {
      this._closeAC();
      return;
    }

    ac.innerHTML = "";
    hits.forEach((c) => {
      const li = document.createElement("li");
      li.className = "tftdle-ac-item";
      const imgHtml =
        '<img src="' + _esc(c.image) + '" alt="" ' +
        'onerror="this.style.display=\'none\'" class="tftdle-ac-img">';
      li.innerHTML =
        imgHtml +
        '<span class="tftdle-ac-name">' + _esc(c.name) + "</span>" +
        '<span class="tftdle-ac-set">Set ' + c.set + "</span>";
      li.addEventListener("click", () => TFTdleUI._pickChamp(c));
      ac.appendChild(li);
    });
    ac.classList.remove("hidden");
  },

  _pickChamp(c) {
    this._selected = c;
    const input = document.getElementById("tftdle-guess-input");
    if (input) input.value = c.name + " (Set " + c.set + ")";
    const btn = document.getElementById("tftdle-submit");
    if (btn) btn.disabled = false;
    this._closeAC();
  },

  _closeAC() {
    const ac = document.getElementById("tftdle-ac");
    if (ac) {
      ac.classList.add("hidden");
      ac.innerHTML = "";
    }
  },

  _submitSelected() {
    if (!this._selected || TFTdle.gameOver) return;
    TFTdle.submitGuess(this._selected);
    this._selected = null;
    const input = document.getElementById("tftdle-guess-input");
    if (input) {
      input.value = "";
    }
    this._closeAC();
    this._render();
  },
};

// ------ tiny helpers ------

function _makeCell(text, cls) {
  const td = document.createElement("td");
  td.className = "tftdle-cell " + cls;
  td.textContent = text;
  return td;
}

function _arrow(guess, target, cls) {
  if (cls === "match") return "";
  return guess < target ? "\u25B2" : "\u25BC";
}

function _esc(s) {
  if (!s) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ----------------------------------------------------------
// Boot — runs after app.js has already booted
// ----------------------------------------------------------
(async function bootTFTdle() {
  try {
    await TFTdle.load();
    TFTdleUI.init();
  } catch (err) {
    console.error("TFTdle boot failed:", err);
  }
})();
