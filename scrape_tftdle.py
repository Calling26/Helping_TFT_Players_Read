"""
TFTdle Data Scraper
Fetches all historical TFT set champion data from CommunityDragon and writes
frontend/tftdle_champions.json for the TFTdle daily champion-guessing game mode.
"""

import json
import os
import sys
import urllib.request

CDRAGON_URL = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json"
CDRAGON_GAME_BASE = "https://raw.communitydragon.org/latest/game/"
OUTPUT_FILE = os.path.join("frontend", "tftdle_champions.json")

# ---------------------------------------------------------------------------
# Gender mapping (provided by project spec)
# ---------------------------------------------------------------------------
GENDER_MAP = {
    "Aatrox": "Male", "Ahri": "Female", "Akali": "Female", "Akshan": "Male",
    "Alistar": "Male", "Ambessa": "Female", "Amumu": "Male", "Anivia": "Female",
    "Annie": "Female", "Aphelios": "Male", "Ashe": "Female", "Aurelion Sol": "Male",
    "Aurora": "Female", "Azir": "Male", "Bard": "Other", "Bel'Veth": "Female",
    "Blitzcrank": "Other", "Brand": "Male", "Braum": "Male", "Briar": "Female",
    "Caitlyn": "Female", "Camille": "Female", "Cassiopeia": "Female", "Cho'Gath": "Male",
    "Corki": "Male", "Darius": "Male", "Diana": "Female", "Dr. Mundo": "Male",
    "Draven": "Male", "Ekko": "Male", "Elise": "Female", "Evelynn": "Female",
    "Ezreal": "Male", "Fiddlesticks": "Other", "Fiora": "Female", "Fizz": "Male",
    "Galio": "Male", "Gangplank": "Male", "Garen": "Male", "Gnar": "Male",
    "Gragas": "Male", "Graves": "Male", "Gwen": "Female", "Hecarim": "Male",
    "Heimerdinger": "Male", "Hwei": "Male", "Illaoi": "Female", "Irelia": "Female",
    "Ivern": "Male", "Janna": "Female", "Jarvan IV": "Male", "Jax": "Male",
    "Jayce": "Male", "Jhin": "Male", "Jinx": "Female", "K'Sante": "Male",
    "Kai'Sa": "Female", "Kalista": "Female", "Karma": "Female", "Karthus": "Male",
    "Kassadin": "Male", "Katarina": "Female", "Kayle": "Female", "Kayn": "Male",
    "Kennen": "Male", "Kha'Zix": "Male", "Kindred": "Other", "Kled": "Male",
    "Kog'Maw": "Male", "LeBlanc": "Female", "Lee Sin": "Male", "Leona": "Female",
    "Lillia": "Female", "Lissandra": "Female", "Lucian": "Male", "Lulu": "Female",
    "Lux": "Female", "Malphite": "Male", "Malzahar": "Male", "Maokai": "Male",
    "Master Yi": "Male", "Mel": "Female", "Milio": "Male", "Miss Fortune": "Female",
    "Mordekaiser": "Male", "Morgana": "Female", "Naafiri": "Female", "Nami": "Female",
    "Nasus": "Male", "Nautilus": "Male", "Neeko": "Female", "Nidalee": "Female",
    "Nilah": "Female", "Nocturne": "Male", "Nunu & Willump": "Male", "Nunu": "Male",
    "Olaf": "Male", "Orianna": "Female", "Ornn": "Male", "Pantheon": "Male",
    "Poppy": "Female", "Pyke": "Male", "Qiyana": "Female", "Quinn": "Female",
    "Rakan": "Male", "Rammus": "Male", "Rek'Sai": "Female", "Rell": "Female",
    "Renata Glasc": "Female", "Renekton": "Male", "Rengar": "Male", "Riven": "Female",
    "Rumble": "Male", "Ryze": "Male", "Samira": "Female", "Sejuani": "Female",
    "Senna": "Female", "Seraphine": "Female", "Sett": "Male", "Shaco": "Male",
    "Shen": "Male", "Shyvana": "Female", "Singed": "Male", "Sion": "Male",
    "Sivir": "Female", "Skarner": "Male", "Smolder": "Male", "Sona": "Female",
    "Soraka": "Female", "Swain": "Male", "Sylas": "Male", "Syndra": "Female",
    "Tahm Kench": "Male", "Taliyah": "Female", "Talon": "Male", "Taric": "Male",
    "Teemo": "Male", "Thresh": "Male", "Tristana": "Female", "Trundle": "Male",
    "Tryndamere": "Male", "Twisted Fate": "Male", "Twitch": "Male", "Udyr": "Male",
    "Urgot": "Male", "Varus": "Male", "Vayne": "Female", "Veigar": "Male",
    "Vel'Koz": "Male", "Vex": "Female", "Vi": "Female", "Viego": "Male",
    "Viktor": "Male", "Vladimir": "Male", "Volibear": "Male", "Warwick": "Male",
    "Wukong": "Male", "Xayah": "Female", "Xerath": "Male", "Xin Zhao": "Male",
    "Yasuo": "Male", "Yone": "Male", "Yorick": "Male", "Yunara": "Female",
    "Yuumi": "Female", "Zac": "Male", "Zed": "Male", "Zeri": "Female",
    "Ziggs": "Male", "Zilean": "Male", "Zoe": "Female", "Zyra": "Female",
    "Alune": "Female", "Ao Shin": "Male", "Baron Nashor": "Other", "Daeja": "Female",
    "Elder Dragon": "Other", "Idas": "Female", "Kobuko": "Male", "Nomsy": "Male",
    "Norra": "Female", "Norra & Yuumi": "Female", "Poggles": "Other",
    "Shi Oh Yu": "Female", "Silco": "Male", "Sohm": "Female", "Sy'fen": "Male",
    "Terra": "Other", "Zippy": "Male",
}


