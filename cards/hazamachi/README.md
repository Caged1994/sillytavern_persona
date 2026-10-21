# Hazamachi: The Lantern Hour

An original, card-agnostic example for the Persona Stats extension: a narrator/game-master card plus six lorebooks, set in a fog-wrapped mountain town over one school year (April 2027 – March 2028).

| File | What it is |
|---|---|
| `Hazamachi-The-Lantern-Hour.json` | The card (SillyTavern character card V2, narrator/GM). |
| `hazamachi-world.json` | World: town, places, rules of the Lantern Hour, the GM-only truth, tone. |
| `hazamachi-confidants.json` | 11 `Confidant:` entries (Arcana, When/Where, rank requirements, perks). |
| `hazamachi-calendar-activities.json` | `Calendar:` school year (exams, holidays, festivals) and 10 `Activity:` entries for free time. |
| `hazamachi-dungeons.json` | `Dungeon:` The Undercroft (labyrinth, 6 blocks) and four domains with appear/deadline dates. |
| `hazamachi-places.json` | 14 `Place:` entries (position, links, hours, aliases, dungeons) and a `Map:` entry with the river and the reservoir, for the Map tab. |
| `hazamachi-personas.json` | 25 original `Persona:` entries (folklore names) for the Compendium and fusions. |

## Setup
1. Import the card in SillyTavern.
2. In World Info, import the six `hazamachi-*.json` files and activate them (global) or attach the world one to the card.
3. Keep Context Size large enough (16k+) for the tracker instructions.
4. Optional: also import `compendium/Persona-Compendium.json` for the generic fusion pool.

The party grows as the story goes: Tsubasa, Mio, Daigo and Sora each rule one domain and join when it is cleared.
