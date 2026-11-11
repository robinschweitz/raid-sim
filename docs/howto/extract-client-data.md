# Extracting spell data from your WotLK client

This is done once, on your own machine, with your own 3.3.5a (build 12340) client. The `.dbc`
files are Blizzard game data and are never committed; only the numbers we need end up in the repo.

## 1. Get the six DBC files

You need these files from the client's `DBFilesClient` folder (inside the client's MPQ archives):
`Spell.dbc`, `SpellCastTimes.dbc`, `SpellDifficulty.dbc`, `SpellDuration.dbc`, `SpellRadius.dbc`,
`SpellRange.dbc`.

Two common ways:
- **AzerothCore's extractor**: the `map_extractor` tool from an AzerothCore build writes all DBC files
  of a client into a `dbc` folder (it is the same tool server owners use, so the files are exactly what
  the server reads).
- **An MPQ editor**: open the client's `Data/<locale>/` archives (the locale archive and its patch
  archives, applied in order) and export `DBFilesClient/<name>.dbc`. The latest patch archive's copy
  wins.

Put the six files into one folder outside the repository, for example `C:\wow-dbc\`.

## 2. Run the extraction

    pnpm extract-spells --dbc C:\wow-dbc --spells <spell ids> --out packages/content/data/spelldata/festergut.json

Plan 2b lists the Festergut spell ids. The command prints one version string per file, for example
`client-12340:Spell.dbc:0123456789ab`, and any id it could not find.

## 3. Pin the versions

Add the printed version strings to `PINS.spellDataVersions` in `packages/data/src/pins.ts` and to the
"Spell data" section of `docs/sources.md` together with the full SHA-256 hashes, then commit the JSON
file and both changes. From then on, every `spelldata` source in the content must name one of these
versions, or the data check fails.
