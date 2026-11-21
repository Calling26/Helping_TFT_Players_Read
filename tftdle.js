/* ==========================================================
   TFTdle — Daily Champion Guessing Game
   Completely independent of QuizEngine / DataStore in app.js
   ========================================================== */

"use strict";

// ----------------------------------------------------------
// Utility: mulberry32 seeded PRNG
// ----------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Date string YYYY-MM-DD in local time
function todayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Convert YYYY-MM-DD to a compact integer seed
function dateSeed(str) {
  return parseInt(str.replace(/-/g, ""), 10);
}

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
  today: "",

  async load() {
    const res = await fetch("tftdle_champions.json?v=1");
    if (!res.ok) throw new Error("Failed to load tftdle_champions.json");
    const raw = await res.json();
    // Filter to only cost 1-5 (pure playable pool for guessing game)
    this.champions = raw.filter((c) => c.cost >= 1 && c.cost <= 10);
    this.today = todayString();
    this._loadState();
    this.target = this._dailyTarget();
    this.streak = parseInt(localStorage.getItem("tftdle_streak") || "0", 10);
  },

  _dailyTarget() {
    const rng = mulberry32(dateSeed(this.today));
    const idx = Math.floor(rng() * this.champions.length);
    return this.champions[idx];
  },

  _stateKey() {
    return "tftdle_state_" + this.today;
  },

  _saveState() {
    const state = {
      guesses: this.guesses.map((g) => g.id + "|" + g.set),
      gameOver: this.gameOver,
      won: this.won,
    };
    localStorage.setItem(this._stateKey(), JSON.stringify(state));
    // Clean up old keys (keep only today's)
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith("tftdle_state_") && k !== this._stateKey()) {
        localStorage.removeItem(k);
      }
    }
  },

  _loadState() {
    try {
      const raw = localStorage.getItem(this._stateKey());
      if (!raw) return;
      const state = JSON.parse(raw);
      this.gameOver = !!state.gameOver;
      this.won = !!state.won;
      this.guesses = (state.guesses || [])
        .map((key) => {
          const [id, setStr] = key.split("|");
          return this.champions.find(
            (c) => c.id === id && String(c.set) === setStr
          );
        })
        .filter(Boolean);
    } catch (_) {
      // Ignore corrupt state
    }
  },

  submitGuess(champion) {
    if (this.gameOver) return false;
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
      const lastWin = localStorage.getItem("tftdle_last_win") || "";
      const prevStreak = parseInt(localStorage.getItem("tftdle_streak") || "0", 10);
      // Check if yesterday's date was a win to maintain streak
      const yd = new Date();
      yd.setDate(yd.getDate() - 1);
      const yesterdayStr =
        yd.getFullYear() +
        "-" +
        String(yd.getMonth() + 1).padStart(2, "0") +
        "-" +
        String(yd.getDate()).padStart(2, "0");
      if (lastWin === yesterdayStr) {
        this.streak = prevStreak + 1;
      } else if (lastWin === this.today) {
        this.streak = prevStreak; // already counted today
      } else {
        this.streak = 1;
      }
      localStorage.setItem("tftdle_streak", String(this.streak));
      localStorage.setItem("tftdle_last_win", this.today);
    } else if (this.guesses.length >= this.maxGuesses) {
      this.gameOver = true;
      this.won = false;
      this.streak = 0;
      localStorage.setItem("tftdle_streak", "0");
    }

    this._saveState();
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
  _selected: null, // { id, set } of autocomplete selection

  init() {
    // Mode card click (wired from index.html data-mode="tftdle")
    document.querySelectorAll(".mode-card[data-mode='tftdle']").forEach((btn) => {
      btn.addEventListener("click", () => TFTdleUI.show());
    });

    // Home button: also hide TFTdle screen
    const btnHome = document.getElementById("btn-home");
    if (btnHome) {
      btnHome.addEventListener("click", () => {
        const s = document.getElementById("screen-tftdle");
        if (s) s.classList.add("hidden");
      });
    }

    // Guess input events
    const input = document.getElementById("tftdle-guess-input");
    if (input) {
      input.addEventListener("input", () => TFTdleUI._updateAC());
      input.addEventListener("keydown", (e) => {
        if (e.key === "Escape") TFTdleUI._closeAC();
        if (e.key === "Enter") TFTdleUI._submitSelected();
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
      el.textContent = "\uD83D\uDD25 " + TFTdle.streak + " day streak";
      el.style.display = "inline-block";
    } else {
      el.style.display = "none";
    }
  },

  _renderMeta() {
    const left = TFTdle.maxGuesses - TFTdle.guesses.length;
    const el = document.getElementById("tftdle-meta");
    if (el) {
      el.textContent = TFTdle.gameOver
        ? ""
        : left + " guess" + (left !== 1 ? "es" : "") + " remaining";
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
    const title = TFTdle.won ? "You got it!" : "Better luck tomorrow!";
    const summary = TFTdle.won
      ? "<strong>" + _esc(t.name) + "</strong> \u2014 Set " + t.set +
        ", " + t.cost + "g, " + _esc(t.traits.join(", "))
      : "The answer was <strong>" + _esc(t.name) + "</strong> \u2014 Set " +
        t.set + ", " + t.cost + "g, " + _esc(t.traits.join(", "));

    const streakLine =
      TFTdle.won && TFTdle.streak > 0
        ? '<p class="tftdle-streak-line">\uD83D\uDD25 ' + TFTdle.streak + " day streak!</p>"
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
      '<p class="tftdle-next-line">Come back tomorrow for a new champion!</p>' +
      "</div>";
  },

  _setInputState() {
    const wrap = document.getElementById("tftdle-input-wrap");
    const input = document.getElementById("tftdle-guess-input");
    const btn = document.getElementById("tftdle-submit");
    if (!wrap || !input || !btn) return;

    if (TFTdle.gameOver) {
      input.disabled = true;
      btn.disabled = true;
      input.placeholder = "Game over for today";
    } else {
      input.disabled = false;
      btn.disabled = true;
      input.placeholder = "Type a champion name...";
      input.focus();
    }
  },

  // ---- Autocomplete ----

  _updateAC() {
    this._selected = null;
    const btn = document.getElementById("tftdle-submit");
    if (btn) btn.disabled = true;

    const q = (document.getElementById("tftdle-guess-input").value || "").trim().toLowerCase();
    const ac = document.getElementById("tftdle-ac");
    if (!q || !ac) { this._closeAC(); return; }

    const guessedKeys = new Set(TFTdle.guesses.map((g) => g.id + "|" + g.set));
    const hits = TFTdle.champions
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) &&
          !guessedKeys.has(c.id + "|" + c.set)
      )
      .slice(0, 8);

    if (!hits.length) { this._closeAC(); return; }

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
    if (ac) { ac.classList.add("hidden"); ac.innerHTML = ""; }
  },

  _submitSelected() {
    if (!this._selected || TFTdle.gameOver) return;
    TFTdle.submitGuess(this._selected);
    this._selected = null;
    const input = document.getElementById("tftdle-guess-input");
    if (input) { input.value = ""; input.dataset.selected = ""; }
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
