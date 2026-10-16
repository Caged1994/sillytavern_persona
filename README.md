# Persona Stats for SillyTavern

A SillyTavern extension for playing cards themed on *Shin Megami Tensei: Persona* (focus on Persona 3, 4 and 5). Work in progress.

## Origin and licence

Persona Stats is a modified version of [Better Stats](https://github.com/Caged1994/Better-Stats), which is itself a fork of [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite) by DangerDaza (itself derived from marinara_spaghetti's RPG Companion). It is distributed under the **GNU AGPL-3.0-or-later**; see `LICENSE`. Original copyright notices are retained.

## Changes from Better Stats

- D&D attributes replaced by Persona stats: **St** (Strength), **Ma** (Magic), **En** (Endurance), **Ag** (Agility), **Lu** (Luck), on a 1–99 scale. Mana is shown as **SP**, Health as **HP**.
- Optional bars (satiety, energy, hygiene, morale) are **off by default**; the user can switch them on in the Stats panel.
- **HP and SP in points** (current / max) everywhere: max HP grows with En and level, max SP with level. No automatic conditions from low bars.
- The Stats panel shows HP, SP and the attributes together as slanted bars in the style of the Persona 5 status screen ("MAX" on a full bar).
- **Social stats** (Persona 5): Knowledge, Guts, Proficiency, Kindness and Charm for the player's character, with ranks 1–5 and their titles, drawn as overlapping circles in the Social tab. The AI adds 1–5 points when the character does something that builds a stat; points never go down. Can be switched off in Settings.
- **Personas**: as in the games, St/Ma/En/Ag/Lu come from the equipped Persona. Each Persona has an Arcana, a level, the five stats, an affinity to each element (Phys, Gun, Fire, Ice, Elec, Wind, Psy, Nuke, Bless, Curse: Weak / Resist / Null / Drain / Repel) and up to 8 skills. The player's character is a Wild Card (up to 12 Personas, switch any time); others have one, and a new one replaces it. The equipped Persona levels up with its owner (+3 stat points a level, spread like the stats it has) and learns the skills of its list. The AI can awaken new Personas; the extension always sets the numbers. Owned Personas live in the chat; the Persona tab of the Stats panel shows and edits them.
- **Persona skills**: a database of 1199 skills from P5R, P3 Reload and P4 Golden (`src/data/personaSkills.js`, built by `tools/build-skills.py` from megaten-fusion-tool, public domain) with element, power, hits, accuracy, crit, ailment, target and cost. A Persona's skills use it automatically in fights; passives like Resist / Null / Repel / Drain X change the affinities.
- **Persona combat**: every attack has an element and every fighter affinities (the party's from their equipped Persona, Shadows' from the Compendium or the AI). Weak ×1.25, Resist ×0.5, Null, Drain and Repel work as in the games. A weakness, a party critical or a technical (an element that exploits an ailment) knocks the target down and gives **1 More**; during it the party can **Baton Pass** (+50% per pass) or, with every enemy down, launch an **All-Out Attack**. SP skills cost SP, Phys skills HP. Ailments (Burn, Freeze, Shock, Sleep, Dizzy, Confuse, Fear, Forget, Rage, Despair, Brainwash), -kaja/-kunda, Charge/Concentrate, walls and breaks, Tetrakarn/Makarakarn, Hama/Mudo. Enemy affinities are hidden until an element hits them; enemies aim for the party's weaknesses.
- Combat rebalanced for the 1–99 scale: HP, damage and healing grow with level, hit/flee chances compare Agility as a ratio, Luck raises critical hits; a fight between equals takes about five hits at any level. Condition maluses and the AI's guidance for item/condition effects scaled up to match.
- Combat, dungeon, checks, effects and conditions remapped to the new attributes.
- Removed: Bunny Mo integration, the human-scale (average/peak) tiers, the Character Sheet feature and the sphere grid.
- Kept: weather, Lore Library, portrait bar, scene headers, chat bubbles, themes.

## Persona Compendium (lorebook)

The catalogue of Personas is a lorebook: any entry whose title (or first line) starts with `Persona:` is read as one. Choose the lorebook in Settings → RPG & Stats → Persona Compendium, or leave "Active lorebooks". One field per line, in any order:

```
Persona: Arsène
Arcana: Fool
Level: 1
St 2 · Ma 2 · En 2 · Ag 3 · Lu 1
Phys - · Gun - · Fire - · Ice Wk · Elec - · Wind - · Psy - · Nuke - · Bless Wk · Curse Rs
Skills: Eiha, Cleave
Learns: Lv2 Rakukaja, Lv4 Sukunda
Description: The gentleman thief of the Fool Arcana.
```

A ready-made Compendium is in `compendium/Persona-Compendium.json`: the 242 Personas of Persona 5 Royal (fusable ones and the Phantom Thieves'), plus the 86 from Persona 3 (Reload, Episode Aigis, FES) and Persona 4 Golden that P5R does not have — 328 in all, no repeats. Import it in SillyTavern's World Info / Lore Library and pick it in Settings. For P3/P4 Personas, Slash/Strike/Pierce become Phys (the exact three are in the description when they differ), Light → Bless, Dark → Curse; Gun, Psy and Nuke stay normal since those games lack them. Skills unlocked by awakening or social links are listed in each entry's description. Each entry also says how the Persona is obtained: normal fusion (Arcana chart), the ingredients of a special fusion, "cannot be fused" with the requirement (treasure Personas, party members' Personas), and what unlocks it (story progress, a maxed Confidant / Social Link, DLC). It is built by `tools/build-compendium.py` from the data of [megaten-fusion-tool](https://github.com/aqiu384/megaten-fusion-tool) by aqiu384 (public domain).

Affinities accept `Wk`/`Weak`, `Rs`/`Resist`, `Nu`/`Null`, `Dr`/`Drain`, `Rp`/`Repel` and `-` for normal. An entry without a stats line gets an even spread for its level. When a character obtains a Persona whose name is in the Compendium, a copy is made for that chat; levelling it up never changes the lorebook.

## Installation

In SillyTavern: Extensions → Install Extension → paste `https://github.com/Caged1994/sillytavern_persona`, then reload.

## Tests

`node tools/<name>.mjs` for each script in `tools/` (`load-check.mjs` verifies the module graph).

## Credits

DangerDaza (Doom's Enhancement Suite), marinara_spaghetti (RPG Companion), Caged1994 (Better Stats). Persona 3/4/5 data: aqiu384's megaten-fusion-tool (public domain).
