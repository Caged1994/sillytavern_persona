#!/usr/bin/env python3
"""
Builds src/data/personaSkills.js: the skills of Persona 5 Royal, plus the
ones of Persona 3 Reload and Persona 4 Golden (and older P3 versions) that
P5R does not have, with what the combat needs to use them.

Each skill:  name: { e, t, c, k, fx, d, g }
  e   element: phys gun fire ice elec wind psy nuke bless curse almighty
      ailment heal support passive special
  t   target: one | all | ally | allies | self | ''   ('' for passives)
  c   cost (0 = free) and k its kind: 'sp' (SP points), 'hp' (% of max HP),
      'spp' (% of max SP, P3/P4)
  fx  what it does in a fight (see FX below), or omitted when the combat
      cannot use it (navigation, fusion-only, traits…)
  d   the game's effect text ("40 pwr, 25% Burn")
  g   game it comes from (p5r, p3r, p4g, p3)

FX kinds:
  dmg    { pw, hits:[min,max], acc, crit, ail?:[name, %], el }
  kill   { el, pct }                         Hama / Mudo lines
  drain  { pw, what: 'hp'|'sp' }             Life / Spirit Drain
  heal   { pw } | { revive: % } | { cure: [ailments] } | { sp: n }
  kaja   { stats: ['atk','def','agi'] }      ally buff (Tarukaja…)
  kunda  { stats: [...] }                    foe debuff (Tarunda…)
  charge { what: 'phys'|'magic' }            Charge / Concentrate
  wall   { el } / break { el }               Fire Wall / Fire Break
  karn   { what: 'phys'|'magic' }            Tetrakarn / Makarakarn
  dekaja / dekunda
  ail    { ail, pct }                        pure ailment skills (Dormina…)
  aff    { el, val }                         passive Resist/Null/Repel/Drain X
  halve  { el, pct }                         Divine Judgement / Demonic Decree
  combo  { of: [fx…] }                       "Diarama + Tarukaja", "Heat Riser"…

Source data: megaten-fusion-tool by aqiu384 (public domain, Unlicense).
Usage: python3 tools/build-skills.py <path to megaten-fusion-tool/src/app>
"""
import json, os, re, sys

APP = sys.argv[1] if len(sys.argv) > 1 else 'src/app'
OUT = os.path.join(os.path.dirname(__file__), '..', 'src', 'data', 'personaSkills.js')

# (label, game folder, files in override order, cost style)
SOURCES = [
    ('p5r', 'p5', ['skill-data', 'roy-skill-data'], 'p5'),
    ('p3r', 'p3r', ['skill-data', 'aeg-skill-data'], 'p5'),
    ('p4g', 'p4', ['skill-data', 'golden-skill-data'], 'p4'),
    ('p3', 'p3', ['van-skill-data', 'fes-skill-data', 'p3p-skill-data'], 'p4'),
]

ELEM = {'phy': 'phys', 'sla': 'phys', 'str': 'phys', 'pie': 'phys', 'gun': 'gun', 'fir': 'fire', 'ice': 'ice',
        'ele': 'elec', 'win': 'wind', 'psy': 'psy', 'nuk': 'nuke', 'ble': 'bless', 'lig': 'bless', 'cur': 'curse',
        'dar': 'curse', 'alm': 'almighty', 'ail': 'ailment', 'rec': 'heal', 'sup': 'support', 'pas': 'passive',
        'spe': 'special', 'tra': None}
TARGET = {'1 foe': 'one', 'one foe': 'one', 'all foes': 'all', '1 ally': 'ally', 'all allies': 'allies',
          'party': 'allies', 'self': 'self', 'universal': 'all', 'rand allies': 'allies', '-': ''}
AILMENTS = ['Burn', 'Freeze', 'Shock', 'Dizzy', 'Sleep', 'Confuse', 'Fear', 'Forget', 'Rage', 'Despair',
            'Brainwash', 'Hunger', 'Poison', 'Charm', 'Distress', 'Panic', 'Silence', 'Exhaustion',
            'Enervation', 'Mute', 'Down']
ELEM_WORDS = {'phys': 'phys', 'physical': 'phys', 'gun': 'gun', 'fire': 'fire', 'ice': 'ice', 'elec': 'elec',
              'electric': 'elec', 'wind': 'wind', 'psy': 'psy', 'psychic': 'psy', 'nuke': 'nuke', 'nuclear': 'nuke',
              'bless': 'bless', 'light': 'bless', 'curse': 'curse', 'dark': 'curse', 'slash': 'phys',
              'strike': 'phys', 'pierce': 'phys'}

EFFECTS = json.load(open(os.path.join(APP, 'compendium', 'data', 'skill-effects.json'), encoding='utf-8'))


