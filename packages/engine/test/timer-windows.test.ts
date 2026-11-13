import { describe, expect, it } from 'vitest';
import { EventScriptedAI, attachBoss, type BossContext, type MechanicStatus } from '../src/boss';
import { installCoreRules } from '../src/casting';
import { EventMap } from '../src/eventmap';
import { RngRegistry } from '../src/rng';
import { Simulation } from '../src/sim';
import { ThreatManager } from '../src/threat';

const newMap = () => new EventMap(new RngRegistry(1).stream('test.timers'));

describe('EventMap time-until query (GetTimeUntilEvent, EventMap.cpp 200–212)', () => {
  it('gives the time until the earliest event with the id, or null', () => {
    const m = newMap();
    expect(m.timeUntilEvent(1)).toBeNull();
    expect(m.hasTimeUntilEvent(1)).toBe(false);
    m.schedule(1, 5000);
    m.schedule(1, 2000);
    m.schedule(2, 3000);
    m.update(500);
    expect(m.timeUntilEvent(1)).toBe(1500);
    expect(m.timeUntilEvent(2)).toBe(2500);
    expect(m.hasTimeUntilEvent(2)).toBe(true);
  });

  it('follows delays, reschedules and execution', () => {
    const m = newMap();
    m.schedule(1, 1000, 1);
    m.delayEventsToMax(4000, 1);
    expect(m.timeUntilEvent(1)).toBe(4000);
    m.reschedule(1, 700);
    expect(m.timeUntilEvent(1)).toBe(700);
    m.update(900);
    expect(m.timeUntilEvent(1)).toBe(-200);
    expect(m.execute()).toBe(1);
    expect(m.timeUntilEvent(1)).toBeNull();
  });
});

const EVENT_A = 1;
const EVENT_B = 2;
const GROUP_B = 1;

/** A: every 10 s, delays group 1 to at least 8 s. B: first after 12 to 15 s. */
class WindowAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  constructor(private readonly mode: 'ok' | 'wrong_window' | 'cancel_b') {
    super();
  }
  protected engage(ctx: BossContext): void {
    this.events.schedule(EVENT_A, 10000);
    this.publishWindow(ctx, 'a', EVENT_A, 10000, 10000, []);
    this.events.scheduleRange(EVENT_B, 12000, 15000, GROUP_B);
    if (this.mode === 'wrong_window') this.publishWindow(ctx, 'b', EVENT_B, 20000, 30000, []);
    else this.publishWindow(ctx, 'b', EVENT_B, 12000, 15000, []);
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    const ev = ctx.ai(id === EVENT_A ? 'a' : 'b');
    if (id !== EVENT_A) return;
    if (this.mode === 'cancel_b') this.events.cancel(EVENT_B);
    this.events.delayEventsToMax(8000, GROUP_B);
    this.raiseWindow(ctx, EVENT_B, 8000, [ev]);
    this.events.schedule(EVENT_A, 10000);
    this.publishWindow(ctx, 'a_again', EVENT_A, 10000, 10000, [ev]);
  }
}

