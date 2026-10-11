"""
TFT Quiz App — Data Pipeline
Fetches the latest TFT data from CommunityDragon, parses the highest-numbered
set into clean champion / trait / augment records, and writes frontend/data.json.
"""

import json
import os
import re
import sys
import urllib.request

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
CDRAGON_URL = "https://raw.communitydragon.org/latest/cdragon/tft/en_us.json"
CDRAGON_GAME_BASE = "https://raw.communitydragon.org/latest/game/"
OUTPUT_DIR = "frontend"
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "data.json")


# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────
def fetch_json(url: str) -> dict:
    """Fetch JSON from *url*, setting a User-Agent to avoid 403s."""
    req = urllib.request.Request(url, headers={"User-Agent": "TFT-Quiz-App/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def strip_html(text: str) -> str:
    """Remove TFT icon formatting tags (%i:...%), metadata tags ({...}), HTML tags, and collapse whitespace."""
    if not text:
        return ""
    cleaned = re.sub(r"%i:[^%]+%", "", text)
    cleaned = re.sub(r"\{[^}]+\}", "", cleaned)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_icon(path: str) -> str:
    """Convert .tex/.dds → .png and prepend the CDragon game base URL.
    Append .png if path contains a hash { ... } and lacks an image extension."""
    if not path:
        return ""
    if "{" in path and "}" in path and not (path.lower().endswith(".png") or path.lower().endswith(".tex")):
        path = path + ".png"
    path = path.lower().replace(".tex", ".png").replace(".dds", ".png")
    return CDRAGON_GAME_BASE + path


def get_latest_set(data: dict):
    """Return (set_key, set_data) for the highest-numbered set."""
    sets = data.get("sets", {})
    if not sets:
        raise ValueError("No 'sets' key found in CDragon data")
    numeric = []
    for key in sets:
        try:
            numeric.append((int(key), key))
        except ValueError:
            continue
    if not numeric:
        raise ValueError("No numeric set keys found in data")
    numeric.sort(reverse=True)
    best_key = numeric[0][1]
    return best_key, sets[best_key]


# ──────────────────────────────────────────────
# Augment description resolver
# ──────────────────────────────────────────────
def resolve_description(desc: str, effects: dict) -> str:
    """Replace @Variable@ and @Variable*N@ placeholders with values
    from the *effects* map.  Strips HTML afterwards."""
    if not desc:
        return ""

    def _replacer(match):
        raw = match.group(1)

        # Skip runtime property refs like TFTUnitProperty.xxx
        if "." in raw and "TFT" in raw:
            return ""

        # Handle multiplier: @Var*100@
        parts = raw.split("*")
        var_name = parts[0].strip()
        try:
            multiplier = float(parts[1]) if len(parts) > 1 else 1.0
        except ValueError:
            multiplier = 1.0

        # Strip all underscores from both match and keys before comparing (case-insensitive)
        clean_var = var_name.replace("_", "").lower()
        value = None
        for ek, ev in effects.items():
            if ek.replace("_", "").lower() == clean_var:
                value = ev
                break

        if value is None:
            return "X"  # Generic fallback for missing variables

        if isinstance(value, list) and value:
            value = value[0]

        if isinstance(value, (int, float)):
            result = value * multiplier
            # Clean formatting: 40.0 -> 40, 33.3333 -> 33.33
            if result == int(result):
                return str(int(result))
            return f"{result:.2f}".rstrip('0').rstrip('.')
        return str(value)

    resolved = re.sub(r"@([^@]+)@", _replacer, desc)
    return strip_html(resolved)


# ──────────────────────────────────────────────
# Parsers
# ──────────────────────────────────────────────
def parse_traits(set_data: dict):
    """Return (trait_list, apiName→displayName lookup)."""
    trait_list = []
    lookup = {}

    for trait in set_data.get("traits", []):
        api = trait.get("apiName")
        if not api:
            continue
        name = trait.get("name", "")
        if not name:
            name = api.split("_", 1)[-1] if "_" in api else api
        desc = strip_html(trait.get("desc", ""))

        lookup[api] = name
        trait_list.append({
            "apiName": api,
            "name": name,
            "desc": desc,
        })

    return trait_list, lookup


def parse_champions(set_data: dict, trait_lookup: dict):
    """Return a list of champion dicts for the given set."""
    champions = []

    for champ in set_data.get("champions", []):
        api = champ.get("apiName")
        if not api:
            continue

        name = champ.get("name", "")
        if not name:
            name = api.split("_", 1)[-1] if "_" in api else api

        cost = champ.get("cost", 0)
        if cost <= 0:
            continue  # system unit, skip

        # Skip system/summon units that have no traits
        raw_traits = champ.get("traits", [])
        if not raw_traits:
            continue

        # Map trait apiNames -> display names
        traits = [
            trait_lookup.get(t, t.split("_", 1)[-1] if "_" in t else t)
            for t in raw_traits
        ]

        icon = normalize_icon(champ.get("icon", ""))

        # ── Spell / Ability ──
        ability = champ.get("ability", {}) or {}
        spell_name = ability.get("name", "") or "Unknown Ability"
        spell_desc = ability.get("desc", "") or ""
        # Remove TFT inline formatting tags like %i:scaleAP%
        spell_desc = re.sub(r"%i:[^%]+%", "", spell_desc)

        # Variables: list of {"name": str, "value": list}
        # Keep all variables including obfuscated hash names (e.g. {a53b5})
        raw_vars = ability.get("variables", []) or []
        variables = {}
        for v in raw_vars:
            if not isinstance(v, dict):
                continue
            vname = v.get("name", "")
            vvalue = v.get("value")
            if vname:
                if isinstance(vvalue, list):
                    variables[vname] = vvalue
                elif isinstance(vvalue, (int, float)):
                    variables[vname] = [vvalue]

        champions.append({
            "apiName": api,
            "name": name,
            "cost": cost,
            "traits": traits,
            "icon": icon,
            "spell": {
                "name": spell_name,
                "desc": spell_desc,
                "variables": variables,
            },
        })

    return champions


def parse_augments(items: list, set_prefix: str):
    """Filter items where isAugment==True and apiName starts with *set_prefix*."""
    augments = []

    for item in items:
        if not item.get("isAugment", False):
            continue
        api = item.get("apiName")
        if not api:
            continue
        # Only include augments belonging to the current set
        if set_prefix and not api.startswith(set_prefix):
            continue
        name = item.get("name", "")
        if not name:
            continue

        raw_desc = item.get("desc", "")
        effects = item.get("effects", {}) or {}
        desc = resolve_description(raw_desc, effects)

        icon = normalize_icon(item.get("icon", ""))

        augments.append({
            "apiName": api,
            "name": name,
            "desc": desc,
            "icon": icon,
        })

    return augments


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────
def _derive_set_prefix(set_key: str, set_data: dict) -> str:
    """Guess the apiName prefix for the current set by inspecting champion
    apiNames.  Falls back to 'TFT{set_key}' or 'DA' patterns."""
    from collections import Counter
    prefixes = Counter()
    for champ in set_data.get("champions", []):
        api = champ.get("apiName", "")
        # Grab everything before the last underscore as candidate prefix
        parts = api.split("_")
        if len(parts) >= 2:
            candidate = parts[0]
            if candidate not in ("TFT",):  # skip generic TFT_ system units
                prefixes[candidate] = prefixes.get(candidate, 0) + 1
    if prefixes:
        # Most common non-generic prefix
        best = prefixes.most_common(1)[0][0]
        return best + "_"
    return f"TFT{set_key}_"


def main():
    print("=" * 55)
    print("  TFT Quiz App -- Data Pipeline")
    print("=" * 55)

    # 1. Fetch
    print("\n[1/5] Fetching en_us.json from CommunityDragon ...")
    try:
        data = fetch_json(CDRAGON_URL)
    except Exception as exc:
        print(f"  FAILED: {exc}")
        sys.exit(1)
    print(f"  OK -- top-level keys: {list(data.keys())}")

    # 2. Latest set
    print("\n[2/5] Identifying latest set ...")
    try:
        set_key, set_data = get_latest_set(data)
    except ValueError as exc:
        print(f"  FAILED: {exc}")
        sys.exit(1)
    set_prefix = _derive_set_prefix(set_key, set_data)
    print(f"  OK -- using Set {set_key} (augment prefix: '{set_prefix}')")

    # 3. Traits (parsed first so champions can use the name lookup)
    print("\n[3/5] Parsing traits ...")
    traits, trait_lookup = parse_traits(set_data)
    print(f"  OK -- {len(traits)} traits")

    # 4. Champions
    print("\n[4/5] Parsing champions ...")
    champions = parse_champions(set_data, trait_lookup)
    print(f"  OK -- {len(champions)} champions")

    # 5. Augments (filtered to current set prefix)
    print("\n[5/5] Parsing augments ...")
    augments = parse_augments(data.get("items", []), set_prefix)
    print(f"  OK -- {len(augments)} augments")

    # Write output
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    output = {
        "champions": champions,
        "traits": traits,
        "augments": augments,
    }
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 55)
    print(f"  DONE  Wrote {OUTPUT_FILE}")
    print(f"      Champions : {len(champions)}")
    print(f"      Traits    : {len(traits)}")
    print(f"      Augments  : {len(augments)}")
    print("=" * 55)

    # Sample output
    if champions:
        c = champions[0]
        print(f"\n  Sample champion: {c['name']} (cost {c['cost']})")
        print(f"    Traits : {c['traits']}")
        print(f"    Spell  : {c['spell']['name']}")
        vars_count = len(c["spell"]["variables"])
        print(f"    Vars   : {vars_count} variable(s)")


if __name__ == "__main__":
    main()