def effect_text(nums, descs):
    """Port of the fusion tool's skillRowToEffect (pq2/models/skill-importer.ts)."""
    nums = list(nums) + [0] * (8 - len(nums))
    _, _, power, min_hits, max_hits, acc, crit, mod = nums[:8]
    effect, cond = descs[0], descs[1]
    cond_str = EFFECTS.get(cond[3:], cond) if cond.startswith('FMT') else cond
    base_mod = int(mod)
    power_str = '' if not power else f'{power:g} pwr'
    hit_str = f'{min_hits}-{max_hits} hits' if min_hits != max_hits else ('' if max_hits < 2 else f'{max_hits} hits')
    crit_str = '' if crit <= 5 else f'{crit}% crit'
    acc_str = '' if acc == 0 or 90 <= acc <= 110 else f'{acc}% acc'
    mod_str = f'{mod:g}' if base_mod < 1000 else f'{(base_mod - 1000) / 100:g}'
    effect_str = '' if cond == '-' else cond_str.replace('$1', mod_str).replace('$2', effect)
    full = ', '.join(s for s in [power_str, hit_str, acc_str, crit_str, effect_str] if s)
    return full[:1].upper() + full[1:] if full and full[0] != 'x' else full


def cost_of(raw, style):
    if not raw:
        return 0, ''
    if raw < 1000:
        return raw, 'hp'
    if raw <= 2000:
        return raw - 1000, 'sp'
    return (raw - 2000, 'spp') if style == 'p4' else (0, '')  # P5/P3R: team-up "Showtime" costs


def words_to_elems(text):
    t = text.lower()
    if 'phys or gun' in t:
        return ['phys', 'gun']
    if 'non-almighty magic' in t or t == 'magic':
        return ['magic']
    return [ELEM_WORDS[w] for w in re.findall(r'[a-z]+', t) if w in ELEM_WORDS]


def kaja_stats(text):
    t = text.lower()
    out = []
    if 'taru' in t or 'attack' in t:
        out.append('atk')
    if 'raku' in t or 'defense' in t or 'defence' in t:
        out.append('def')
    if 'suku' in t or 'accuracy' in t or 'evasion' in t:
        out.append('agi')
    return out


HEAL_PCT = re.compile(r'^(\d+)% HP restore$', re.I)


def fx_of(name, el, target, nums, descs):
    nums = list(nums) + [0] * (8 - len(nums))
    _, _, power, min_hits, max_hits, acc, crit, mod = nums[:8]
    effect, cond = descs[0], descs[1]
    pct = mod if mod < 1000 else round((mod - 1000) / 100 * 100)
    if cond == 'FMTExact' and effect == 'HP restore' and el == 'heal':
        return {'k': 'heal', 'pct': int(pct)}
    dtext = effect_text(nums, descs)
    if re.search(r'(reduces current hp by|chance to halve current hp)', dtext.lower()):
        m = re.search(r'(\d+)% chance', dtext)
        return {'k': 'halve', 'el': el, 'pct': int(m.group(1)) if m else 100}
    # "A + B" in the effect, or in a raw template ("$1% $2 + Sukukaja").
    combo_src = effect if ('+' in effect and cond in ('FMTBase', '-')) else (dtext if ' + ' in cond and not cond.startswith('FMT') else '')
    if not combo_src and cond in ('FMTBase', '-') and el in ('heal', 'support') and not power:
        combo_src = effect
    only_kaja = all(re.fullmatch(r'(taru|raku|suku)(kaja|nda)', x.strip().lower()) for x in combo_src.split('+'))
    if combo_src and not only_kaja:
        names = [x.strip() for x in combo_src.split('+')]
        names = [f'{int(pct)}% HP restore' if n == 'HP restore' and pct else n for n in names]
        return {'k': 'combo', 'names': names}  # resolved in main()
    if el == 'passive':
        m = re.match(r'FMT(Resist|Null|Repel|Drain)Elem$', cond)
        if m:
            elems = words_to_elems(effect)
            val = {'Resist': 'rs', 'Null': 'nu', 'Repel': 'rp', 'Drain': 'dr'}[m.group(1)]
            if len(elems) == 1 and elems[0] != 'magic':
                return {'k': 'aff', 'el': elems[0], 'val': val}
        return None
    if el in ('heal',):
        if cond == 'FMTRecarm':
            return {'k': 'heal', 'revive': int(mod) if mod < 1000 else 100}
        if cond == 'FMTCureAilment':
            return {'k': 'heal', 'cure': [a for a in AILMENTS if a.lower() in effect.lower()] or ['all']}
        if 'SP restore' in effect or effect.lower().startswith('sp'):
            return {'k': 'heal', 'sp': int(power or mod or 10)}
        if power:
            return {'k': 'heal', 'pw': power}
        if 'Amrita' in effect or 'Patra' in effect or 'Baisudi' in effect or 'Energy Drop' in effect:
            return {'k': 'heal', 'cure': ['all']}
        return None
    if el == 'support':
        if cond == 'FMTPersonaKaja':
            stats = kaja_stats(effect)
            return {'k': 'kunda' if target in ('one', 'all') else 'kaja', 'stats': stats} if stats else None
        if re.search(r'(taru|raku|suku)(kaja|nda)', effect.lower()):
            stats = kaja_stats(effect)
            return {'k': 'kunda' if 'nda' in effect.lower() else 'kaja', 'stats': stats}
        if cond == 'FMTElemCharge':
            return {'k': 'charge', 'what': 'phys' if 'phys' in effect.lower() else 'magic'}
        if cond in ('FMTElemWall', 'FMTElemBreak'):
            elems = words_to_elems(effect)
            return {'k': 'wall' if cond == 'FMTElemWall' else 'break', 'el': elems[0]} if elems else None
        if cond == 'FMTElemKarn':
            return {'k': 'karn', 'what': 'phys' if 'phys' in effect.lower() else 'magic'}
        if '-kaja' in effect.lower():
            return {'k': 'dekaja'}
        if '-kunda' in effect.lower():
            return {'k': 'dekunda'}
        return None
    if el == 'ailment':
        ail = next((a for a in AILMENTS if a.lower() == effect.lower().strip()), None)
        if ail and ail != 'Down':
            return {'k': 'ail', 'ail': ail, 'pct': int(pct) if pct else 30}
        return None
    if effect.lower() == 'instakill':
        return {'k': 'kill', 'el': el, 'pct': int(pct) if pct else 25}
    if cond == 'FMTPersonaLifeDrainN':
        return {'k': 'drain', 'pw': int(mod) if mod < 1000 else 30, 'what': 'sp' if 'SP' in effect else 'hp'}
    if el in ('special',):
        el = 'almighty'
    if power and el in ELEM.values():
        fx = {'k': 'dmg', 'el': el, 'pw': power, 'hits': [int(min_hits or 1), int(max_hits or 1)],
              'acc': int(acc or 95), 'crit': int(crit or 0)}
        ail = next((a for a in AILMENTS if a.lower() == effect.lower().strip()), None)
        if ail and cond == 'FMTExact' and ail != 'Down':
            fx['ail'] = [ail, int(pct) if pct else 10]
        return fx
    return None