function run(mode: 'ok' | 'wrong_window' | 'cancel_b') {
  const sim = new Simulation({ seed: 3, maxDurationMs: 19000, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ id: 'p1', name: 'p1', kind: 'player', role: 'tank', maxHealth: 1000, pos: { x: 5, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 'p1', 1);
  attachBoss(sim, new WindowAI(mode), 'boss', 10);
  sim.run();
  return sim;
}

const windows = (sim: Simulation) =>
  sim.trace
    .list()
    .filter((e) => e.kind === 'timer_window')
    .map((e) => [e.t, e.data.ability, e.data.earliestMs, e.data.latestMs]);

describe('published timer windows follow the EventMap (A-034)', () => {
  it('a delay raises both bounds to the floor, and the event fires inside its window', () => {
    const sim = run('ok');
    expect(windows(sim)).toEqual([
      [0, 'a', 10000, 10000],
      [0, 'b', 12000, 15000],
      // A at 10 s delays B to at least 18 s: both bounds were below it.
      [10000, 'b', 18000, 18000],
      // The same event under a new name: the old name is cleared first.
      [10000, 'a', null, null],
      [10000, 'a_again', 20000, 20000],
      // B was a one-shot: its window is cleared by the check after the update in which it fired.
      [18000, 'b', null, null],
    ]);
    const b = sim.trace.list().find((e) => e.kind === 'ai_event' && e.data.event === 'b');
    expect(b?.t).toBe(18000);
    expect(sim.timerWindows.has('boss|b')).toBe(false);
  });

  it('a window that does not contain its event throws', () => {
    expect(() => run('wrong_window')).toThrow(/timer window b \[20000, 30000\] does not contain event 2 \(due in 1\d{4} ms\)/);
  });

  it('a window whose event is gone is cleared', () => {
    const sim = run('cancel_b');
    expect(windows(sim)).toContainEqual([10000, 'b', null, null]);
    expect(sim.timerWindows.has('boss|b')).toBe(false);
  });
});

/** Scripts that break the contract after the fact, to see the automatic check after every update. */
class AutoAI extends EventScriptedAI {
  readonly bossId = 'boss';
  readonly mechanics: readonly MechanicStatus[] = [];
  constructor(private readonly mode: 'reschedule_unpublished' | 'one_shot' | 'same_name' | 'partial_raise' | 'unchanged_raise' | 'fixed_delay' | 'fixed_delay_inside' | 'script_cleared') {
    super();
  }
  protected engage(ctx: BossContext): void {
    this.events.schedule(EVENT_A, 5000);
    this.publishWindow(ctx, 'a', EVENT_A, 5000, 5000, []);
    if (this.mode === 'same_name') {
      this.events.schedule(EVENT_B, 6000);
      this.publishWindow(ctx, 'a', EVENT_B, 6000, 6000, []);
    }
    if (this.mode === 'partial_raise' || this.mode === 'unchanged_raise') {
      this.events.scheduleRange(EVENT_B, 8000, 15000, GROUP_B);
      this.publishWindow(ctx, 'b', EVENT_B, 8000, 15000, []);
    }
    if (this.mode === 'fixed_delay' || this.mode === 'fixed_delay_inside') {
      // A fixed time inside a published window of 8 to 15 s.
      this.events.schedule(EVENT_B, this.mode === 'fixed_delay' ? 14000 : 9000, GROUP_B);
      this.publishWindow(ctx, 'b', EVENT_B, 8000, 15000, []);
    }
  }
  protected executeEvent(id: number, ctx: BossContext): void {
    if (id !== EVENT_A) return;
    const ev = ctx.ai('a');
    switch (this.mode) {
      case 'reschedule_unpublished':
        this.events.schedule(EVENT_A, 3000);
        return;
      case 'partial_raise':
        // B is due at 8 to 15 s; at 5 s a floor of 7 s means 12 s: the earliest bound moves, the latest stays.
        this.events.delayEventsToMax(7000, GROUP_B);
        this.raiseWindow(ctx, EVENT_B, 7000, [ev]);
        return;
      case 'unchanged_raise':
        this.events.delayEventsToMax(1000, GROUP_B);
        this.raiseWindow(ctx, EVENT_B, 1000, [ev]);
        return;
      case 'fixed_delay':
      case 'fixed_delay_inside':
        // DelayEvents adds the amount to the event's time (EventMap.cpp 122–142); it is not a floor.
        this.events.delayEvents(2000, GROUP_B);
        this.raiseWindow(ctx, EVENT_B, 2000, [ev]);
        return;
      case 'script_cleared':
        // The script clears the window of its one-shot itself, with its own cause.
        ctx.clearTimer('a', [ev]);
        return;
      default:
        return;
    }
  }
}

function runAuto(mode: ConstructorParameters<typeof AutoAI>[0], maxDurationMs = 9000) {
  const sim = new Simulation({ seed: 3, maxDurationMs, sampleIntervalMs: 1000 });
  installCoreRules(sim);
  sim.addUnit({ id: 'boss', name: 'Boss', kind: 'creature', role: 'boss', maxHealth: 1e6, pos: { x: 0, y: 0 }, speedYdPerSec: 0, combatReach: 5, boundingRadius: 2 });
  sim.addUnit({ id: 'p1', name: 'p1', kind: 'player', role: 'tank', maxHealth: 1000, pos: { x: 5, y: 0 }, speedYdPerSec: 7, combatReach: 1.5, boundingRadius: 0.389 });
  const threat = new ThreatManager(sim, 1000);
  threat.install();
  threat.add('boss', 'p1', 1);
  attachBoss(sim, new AutoAI(mode), 'boss', 10);
  sim.run();
  return sim;
}

describe('the check after every boss update (fixups)', () => {
  it('an event rescheduled without publishing throws', () => {
    expect(() => runAuto('reschedule_unpublished')).toThrow(/timer window a \[5000, 5000\] does not contain event 1 \(due at 8\d{3}\)/);
  });

  it('the window of a one-shot event is cleared after it fires', () => {
    const sim = runAuto('one_shot');
    expect(windows(sim)).toEqual([
      [0, 'a', 5000, 5000],
      [5000, 'a', null, null],
    ]);
    expect(sim.timerWindows.has('boss|a')).toBe(false);
  });

  it('two events cannot publish under one ability name', () => {
    expect(() => runAuto('same_name')).toThrow(/timer window name a is already used by event 1, not event 2/);
  });

  it('a raise that moves one bound republishes the window with the other unchanged', () => {
    const sim = runAuto('partial_raise', 6000);
    expect(windows(sim).filter((w) => w[1] === 'b')).toEqual([
      [0, 'b', 8000, 15000],
      [5000, 'b', 12000, 15000],
    ]);
  });

  it('a raise that changes nothing is not published again', () => {
    const sim = runAuto('unchanged_raise', 6000);
    expect(windows(sim).filter((w) => w[1] === 'b')).toEqual([[0, 'b', 8000, 15000]]);
  });

  it('a fixed-amount delay that moves the event out of its window throws in the check after the update', () => {
    // B at 14 s, window 8 to 15 s; at 5 s DelayEvents adds 2 s: due at 16 s. The floor of 7 s does not move the window.
    expect(() => runAuto('fixed_delay', 6000)).toThrow(/timer window b \[8000, 15000\] does not contain event 2 \(due at 16000\)/);
  });

  it('a fixed-amount delay that keeps the event inside its window passes', () => {
    // B at 9 s, delayed to 11 s: still inside 8 to 15 s, and the window is not published again.
    const sim = runAuto('fixed_delay_inside', 12000);
    expect(windows(sim).filter((w) => w[1] === 'b')).toEqual([
      [0, 'b', 8000, 15000],
      [11000, 'b', null, null],
    ]);
  });

  it('a window cleared by the check names the AI event that last executed as its cause', () => {
    const sim = runAuto('one_shot');
    const a = sim.trace.list().find((e) => e.kind === 'ai_event' && e.data.event === 'a');
    const cleared = sim.trace.list().filter((e) => e.kind === 'timer_window' && e.data.cleared === true);
    expect(a).toBeDefined();
    expect(cleared.map((e) => [e.t, e.data.ability, e.causes])).toEqual([[5000, 'a', [a!.id]]]);
  });

  it('a window the script cleared itself is not cleared a second time', () => {
    const sim = runAuto('script_cleared');
    const a = sim.trace.list().find((e) => e.kind === 'ai_event' && e.data.event === 'a');
    const cleared = sim.trace.list().filter((e) => e.kind === 'timer_window' && e.data.cleared === true);
    expect(cleared.map((e) => [e.t, e.data.ability, e.causes])).toEqual([[5000, 'a', [a!.id]]]);
  });
});
