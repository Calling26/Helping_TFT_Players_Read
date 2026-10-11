# Helping TFT Players Read 📖✨

> The ultimate training facility for Teamfight Tactics players who refuse to read patch notes, traits, or champion abilities in-game.

A web-based interactive quiz application with a sleek Gold & Black aesthetic designed to test and sharpen your TFT knowledge across 5 game modes.

### 🌐 Play Live in Browser:
👉 **[https://calling26.github.io/Helping_TFT_Players_Read/](https://calling26.github.io/Helping_TFT_Players_Read/)**

---

## 🎮 Game Modes

1. **⚔️ Champion Flashcard**: View a champion image and recall their gold cost, traits, and ability name across 3 progressive sub-steps.
2. **🔮 Reverse Recall**: Read ability descriptions with redacted champion names and guess which champion possesses that ability.
3. **✨ Augment Identifier**: Read an augment name and identify its exact mechanical description.
4. **🔄 Reverse Augment**: Read an augment effect description and identify its name.
5. **🔍 Spot the Error**: Inspect a champion's ability text containing a fabricated mechanic, swapped keyword, or altered duration/number. Click directly on the error in the text to identify it!

---

## 🚀 Getting Started

### 1. Prerequisites
- Python 3.8+ (for local HTTP server and data pipeline)

### 2. Run Locally
Navigate to the project directory and serve the frontend:

```bash
# Serve the frontend directory
python -m http.server 8000 --directory frontend
```

Open [http://localhost:8000](http://localhost:8000) in your web browser.

### 3. Update Game Data (Optional)
To pull the latest champion, trait, and augment data directly from CommunityDragon:

```bash
python pipeline.py
```

This will automatically fetch, clean developer tags, resolve numbers/variables, and generate `frontend/data.json`.

---

## 🛠️ Tech Stack
- **HTML5 & Vanilla CSS**: Glassmorphism design system, CSS variables, micro-animations, and gold & black theme.
- **Vanilla JavaScript**: State-driven quiz engine, interactive text segment parser, dynamic SVG score rings.
- **Python**: Data fetching and parsing pipeline interfacing with CommunityDragon.
