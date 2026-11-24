// The calibration is made exclusively with the frozen baseline. Neither a new
// candidate nor a failed verification run can increase the timing allowances.
import assert from "node:assert/strict";

export const baseline = "030bc84ef9871587c55917da6e1fc46de7410c8d";
export const calibrationSize = 4;
const counts = [1, 2, 4];
// Existing Chromium scrolling diagnostic ceiling (docs/search-preview-diagnostics.md).
const maxRepeatabilityMs = 2;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function quantile95(samples) {
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
}

export function validateLane(results) {
  assert.deepEqual(results.map(group => group.count), counts);
  for (const { count, rounds, anchor } of results) {
    assert.equal(rounds.length, 3);
    assert.ok(anchor.restored, 'Reading anchor failed to restore in ' + count + ' streams');
    for (const [j, r] of rounds.entries()) {
      const start = j * 120 * 32;
      assert.deepEqual(r.workload.inputs, Array.from({ length: 120 }, (_, i) => start + (i + 1) * 32));
      assert.equal(r.workload.before[0].scrollTop, start);
      assert.equal(r.workload.after[0].scrollTop, start + 120 * 32);
      assert.equal(r.workload.visited.length, count);
      assert.ok(r.workload.visited[0].count > r.workload.before[0].visible.length);
      for (const state of [...r.workload.before, ...r.workload.after]) {
        assert.ok(state.visible.length && state.columns > 0 && state.hydrated.count >= state.visible.length);
      }
      assert.equal(r.intervalsMs.length, 120);
      assert.ok(r.intervalsMs.every(value => Number.isFinite(value) && value > 0));
      assert.ok(Math.abs(quantile95(r.intervalsMs) - r.p95) < 0.011);
      assert.ok(Number.isFinite(r.cadenceMs) && r.cadenceMs > 0);
      assert.equal(r.missedFrames, r.intervalsMs.filter(ms => ms > 1.5 * r.cadenceMs).length);
      assert.ok(r.rendererMs.TaskDuration > 0);
      assert.equal(r.blanks, 0, 'Blank viewport');
      assert.equal(r.siblingsMoved, false, 'Inactive stream moved');
      assert.ok(r.maxCorrection < r.height && r.endScroll > 0, 'Jump or no scroll');
    }
  }
}

export function matchWork(left, right) {
  validateLane(left);
  validateLane(right);
  for (const [i, group] of right.entries()) {
    for (const [j, r] of group.rounds.entries()) {
      const ref = left[i].rounds[j];
      const where = group.count + ' streams, segment ' + (j + 1);
      assert.deepEqual([r.width, r.height], [ref.width, ref.height], 'Viewport mismatch: ' + where);
      assert.deepEqual(r.workload, ref.workload, 'Scroll workload mismatch: ' + where);
      assert.ok(Math.abs(r.cadenceMs - ref.cadenceMs) < 1, 'Display cadence mismatch: ' + where);
    }
  }
}

function differences(ref, test) {
  const paired = test.map((r, i) => ({
    p95: r.p95 - ref[i].p95,
    // Absolute time per 120 frames includes script, layout, and paint work.
    busy: (r.rendererMs.TaskDuration - ref[i].rendererMs.TaskDuration) / ref[i].rendererMs.TaskDuration,
    missed: r.missedFrames - ref[i].missedFrames,
  }));
  return {
    p95Ms: median(paired.map(d => d.p95)),
    busyFraction: median(paired.map(d => d.busy)),
    missedFrames: median(paired.map(d => d.missed)),
  };
}

export function calibrate(lanes) {
  assert.equal(lanes.length, calibrationSize);
  const spread = { p95Ms: 0, busyFraction: 0, missedFrames: 0 };
  for (let a = 0; a < lanes.length; a++) {
    for (let b = a + 1; b < lanes.length; b++) {
      matchWork(lanes[a], lanes[b]);
      for (let i = 0; i < counts.length; i++) {
        const d = differences(lanes[a][i].rounds, lanes[b][i].rounds);
        // A machine-wide repeatability estimate, always comparing the same
        // stream count and segment before pooling the worst absolute difference.
        for (const key of Object.keys(spread)) spread[key] = Math.max(spread[key], Math.abs(d[key]));
        const reverse = differences(lanes[b][i].rounds, lanes[a][i].rounds);
        spread.busyFraction = Math.max(spread.busyFraction, Math.abs(reverse.busyFraction));
      }
    }
  }
  return {
    spread,
    limit: {
      // The original gate used 0.1 ms for the host timestamp resolution.
      p95Ms: Math.min(maxRepeatabilityMs, spread.p95Ms + 0.1),
      busyFraction: spread.busyFraction,
      missedFrames: spread.missedFrames,
    }
  };
}

export function compare(lanes, limit) {
  const [before, after] = lanes;
  matchWork(before, after);
  return after.map(({ count, rounds }, i) => {
    const ref = before[i].rounds;
    const delta = differences(ref, rounds);
    const failed = Object.keys(delta).filter(key => delta[key] > limit[key] + 1e-9);
    // Independently forbid a P95 slipping into the next display interval.
    // Slow references make the timing comparison invalid rather than easier.
    if (ref.some(r => r.p95 > 1.5 * r.cadenceMs)) failed.push("baselineFrameBudget");
    if (rounds.some(r => r.p95 > 1.5 * r.cadenceMs)) failed.push("candidateFrameBudget");
    const legacyPass = Math.min(...rounds.map(r => r.p95)) <= Math.max(...ref.map(r => r.p95)) + 0.1;
    return { count, delta, limit, legacyPass, failed };
  });
}

// Segments within one application launch share a renderer and cache. The
// independent replicate for a release decision is a fresh pair of launches.
export function decide(pairs) {
  assert.equal(pairs.length, 3, "The experiment has three preassigned launch pairs");
  return counts.map((count, i) => {
    const results = pairs.map(pair => pair[i]);
    assert.ok(results.every(r => r.count === count));
    const failures = {};
    for (const r of results) {
      for (const key of r.failed) failures[key] = (failures[key] ?? 0) + 1;
    }
    const failed = Object.keys(failures).filter(key =>
      key.endsWith("FrameBudget") || failures[key] >= 2);
    // Retain sensitivity to sub-envelope differences if the original gate
    // separates every candidate launch from its matched reference.
    if (results.every(r => !r.legacyPass)) failed.push("consistentLegacySeparation");
    return { count, failures, failed, pairs: results };
  });
}
