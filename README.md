# Persona Stats for SillyTavern

A SillyTavern extension for playing cards themed on *Shin Megami Tensei: Persona* (focus on Persona 3, 4 and 5). Work in progress.

## Origin and licence

Persona Stats is a modified version of [Better Stats](https://github.com/Caged1994/Better-Stats), which is itself a fork of [Doom's Enhancement Suite](https://github.com/DangerDaza/Dooms-Enhancement-Suite) by DangerDaza (itself derived from marinara_spaghetti's RPG Companion). It is distributed under the **GNU AGPL-3.0-or-later**; see `LICENSE`. Original copyright notices are retained.

## Changes from Better Stats

- D&D attributes replaced by Persona stats: **St** (Strength), **Ma** (Magic), **En** (Endurance), **Ag** (Agility), **Lu** (Luck), on a 1–99 scale. Mana is shown as **SP**, Health as **HP**.
- Optional bars (satiety, energy, hygiene, morale) are **off by default**; the user can switch them on in the Stats panel.
- Combat, dungeon, sphere grid, checks, effects and conditions remapped to the new attributes.
- Removed: Bunny Mo integration, the human-scale (average/peak) tiers, and the Character Sheet feature.
- Kept: weather, Lore Library, portrait bar, scene headers, chat bubbles, themes.

## Installation

In SillyTavern: Extensions → Install Extension → paste `https://github.com/Caged1994/sillytavern_persona`, then reload.

## Tests

`node tools/<name>.mjs` for each script in `tools/` (`load-check.mjs` verifies the module graph).

## Credits

DangerDaza (Doom's Enhancement Suite), marinara_spaghetti (RPG Companion), Caged1994 (Better Stats).
