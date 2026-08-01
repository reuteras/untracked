import { createDomainList } from "./domain-list.mjs";

const container = document.getElementById("hostnames");

async function render() {
  const { disabledHostnames } = await chrome.storage.local.get(
    "disabledHostnames"
  );
  const list = createDomainList(disabledHostnames ?? []);
  const hostnames = list.toArray().sort();

  container.textContent = "";

  if (hostnames.length === 0) {
    const empty = document.createElement("p");
    empty.textContent = "No sites excluded — stripping is active everywhere.";
    container.append(empty);
    return;
  }

  const ul = document.createElement("ul");
  for (const hostname of hostnames) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = hostname;

    const reEnable = document.createElement("button");
    reEnable.textContent = "Re-enable";
    reEnable.addEventListener("click", async () => {
      list.toggle(hostname);
      await chrome.storage.local.set({ disabledHostnames: list.toArray() });
    });

    li.append(name, reEnable);
    ul.append(li);
  }
  container.append(ul);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.disabledHostnames) render();
});

render();
