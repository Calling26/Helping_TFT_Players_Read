import json

d = json.load(open("frontend/data.json", "r", encoding="utf-8"))

# Show champion prefixes and actual set-18 champions
real_champs = [c for c in d["champions"] if len(c.get("traits", [])) > 0]
system_champs = [c for c in d["champions"] if len(c.get("traits", [])) == 0]

print(f"Total champions: {len(d['champions'])}")
print(f"  With traits (real): {len(real_champs)}")
print(f"  Without traits (system/summon): {len(system_champs)}")

print("\nSystem units (no traits):")
for c in system_champs[:10]:
    print(f"  {c['apiName']} -> {c['name']} (cost={c['cost']})")

print(f"\nReal champions (first 20):")
for c in real_champs[:20]:
    print(f"  {c['name']} | cost={c['cost']} | traits={c['traits']} | spell={c['spell']['name']}")
    varcount = len(c["spell"]["variables"])
    if varcount > 0:
        print(f"    variables: {list(c['spell']['variables'].keys())[:5]}")

print(f"\nTraits (first 10):")
for t in d["traits"][:10]:
    print(f"  {t['name']}: {t['desc'][:80]}...")

print(f"\nAugments count: {len(d['augments'])}")
# Check augment prefixes
aug_prefixes = set()
for a in d["augments"]:
    parts = a["apiName"].split("_")
    if len(parts) >= 2:
        aug_prefixes.add(parts[0] + "_" + parts[1])
print(f"Augment prefixes: {sorted(aug_prefixes)[:15]}")

print(f"\nSample augments (first 5):")
for a in d["augments"][:5]:
    print(f"  {a['name']}: {a['desc'][:100]}...")
