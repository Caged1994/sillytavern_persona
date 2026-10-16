#!/usr/bin/env python3
"""
Builds compendium/Persona-Compendium.json, a SillyTavern lorebook with one
"Persona:" entry per Persona (format: src/utils/personaModel.js).

Persona 5 Royal is the base; Persona 3 and Persona 4 only add the Personas
that are not already there (a name seen once is never repeated). Sources, in
order — the first one to have a Persona wins:
  P5R (fusable + Phantom Thieves), P3 Reload, P3 Reload Episode Aigis,
  P4 Golden, P4, P3 FES, P3 (vanilla), P3 Portable, P3 FES The Answer.

Elements are mapped onto the ten of Persona 5: P3's Slash/Strike/Pierce
become Phys (the value two of them share; the exact three are kept in the
description when they differ), Light → Bless, Dark → Curse. P3 and P4 have
no Gun, Psy or Nuke, so those stay normal for their Personas.

Source data: megaten-fusion-tool by aqiu384 (public domain, Unlicense),
https://github.com/aqiu384/megaten-fusion-tool — src/app/{p5,p3r,p4,p3}/data.

Usage: python3 tools/build-compendium.py <path to megaten-fusion-tool/src/app>
"""
import json, os, re, sys, unicodedata

APP = sys.argv[1] if len(sys.argv) > 1 else 'src/app'
OUT = os.path.join(os.path.dirname(__file__), '..', 'compendium', 'Persona-Compendium.json')

# (game folder, Persona files, label, special-fusion files, unlock files, prerequisite files)
# Fusion files are tried in order; the first that knows a Persona wins.
SOURCES = [
    ('p5', ['roy-demon-data', 'roy-party-data'], 'Persona 5 Royal',
     ['roy-special-recipes'], ['roy-demon-unlocks'], ['roy-fusion-prereqs']),
    ('p3r', ['demon-data', 'party-data'], 'Persona 3 Reload',
     ['special-recipes'], ['demon-unlocks'], []),
    ('p3r', ['aeg-demon-data', 'aeg-party-data'], 'Persona 3 Reload: Episode Aigis',
     ['special-recipes'], ['aeg-demon-unlocks', 'demon-unlocks'], []),
    ('p4', ['golden-demon-data', 'golden-party-data'], 'Persona 4 Golden',
     ['special-recipes'], ['golden-demon-unlocks'], []),
    ('p4', ['demon-data', 'party-data'], 'Persona 4',
     ['special-recipes'], ['demon-unlocks'], []),
    ('p3', ['fes-demon-data', 'fes-party-data'], 'Persona 3 FES',
     ['fes-special-recipes', 'van-special-recipes', 'pair-special-recipes'], ['fes-demon-unlocks'], []),
    ('p3', ['van-demon-data', 'van-party-data'], 'Persona 3',
     ['van-special-recipes', 'pair-special-recipes'], ['van-demon-unlocks'], []),
    ('p3', ['p3p-demon-data', 'p3p-party-data'], 'Persona 3 Portable',
     ['fes-special-recipes', 'van-special-recipes', 'pair-special-recipes'], ['fes-demon-unlocks'], []),
    ('p3', ['ans-demon-data', 'ans-party-data'], 'Persona 3 FES: The Answer',
     ['fes-special-recipes', 'van-special-recipes'], ['fes-demon-unlocks'], []),
]

ELEMS = ['Phys', 'Gun', 'Fire', 'Ice', 'Elec', 'Wind', 'Psy', 'Nuke', 'Bless', 'Curse']
SRC_ELEM = {'phy': 'Phys', 'gun': 'Gun', 'fir': 'Fire', 'ice': 'Ice', 'ele': 'Elec', 'win': 'Wind',
            'psy': 'Psy', 'nuk': 'Nuke', 'ble': 'Bless', 'cur': 'Curse', 'lig': 'Bless', 'dar': 'Curse'}
PHYS3 = {'sla': 'Slash', 'str': 'Strike', 'pie': 'Pierce'}
# First digit of the fusion tool's resist code: 6 weak, 5 normal, 4 resist, 3 null, 2 repel, 1 drain.
KIND = {'6': 'Wk', '5': '-', '4': 'Rs', '3': 'Nu', '2': 'Rp', '1': 'Dr'}
ARCANA = {'Hanged': 'Hanged Man'}
STATS = ['St', 'Ma', 'En', 'Ag', 'Lu']


# The same Persona spelled differently across games: the key on the left
# counts as the one on the right, so the later spelling is dropped as a repeat.
SAME_AS = {
    'kusimitama': 'kushimitama', 'yakshini': 'yaksini', 'mithra': 'mithras', 'seiryuu': 'seiryu',
    'girimekhala': 'girimehkala', 'oukuninushi': 'okuninushi', 'laksmi': 'lakshmi',
    'niddhoggr': 'nidhoggr', 'kushinadahime': 'kushinada',
}


def clean_name(name):
    # P3 Reload marks a few Personas that share a name with another game with " A".
    return re.sub(r' A$', '', name)


def key(name):
    s = unicodedata.normalize('NFKD', clean_name(name)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'[^a-z0-9]+', '', s)
    return SAME_AS.get(s, s)


def arcana(race):
    r = race[:-2] if race.endswith(' P') else race
    return ARCANA.get(r, r)


