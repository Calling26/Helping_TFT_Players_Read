import json
import re

d = json.load(open("frontend/data.json", "r", encoding="utf-8"))

# Count augments with 2+ numbers
aug_with_nums = []
for a in d["augments"]:
    nums = re.findall(r"\b(\d+\.?\d*)\b", a["desc"])
    nums = [n for n in nums if float(n) >= 2]
    if len(nums) >= 2:
        aug_with_nums.append((a["name"], nums, a["desc"][:150]))

print(f"Augments with 2+ significant numbers: {len(aug_with_nums)}")
for name, nums, desc in aug_with_nums[:10]:
    print(f"  {name}: nums={nums}")
    print(f"    {desc}")
    print()

# Count champions with variable data we can present
print("\n=== Champions with stat-card viable variables ===")
champ_viable = 0
for c in d["champions"]:
    variables = c["spell"]["variables"]
    # Get variables with meaningful star-1 values
    viable = {k: v[1] for k, v in variables.items() if isinstance(v, list) and len(v) > 1 and v[1] != 0 and not k.startswith("{")}
    if len(viable) >= 3:
        champ_viable += 1
        if champ_viable <= 5:
            print(f"  {c['name']}: {viable}")

print(f"\nTotal champion stat-cards: {champ_viable}")
