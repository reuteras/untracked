import { test } from "node:test";
import assert from "node:assert/strict";
import { createRedirectGuard } from "../redirect-guard.mjs";

function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

test("allows redirects up to the limit", () => {
  const { now } = makeClock();
  const guard = createRedirectGuard({ limit: 5, windowMs: 3000, now });
  for (let i = 0; i < 5; i++) {
    assert.equal(guard.isLooping(1), false);
  }
});

test("trips once the limit is exceeded within the window", () => {
  const { now } = makeClock();
  const guard = createRedirectGuard({ limit: 3, windowMs: 3000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true);
});

test("stays tripped while calls keep arriving inside the window", () => {
  const { now, advance } = makeClock();
  const guard = createRedirectGuard({ limit: 1, windowMs: 3000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true);
  advance(100);
  assert.equal(guard.isLooping(1), true);
});

test("resets once the window elapses without a call", () => {
  const { now, advance } = makeClock();
  const guard = createRedirectGuard({ limit: 2, windowMs: 1000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true);

  advance(1001);
  assert.equal(guard.isLooping(1), false);
});

test("tracks tabs independently", () => {
  const { now } = makeClock();
  const guard = createRedirectGuard({ limit: 1, windowMs: 3000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true);
  assert.equal(guard.isLooping(2), false);
});

test("forget() clears state for a tab", () => {
  const { now } = makeClock();
  const guard = createRedirectGuard({ limit: 1, windowMs: 3000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true);
  guard.forget(1);
  assert.equal(guard.isLooping(1), false);
});

test("once tripped, continued attempts keep it tripped past the original window", () => {
  const { now, advance } = makeClock();
  const guard = createRedirectGuard({ limit: 1, windowMs: 1000, now });
  assert.equal(guard.isLooping(1), false);
  assert.equal(guard.isLooping(1), true); // tripped at t=0

  // A page that keeps looping every 600ms never gets a quiet window.
  for (let i = 0; i < 5; i++) {
    advance(600);
    assert.equal(guard.isLooping(1), true);
  }

  // Only a full quiet window releases it.
  advance(1001);
  assert.equal(guard.isLooping(1), false);
});

test("under the limit the window is fixed, so slow legitimate use never accumulates", () => {
  const { now, advance } = makeClock();
  const guard = createRedirectGuard({ limit: 2, windowMs: 1000, now });
  // One tracked link every 700ms: at most two per fixed window, never trips.
  for (let i = 0; i < 10; i++) {
    assert.equal(guard.isLooping(1), false);
    advance(700);
  }
});
