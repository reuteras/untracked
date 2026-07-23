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
