import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl } from "../strip.mjs";

test("plain UTM params stripped", () => {
  assert.equal(
    cleanUrl("https://example.com/?utm_source=newsletter&utm_medium=email"),
    "https://example.com/"
  );
});

test("mixed params: only tracking params removed", () => {
  assert.equal(
    cleanUrl("https://example.com/?page=2&utm_campaign=spring"),
    "https://example.com/?page=2"
  );
});

test("wildcard catch: unlisted utm_* param stripped", () => {
  assert.equal(
    cleanUrl("https://example.com/?utm_custom_thing=foo"),
    "https://example.com/"
  );
});

test("no tracking params: no-op", () => {
  assert.equal(cleanUrl("https://example.com/?page=1"), null);
});

test("no query string at all: no-op", () => {
  assert.equal(cleanUrl("https://example.com/"), null);
});

test("fragment preserved after stripping", () => {
  assert.equal(
    cleanUrl("https://example.com/?utm_source=x#section"),
    "https://example.com/#section"
  );
});

test("fbclid stripped", () => {
  assert.equal(
    cleanUrl("https://example.com/?fbclid=abc123"),
    "https://example.com/"
  );
});

test("gclid stripped", () => {
  assert.equal(
    cleanUrl("https://example.com/?gclid=xyz789"),
    "https://example.com/"
  );
});

test("_bhlid stripped", () => {
  assert.equal(
    cleanUrl("https://example.com/?_bhlid=abc123"),
    "https://example.com/"
  );
});

test("duplicate tracking params: all instances removed", () => {
  assert.equal(
    cleanUrl("https://example.com/?utm_source=a&utm_source=b&page=1"),
    "https://example.com/?page=1"
  );
});

test("non-tracked params left untouched", () => {
  assert.equal(
    cleanUrl("https://example.com/?page=2&sort=asc&utm_id=1"),
    "https://example.com/?page=2&sort=asc"
  );
});

test("invalid URL returns null", () => {
  assert.equal(cleanUrl("not a url"), null);
});

test("tracked param names match case-insensitively", () => {
  assert.equal(
    cleanUrl("https://example.com/?UTM_SOURCE=x&Utm_Medium=y&page=1"),
    "https://example.com/?page=1"
  );
});

test("percent-encoded tracked name is still recognised", () => {
  assert.equal(
    cleanUrl("https://example.com/?%75tm_source=x&page=1"),
    "https://example.com/?page=1"
  );
});

test("untouched params survive byte-for-byte", () => {
  // Rebuilding through URLSearchParams would rewrite every one of these:
  // "/" -> %2F, "@" -> %40, "~" -> %7E, "%20" -> "+", "bare" -> "bare=".
  assert.equal(
    cleanUrl(
      "https://example.com/p?path=/a/b&mail=a@b.com&t=~x&sp=a%20b&sig=AbC%2B%2F%3D&bare&utm_source=x"
    ),
    "https://example.com/p?path=/a/b&mail=a@b.com&t=~x&sp=a%20b&sig=AbC%2B%2F%3D&bare"
  );
});

test("empty segments alone do not trigger a redirect", () => {
  assert.equal(cleanUrl("https://example.com/?&&page=1&"), null);
});

test("empty segments are dropped when a rebuild happens anyway", () => {
  assert.equal(
    cleanUrl("https://example.com/?&utm_source=x&&page=1&"),
    "https://example.com/?page=1"
  );
});

test("malformed percent sequence in a name does not throw", () => {
  assert.equal(
    cleanUrl("https://example.com/?%E0%A4%A=1&utm_source=x"),
    "https://example.com/?%E0%A4%A=1"
  );
});

test("tens of thousands of distinct utm_* params are stripped in linear time", () => {
  // Regression: per-name searchParams.delete() made this quadratic — 20k
  // params took 15s and hung the service worker. Must stay well under 1s.
  const query = Array.from({ length: 50000 }, (_, i) => `utm_${i}=1`).join("&");
  const started = performance.now();
  const result = cleanUrl(`https://example.com/?${query}&page=1`);
  const elapsed = performance.now() - started;
  assert.equal(result, "https://example.com/?page=1");
  assert.ok(elapsed < 1000, `took ${elapsed.toFixed(0)}ms`);
});
