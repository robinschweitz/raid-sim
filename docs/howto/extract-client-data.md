# Extracting spell data from your WotLK client

This is done once, on your own machine, with your own 3.3.5a (build 12340) client. The `.dbc`
files are Blizzard game data and are never committed; only the numbers we need end up in the repo.

## 1. Run the extraction straight from the client

The tool reads the six DBC files it needs (`Spell.dbc`, `SpellCastTimes.dbc`, `SpellDifficulty.dbc`,
`SpellDuration.dbc`, `SpellRadius.dbc`, `SpellRange.dbc`) directly from the client's MPQ archives,
read-only. Run it from the repository folder:

    corepack pnpm extract-spells --client E:\WoW_3.3.5a_rising-gods.de --locale deDE --spells <spell ids> --out packages/content/data/spelldata/festergut.json

In Windows PowerShell or cmd, write `corepack pnpm` (plain `pnpm` is usually not on the path there) and
run the command from the repository folder.

- `--locale` picks the language folder under `Data\` (`deDE`, `enGB`, ...). Spell names come out in that
  language. It may be left out when only one locale folder is installed.
- The archives are searched newest first, the way the client applies them: `Data\<locale>\patch-<locale>-3.MPQ`,
  `-2`, `patch-<locale>.MPQ`, `lichking-locale-`, `expansion-locale-`, `locale-<locale>.MPQ`, then
  `Data\patch-3.MPQ` ... `common.MPQ` (extra numbered server patches first). For each file the command
  prints which archive it came from; the output JSON records it as `archive`.
- `--save-dbc <folder>` also writes the six extracted files, for cross-checks with other tools. The
  folder must be outside the repository or under `client-data\` (which git ignores).

Plan 2b lists the Festergut spell ids. The command prints one version string per file, for example
`client-12340:Spell.dbc:0123456789ab`, and any id it could not find.

### Fallback: loose DBC files

If the command reports a compression it does not support (it names the file, the archive and the
compression), export the six files with an MPQ editor (from the archives listed above; the newest
archive's copy wins) or with AzerothCore's `map_extractor`, put them in one folder outside the
repository (or in `client-data\`), and run:

    corepack pnpm extract-spells --dbc C:\wow-dbc --spells <spell ids> --out packages/content/data/spelldata/festergut.json

Both ways give the same hashes and the same output for the same client files.

## 2. Pin the versions

Add the printed version strings to `PINS.spellDataVersions` in `packages/data/src/pins.ts` and to the
"Spell data" section of `docs/sources.md` together with the full SHA-256 hashes, then commit the JSON
file and both changes. From then on, every `spelldata` source in the content must name one of these
versions, or the data check fails.
