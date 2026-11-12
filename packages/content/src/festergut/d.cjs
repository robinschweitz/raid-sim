const fs=require('fs');const f='docs/adaptations.md';let s=fs.readFileSync(f,'utf8');
const rep=(o,n)=>{if(s.split(o).length-1!==1)throw new Error('no match '+o);s=s.replace(o,()=>n);};
rep("Generic rule; a boss script can define a different behaviour for a specific aura.","Generic rule; until a dedicated hook exists (Plan 2), a boss script can handle the specific aura via `sim.subscribe`.");
rep("and use fixed ranges (melee and tank 5 yd, ranged and healer 40 yd).","and use fixed ranges (melee and tank 5 yd, ranged and healer 40 yd; all parameters are `assumption` entries in `core-data.ts`).");
const m=s.match(/(\| A-015 [^\r\n]*)(\r?\n)/);const nl=m[2];
const rows=[
"| A-016 | Auras stack per caster: an aura instance is keyed by aura and caster (`aura|caster`), so two casters' copies of one aura coexist and only the same caster's copy stacks and refreshes. | One rule for stacking; matches how per-caster debuffs behave in the game. | `auras.test.ts` |",
"| A-017 | Damage and healing amounts are rounded half-up to whole numbers before they are applied. | Health is an integer; one deterministic rounding rule. | `sim.test.ts` |",
"| A-018 | A spell's cooldown starts when the cast succeeds, not when it begins. | A cast that fails or is interrupted does not consume the cooldown. | `casting.test.ts` |",
];
s=s.replace(m[0],()=>m[1]+nl+rows.join(nl)+nl);
fs.writeFileSync(f,s);
