import json
import re

d = json.load(open("frontend/data.json", "r", encoding="utf-8"))

print("=== Champions with 2+ spell variables ===\n")
count = 0
good = 0
for c in d["champions"]:
    vars_ = c["spell"]["variables"]
    if len(vars_) < 2:
        continue
    count += 1
    desc = c["spell"]["desc"]
    desc_vars = re.findall(r"@([^@]+)@", desc)
    # Check how many desc vars can resolve
    resolved = 0
    for dv in desc_vars:
        base = dv.split("*")[0].strip()
        found = any(k.lower() == base.lower() for k in vars_)
        if found:
            resolved += 1
    
    # Check if variables have valid star-1 values
    valid_vals = sum(1 for v in vars_.values() if isinstance(v, list) and len(v) > 1 and v[1] != 0)
    
    if resolved >= 2 and valid_vals >= 2:
        good += 1
        status = "GOOD"
    else:
        status = "BAD "
    
    print(f"  [{status}] {c['name']}: {len(vars_)} vars, {len(desc_vars)} in desc, {resolved} resolvable, {valid_vals} valid vals")
    if status == "BAD ":
        print(f"         vars: {list(vars_.keys())}")
        print(f"         desc @vars: {desc_vars[:6]}")

print(f"\nTotal with 2+ vars: {count}")
print(f"Good for Spot the Error: {good}")
print(f"Bad (unresolvable): {count - good}")
