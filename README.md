# Historyline 1914-1918 tools

Tools and a map viewer for the 1992 Blue Byte game, working towards an engine
that plays it. Everything reads the data files of an installed copy of the
game; none of the game's files are part of this project, and `unpacked/` and
`out/` (which hold copies of its graphics) are git-ignored.

Needs Node 24 or later. The game folder is taken from the `HL_GAME_DIR`
environment variable and defaults to the GOG install path
`C:\GOG Games\Battle Isle Historyline 1914-1918`.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Installs Vite and TypeScript. |
| `npm run dev` | Starts the map viewer at http://localhost:5914. |
| `npm test` | Runs the tests. The ones that need the game are skipped if it is not installed. |
| `npm run typecheck` | Type-checks the project. |
| `npm run render -- map 12` | Draws a map to `out/` as a PNG. Also `tiles` and `units`; add `--summer` or `--winter`, `--palette N`, `--no-units`, `--scale N`. |
| `npm run sketch -- maps/mill-stream.json` | Builds a new map from its sketch, says what is wrong with it, and draws it to `out/`. Add `--play 40` to have the computer play both sides for up to 40 rounds, and `--games 6` to play that many battles. |
| `npm run unpack` | Unpacks every data file into `unpacked/` for inspection, with a `manifest.tsv`. |

## Playing

A round has two halves. In the first the German side moves and the French
side orders attacks; in the second they swap. The toolbar says which is which.

- To move: click a unit of the side that moves, then a bright field.
- To load a unit onto a transport, or put it into a building of its own side:
  move it onto the transport or the building's entrance, which are bright if
  they can take it.
- To see inside: click a building, or a transport that carries something. A
  dialog shows its seven places and the units in them. A loaded transport of
  the side that moves is only selected by the first click, so that it can be
  moved, and opened by a second click on it. An empty transport is only ever
  selected; "Look inside" in the side panel opens either.
- To unload: in that dialog, press "Move out" under a unit that can leave,
  then click a bright field. A transport can move first and unload afterwards.
- To take a building: move infantry, cavalry or another unit that may use any
  entrance onto the entrance of a building that is not its side's. It takes
  the building when the turn ends, if it is still there.
- To attack: click a unit of the side that attacks, then a red field (an enemy
  unit in range). Click the same target again to cancel.
- To build a unit: in the half your side attacks, click one of its factories.
  Under the places the dialog lists what the factory can build, with a "Build"
  button for each kind the side has the points for. Click a kind to see what
  it is and can do beside the list: its speed, armour, weapons, where it can
  go and what it costs. The new unit takes a place and can move out when its
  side next moves.
- To repair a unit: in the half your side attacks, click the building it is
  in and press "Repair" under it.
- To build a depot: in the half your side attacks, click a construction
  unit, then a blue field. The first order prepares the ground; an order on
  prepared ground in a later round builds the depot. Click the field again to
  cancel.
- To dig a trench: in the half your side attacks, click sappers, then a blue
  field next to them. A blue field that is already trench is filled in
  instead.
- "End turn" carries out the attacks ordered, in the order they were given,
  then hands over the buildings taken, has the building and digging done, pays
  the side that moved, and starts
  the next half. The side panel then lists what each attack did and which
  buildings changed hands. The toolbar shows each side's points.
- The attacks of the turn that has just ended come up on the map one after
  another: a white line from each attacker to the field it aimed at (dashed
  if nothing was there any more), the vehicles each unit lost, and a red
  cross on a unit destroyed. They stay until the next click on the map or
  Esc; "Show them on the map again" in the side panel replays them.
- "Restart" puts the map back as the game's files have it.
- The battle in progress on each map is kept as it goes, without being
  asked: after a reload, or a look at another map, it is taken up where it
  was left, the moves and orders of the half under way included. What is not
  kept is the report of the last turn. A battle that is over, or one nothing
  has happened in, is not kept, and "Restart" begins a map afresh.
- "Save" keeps the battle as it stands, orders given in this half included.
  There is one save for each map, and saving again replaces it. "Load" brings
  the map's saved battle back. Maps with a saved battle have a dot in the map
  list. This save is apart from the battle in progress and is only changed
  by "Save". Both are kept in the browser they were made in (its local
  storage for this address), not in a file.
