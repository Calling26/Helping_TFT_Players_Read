# Helping TFT Players Read

> The ultimate training facility for Teamfight Tactics players who refuse to read patch notes, traits, or champion abilities in-game.

A web-based interactive quiz application with a sleek Gold & Black aesthetic designed to test and sharpen your TFT knowledge across 5 game modes.

### Play Live in Browser:
**[https://calling26.github.io/Helping_TFT_Players_Read/](https://calling26.github.io/Helping_TFT_Players_Read/)**

---

## Game Modes

1. **Spot the Error [Popular / Start Here]**: Inspect a champion ability text containing a fabricated mechanic, swapped keyword, or altered effect. Click directly on the incorrect sentence in the text to spot it!
2. **Champion Flashcard**: View a champion portrait and recall their gold cost, traits, and ability name across 3 progressive sub-steps.
3. **Reverse Recall**: Read ability descriptions with redacted champion names and guess which champion possesses that ability.
4. **Augment Identifier**: Read an augment name and identify its exact mechanical description.
5. **Reverse Augment**: Read an augment effect description and identify its name.

---

## Getting Started

### 1. Prerequisites
- Python 3.8+ (for local HTTP server and data pipeline)

### 2. Run Locally
Navigate to the project directory and serve the frontend:

`ash
python -m http.server 8000 --directory frontend
`

Open [http://localhost:8000](http://localhost:8000) in your web browser.

### 3. Update Game Data (Optional)
To pull the latest champion, trait, and augment data directly from CommunityDragon:

`ash
python pipeline.py
`

This will automatically fetch, clean developer tags, resolve numbers/variables, and generate rontend/data.json.

---

## Tech Stack
- **HTML5 & Vanilla CSS**: Glassmorphism design system, CSS variables, micro-animations, and gold & black theme.
- **Vanilla JavaScript**: State-driven quiz engine, interactive text segment parser, dynamic SVG score rings.
- **Python**: Data fetching and parsing pipeline interfacing with CommunityDragon.

---

## Legal & Intellectual Property

Helping TFT Players Read isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.

The open-source software license (MIT) applies solely to the original source code and software architecture created for this project. All TFT splash art, champion icons, spell icons, traits, augments, and related in-game text are copyrighted by Riot Games and provided via the CommunityDragon open-data project.
