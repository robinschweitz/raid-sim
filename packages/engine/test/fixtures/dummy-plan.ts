export const PLAN_YAML = `
id: dummy-basic
boss: dummy
roster:
  - { id: t1, name: Tanky, kind: standin, role: tank, maxHealth: 40000, ratePerSecond: 500, reaction: { minMs: 300, maxMs: 300 } }
  - { id: h1, name: Healy, kind: standin, role: healer, maxHealth: 20000, ratePerSecond: 800, reaction: { minMs: 300, maxMs: 300 } }
  - { id: p1, name: Alice, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p2, name: Bob, kind: modelled, spec: test_caster, profile: default, reaction: { minMs: 300, maxMs: 500 } }
  - { id: p3, name: Cara, kind: standin, role: ranged, maxHealth: 20000, ratePerSecond: 1000, reaction: { minMs: 300, maxMs: 500 } }
spots:
  tank: { x: 6, y: 0 }
  heal: { x: -20, y: 0 }
  ranged: { x: 20, y: 0 }
  far: { x: 50, y: 0 }
phases:
  - phase: default
    assignments: { t1: tank, h1: heal, p1: ranged, p2: ranged, p3: ranged }
rules:
  - id: run-when-marked
    who: [p1, p2, p3, h1]
    when: { on: aura_applied, aura: mark, target: self }
    do: { do: move_to, spot: far }
    priority: 60
`;

export const SCENARIO_YAML = `
id: dummy-clean
plan: dummy-plan.yaml
difficulty: 25n
seed: 1234
maxDurationMs: 30000
observation:
  text: scenario.dummy_clean.observation
  checks:
    - { check: outcome_is, outcome: timeout }
    - { check: event_occurs, kind: aura_applied, where: { aura: mark } }
`;
