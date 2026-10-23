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

    // ── Expanded fake-clause pool (16 entries) ──
    const fakeClauses = [
      { clause: "Also Stuns all enemies hit for 1.5 seconds.", explanation: "This ability does not Stun enemies." },
      { clause: "Executes enemies below 15% Health.", explanation: "This ability does not execute enemies." },
      { clause: "Grants 30 Armor and Magic Resist for 4 seconds.", explanation: "This ability does not grant Armor and Magic Resist." },
      { clause: "Adjacent allies gain 25% Attack Speed for 5 seconds.", explanation: "This ability does not grant Attack Speed to allies." },
      { clause: "Permanently gains 10 Ability Power on takedown.", explanation: "This ability does not gain Ability Power on takedown." },
      { clause: "Cleanses all crowd control effects on cast.", explanation: "This ability does not cleanse crowd control effects." },
      { clause: "Heals the lowest Health ally for 250 Health.", explanation: "This ability does not heal allies." },
      { clause: "Shields the 2 lowest Health allies for 200 for 4 seconds.", explanation: "This ability does not shield allies." },
      { clause: "Also Sunders enemies for 3 seconds.", explanation: "This ability does not Sunder enemies." },
      { clause: "Heals the lowest health ally for 200.", explanation: "This ability does not heal the lowest health ally." },
      { clause: "Grants 50% Dodge chance for 2 seconds.", explanation: "This ability does not grant Dodge chance." },
      { clause: "Executes enemies below 10% Health.", explanation: "This ability does not execute low-health enemies." },
      { clause: "Adjacent allies gain 20% Attack Speed.", explanation: "This ability does not buff adjacent allies' Attack Speed." },
      { clause: "Shields the lowest health ally for 150.", explanation: "This ability does not shield the lowest health ally." },
      { clause: "Deals 10% bonus damage to shielded targets.", explanation: "This ability does not deal bonus damage to shielded targets." },
      { clause: "Reduces the target's Armor by 40% for 3 seconds.", explanation: "This ability does not reduce Armor." },
    ];

    // ── Expanded swap rules with deeper replacement pools ──
    const swapRules = [
      {
        regex: /\bmagic damage\b/gi,
        real: "magic damage",
        replacements: ["physical damage", "true damage"],
        makeExplanation: (fake) => `Deals '${fake}' — the real ability deals magic damage`,
      },
      {
        regex: /\bphysical damage\b/gi,
        real: "physical damage",
        replacements: ["magic damage", "true damage"],
        makeExplanation: (fake) => `Deals '${fake}' — the real ability deals physical damage`,
      },
      {
        regex: /\btrue damage\b/gi,
        real: "true damage",
        replacements: ["magic damage", "physical damage"],
        makeExplanation: (fake) => `Deals '${fake}' — the real ability deals true damage`,
      },
      {
        regex: /\bArmor\b/g,
        real: "Armor",
        replacements: ["Magic Resist", "Health", "Attack Speed"],
        makeExplanation: (fake) => `Stat altered to '${fake}' — the real ability affects Armor`,
      },
      {
        regex: /\bMagic Resist\b/gi,
        real: "Magic Resist",
        replacements: ["Armor", "Health", "Attack Speed"],
        makeExplanation: (fake) => `Stat altered to '${fake}' — the real ability affects Magic Resist`,
      },
      {
        regex: /\bAttack Speed\b/gi,
        real: "Attack Speed",
        replacements: ["Ability Power", "Movement Speed"],
        makeExplanation: (fake) => `Grants '${fake}' — the real ability affects Attack Speed`,
      },
      {
        regex: /\bAbility Power\b/gi,
        real: "Ability Power",
        replacements: ["Attack Speed", "Attack Damage"],
        makeExplanation: (fake) => `Grants '${fake}' — the real ability affects Ability Power`,
      },
      {
        regex: /\bStun(s)?\b/gi,
        real: "Stun",
        replacements: ["Silence", "Disarm", "Chill"],
        makeExplanation: (fake) => `Inflicts '${fake}' — the real ability inflicts Stun`,
      },
      {
        regex: /\bStunning\b/gi,
        real: "Stunning",
        replacements: ["Silencing", "Disarming", "Chilling"],
        makeExplanation: (fake) => `Status altered to '${fake}' — the real ability is Stunning`,
      },
      {
        regex: /\bWound(s)?\b/gi,
        real: "Wound",
        replacements: ["Burn", "Sunder"],
        makeExplanation: (fake) => `Applies '${fake}' — the real ability applies Wound`,
      },
      {
        regex: /\bBurn(s)?\b/gi,
        real: "Burn",
        replacements: ["Wound", "Sunder"],
        makeExplanation: (fake) => `Applies '${fake}' — the real ability applies Burn`,
      },
      {
        regex: /\bShield(s)?\b/gi,
        real: "Shield",
        replacements: ["Heal", "Omnivamp"],
        makeExplanation: (fake) => `Changed to '${fake}' — the real ability uses Shield`,
      },
      {
        regex: /\bhex(es)?\b/gi,
        real: "Hexes",
        replacements: ["Rows", "Columns"],
        makeExplanation: (fake) => `Area changed to '${fake}' — the real ability targets Hexes`,
      },
      {
        regex: /\bAttack Damage\b/gi,
        real: "Attack Damage",
        replacements: ["Ability Power", "Armor"],
        makeExplanation: (fake) => `Stat altered to '${fake}' — the real ability affects Attack Damage`,
      },
      {
        regex: /\bSilence(s|d)?\b/gi,
        real: "Silence",
        replacements: ["Stun", "Disarm", "Chill"],
        makeExplanation: (fake) => `Inflicts '${fake}' — the real ability inflicts Silence`,
      },
      {
        regex: /\bDisarm(s|ed)?\b/gi,
        real: "Disarm",
        replacements: ["Stun", "Silence", "Chill"],
        makeExplanation: (fake) => `Inflicts '${fake}' — the real ability inflicts Disarm`,
      },
    ];

    const numRegex = /\b(\d+(?:\.\d+)?)\s*(seconds?|hexes?|hex|attacks?|targets?|allies|enemies)\b/gi;
    const innocentPattern = /\b(magic damage|physical damage|true damage|Armor|Magic Resist|Attack Speed|Ability Power|Attack Damage|Health|Mana|Stuns?|Stunning|Silence|Silences|Disarms?|Wounds?|Burns?|Shields?|Heals?|Omnivamp|Sunder|Chill|\d+(?:\.\d+)?\s*(?:seconds?|hexes?|hex|attacks?|targets?|allies|enemies))\b/gi;

    for (const champ of pool) {
      const baseText = resolveSpellText(champ.spell.desc, champ.spell.variables, 1);
      if (!baseText || baseText.length < 25) continue;

      // Find keyword swap candidates
      const matchedSwaps = [];
      for (const rule of swapRules) {
        rule.regex.lastIndex = 0;
        let m;
        while ((m = rule.regex.exec(baseText)) !== null) {
          matchedSwaps.push({
            rule,
            index: m.index,
            length: m[0].length,
            matchedText: m[0],
          });
        }
      }

      // Find number/duration candidates
      numRegex.lastIndex = 0;
      const numMatches = [];
      let nm;
      while ((nm = numRegex.exec(baseText)) !== null) {
        numMatches.push({
          full: nm[0],
          numStr: nm[1],
          unit: nm[2],
          index: nm.index,
        });
      }

      const availableStrategies = ["inject"];
      if (matchedSwaps.length > 0) availableStrategies.push("swap");
      if (numMatches.length > 0) availableStrategies.push("number");

      const strategy = availableStrategies[Math.floor(Math.random() * availableStrategies.length)];

      let fullCorruptedText = baseText;
      let errorStart = 0;
      let errorEnd = 0;
      let explanation = "";
      let corruptionMeta = null; // Tracks corruption type for smarter distractors

      if (strategy === "swap") {
        const pickedSwap = matchedSwaps[Math.floor(Math.random() * matchedSwaps.length)];
        const fake = pickedSwap.rule.replacements[Math.floor(Math.random() * pickedSwap.rule.replacements.length)];
        fullCorruptedText =
          baseText.slice(0, pickedSwap.index) + fake + baseText.slice(pickedSwap.index + pickedSwap.length);
        errorStart = pickedSwap.index;
        errorEnd = pickedSwap.index + fake.length;
        explanation = pickedSwap.rule.makeExplanation(fake);
        corruptionMeta = { type: "swap", realKeyword: pickedSwap.rule.real, fakeKeyword: fake };
      } else if (strategy === "number") {
        const pickedNum = numMatches[Math.floor(Math.random() * numMatches.length)];
        const val = parseFloat(pickedNum.numStr);
        let fakeVal;
        if (val === 1) fakeVal = 3;
        else if (val === 1.5) fakeVal = 3;
        else if (val === 2) fakeVal = 4;
        else fakeVal = val * 2;

        let fakeUnit = pickedNum.unit;
        if (fakeVal > 1) {
          const u = pickedNum.unit.toLowerCase();
          if (u === "second") fakeUnit = "seconds";
          else if (u === "hex") fakeUnit = "hexes";
          else if (u === "attack") fakeUnit = "attacks";
          else if (u === "target") fakeUnit = "targets";
          else if (u === "ally") fakeUnit = "allies";
          else if (u === "enemy") fakeUnit = "enemies";
        }

        const fakeValStr = Number.isInteger(fakeVal) ? String(fakeVal) : fakeVal.toFixed(1);
        const fakeStr = `${fakeValStr} ${fakeUnit}`;
        const realStr = pickedNum.full;

        fullCorruptedText =
          baseText.slice(0, pickedNum.index) + fakeStr + baseText.slice(pickedNum.index + pickedNum.full.length);
        errorStart = pickedNum.index;
        errorEnd = pickedNum.index + fakeStr.length;
        explanation = `'${fakeStr}' — the real duration/value is ${realStr}`;
        corruptionMeta = { type: "number", fakeStr, realStr };
      } else {
        // Strategy "inject" — insert at a random sentence position
        const eligibleClauses = fakeClauses.filter((fc) => !baseText.includes(fc.clause));
        const pickedClause = eligibleClauses[Math.floor(Math.random() * eligibleClauses.length)] || fakeClauses[0];

        // Split into sentences, splice at random position, rejoin
        const sentences = baseText.split('. ');
        const insertIdx = Math.floor(Math.random() * (sentences.length + 1));
        // Remove trailing period from injected clause to avoid double-period on rejoin
        const cleanClause = pickedClause.clause.replace(/\.\s*$/, '');
        sentences.splice(insertIdx, 0, cleanClause);
        fullCorruptedText = sentences.join('. ');

        // Locate the injected clause in the reassembled text to set error bounds
        const injectedStart = fullCorruptedText.indexOf(cleanClause);
        errorStart = injectedStart >= 0 ? injectedStart : 0;
        errorEnd = errorStart + cleanClause.length;
        explanation = pickedClause.explanation;
        corruptionMeta = { type: "inject", usedClause: pickedClause, allClauses: fakeClauses };
      }

      // Collect innocent candidate phrases in fullCorruptedText
      innocentPattern.lastIndex = 0;
      const innocentRanges = [];
      let im;
      while ((im = innocentPattern.exec(fullCorruptedText)) !== null) {
        const start = im.index;
        const end = start + im[0].length;
        // Don't overlap with the error
        if (end <= errorStart || start >= errorEnd) {
          // Don't overlap with existing innocent ranges
          const overlaps = innocentRanges.some((r) => !(end <= r.start || start >= r.end));
          if (!overlaps) {
            innocentRanges.push({ start, end });
          }
        }
      }

      // Require at least 2 innocent targets to ensure a good quiz question
      if (innocentRanges.length < 2) continue;

      const allRanges = [
        { start: errorStart, end: errorEnd, isError: true },
        ...innocentRanges.map((r) => ({ start: r.start, end: r.end, isError: false })),
      ];
      allRanges.sort((a, b) => a.start - b.start);

      let renderedHtml = "";
      let lastIndex = 0;
      let phraseId = 0;

      for (const r of allRanges) {
        if (r.start > lastIndex) {
          renderedHtml += escapeHtml(fullCorruptedText.slice(lastIndex, r.start));
        }
        const phraseText = fullCorruptedText.slice(r.start, r.end);
        renderedHtml += `<span class="spot-phrase" data-id="${phraseId++}" data-is-error="${r.isError}">${escapeHtml(phraseText)}</span>`;
        lastIndex = r.end;
      }
      if (lastIndex < fullCorruptedText.length) {
        renderedHtml += escapeHtml(fullCorruptedText.slice(lastIndex));
      }

      this.questions.push({
        type: "spot-error",
        champion: champ,
        renderedHtml,
        explanation,
        corruptionMeta,
      });

      if (this.questions.length >= this.totalQuestions) break;
    }
  },

  // ── Generate type-matched distractors for Spot the Error ──
  _buildSpotErrorDistractors(corruptionMeta, count = 3) {
    const distractors = [];

    if (corruptionMeta.type === "swap") {
      // Generate plausible "wrong keyword swap" distractors
      const allKeywords = [
        "magic damage", "physical damage", "true damage",
        "Armor", "Magic Resist", "Health", "Attack Speed",
        "Ability Power", "Attack Damage", "Movement Speed",
        "Stun", "Silence", "Disarm", "Chill",
        "Shield", "Heal", "Omnivamp",
        "Wound", "Burn", "Sunder",
        "Hexes", "Rows", "Columns",
      ];
      const usedReal = corruptionMeta.realKeyword.toLowerCase();
      const usedFake = corruptionMeta.fakeKeyword.toLowerCase();
      // Pick pairs that weren't actually swapped
      const candidates = allKeywords.filter(
        (k) => k.toLowerCase() !== usedReal && k.toLowerCase() !== usedFake
      );
      const pairs = shuffle(candidates);
      for (let i = 0; i + 1 < pairs.length && distractors.length < count; i += 2) {
        distractors.push(`'${pairs[i]}' was swapped — it should say '${pairs[i + 1]}'`);
      }
      // Fill if needed
      while (distractors.length < count) {
        const k = pairs[distractors.length % pairs.length];
        distractors.push(`'${k}' was changed — this keyword is incorrect`);
      }
    } else if (corruptionMeta.type === "inject") {
      // Generate distractors claiming other fake sentences were injected
      const unused = corruptionMeta.allClauses.filter(
        (fc) => fc.clause !== corruptionMeta.usedClause.clause
      );
      const picked = shuffle(unused).slice(0, count);
      for (const fc of picked) {
        distractors.push(fc.explanation);
      }
      // Fill if needed
      while (distractors.length < count) {
        distractors.push("A fake mechanic sentence was added to the description.");
      }
    } else if (corruptionMeta.type === "number") {
      // Generate plausible "wrong number/duration" distractors
      const fakeAlts = [];
      const realVal = parseFloat(corruptionMeta.realStr);
      const mults = [0.5, 1.5, 3, 0.25];
      for (const mult of mults) {
        const alt = realVal * mult;
        const altStr = Number.isInteger(alt) ? String(alt) : alt.toFixed(1);
        // Extract the unit from the real string
        const unitMatch = corruptionMeta.realStr.match(/\d[\d.]*\s*(.*)/);
        const unit = unitMatch ? unitMatch[1] : "seconds";
        fakeAlts.push(`'${altStr} ${unit}' — the value was altered`);
      }
      const shuffled = shuffle(fakeAlts);
      for (let i = 0; i < count && i < shuffled.length; i++) {
        distractors.push(shuffled[i]);
      }
      while (distractors.length < count) {
        distractors.push("A numeric value in the description is incorrect.");
      }
    }

    return distractors.slice(0, count);
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
      <div class="spell-text-box">${q.renderedHtml}</div>
      <p class="question-prompt">Click directly on the error or fabricated mechanic in the ability text above:</p>
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

    // Lock all spans and highlight the correct error span
    card.querySelectorAll(".spot-phrase").forEach((span) => {
      span.classList.add("locked");
      if (span.dataset.isError === "true") {
        span.classList.add("correct");
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