def key(name):
    return re.sub(r'[^a-z0-9]+', '', name.lower())


def main():
    out = {}
    seen = set()
    counts = []
    for label, game_dir, files, style in SOURCES:
        rows = {}
        for f in files:
            path = os.path.join(APP, game_dir, 'data', f + '.json')
            if not os.path.exists(path):
                continue
            data = json.load(open(path, encoding='utf-8'))
            for row in (data.values() if isinstance(data, dict) else data):
                rows[row['a'][0]] = row  # later files override earlier ones
        added = 0
        for name, row in rows.items():
            sname, el_raw, target_raw = row['a'][:3]
            el = ELEM.get(el_raw)
            if el is None or sname == 'Attack' or key(sname) in seen:
                continue
            nums, descs = row['b'], (row.get('c') or ['-', '-', '-'])
            descs = list(descs) + ['-'] * (3 - len(descs))
            target = TARGET.get(target_raw.lower(), '')
            cost, kind = cost_of(nums[1] if len(nums) > 1 else 0, style)
            rec = {'e': el, 't': target}
            if cost:
                rec['c'] = cost
                rec['k'] = kind
            fx = fx_of(sname, el, target, nums, descs)
            if fx:
                rec['fx'] = fx
            text = effect_text(nums, descs)
            if text:
                rec['d'] = text
            rec['g'] = label
            seen.add(key(sname))
            out[sname] = rec
            added += 1
        counts.append(f'{label}: {added}')
    # Combos name other skills ("Diarama + Tarukaja"): inline what those do.
    def resolve(part, depth=0):
        m = HEAL_PCT.match(part)
        if m:
            return [{'k': 'heal', 'pct': int(m.group(1))}]
        rec = out.get(part)
        if not rec or depth > 3 or 'fx' not in rec:
            return []
        fx = rec['fx']
        if fx.get('k') == 'combo':
            return list(fx.get('of', []))
        return [fx]
    for _ in range(3):
        for name, rec in out.items():
            fx = rec.get('fx')
            if fx and fx.get('k') == 'combo' and 'names' in fx:
                parts = [x for n in fx['names'] for x in resolve(n)]
                if parts and len(parts) >= len(fx['names']):
                    rec['fx'] = {'k': 'combo', 'of': parts}
    for name, rec in list(out.items()):
        fx = rec.get('fx')
        if fx and fx.get('k') == 'combo' and 'names' in fx:
            del rec['fx']  # names it could not resolve
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    body = json.dumps(out, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('// Generated by tools/build-skills.py from megaten-fusion-tool (aqiu384, public domain). Do not edit by hand.\n')
        f.write(f'export const PERSONA_SKILLS = {body};\n')
    usable = sum(1 for r in out.values() if 'fx' in r)
    print('\n'.join(counts))
    print(f'{len(out)} skills ({usable} usable in combat) → {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