- "Computer" in the toolbar hands a side to the computer: German, French or
  both. It plays its part as each half begins: its moves if its side moves,
  its orders if its side attacks. Yellow lines show where its units moved
  from, and the side panel says what it did. Its attack orders are not shown
  (unless it plays both sides), since a player who saw them could step out of
  the way. Its units can be looked at but not given orders. With both sides
  the computer's, "End turn" plays one half at a time.

What is and is not in yet:

- A unit moves once and attacks once per round. An attack hits whatever enemy
  stands on the field aimed at when the half ends, so a unit that moves away
  in the same half is missed. Medium, heavy and train artillery cannot attack
  in the half after one in which they moved: in a round they move or fire.
- Fights follow `src/game/combat.ts`: losses are worked out, not rolled.
  Units lose vehicles, gain experience, and are removed when none are left. A
  side with no units left has lost.
- Buildings and transports hold up to seven units each; the small number on a
  transport or an entrance is how many. Units inside cannot attack or be
  attacked, but what a transport carries shares its losses and is lost with
  it. A unit cannot leave in the half it went in, and leaves with a short move.
  Taking a building takes the units inside with it, and taking the enemy
  headquarters wins the battle.
- Which side moves first in the original has not been checked. There the two
  players act at the same time on a split screen and do not see each other's
  orders; here everything is visible on one screen.
- Both sides start with no points. A side is paid what its headquarters,
  factories and depots earn when the half it moved in ends, and spends it in
  the next half: on units built in its factories, or 15 points to bring a
  damaged unit inside a building back to full strength.
- Submarines, destroyers and battleships fill two fields and are one unit:
  click either field to select the ship. When it moves, its rear follows on
  the field its front has just left, so it cannot turn round on the spot. It
  attacks from its front field and can be attacked on either.
- A construction unit builds depots: it prepares four fields of open ground
  in one round and builds on them in another, which uses up what it carries.
  A repair in a building restocks it. The new depot is its side's, earns
  nothing, and holds and repairs units like any other. A map holds ten depots
  at most.
- Sappers do not start attacks; they only fire back. They dig a trench three
  fields long across the way to the field picked, on open ground, and fill in
  a trench the same way. Trenches cost the most to cross and are the best
  ground to defend on.
- A saved battle holds the ground, units, buildings, round, orders and
  points, not the game's unit and terrain tables, which are read from the
  game's files again when it is loaded. Destroyed units and the reports of
  past turns are not kept. The format is this project's own; the original's
  saved games are not read.
- The computer's player follows the original's in outline (see below): it
  takes buildings with infantry and cavalry, holds the fields beside its
  headquarters, sends up to four units round each enemy unit, has its guns
  fire from where they stand, pulls damaged units into buildings and repairs
  them, and fills its factories. It does not build depots or dig trenches,
  and it uses transports only to carry what they start with. The original
  has no difficulty setting for it, and neither has this.

## Making maps

New maps are made from sketches: JSON files in `maps/`, each of which the
viewer lists under "New maps" and builds with the installed game's tiles when
it is opened. A sketch names no tiles. It says:

- `ground`: one string for each row and one letter for each field.
  `.` grass, `,` bare ground, `o` craters, `f` forest, `h` houses,
  `^` a hill, `r` rocks, `#` barbed wire (only troops on foot cross it),
  `t` a trench, `p` a pond, `-` shallow water, `~` deep water,
  `*` rocks in water.
- `roads`, `tracks`, `rails`, `rivers`: lists of paths. A path is a list of
  fields, `[column, row]` counted from 0 at the top left; fields that are
  not neighbours are joined by the straightest run between them. Odd columns
  sit half a field lower than even ones.
- `buildings`: `kind` (headquarters, factory, depot), `owner` (german,
  french, neutral), `at` (the field of its entrance), and optionally
  `income`, `worth` (to the computer, as something to take) and `holds`
  (the units inside). A headquarters lies around the field below its
  entrance, a factory to the left of its entrance, a depot below it.
- `scenery`: larger pieces by name, each placed by its topmost field:
  `hill` and `mountain` (four fields), `ridge` (two), `town` (a house
  with two fields of street to its right).