def get_champion_gender(raw_name: str) -> str:
    clean = raw_name.strip()
    if clean in GENDER_MAP:
        return GENDER_MAP[clean]
    if "&" in clean:
        parts = [p.strip() for p in clean.split("&")]
        genders = {GENDER_MAP.get(p, "Other") for p in parts}
        return genders.pop() if len(genders) == 1 else "Other"
    return "Other"


def normalize_icon(path: str, api_name: str) -> str:
    """Return a full CDragon URL for a champion portrait.

    Preference: squareIcon (square tile) over icon (splash).
    If the path is a hash token (starts with '{'), fall back to a guessed
    URL constructed from the apiName.
    """
    if path and not path.startswith("{"):
        p = path.lower().replace(".tex", ".png").replace(".dds", ".png")
        return CDRAGON_GAME_BASE + p
    # Fallback: construct from apiName
    guessed = "assets/ux/tft/championsplashes/{}_mobile.png".format(api_name.lower())
    return CDRAGON_GAME_BASE + guessed


def build_trait_lookup(set_data: dict) -> dict:
    lookup = {}
    for trait in set_data.get("traits", []):
        api = trait.get("apiName", "")
        name = trait.get("name", "")
        if api and name:
            lookup[api] = name
    return lookup


def parse_set_champions(set_key: str, set_data: dict, trait_lookup: dict) -> list:
    set_num = int(set_key)
    champions = []

    for champ in set_data.get("champions", []):
        api = champ.get("apiName", "")
        if not api:
            continue

        name = (champ.get("name") or "").strip()
        if not name:
            name = api.split("_", 1)[-1] if "_" in api else api

        cost = champ.get("cost", 0)
        if cost < 1:
            continue  # system unit (cost 0 or negative)

        raw_traits = champ.get("traits", [])
        if not raw_traits:
            continue  # skip summons / PvE monsters with no traits

        traits = [
            trait_lookup.get(t, t.split("_", 1)[-1] if "_" in t else t)
            for t in raw_traits
        ]

        stats = champ.get("stats") or {}
        range_val = int(round(stats.get("range") or 1))

        # Icon: squareIcon (tile portrait) preferred; fall back to icon, then guess
        sq = champ.get("squareIcon", "") or ""
        ico = champ.get("icon", "") or ""
        if sq and not sq.startswith("{"):
            image = normalize_icon(sq, api)
        elif ico and not ico.startswith("{"):
            image = normalize_icon(ico, api)
        else:
            image = normalize_icon("", api)

        gender = get_champion_gender(name)

        champions.append({
            "id":     api,
            "name":   name,
            "set":    set_num,
            "cost":   cost,
            "range":  range_val,
            "traits": traits,
            "gender": gender,
            "image":  image,
        })

    return champions


def fetch_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "TFT-Quiz-App/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    print("=" * 55)
    print("  TFTdle Data Scraper")
    print("=" * 55)

    print("\n[1/3] Fetching CommunityDragon data ...")
    try:
        data = fetch_json(CDRAGON_URL)
    except Exception as exc:
        print(f"  FAILED: {exc}")
        sys.exit(1)

    sets = data.get("sets", {})
    num_keys = sorted([k for k in sets.keys() if k.isdigit()], key=int)
    print(f"  OK -- found sets: {num_keys}")

    print("\n[2/3] Parsing champions from all sets ...")
    all_champions = []
    for set_key in num_keys:
        set_data = sets[set_key]
        trait_lookup = build_trait_lookup(set_data)
        champs = parse_set_champions(set_key, set_data, trait_lookup)
        all_champions.extend(champs)
        print(f"  Set {set_key:>2}: {len(champs):>3} champions")

    # De-duplicate by (id, set) in case a champion appears twice in the same set
    seen = set()
    deduped = []
    for c in all_champions:
        key = (c["id"], c["set"])
        if key not in seen:
            seen.add(key)
            deduped.append(c)

    print(f"\n  Total (deduplicated): {len(deduped)} champion entries")

    print("\n[3/3] Writing output ...")
    os.makedirs("frontend", exist_ok=True)
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(deduped, f, indent=2, ensure_ascii=False)
    print(f"  OK -- wrote {OUTPUT_FILE}")

    print("\n" + "=" * 55)
    print("  DONE")
    print("=" * 55)

    if deduped:
        c = deduped[0]
        print(f"\n  Sample: {c['name']} (Set {c['set']}, Cost {c['cost']}, "
              f"Range {c['range']}, {c['gender']})")
        print(f"    Traits: {c['traits']}")
        print(f"    Image:  {c['image'][:80]}")


if __name__ == "__main__":
    main()
