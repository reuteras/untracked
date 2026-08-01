import { test } from "node:test";
import assert from "node:assert/strict";
import { createDomainList, hostnameOf } from "../domain-list.mjs";

test("hostnameOf returns the hostname for http(s) URLs", () => {
  assert.equal(hostnameOf("https://example.com/path?x=1"), "example.com");
  assert.equal(hostnameOf("http://example.com/"), "example.com");
});

test("hostnameOf ignores Chrome's internal failed-navigation page", () => {
  // Regression: this used to parse to hostname "chromewebdata", letting a
  // failed load's error page get badged and toggled instead of the real
  // site whose navigation actually failed.
  assert.equal(hostnameOf("chrome-error://chromewebdata/"), "");
});

test("hostnameOf ignores other non-http(s) pages", () => {
  assert.equal(hostnameOf("chrome://newtab/"), "");
  assert.equal(hostnameOf("about:blank"), "");
  assert.equal(hostnameOf("data:text/html,hi"), "");
});

test("hostnameOf returns empty string for unparseable input", () => {
  assert.equal(hostnameOf("not a url"), "");
});

test("hostname is not disabled by default", () => {
  const list = createDomainList();
  assert.equal(list.isDisabled("example.com"), false);
});

test("toggle disables an enabled hostname", () => {
  const list = createDomainList();
  const nowDisabled = list.toggle("example.com");
  assert.equal(nowDisabled, true);
  assert.equal(list.isDisabled("example.com"), true);
});

test("toggle re-enables a disabled hostname", () => {
  const list = createDomainList(["example.com"]);
  const nowDisabled = list.toggle("example.com");
  assert.equal(nowDisabled, false);
  assert.equal(list.isDisabled("example.com"), false);
});

test("matching is by exact hostname, not by site", () => {
  const list = createDomainList(["app.sw.broadcom.com"]);
  assert.equal(list.isDisabled("app.sw.broadcom.com"), true);
  assert.equal(list.isDisabled("broadcom.com"), false);
  assert.equal(list.isDisabled("other.broadcom.com"), false);
});

test("toArray reflects current disabled set", () => {
  const list = createDomainList(["a.com"]);
  list.toggle("b.com");
  assert.deepEqual([...list.toArray()].sort(), ["a.com", "b.com"]);
});

test("initialHostnames seeds the disabled set", () => {
  const list = createDomainList(["seeded.example.com"]);
  assert.equal(list.isDisabled("seeded.example.com"), true);
});