- `units`: `kind` (the game's name for it, or its number), `side`, `at`
  (one field or a list of them), and `holds` for a loaded transport.
- `tiles`: single tiles by terrain number, for what a sketch has no word
  for, such as the footbridges and the harbour pieces.
- `title`, `about`, `season`, `seed` (which look each plain field gets),
  and `buildable` (the kinds factories may build; all of them if left out).

`src/maps/sketch.ts` picks the tiles:

- A road, track, railway or river gets, on each field, the piece that leaves
  it by the right sides. The tile set has bends of 120 degrees but none of
  60, no piece a line ends on (so a line runs to the far side of its last
  field), forks in most but not all directions, and one crossroads. Where a
  track meets a paved road the fork is paved. A road crosses a river, and a
  railway a road, a track or a river, only where the tiles have the
  crossing: a road straight up the map over a river running slantwise, for
  example. Roads cross open water on bridges; railways do not.
- Shallow water beside land becomes shore. Each such field takes the shore
  tile that agrees best with the land, deep water and other shores around
  it, and the fields are gone over until none changes. The tile set has
  eight shores, so not every coastline can be drawn: a field of water with
  land only straight above it has no tile, and the coast has to step past
  it. A river runs out cleanly into the head of a bay, between two shores.
- Buildings and scenery are put down whole. Plain ground gets one of its
  looks, the same one every time for the same seed.

What does not fit is reported as a problem with its field ("no tile has a
road above, a road upper right and nothing else, wanted at 2, 3"), and the
map is still made, so it can be looked at. A sketch in `maps/` is expected to
have none; a test builds each and has the computer fight on it.

A map need not be fair. `--play` shows how lopsided a battle is when the
computer plays both sides; Mill Stream is meant to be hard for the German
side, and the computer's French win it every time.

Not done: trench lines (a trench is one field), the harbour and quay pieces
other than by tile number, picking a winter look (maps draw in either
season as they are), and writing a map out in the game's own file formats.
Whether the original would load such a file has not been tried.

## Layout

- `src/formats` decodes the game's file formats: TPWM compression, library
  archives, sprites, palettes, maps, building files and the unit table.
- `src/gfx` is a software RGBA surface; the browser and the PNG tool draw
  through it, so both show the same pixels.
- `src/game` holds the game's rules: where a unit can move (`movement.ts`),
  what a fight costs (`combat.ts`), and a game in progress with its
  buildings and transports, moves, attack orders and turns (`state.ts`), and
  saving it (`save.ts`). `computer.ts` is the computer's player.
- `src/maps` makes maps from sketches: `pieces.ts` is the table of what
  the tiles show, `sketch.ts` the builder. `maps` holds the sketches.
- `src/viewer` loads the assets and draws a map.
- `src/web` is the viewer's page.
- `tools` holds the command-line tools.

## What is known and what is not

The map, building and library layouts follow the
[ModdingWiki](https://moddingwiki.shikadi.net/wiki/History_Line_1914-1918)
pages for the game. Worked out here: the TPWM stream, the 4-bit sprite nibble
order, the hex grid's geometry, and the unit table.

Unit statistics (`UNIT.DAT`, decoded in `src/formats/unitTypes.ts`): speed,
armour, group size, the three weapons with their ranges, cost, weight and
transport capacity were checked against the data sheets in the game's manual
for all 51 unit types. They agree except that the manual gives anti-tank guns
speed 2 where the file has 3, and gives trains and large ships a group size of
1 and trains a weight, where the file has 6 and 0.

Terrain a unit can enter: each unit type has a mask of seven terrain classes
and each terrain number has one class (`WW1GNDS.DAT`, `WW1GNDW.DAT`). The
classes are the seven kinds of terrain on the manual's data sheets. On the
game's 72 maps every train starts on rail and every ship on water. Of about
5,300 other mobile units, 66 start on terrain their mask excludes, nearly all
of them guns placed in trenches or woods, so the mask limits movement and not
where a map may place a unit.

Maps: 00-47 have a `MAP\nn.COM` file and are the single-player maps; 48-71 are
for two players. Maps 24-47 are the same battlefields as 00-23 (same sizes,
nearly the same terrain) with different starting units.

What the tiles show (`src/maps/pieces.ts`) is in none of the game's files.
The six sides of each tile (land, water, or a road, track, railway or river
crossing) were read off the tiles' pictures, and the pieces that span
several fields off the original maps, where a headquarters, a factory, a
depot, a hill and a mountain are always laid the same way. Checked against
the 72 maps: of about 193,000 pairs of neighbouring fields, all but 0.4%
have sides that go together by this table. Most of the rest are shallow
water straight above or below land, a shore the tile set cannot draw.
Terrain 0x3F, which looks like bare ground with wire on it, has a terrain
class of two bits (deep water and mountains), so troops on foot cross it and
vehicles do not.

### Taken from the hl1914-18 project

[DropIn-Classics/hl1914-18](https://github.com/DropIn-Classics/hl1914-18) is a
C port made by translating the original program's routines. Its notes and
code were read for the facts below; none of its code is used here, and none of
this has been checked against the running game from this project.

- Season: `CODES.DAT` has a 10-byte record per map, and bit 1 of its byte 8
  says the map is played in winter (`src/formats/mapRecords.ts`). 24 of the 72
  maps are winter maps. The record also holds the map's code word.
- Palette: which of `00.PAL`, `01.PAL` and `02.PAL` is used is a setting in
  the game's menu, not tied to the map or season. They differ in unit colours;
  the third is grey.
- Facing: units start facing down the map if German and up if French.
- Movement (`src/game/movement.ts`, with the full rule in its header): a
  unit's budget is byte 0 of its unit record. Entering a field costs byte 3 of
  the terrain record, or byte 4 for aircraft, and the field must be of a class
  the unit's mask allows. A field can be entered while the budget covers its
  cost. Fields holding an enemy unit are closed, and a field next to an enemy
  unit can always be entered but ends the move. Building entrances are closed
  to the other side: bits 0 to 2 of a terrain record's first byte mark French,
  neutral and German ones. The viewer shows the result when a unit is clicked.
  A friendly transport's field costs 2 whatever its terrain, so a unit can
  board a train on its rails.
- Ships that fill two fields (`src/game/state.ts`, with the full rule in its
  header): the two halves are two kinds in the unit table, the second only
  the picture of the rear, and a map names both. A ship's range, and the
  distance to what it attacks, are counted from its first half. A ship
  attacked on its second half defends on that field's ground and fires back
  if that field is next to the attacker, but units around the fight only
  count when the two units' first fields are neighbours.
- Buildings and transports (`src/game/state.ts`, with the full rule in its
  header). A map's `.SHP` records name a headquarters by its side, a factory
  or depot by its number among those of its kind as the map is read row by
  row, and a transport by its number among the transports, first those on the
  map and then those the records themselves make. A factory covers its
  entrance, the two fields to its left and the one beyond; a depot its
  entrance and the three fields below. Which transport carries which unit is
  a pair of bit masks in the unit records (bytes 17-18 and 19-20): supply cars
  carry infantry and guns, supply trains and transport ships nearly every
  ground unit. Loading is limited by seven places and by weight against
  capacity. Leaving, taking a building and what a fight does to a transport's
  load are as the header describes. A taken building's entrance changes to
  its new owner's terrain; the eight terrain numbers for that are the first
  bytes of `AMOK.DAT`.
- Combat (`src/game/combat.ts`, with the full rule in its header): who can
  attack whom and at what range, the bonus from units around the target, the
  support from units beside it, the loss formula, return fire and experience.
  Two small tables come from `HL.EXE` itself and a test checks them against
  the installed file. One point is uncertain: the port's distance routine is
  called with rows and columns the other way round from what gives the
  ordinary distance between fields; the ordinary distance is used here, which
  only matters for how much a long-range gun weakens with distance.
- Points (`src/game/state.ts`, with the full rule in its header): a
  building's "resources" in its `.SHP` record is what it earns its owner
  each round, and a headquarters no record names earns 50. Both sides start
  at 0. Which kinds a map's factories build is the list at the start of its
  `.SHP` file; the first ten kinds are for the German side only and those
  after the 36th for the French only. A kind's price is byte 63 of its unit
  record. The ten kinds with 255 there (the bunker and the ships) are not
  barred by the program, only dear, and no map lists the bunker; a few maps
  do list patrol boats and transport ships. A repair costs 15
  points, 50 for the construction unit. The original takes no more than
  10,000 points into a building's screen; here a side never holds more.
- Depots (`src/game/state.ts`, with the full rule in its header): the
  construction unit is the one kind with bit 6 of byte 18 of its unit record.
  It can work on ten fields near it, listed in `HL.EXE`; ground a depot can
  stand on has bit 7 of the second byte of its terrain record, which open
  plains and trenches have. The terrain numbers of prepared ground and of a
  depot's fields are in `AMOK.DAT`.
- Trenches (`src/game/state.ts`, with the full rule in its header): sappers
  are the one kind with bit 5 of byte 18 of its unit record, and for such a
  unit the program offers digging where it offers other units an attack. The
  three fields of a trench and their terrain numbers, for each of the six
  directions, are two tables in `HL.EXE`. Aimed at a field that is trench,
  the same three fields become open ground (terrain 0x51).
- Guns that are slow to fire: bit 0 of byte 15 of a unit record, set for
  medium, heavy and train artillery. A unit with it that moved in a half and
  is not inside something cannot be given an order in the next half.
- Aircraft and buildings: bit 6 of the second byte of a terrain record marks
  ground an aircraft cannot end a move on, and the program asks it of every
  move. The 16 terrain numbers that have it are the fields of buildings other
  than their entrances and the four of ground prepared for a depot. The same
  16 are of the terrain class no unit kind can enter, so with the game's own
  files no unit reaches them anyway and the check never decides anything. It
  is in `cannotStopReason` all the same.
- The computer's player (`src/game/computer.ts`, with what it does in its
  header). The port shows how the original's works: every unit gets one plan
  with a worth, plans are made in a fixed order (buildings to take, fields by
  the headquarters to hold, repairs, guns that stay to fire, units sent round
  each enemy unit, and a march on the enemy for the rest), and a plan worth
  more takes a unit from one worth less. The worths and limits used here are
  the port's: what makes an enemy unit worth attacking, 110 times a
  building's worth for a factory or depot and 10 times for the headquarters,
  four attackers to a target, 14 points kept back from repairs and 61 from
  building, and a kind to build drawn at random. The code here is written
  for this engine's rules and is simpler in places; its header lists what is
  left out and what is added.
- `MAP\nn.COM` (`src/formats/computerTable.ts`): six bytes for each unit
  kind, telling the computer what the kind is worth as a target and how to
  use it. Only the single-player maps have one.
- Which side the computer plays: the French on maps 00 to 23 and the German
  on maps 24 to 47, so the player is German in the first set and French in
  the second.
- The fifth byte of a building's `.SHP` record is what the building is worth
  to the computer as something to take; 15 for a factory, 10 for a depot and
  20 for a headquarters when no record names it, and 5 once it has been
  taken.

Checked against the installed game's files, by tests: every loaded transport
on the 72 maps is within those loading rules, every field the building
layouts name is marked in the terrain table as part of a building of that
kind, every map has one headquarters for each side, the entrance terrain
found for each kind and owner is the one `AMOK.DAT` lists, and on every map
both sides earn points and their factories build only kinds the map lists.
Every ship of two fields on the maps has its second half where the rule puts
it, on deep water, and still has after a move. All 181 depots and 21 prepared
sites on the maps lie as the depot rule lays them, and its tables are the
ones in `HL.EXE` and `AMOK.DAT`. The trench tables are the ones in `HL.EXE`
too. The ground marked as no place for aircraft to land is those 16 terrain
numbers in both seasons' tables, and no unit's range on any map reaches one.
The 48 `.COM` files are 306 bytes each, 51 kinds of six bytes, in four
versions; the kinds they send to take buildings are ones the rules let do it,
and each version has its side build kinds of its own army only. A test has
the computer play both sides of all 72 maps for twelve rounds.

Read in the hl1914-18 source but not built here:

- A transport that enters a building of its side leaves any supply goods it
  carries there. No unit type in `UNIT.DAT` is marked as goods.
- Of the computer's player: units that escort others (no map's table asks
  for an escort), sending a transport to fetch a unit, and the order in which
  the fields round the headquarters are held, which is a table in `HL.EXE`.

Oddities in the map files: ten `.SHP` records name an owner for their units
that is not the owner the building's entrance shows (so, for example, German
units start inside a depot that is nobody's on map 45), and one record on map
48 names a transport the map does not have.

Not known yet:

- What the "speed" in a unit record is used for. It equals budget divided by
  cost for aircraft and ships on open sky and deep water, but not for ground
  units and trains.
- Bytes 16 and 21-25 of a unit record, and the other bits of bytes 14, 15
  and 17 to 20.
- Several bits of bytes 0 and 1 of a terrain record.
- Bytes 1 and 5 of a `MAP\nn.COM` record, which the game does not read.
- Whether a player of the original sees the other side's units move during a
  half. Here the computer's moves are made as the half begins and are seen.
