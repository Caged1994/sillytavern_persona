#!/usr/bin/env python3
"""
Builds compendium/P5R-Persona-Compendium.json, a SillyTavern lorebook with
one "Persona:" entry per Persona of Persona 5 Royal (fusable Personas and the
Phantom Thieves' Personas), in the Compendium format of src/utils/personaModel.js.

Source data: megaten-fusion-tool by aqiu384 (public domain, Unlicense),
https://github.com/aqiu384/megaten-fusion-tool — src/app/p5/data/
roy-demon-data.json and roy-party-data.json.

Usage: python3 tools/build-p5r-compendium.py <path to megaten-fusion-tool/src/app/p5/data>
"""
import json, sys, os

DATA = sys.argv[1] if len(sys.argv) > 1 else 'src/app/p5/data'
OUT = os.path.join(os.path.dirname(__file__), '..', 'compendium', 'P5R-Persona-Compendium.json')

ELEMS = ['Phys', 'Gun', 'Fire', 'Ice', 'Elec', 'Wind', 'Psy', 'Nuke', 'Bless', 'Curse']
CODES = {'-': '-', 'w': 'Wk', 's': 'Rs', 'n': 'Nu', 'r': 'Rp', 'd': 'Dr'}
ARCANA = {'Hanged': 'Hanged Man'}
STATS = ['St', 'Ma', 'En', 'Ag', 'Lu']


def arcana(race):
    r = race[:-2] if race.endswith(' P') else race
    return ARCANA.get(r, r)


def entry_text(name, d, party):
    skills = d['skills']
    start = [s for s, l in sorted(skills.items(), key=lambda x: x[1]) if l < 1]
    learns = [(l, s) for s, l in sorted(skills.items(), key=lambda x: x[1]) if 1 <= l <= 99]
    later = [s for s, l in skills.items() if l > 99]
    lines = [
        f'Persona: {name}',
        f'Arcana: {arcana(d["race"])}',
        f'Level: {d["lvl"]}',
        ' · '.join(f'{k} {v}' for k, v in zip(STATS, d['stats'])),
        ' · '.join(f'{e} {CODES[c.lower()]}' for e, c in zip(ELEMS, d['resists'])),
        f'Skills: {", ".join(start)}',
    ]
    if learns:
        lines.append('Learns: ' + ', '.join(f'Lv{l} {s}' for l, s in learns))
    desc = []
    if party:
        desc.append('Persona of a Phantom Thief (Persona 5 Royal)')
    else:
        desc.append('Persona 5 Royal Persona')
    if d.get('trait'):
        desc.append(f'trait: {d["trait"]}')
    if later:
        desc.append(f'unlocked later (awakening / Confidant): {", ".join(later)}')
    lines.append('Description: ' + '; '.join(desc) + '.')
    return '\n'.join(lines)


def main():
    demons = json.load(open(os.path.join(DATA, 'roy-demon-data.json'), encoding='utf-8'))
    party = json.load(open(os.path.join(DATA, 'roy-party-data.json'), encoding='utf-8'))
    items = [(n, d, False) for n, d in demons.items()] + [(n, d, True) for n, d in party.items() if n not in demons]
    items.sort(key=lambda x: (x[1]['lvl'], x[0]))
    entries = {}
    for uid, (name, d, is_party) in enumerate(items):
        entries[str(uid)] = {
            'uid': uid, 'key': [name], 'keysecondary': [], 'comment': f'Persona: {name}',
            'content': entry_text(name, d, is_party),
            'constant': False, 'vectorized': False, 'selective': True, 'selectiveLogic': 0,
            'addMemo': True, 'order': 100, 'position': 0, 'disable': False,
            'excludeRecursion': True, 'preventRecursion': True, 'delayUntilRecursion': False,
            'probability': 100, 'useProbability': True, 'depth': 4, 'group': '',
            'groupOverride': False, 'groupWeight': 100, 'scanDepth': None, 'caseSensitive': None,
            'matchWholeWords': True, 'useGroupScoring': None, 'automationId': '', 'role': None,
            'sticky': 0, 'cooldown': 0, 'delay': 0, 'displayIndex': uid,
        }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'entries': entries}, f, ensure_ascii=False, indent=1)
    print(f'{len(entries)} Personas → {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
