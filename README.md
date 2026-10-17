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
- **Personas**: as in the games, St/Ma/En/Ag/Lu come from the equipped Persona. Each Persona has an Arcana, a level, the five stats, an affinity to each element (Phys, Gun, Fire, Ice, Elec, Wind, Psy, Nuke, Bless, Curse: Weak / Resist / Null / Drain / Repel) and up to 8 skills. The player's character is a Wild Card (up to 12 Personas, switch any time); others have one, and a new one replaces it. As in the games, a Persona is never above its user's level: a stronger one cannot be added or equipped by hand, and one the AI awakens comes in at the user's level. The equipped Persona levels up with its owner (+3 stat points a level, spread like the stats it has) and learns the skills of its list. The AI can awaken new Personas; the extension always sets the numbers. Owned Personas live in the chat; the Persona tab of the Stats panel shows and edits them.
- **Persona skills**: a database of 1199 skills from P5R, P3 Reload and P4 Golden (`src/data/personaSkills.js`, built by `tools/build-skills.py` from megaten-fusion-tool, public domain) with element, power, hits, accuracy, crit, ailment, target and cost. A Persona's skills use it automatically in fights; passives like Resist / Null / Repel / Drain X change the affinities.
- **Persona combat**: every attack has an element and every fighter affinities (the party's from their equipped Persona, Shadows' from the Compendium or the AI). Weak ×1.25, Resist ×0.5, Null, Drain and Repel work as in the games. A weakness, a party critical or a technical (an element that exploits an ailment) knocks the target down and gives **1 More**; during it the party can **Baton Pass** (+50% per pass) or, with every enemy down, launch an **All-Out Attack**. SP skills cost SP, Phys skills HP. Ailments (Burn, Freeze, Shock, Sleep, Dizzy, Confuse, Fear, Forget, Rage, Despair, Brainwash), -kaja/-kunda, Charge/Concentrate, walls and breaks, Tetrakarn/Makarakarn, Hama/Mudo. Enemy affinities are hidden until an element hits them; enemies aim for the party's weaknesses.
- **Confidants** (Social Links): one person per Arcana, rank 1–10, raised by points the AI gives for time spent together; ranks can require a social stat or a level and unlock things. Who can become one is set per card: *Defined* (only the lorebook's), *Mixed* (the lorebook's keep their Arcana, the story fills the free ones), *Sandbox* (all from the story), or *Automatic* (Mixed when a lorebook has Confidants, Sandbox otherwise). A bond the story starts with someone not in the lorebook needs their affinity at a threshold, and can be set to wait for Accept / Reject. Shown as tarot cards in the Confidants tab.
- Combat rebalanced for the 1–99 scale: HP, damage and healing grow with level, hit/flee chances compare Agility as a ratio, Luck raises critical hits; a fight between equals takes about five hits at any level. Condition maluses and the AI's guidance for item/condition effects scaled up to match.
- Combat, dungeon, effects and conditions remapped to the new attributes.
- Checks (d20) use the social stats instead: d20 + 2 × (rank − 1) + bonus (±5) against the difficulty; a natural 1 always fails and no check is ever above 95%.
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
Inherits: Curse
Fusion: normal fusion of two Personas (Arcana chart)
```

`Inherits` and `Fusion` are for the Velvet Room and optional (no Fusion line = normal fusion; also `Fusion: special fusion of A + B`, `Fusion: cannot be fused`, `Unlocked by: Maxed Confidant: <Arcana> Rank 10`).

A ready-made Compendium is in `compendium/Persona-Compendium.json`: the 242 Personas of Persona 5 Royal (fusable ones and the Phantom Thieves'), plus the 86 from Persona 3 (Reload, Episode Aigis, FES) and Persona 4 Golden that P5R does not have — 328 in all, no repeats. Import it in SillyTavern's World Info / Lore Library and pick it in Settings. For P3/P4 Personas, Slash/Strike/Pierce become Phys (the exact three are in the description when they differ), Light → Bless, Dark → Curse; Gun, Psy and Nuke stay normal since those games lack them. Skills unlocked by awakening or social links are listed in each entry's description. Each entry also says how the Persona is obtained: normal fusion (Arcana chart), the ingredients of a special fusion, "cannot be fused" with the requirement (treasure Personas, party members' Personas), and what unlocks it (story progress, a maxed Confidant / Social Link, DLC). It is built by `tools/build-compendium.py` from the data of [megaten-fusion-tool](https://github.com/aqiu384/megaten-fusion-tool) by aqiu384 (public domain).

Affinities accept `Wk`/`Weak`, `Rs`/`Resist`, `Nu`/`Null`, `Dr`/`Drain`, `Rp`/`Repel` and `-` for normal. An entry without a stats line gets an even spread for its level. When a character obtains a Persona whose name is in the Compendium, a copy is made for that chat; levelling it up never changes the lorebook.

## Calendar

A real calendar with four times of day: **morning** (from 5:00), **afternoon** (12:00), **evening** (18:00) and **night** (22:00). It is in charge of the Info Box date and time:

- The AI keeps writing the Info Box date ("Weekday, Month Day, Year") and time as before. The calendar reads them and moves forward. If a reply goes back in time, the calendar keeps its moment and writes its own date, and a time in its slot, back into the Info Box. Without the Info Box date widget, the AI uses the `"calendar": {"date", "slot"}` key instead.
- By hand (Stats panel → Calendar, your character): next time of day, next day, any date (also backwards), or by typing in the Info Box.
- Weather by day: today's comes from the Info Box. The AI is asked for a 3-day forecast when one is missing; you can also type it on any day.
- Events: event, deadline, exam or holiday, with a countdown in the panel and in the prompt. Missed deadlines are told to the AI. They come from the story (`"calendar": {"events": [...], "done": [...]}`), by hand, or from lorebook entries titled `Calendar:`, one per line:

```
Calendar: Shujin Academy
April 29: Golden Week (holiday)
2016-05-05: Kamoshida's Palace deadline
July 13 evening — Fireworks festival
```

A date without a year repeats every year. A swipe undoes what the replaced reply changed.

## Confidant abilities (teammates)

A Confidant who fights with you (a party member) unlocks abilities in battle as the bond grows, as P5's teammates do:

| Rank | Ability | Effect |
|---|---|---|
| 2 | Baton Pass | Can take and pass on a 1 More. With Confidants on, Baton Pass needs it: you (the leader) can always pass, a teammate only once their bond has it. |
| 4 | Follow Up | After your single-target attack that did not knock the enemy down, may strike too: 30%, +5% a rank, at most 50%. |
| 6 | Endure | Survives a fatal blow with 1 HP, once a fight. |
| 7 | Harisen Recovery | May cure your ailment at the start of your turn: 35%, +5% a rank, at most 50%. |
| 8 | Protect | Takes a fatal blow meant for you, once a fight. |
| 10 | Awakening | A button in the Confidants tab evolves their equipped Persona, once. |

A lorebook Confidant can move any of them with its unlock lines: `Rank 3 unlocks: Follow Up` sets Follow Up to rank 3. `Rank 10 unlocks: Captain Kidd evolves into Seiten Taisei` makes the Awakening turn the Persona into Seiten Taisei (taken from the Compendium, keeping the old skills where they fit, never above the teammate's level). Without a named evolution, the Persona loses its weaknesses and gains +2 to every stat. Confidants who are not party members get no battle abilities; their unlock texts stay story notes. The AI is told which abilities each teammate has. With Confidants off, nobody has them and Baton Pass is free, as before.

## Velvet Room (fusion)

A Wild Card with at least two Personas can fuse them from the Persona tab (Settings → Velvet Room switches it off). The rules are Persona 5 Royal's:

- **Normal fusion** of two Personas: the Arcana chart gives the result's Arcana (P5R's; pairs with Aeon or Jester use P4 Golden's, then P3 Reload's). The result is the first Persona of that Arcana at level (level₁ + level₂) / 2 + 1 or above. Two of the same Arcana give the strongest one below that level that is neither parent; if there is none, the fusion fails. The base (Compendium) levels count, so training a Persona does not change what it fuses into. Only Personas marked "normal fusion" come out of one.
- **Special fusion**: the exact set of a recipe (`Fusion: special fusion of A + B + …`, 2 to 6 Personas). The tab lists the ones your stock can make.
- **Treasure fusion**: a treasure demon (Crystal Skull, Koh-i-Noor…) moves the other Persona up or down inside its Arcana.
- **Limits**: the result cannot be above your level (Levels on); a Persona unlocked by a maxed Confidant (`Unlocked by: Maxed Confidant: Death Rank 10`) needs that Confidant at that rank (Confidants on). Story and DLC unlocks are left to the story. You cannot fuse into a Persona you already own.
- **Bonus**: the Confidant of the result's Arcana adds rank ÷ 2 levels (rank 10 → +5), never past your level.
- **Skills**: the result keeps its own skills and inherits from the parents' — 1 slot for 1 skill, 2 for up to 4, 3 for up to 8, 4 beyond — limited by its inheritance type (`Inherits: Fire`: a Fire Persona cannot take Ice, Phys or Gun skills, as in P5R). You pick which ones; the parents are gone afterwards.

The ready-made Compendium mixes P3/P4 Personas into the same Arcana rows, so some results differ from pure P5R; disable those entries in the lorebook for P5R's exact results. The tables are built by `tools/build-fusion.py` from megaten-fusion-tool's data.

## Confidants in a lorebook

Any entry whose title (or first line) starts with `Confidant:` describes a Confidant the card has planned. The bond still forms in the story (or by hand); until then it shows as "not met".

```
Confidant: Ryuji Sakamoto
Arcana: Chariot
Rank 2 requires: Guts 2
Rank 5 requires: Level 20
Rank 4 unlocks: Follow-up attack
Rank 10 unlocks: Captain Kidd evolves into Seiten Taisei
Description: Loud, loyal, former track star.
```

Requirements can name a social stat (Knowledge, Guts, Proficiency, Kindness, Charm) with a rank, or a level. Unlocks are text the AI is told about.

## Installation

In SillyTavern: Extensions → Install Extension → paste `https://github.com/Caged1994/sillytavern_persona`, then reload.

## Tests

`node tools/<name>.mjs` for each script in `tools/` (`load-check.mjs` verifies the module graph).

## Credits

DangerDaza (Doom's Enhancement Suite), marinara_spaghetti (RPG Companion), Caged1994 (Better Stats). Persona 3/4/5 data: aqiu384's megaten-fusion-tool (public domain).
