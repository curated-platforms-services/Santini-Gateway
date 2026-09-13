let token = sessionStorage.getItem("santiniAdminToken") || "";

const byId = (id) => document.getElementById(id);
const statusNode = byId("status");

byId("token").value = token;

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.className = isError ? "error" : "";
}

function headers() {
  return {
    "content-type": "application/json",
    "authorization": `Bearer ${token}`
  };
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error?.message || `Request failed with HTTP ${response.status}`);
  }
  return body;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[character]));
}

async function loadRuntime() {
  const node = byId("runtime");
  try {
    const { runtime, note } = await api("/api/admin/runtime");
    const names = runtime.activeSubgraphs.length
      ? runtime.activeSubgraphs.map((item) => escapeHtml(item.name)).join(", ")
      : "none";

    node.innerHTML = `
      <p><strong>${runtime.ready ? "Ready" : "Not ready"}</strong></p>
      <p class="muted">Active subgraphs: ${names}</p>
      <p class="muted">${escapeHtml(note)}</p>
      ${runtime.compositionError ? `<p class="error">${escapeHtml(runtime.compositionError)}</p>` : ""}
    `;
  } catch (error) {
    node.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function loadAudit() {
  const node = byId("audit");
  try {
    const { events } = await api("/api/admin/audit-events");
    if (!events.length) {
      node.innerHTML = `<p class="muted">No configuration changes recorded.</p>`;
      return;
    }

    node.innerHTML = `<ul>${events.map((event) => `
      <li>
        <strong>${escapeHtml(event.eventType)}</strong>
        <span class="muted">${new Date(event.createdAt).toLocaleString()}</span>
      </li>
    `).join("")}</ul>`;
  } catch (error) {
    node.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

async function validateSubgraph(id, output) {
  output.textContent = "Validation in progress…";
  try {
    await api(`/api/admin/subgraphs/${id}/validate`, { method: "POST" });
    output.textContent = "Endpoint validation succeeded.";
  } catch (error) {
    output.textContent = `Validation failed: ${error.message}`;
    output.className = "error";
  }
}

async function updateEnabled(id, enabled) {
  await api(`/api/admin/subgraphs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled })
  });
  setStatus("Configuration saved. Restart or redeploy the gateway to activate composition changes.");
  await refresh();
}

async function loadSubgraphs() {
  const root = byId("subgraphs");
  const { subgraphs } = await api("/api/admin/subgraphs");

  if (!subgraphs.length) {
    root.innerHTML = `<p class="muted">No subgraphs registered. Register one, validate it, then restart the gateway.</p>`;
    return;
  }

  root.innerHTML = "";
  for (const subgraph of subgraphs) {
    const item = document.createElement("article");
    item.className = "subgraph";
    item.innerHTML = `
      <div class="subgraph-name">
        <strong>${escapeHtml(subgraph.name)}</strong>
        <span class="badge ${subgraph.enabled ? "enabled" : "disabled"}">
          ${subgraph.enabled ? "enabled" : "disabled"}
        </span>
      </div>
      <p><code>${escapeHtml(subgraph.url)}</code></p>
      <button class="validate" type="button">Validate endpoint</button>
      <button class="secondary toggle" type="button">
        ${subgraph.enabled ? "Disable" : "Enable"}
      </button>
      <p class="muted result"></p>
    `;

    item.querySelector(".validate").onclick = () =>
      validateSubgraph(subgraph.id, item.querySelector(".result"));

    item.querySelector(".toggle").onclick = async () => {
      try {
        await updateEnabled(subgraph.id, !subgraph.enabled);
      } catch (error) {
        setStatus(error.message, true);
      }
    };

    root.appendChild(item);
  }
}

async function refresh() {
  if (!token) {
    setStatus("Enter an administrator token before loading configuration.", true);
    return;
  }

  setStatus("Loading gateway configuration…");
  try {
    await Promise.all([loadSubgraphs(), loadRuntime(), loadAudit()]);
    setStatus("Gateway configuration loaded.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

byId("save-token").onclick = () => {
  token = byId("token").value.trim();
  if (!token) {
    setStatus("Administrator token is required.", true);
    return;
  }
  sessionStorage.setItem("santiniAdminToken", token);
  refresh();
};

byId("refresh").onclick = refresh;

byId("subgraph-form").onsubmit = async (event) => {
  event.preventDefault();

  if (!token) {
    setStatus("Enter an administrator token first.", true);
    return;
  }

  const form = new FormData(event.currentTarget);
  const payload = {
    name: form.get("name"),
    url: form.get("url"),
    enabled: form.get("enabled") === "on"
  };

  try {
    await api("/api/admin/subgraphs", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    byId("enabled").checked = true;
    setStatus("Subgraph saved. Validate it, then restart or redeploy to activate it.");
    await refresh();
  } catch (error) {
    setStatus(error.message, true);
  }
};