def affinities(d, config):
    codes = config['resistCodes']
    elems = config['resistElems']
    out = {e: '-' for e in ELEMS}
    phys3 = {}
    for el, c in zip(elems, d.get('resists', '')):
        kind = KIND.get(str(codes.get(c, 50100))[0], '-')
        if el in PHYS3:
            phys3[PHYS3[el]] = kind
        elif el in SRC_ELEM:
            out[SRC_ELEM[el]] = kind
    note = ''
    if phys3:
        vals = list(phys3.values())
        common = max(set(vals), key=vals.count)
        out['Phys'] = common if vals.count(common) >= 2 else '-'
        if len(set(vals)) > 1:
            note = 'physical: ' + ', '.join(f'{k} {v}' for k, v in phys3.items())
    return out, note


def load(game_dir, f):
    path = os.path.join(APP, game_dir, 'data', f + '.json')
    return json.load(open(path, encoding='utf-8')) if os.path.exists(path) else None


def fusion_info(game_dir, recipe_files, unlock_files, prereq_files):
    """{ key(name): { 'special': [names], 'prereq': str, 'unlock': str } } for one game."""
    info = {}
    def at(name):
        return info.setdefault(key(name), {})
    for f in reversed(recipe_files):  # the first file listed wins
        for name, parts in (load(game_dir, f) or {}).items():
            at(name)['special'] = [clean_name(p) for p in parts]
    for f in prereq_files:
        for name, text in (load(game_dir, f) or {}).items():
            at(name)['prereq'] = text
    for f in reversed(unlock_files):
        for group in load(game_dir, f) or []:
            for names, text in group.get('conditions', {}).items():
                for name in names.split(','):
                    at(name.strip())['unlock'] = f'{group.get("category", "Unlock")}: {text}'
    return info


def fusion_lines(fi, is_party=False):
    """The fixed facts about getting a Persona: how it is fused, prerequisite, unlock."""
    lines = []
    if is_party:
        lines.append('Fusion: cannot be fused (a party member\'s own Persona)')
    elif fi.get('special'):
        lines.append('Fusion: special fusion of ' + ' + '.join(fi['special']))
    elif 'special' in fi:
        lines.append('Fusion: cannot be fused' + (f' — {fi["prereq"]}' if fi.get('prereq') else ''))
    else:
        lines.append('Fusion: normal fusion of two Personas (Arcana chart)')
    if fi.get('prereq') and 'special' not in fi:
        lines.append(f'Requirement: {fi["prereq"]}')
    if fi.get('unlock'):
        lines.append(f'Unlocked by: {fi["unlock"]}')
    return lines


def entry_text(name, d, config, game, is_party, fi=None):
    skills = sorted(d.get('skills', {}).items(), key=lambda x: x[1])
    start = [s for s, l in skills if l < 1]
    learns = [(l, s) for s, l in skills if 1 <= l <= 99]
    later = [s for s, l in skills if l > 99]
    aff, phys_note = affinities(d, config)
    lines = [f'Persona: {name}', f'Arcana: {arcana(d["race"])}', f'Level: {d["lvl"]}']
    if d.get('stats'):
        lines.append(' · '.join(f'{k} {v}' for k, v in zip(STATS, d['stats'])))
    lines.append(' · '.join(f'{e} {aff[e]}' for e in ELEMS))
    lines.append(f'Skills: {", ".join(start)}')
    if learns:
        lines.append('Learns: ' + ', '.join(f'Lv{l} {s}' for l, s in learns))
    desc = [f'{"party member" + chr(39) + "s Persona" if is_party else "Persona"} from {game}']
    if d.get('trait'):
        desc.append(f'trait: {d["trait"]}')
    if phys_note:
        desc.append(phys_note)
    if later:
        desc.append(f'unlocked later (awakening / social link): {", ".join(later)}')
    lines.append('Description: ' + '; '.join(desc) + '.')
    lines.extend(fusion_lines(fi or {}, is_party))
    return '\n'.join(lines)


def main():
    seen = set()
    items = []
    counts = []
    for game_dir, files, label, recipe_files, unlock_files, prereq_files in SOURCES:
        config = json.load(open(os.path.join(APP, game_dir, 'data', 'comp-config.json'), encoding='utf-8'))
        fusion = fusion_info(game_dir, recipe_files, unlock_files, prereq_files)
        added = 0
        for f in files:
            path = os.path.join(APP, game_dir, 'data', f + '.json')
            if not os.path.exists(path):
                continue
            for name, d in json.load(open(path, encoding='utf-8')).items():
                if key(name) in seen or 'race' not in d or 'lvl' not in d:
                    continue
                seen.add(key(name))
                name = clean_name(name)
                fi = fusion.get(key(name), {}) if not f.endswith('party-data') else {}
                items.append((d['lvl'], label, name, entry_text(name, d, config, label, f.endswith('party-data'), fi)))
                added += 1
        counts.append(f'{label}: {added}')
    items.sort(key=lambda x: (x[0], x[2]))
    entries = {}
    for uid, (_, _, name, text) in enumerate(items):
        entries[str(uid)] = {
            'uid': uid, 'key': [name], 'keysecondary': [], 'comment': f'Persona: {name}', 'content': text,
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
    print('\n'.join(counts))
    print(f'{len(entries)} Personas → {os.path.normpath(OUT)}')


if __name__ == '__main__':
    main()
