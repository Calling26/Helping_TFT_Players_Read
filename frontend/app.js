/* ═══════════════════════════════════════════════════════
   TFT Quiz — App Engine
   DataStore · QuizEngine · UIController · 5 Game Modes
   ═══════════════════════════════════════════════════════ */

"use strict";

// ──────────────────────────────────────────────
// Utility helpers
// ──────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pick(arr, n) {
  return shuffle(arr).slice(0, n);
}

function stripHtml(s) {
  if (!s) return "";
  return s
    .replace(/%i:[^%]+%/g, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Replace @Var@ placeholders using spell.variables (star-level index). */
function resolveSpellText(desc, variables, starIndex) {
  if (!desc) return "";
  const idx = starIndex || 1;
  const cleanedDesc = desc.replace(/%i:[^%]+%/g, "");
  let resolved = cleanedDesc.replace(/@([^@]+)@/g, (_, raw) => {
    // Handle TFTUnitProperty refs
    if (raw.includes(".") && raw.includes("TFT")) return "";
    const parts = raw.split("*");
    const varName = parts[0].trim();
    let multiplier = 1;
    if (parts.length > 1) {
      const m = parseFloat(parts[1]);
      if (!isNaN(m)) multiplier = m;
    }
    // Case-insensitive & underscore/brace-stripped lookup
    const cleanVar = varName.replace(/[{}\s_]/g, "").toLowerCase();
    const key = Object.keys(variables || {}).find(
      (k) =>
        k.toLowerCase() === varName.toLowerCase() ||
        k.replace(/[{}\s_]/g, "").toLowerCase() === cleanVar
    );
    if (!key || !variables[key]) return "X";
    const vals = variables[key];
    let val = Array.isArray(vals) ? (vals[idx] ?? vals[0] ?? 0) : vals;
    val *= multiplier;
    if (Number.isFinite(val)) {
      return val === Math.floor(val) ? String(Math.floor(val)) : val.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
    }
    return String(val);
  });
  return stripHtml(resolved);
}

// ──────────────────────────────────────────────
// DataStore — loads and caches data.json
// ──────────────────────────────────────────────
const DataStore = {
  champions: [],
  traits: [],
  augments: [],

  async load() {
    const res = await fetch("data.json?v=3");
    if (!res.ok) throw new Error("Failed to load data.json");
    const data = await res.json();
    this.champions = data.champions || [];
    this.traits = data.traits || [];
    this.augments = data.augments || [];
  },

  /** Champions that have at least 1 spell variable (needed for mode 5). */
  championsWithVars() {
    return this.champions.filter(
      (c) => Object.keys(c.spell.variables).length >= 2
    );
  },
};

// ──────────────────────────────────────────────
// QuizEngine — manages quiz state
// ──────────────────────────────────────────────
const QuizEngine = {
  mode: 0,
  questions: [],
  currentIndex: 0,
  score: 0,
  totalQuestions: 10,

  // Per-question state
  selectedAnswer: null,
  submitted: false,

  // Mode 1 sub-step tracking (cost, traits, spell)
  subStep: 0,
  subScore: 0,
  subTotal: 3,

  reset() {
    this.questions = [];
    this.currentIndex = 0;
    this.score = 0;
    this.selectedAnswer = null;
    this.submitted = false;
    this.subStep = 0;
    this.subScore = 0;
  },

  currentQuestion() {
    return this.questions[this.currentIndex] || null;
  },

  generate(mode) {
    this.mode = mode;
    this.reset();
    switch (mode) {
      case 1: this._genChampionFlashcard(); break;
      case 2: this._genReverseRecall(); break;
      case 3: this._genAugmentIdentifier(); break;
      case 4: this._genReverseAugment(); break;
      case 5: this._genSpotTheError(); break;
    }
    // Cap at totalQuestions
    this.questions = this.questions.slice(0, this.totalQuestions);
  },

  // ── Mode 1: Champion Flashcard ─────────────
  _genChampionFlashcard() {
    const pool = shuffle(DataStore.champions);
    for (const champ of pool) {
      // Build three sub-questions per champion
      const allCosts = [1, 2, 3, 4, 5];
      const costOptions = this._buildOptions(
        String(champ.cost),
        allCosts.filter((c) => c !== champ.cost).map(String),
        3
      );

      const otherTraitSets = DataStore.champions
        .filter((c) => c.name !== champ.name)
        .map((c) => c.traits.join(", "));
      const traitOptions = this._buildOptions(
        champ.traits.join(", "),
        [...new Set(otherTraitSets)],
        3
      );

      const otherSpells = DataStore.champions
        .filter((c) => c.name !== champ.name)
        .map((c) => c.spell.name);
      const spellOptions = this._buildOptions(
        champ.spell.name,
        [...new Set(otherSpells)],
        3
      );

      this.questions.push({
        type: "flashcard",
        champion: champ,
        subs: [
          { prompt: "What is this champion's gold cost?", answer: String(champ.cost), options: costOptions },
          { prompt: "Which traits does this champion have?", answer: champ.traits.join(", "), options: traitOptions },
          { prompt: "What is this champion's spell name?", answer: champ.spell.name, options: spellOptions },
        ],
      });

      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // ── Mode 2: Reverse Recall ─────────────────
  _genReverseRecall() {
    const pool = shuffle(DataStore.champions).filter((c) => c.spell.desc);
    for (const champ of pool) {
      let displayText = resolveSpellText(champ.spell.desc, champ.spell.variables, 1);
      if (displayText.length < 15) continue; // skip trivial spells
      const escaped = champ.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const nameRegex = new RegExp(`\\b(?:Mega\\s+)?${escaped}\\w*\\b`, "gi");
      displayText = displayText.replace(nameRegex, "......");

      const otherNames = DataStore.champions
        .filter((c) => c.name !== champ.name)
        .map((c) => c.name);
      this.questions.push({
        type: "reverse-recall",
        spellText: displayText,
        spellName: champ.spell.name,
        answer: champ.name,
        options: this._buildOptions(champ.name, [...new Set(otherNames)], 3),
      });
      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // ── Mode 3: Augment Identifier ─────────────
  _genAugmentIdentifier() {
    const pool = shuffle(DataStore.augments).filter((a) => a.desc.length > 20);
    for (const aug of pool) {
      const otherDescs = DataStore.augments
        .filter((a) => a.name !== aug.name && a.desc.length > 20)
        .map((a) => a.desc);
      this.questions.push({
        type: "augment-id",
        augmentName: aug.name,
        answer: aug.desc,
        options: this._buildOptions(aug.desc, [...new Set(otherDescs)], 3),
      });
      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // ── Mode 4: Reverse Augment ────────────────
  _genReverseAugment() {
    const pool = shuffle(DataStore.augments).filter((a) => a.desc.length > 20);
    for (const aug of pool) {
      const otherNames = DataStore.augments
        .filter((a) => a.name !== aug.name)
        .map((a) => a.name);
      this.questions.push({
        type: "reverse-augment",
        augmentDesc: aug.desc,
        answer: aug.name,
        options: this._buildOptions(aug.name, [...new Set(otherNames)], 3),
      });
      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // ── Mode 5: Spot the Error ─────────────────
  _genSpotTheError() {
    const pool = shuffle(DataStore.champions).filter(
      (c) => c.spell && c.spell.desc && c.spell.desc.length > 20
    );

    // ── Keyword swap rules ──
    const swapRules = [
      {
        regex: /\bmagic damage\b/gi,
        real: "magic damage",
        replacements: ["physical damage", "true damage"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'magic damage'.`,
      },
      {
        regex: /\bphysical damage\b/gi,
        real: "physical damage",
        replacements: ["magic damage", "true damage"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'physical damage'.`,
      },
      {
        regex: /\btrue damage\b/gi,
        real: "true damage",
        replacements: ["magic damage", "physical damage"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'true damage'.`,
      },
      {
        regex: /\bArmor\b/g,
        real: "Armor",
        replacements: ["Magic Resist", "Health", "Attack Speed"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Armor'.`,
      },
      {
        regex: /\bMagic Resist\b/gi,
        real: "Magic Resist",
        replacements: ["Armor", "Health", "Attack Speed"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Magic Resist'.`,
      },
      {
        regex: /\bAttack Speed\b/gi,
        real: "Attack Speed",
        replacements: ["Ability Power", "Movement Speed", "Shield"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Attack Speed'.`,
      },
      {
        regex: /\bAbility Power\b/gi,
        real: "Ability Power",
        replacements: ["Attack Speed", "Attack Damage"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Ability Power'.`,
      },
      {
        regex: /\bAttack Damage\b/gi,
        real: "Attack Damage",
        replacements: ["Ability Power", "Armor"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Attack Damage'.`,
      },
      {
        regex: /\bShield(s)?\b/gi,
        real: "Shield",
        replacements: ["Attack Speed", "Heal", "Omnivamp"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Shield'.`,
      },
      {
        regex: /\bStun(s)?\b/gi,
        real: "Stun",
        replacements: ["Silence", "Disarm", "Chill"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Stun'.`,
      },
      {
        regex: /\bWound(s)?\b/gi,
        real: "Wound",
        replacements: ["Burn", "Sunder"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Wound'.`,
      },
      {
        regex: /\bBurn(s)?\b/gi,
        real: "Burn",
        replacements: ["Wound", "Sunder"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Burn'.`,
      },
      {
        regex: /\bhex(es)?\b/gi,
        real: "Hexes",
        replacements: ["Rows", "Columns"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Hexes'.`,
      },
      {
        regex: /\bSilence(s|d)?\b/gi,
        real: "Silence",
        replacements: ["Stun", "Disarm", "Chill"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Silence'.`,
      },
      {
        regex: /\bDisarm(s|ed)?\b/gi,
        real: "Disarm",
        replacements: ["Stun", "Silence", "Chill"],
        makeExplanation: (fake) => `This sentence was altered — '${fake}' should be 'Disarm'.`,
      },
    ];

    for (const champ of pool) {
      if (!champ.spell || !champ.spell.desc) continue;

      // ── 1. Sentence-Level Splitting ──
      // Clean the champ.spell.desc (remove %i:...% and HTML tags)
      let cleanDesc = (champ.spell.desc || "")
        .replace(/%i:[^%]+%/g, "")
        .replace(/<br\s*\/?>/gi, ". ")
        .replace(/\\n/g, ". ")
        .replace(/[\r\n]+/g, ". ");

      // Resolve @Var@ placeholders into readable values
      cleanDesc = cleanDesc.replace(/@([^@]+)@/g, (_, raw) => {
        if (raw.includes(".") && raw.includes("TFT")) return "";
        const parts = raw.split("*");
        const varName = parts[0].trim();
        let multiplier = 1;
        if (parts.length > 1) {
          const m = parseFloat(parts[1]);
          if (!isNaN(m)) multiplier = m;
        }
        const cleanVar = varName.replace(/[{}\s_]/g, "").toLowerCase();
        const vars = champ.spell.variables || {};
        const key = Object.keys(vars).find(
          (k) =>
            k.toLowerCase() === varName.toLowerCase() ||
            k.replace(/[{}\s_]/g, "").toLowerCase() === cleanVar
        );
        if (!key || !vars[key]) return "X";
        const vals = vars[key];
        let val = Array.isArray(vals) ? (vals[1] ?? vals[0] ?? 0) : vals;
        val *= multiplier;
        if (Number.isFinite(val)) {
          return val === Math.floor(val)
            ? String(Math.floor(val))
            : val.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
        }
        return String(val);
      });

      // Strip remaining HTML tags
      cleanDesc = cleanDesc.replace(/<[^>]+>/g, " ");

      // Split the entire description by periods
      let sentences = cleanDesc
        .split(/\.\s+/)
        .map((s) => s.replace(/\s+/g, " ").replace(/\.+$/, "").trim())
        .filter((s) => s.length > 3 && !/^[:\-–—\s]+$/.test(s));

      // Need at least 2 real sentences
      if (sentences.length < 2) continue;

      // ── 2. The Corruption Logic ──
      // Check which sentences contain swappable keywords
      const swappableSentences = [];
      for (let si = 0; si < sentences.length; si++) {
        for (const rule of swapRules) {
          rule.regex.lastIndex = 0;
          if (rule.regex.test(sentences[si])) {
            swappableSentences.push({ sentenceIdx: si, rule });
          }
        }
      }

      // Randomly choose to either Inject a Fake Clause OR Mutate an Existing Sentence
      const canMutate = swappableSentences.length > 0;
      const doInject = !canMutate || Math.random() < 0.5;

      let corruptedIndex = -1;
      let explanation = "";

      if (doInject) {
        // If Injecting: Pick a random authentic sentence from a different champion in DataStore.champions
        let pickedSentence = "";
        let fakeOriginChamp = "";

        const otherPool = shuffle(
          DataStore.champions.filter(
            (c) => c.name !== champ.name && c.spell && c.spell.desc && c.spell.desc.length > 20
          )
        );

        for (const other of otherPool) {
          let oClean = (other.spell.desc || "")
            .replace(/%i:[^%]+%/g, "")
            .replace(/<br\s*\/?>/gi, ". ")
            .replace(/\\n/g, ". ")
            .replace(/[\r\n]+/g, ". ")
            .replace(/<[^>]+>/g, " ")
            .replace(/@([^@]+)@/g, "X");

          const otherSentences = oClean
            .split(/\.\s+/)
            .map((s) => s.replace(/\s+/g, " ").replace(/\.+$/, "").trim())
            .filter((s) => s.length > 15 && !s.toLowerCase().includes(other.name.toLowerCase()));

          if (otherSentences.length > 0) {
            pickedSentence = otherSentences[Math.floor(Math.random() * otherSentences.length)];
            fakeOriginChamp = other.name;
            break;
          }
        }

        if (!pickedSentence) {
          pickedSentence = "Also Stuns all enemies hit for 1.5 seconds";
        }

        const insertIdx = Math.floor(Math.random() * (sentences.length + 1));
        sentences.splice(insertIdx, 0, pickedSentence);
        corruptedIndex = insertIdx;
        explanation = fakeOriginChamp
          ? `This sentence belongs to ${fakeOriginChamp} — ${champ.name}'s ability does not contain this effect.`
          : `This sentence was fabricated — ${champ.name}'s ability does not contain this effect.`;

      } else {
        // If Mutating: Pick a random sentence already in the array and swap a keyword inside it
        const pick = swappableSentences[Math.floor(Math.random() * swappableSentences.length)];
        const rule = pick.rule;
        const fake = rule.replacements[Math.floor(Math.random() * rule.replacements.length)];

        rule.regex.lastIndex = 0;
        sentences[pick.sentenceIdx] = sentences[pick.sentenceIdx].replace(rule.regex, fake);
        corruptedIndex = pick.sentenceIdx;
        explanation = rule.makeExplanation(fake);
      }

      // Safety check
      if (corruptedIndex < 0 || corruptedIndex >= sentences.length) continue;

      // ── 3. Wrap Full Sentences ONLY ──
      let htmlDesc = sentences.map((s, i) => {
        let isError = (i === corruptedIndex);
        let cleanS = s.replace(/\.+$/, "");
        return `<span class="spot-phrase" data-id="${i}" data-is-error="${isError}">${escapeHtml(cleanS)}.</span>`;
      }).join(" ");

      this.questions.push({
        type: "spot-error",
        champion: champ,
        renderedHtml: htmlDesc,
        explanation: explanation,
      });

      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // Helper: build an array of 4 options (1 correct + 3 distractors), shuffled
  _buildOptions(correct, distractorPool, count) {
    const distractors = pick(
      distractorPool.filter((d) => d !== correct),
      count
    );
    return shuffle([correct, ...distractors]);
  },
};

// ──────────────────────────────────────────────
// UIController — all DOM manipulation
// ──────────────────────────────────────────────
const UI = {
  // Cached DOM elements
  el: {},

  init() {
    this.el = {
      loading:      document.getElementById("loading-screen"),
      app:          document.getElementById("app"),
      btnHome:      document.getElementById("btn-home"),
      scoreDisplay: document.getElementById("score-display"),
      scoreCurrent: document.getElementById("score-current"),
      scoreTotal:   document.getElementById("score-total"),
      screenHome:   document.getElementById("screen-home"),
      screenQuiz:   document.getElementById("screen-quiz"),
      screenResults:document.getElementById("screen-results"),
      progressBar:  document.getElementById("progress-bar"),
      quizCard:     document.getElementById("quiz-card"),
      btnSubmit:    document.getElementById("btn-submit"),
      btnNext:      document.getElementById("btn-next"),
      resultsScore: document.getElementById("results-score"),
      resultsTotal: document.getElementById("results-total"),
      resultsMsg:   document.getElementById("results-message"),
      ringProgress: document.getElementById("ring-progress"),
      btnPlayAgain: document.getElementById("btn-play-again"),
      btnGoHome:    document.getElementById("btn-go-home"),
    };

    // ── Event listeners ──
    // Mode selection
    document.querySelectorAll(".mode-card").forEach((card) => {
      card.addEventListener("click", () => {
        const mode = parseInt(card.dataset.mode, 10);
        this.startQuiz(mode);
      });
    });

    this.el.btnHome.addEventListener("click", () => this.showHome());
    this.el.btnSubmit.addEventListener("click", () => this.handleSubmit());
    this.el.btnNext.addEventListener("click", () => this.handleNext());
    this.el.btnPlayAgain.addEventListener("click", () => this.startQuiz(QuizEngine.mode));
    this.el.btnGoHome.addEventListener("click", () => this.showHome());
  },

  // ── Screen transitions ──────────────────────
  showHome() {
    this.el.screenHome.classList.remove("hidden");
    this.el.screenQuiz.classList.add("hidden");
    this.el.screenResults.classList.add("hidden");
    this.el.btnHome.style.display = "none";
    this.el.scoreDisplay.style.display = "none";
  },

  showQuiz() {
    this.el.screenHome.classList.add("hidden");
    this.el.screenQuiz.classList.remove("hidden");
    this.el.screenResults.classList.add("hidden");
    this.el.btnHome.style.display = "flex";
    this.el.scoreDisplay.style.display = "block";
  },

  showResults() {
    this.el.screenHome.classList.add("hidden");
    this.el.screenQuiz.classList.add("hidden");
    this.el.screenResults.classList.remove("hidden");
    this.el.btnHome.style.display = "none";
    this.el.scoreDisplay.style.display = "none";

    const total = QuizEngine.totalQuestions;
    const score = QuizEngine.score;
    const pct = score / total;

    this.el.resultsScore.textContent = score;
    this.el.resultsTotal.textContent = `/${total}`;

    // Animate ring
    const circumference = 2 * Math.PI * 52; // r=52
    const offset = circumference * (1 - pct);

    // Add SVG gradient definition if missing
    const svg = this.el.ringProgress.closest("svg");
    if (!svg.querySelector("#ring-grad")) {
      const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
      defs.innerHTML = `<linearGradient id="ring-grad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#fbbd23"/>
        <stop offset="100%" stop-color="#d97706"/>
      </linearGradient>`;
      svg.prepend(defs);
    }

    this.el.ringProgress.style.strokeDashoffset = circumference;
    requestAnimationFrame(() => {
      this.el.ringProgress.style.strokeDashoffset = offset;
    });

    // Message
    if (pct >= 0.9) this.el.resultsMsg.textContent = "Miraculous! A TFT player who can actually read! 🏆";
    else if (pct >= 0.7) this.el.resultsMsg.textContent = "Impressive reading comprehension! Mortdog would be proud.";
    else if (pct >= 0.5) this.el.resultsMsg.textContent = "Average TFT player — skimmed the tooltip and prayed for a top 4.";
    else this.el.resultsMsg.textContent = "Illiterate fast-8 enjoyer detected. Back to reading kindergarten!";
  },

  // ── Quiz flow ────────────────────────────────
  startQuiz(mode) {
    QuizEngine.generate(mode);
    if (QuizEngine.questions.length === 0) {
      alert("Not enough data for this quiz mode. Try running the pipeline first.");
      return;
    }
    QuizEngine.totalQuestions = Math.min(QuizEngine.totalQuestions, QuizEngine.questions.length);
    this.el.scoreTotal.textContent = QuizEngine.totalQuestions;
    this.el.scoreCurrent.textContent = "0";
    this.showQuiz();
    this.renderQuestion();
  },

  renderQuestion() {
    const q = QuizEngine.currentQuestion();
    if (!q) { this.showResults(); return; }

    QuizEngine.selectedAnswer = null;
    QuizEngine.submitted = false;
    this.el.btnSubmit.disabled = true;
    this.el.btnSubmit.classList.remove("hidden");
    this.el.btnNext.classList.add("hidden");

    // Progress
    const pct = (QuizEngine.currentIndex / QuizEngine.totalQuestions) * 100;
    this.el.progressBar.style.width = pct + "%";

    // Render by type
    switch (q.type) {
      case "flashcard":     this._renderFlashcard(q); break;
      case "reverse-recall":this._renderReverseRecall(q); break;
      case "augment-id":    this._renderAugmentId(q); break;
      case "reverse-augment":this._renderReverseAugment(q); break;
      case "spot-error":    this._renderSpotError(q); break;
    }
  },

  // ── Renderers ────────────────────────────────
  _renderFlashcard(q) {
    QuizEngine.subStep = 0;
    QuizEngine.subScore = 0;
    this._renderFlashcardSub(q);
  },

  _renderFlashcardSub(q) {
    const champ = q.champion;
    const sub = q.subs[QuizEngine.subStep];
    const card = this.el.quizCard;

    // Reset per sub-question
    QuizEngine.selectedAnswer = null;
    QuizEngine.submitted = false;
    this.el.btnSubmit.disabled = true;
    this.el.btnSubmit.classList.remove("hidden");
    this.el.btnNext.classList.add("hidden");

    card.innerHTML = `
      <div class="sub-step-indicator">
        ${q.subs.map((_, i) => `<div class="sub-dot ${i < QuizEngine.subStep ? "done" : ""} ${i === QuizEngine.subStep ? "active" : ""}"></div>`).join("")}
      </div>
      <div class="champion-img-wrap">
        <img src="${champ.icon}" alt="${this._escapeAttr(champ.name)}" onerror="this.style.display='none'; const fb = this.nextElementSibling; fb.style.display='flex'; fb.textContent = this.alt;">
        <div class="img-fallback" style="display:none; font-size:0.95rem; font-weight:700; text-align:center; padding:8px; line-height:1.2; word-break:break-word; color:var(--text-primary);">${this._escapeAttr(champ.name)}</div>
      </div>
      <p class="question-label">Champion Flashcard — Step ${QuizEngine.subStep + 1}/3</p>
      <p class="question-prompt">${sub.prompt}</p>
      <div class="options-list">
        ${sub.options.map((opt, i) => `<button class="option-btn" data-idx="${i}" data-value="${this._escapeAttr(opt)}">${opt}</button>`).join("")}
      </div>
    `;
    this._attachOptionListeners();
  },

  _renderReverseRecall(q) {
    const card = this.el.quizCard;
    card.innerHTML = `
      <p class="question-label">Reverse Recall</p>
      <div class="spell-text-box">${q.spellText}</div>
      <p class="question-prompt">Which champion has this ability?</p>
      <div class="options-list">
        ${q.options.map((opt, i) => `<button class="option-btn" data-idx="${i}" data-value="${this._escapeAttr(opt)}">${opt}</button>`).join("")}
      </div>
    `;
    this._attachOptionListeners();
  },

  _renderAugmentId(q) {
    const card = this.el.quizCard;
    card.innerHTML = `
      <p class="question-label">Augment Identifier</p>
      <p class="question-prompt" style="font-size:1.4rem;margin-bottom:28px;">${q.augmentName}</p>
      <p style="color:var(--text-secondary);font-size:0.9rem;margin-bottom:18px;">Which description matches this augment?</p>
      <div class="options-list">
        ${q.options.map((opt, i) => `<button class="option-btn" data-idx="${i}" data-value="${this._escapeAttr(opt)}">${this._truncate(opt, 160)}</button>`).join("")}
      </div>
    `;
    this._attachOptionListeners();
  },

  _renderReverseAugment(q) {
    const card = this.el.quizCard;
    card.innerHTML = `
      <p class="question-label">Reverse Augment</p>
      <div class="spell-text-box">${q.augmentDesc}</div>
      <p class="question-prompt">Which augment has this description?</p>
      <div class="options-list">
        ${q.options.map((opt, i) => `<button class="option-btn" data-idx="${i}" data-value="${this._escapeAttr(opt)}">${opt}</button>`).join("")}
      </div>
    `;
    this._attachOptionListeners();
  },

  _renderSpotError(q) {
    const champ = q.champion;
    const card = this.el.quizCard;

    card.innerHTML = `
      <p class="question-label">Spot the Error</p>
      <div class="champion-header" style="display:flex; align-items:center; gap:16px; margin-bottom:18px;">
        <div class="champion-img-wrap" style="width:68px; height:68px; margin:0; flex-shrink:0;">
          <img src="${champ.icon}" alt="${this._escapeAttr(champ.name)}" onerror="this.style.display='none'; const fb = this.nextElementSibling; fb.style.display='flex'; fb.textContent = this.alt;">
          <div class="img-fallback" style="display:none; font-size:0.8rem; font-weight:700; text-align:center; padding:4px; line-height:1.1; word-break:break-word; color:var(--text-primary);">${this._escapeAttr(champ.name)}</div>
        </div>
        <div>
          <h3 style="font-size:1.3rem; font-weight:700; color:var(--text-primary); margin-bottom:3px;">${champ.name}</h3>
          <p style="font-size:0.88rem; color:var(--accent-primary); font-weight:500;">${champ.spell.name || "Ability"}</p>
        </div>
      </div>
      <div class="spell-text-box spot-error-box">${q.renderedHtml}</div>
      <p class="question-prompt">One of these sentences is wrong. Click the sentence that contains the error:</p>
    `;

    card.querySelectorAll(".spot-phrase").forEach((span) => {
      span.addEventListener("click", () => {
        if (QuizEngine.submitted) return;
        card.querySelectorAll(".spot-phrase.selected").forEach((s) => s.classList.remove("selected"));
        span.classList.add("selected");
        QuizEngine.selectedAnswer = span.dataset.id;
        this.el.btnSubmit.disabled = false;
      });
    });
  },

  // ── Submit / Next handlers ───────────────────
  handleSubmit() {
    if (QuizEngine.submitted || QuizEngine.selectedAnswer === null) return;
    QuizEngine.submitted = true;

    const q = QuizEngine.currentQuestion();

    if (q.type === "flashcard") {
      this._submitFlashcardSub(q);
      return;
    }

    if (q.type === "spot-error") {
      this._submitSpotError(q);
      return;
    }

    // Standard 4-option question
    const correct = q.answer;
    const userPick = QuizEngine.selectedAnswer;
    const isCorrect = userPick === correct;
    if (isCorrect) QuizEngine.score++;
    this.el.scoreCurrent.textContent = QuizEngine.score;

    // Reveal
    this.el.quizCard.querySelectorAll(".option-btn").forEach((btn) => {
      btn.classList.add("locked");
      const val = btn.dataset.value;
      if (val === correct) {
        btn.classList.add("correct");
      } else if (val === userPick) {
        btn.classList.add("incorrect");
      } else {
        btn.classList.add("dimmed");
      }
    });

    this._showFeedback(isCorrect, isCorrect ? null : `Correct answer: ${this._truncate(correct, 100)}`);
    this.el.btnSubmit.classList.add("hidden");
    this.el.btnNext.classList.remove("hidden");
  },

  _submitFlashcardSub(q) {
    const sub = q.subs[QuizEngine.subStep];
    const correct = sub.answer;
    const userPick = QuizEngine.selectedAnswer;
    const isCorrect = userPick === correct;
    if (isCorrect) QuizEngine.subScore++;

    // Reveal
    this.el.quizCard.querySelectorAll(".option-btn").forEach((btn) => {
      btn.classList.add("locked");
      const val = btn.dataset.value;
      if (val === correct) btn.classList.add("correct");
      else if (val === userPick) btn.classList.add("incorrect");
      else btn.classList.add("dimmed");
    });

    this._showFeedback(isCorrect, isCorrect ? null : `Correct: ${correct}`);

    // After short delay, move to next sub or finish
    this.el.btnSubmit.classList.add("hidden");

    if (QuizEngine.subStep < 2) {
      // More sub-questions
      const nextBtn = document.createElement("button");
      nextBtn.className = "btn btn-next";
      nextBtn.textContent = `Next (Step ${QuizEngine.subStep + 2}/3)`;
      nextBtn.addEventListener("click", () => {
        QuizEngine.subStep++;
        QuizEngine.submitted = false;
        QuizEngine.selectedAnswer = null;
        this._renderFlashcardSub(q);
      });
      this.el.quizCard.appendChild(nextBtn);
    } else {
      // All subs done — award 1 point if all 3 correct
      if (QuizEngine.subScore === 3) QuizEngine.score++;
      this.el.scoreCurrent.textContent = QuizEngine.score;
      this.el.btnNext.classList.remove("hidden");
    }
  },

  _submitSpotError(q) {
    const card = this.el.quizCard;
    const selectedSpan = card.querySelector(`.spot-phrase.selected`);
    if (!selectedSpan) return;

    const isCorrect = selectedSpan.dataset.isError === "true";
    if (isCorrect) QuizEngine.score++;
    this.el.scoreCurrent.textContent = QuizEngine.score;

    // Lock all spans: highlight correct, dim innocents
    card.querySelectorAll(".spot-phrase").forEach((span) => {
      span.classList.add("locked");
      if (span.dataset.isError === "true") {
        span.classList.add("correct");
      } else if (span !== selectedSpan) {
        span.classList.add("dimmed");
      }
    });

    if (!isCorrect) {
      selectedSpan.classList.add("incorrect");
    }

    this._showFeedback(isCorrect, q.explanation);
    this.el.btnSubmit.classList.add("hidden");
    this.el.btnNext.classList.remove("hidden");
  },

  handleNext() {
    QuizEngine.currentIndex++;
    if (QuizEngine.currentIndex >= QuizEngine.totalQuestions) {
      this.showResults();
    } else {
      this.renderQuestion();
    }
  },

  // ── Helpers ──────────────────────────────────
  _attachOptionListeners() {
    this.el.quizCard.querySelectorAll(".option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (QuizEngine.submitted) return;
        // Deselect all
        this.el.quizCard.querySelectorAll(".option-btn.selected").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        QuizEngine.selectedAnswer = btn.dataset.value;
        this.el.btnSubmit.disabled = false;
      });
    });
  },

  _showFeedback(isCorrect, correction) {
    const label = document.createElement("div");
    label.className = `feedback-label ${isCorrect ? "correct-label" : "incorrect-label"}`;
    label.textContent = isCorrect ? "Correct!" : "Incorrect";
    if (correction) {
      const span = document.createElement("span");
      span.className = "correction-text";
      span.textContent = correction;
      label.appendChild(span);
    }
    this.el.quizCard.appendChild(label);
  },

  _escapeAttr(str) {
    return str.replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  },

  _truncate(str, max) {
    return str.length > max ? str.slice(0, max) + "..." : str;
  },

  hideLoading() {
    this.el.loading.classList.add("fade-out");
    setTimeout(() => {
      this.el.loading.style.display = "none";
      this.el.app.classList.remove("hidden");
    }, 500);
  },
};

// ──────────────────────────────────────────────
// Boot
// ──────────────────────────────────────────────
(async function boot() {
  try {
    await DataStore.load();
    UI.init();
    UI.hideLoading();
  } catch (err) {
    console.error("Boot failed:", err);
    document.getElementById("loading-screen").innerHTML = `
      <p style="color:#ef4444;font-family:var(--font);text-align:center;">
        Failed to load TFT data.<br>
        <small style="color:#8b92b3;">Make sure data.json exists in the same directory.</small>
      </p>`;
  }
})();
