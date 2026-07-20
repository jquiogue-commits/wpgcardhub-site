// Admin batch flyer import.
//
// Reuses the same admin-gated `parse-flyer` Edge Function the iOS app calls,
// and writes to the same `shows` table via PostgREST — RLS (is_admin) is what
// actually gates the writes, not anything in this file. New shows get the
// region's default centroid as their coordinate (same fallback CreateShowView
// uses); run "Fix map locations" in the app afterward to geocode them
// precisely, rather than adding a second geocoding dependency here.

const REGION_CENTROIDS = {
  "Winnipeg": { latitude: 49.8951, longitude: -97.1384 },
  "Rural MB": { latitude: 49.8485, longitude: -98.9501 },
};
const CATEGORIES = ["Sports", "Pokémon", "TCG", "Multi-Genre"];
const REGIONS = ["Winnipeg", "Rural MB"];

// ---------------------------------------------------------------------------
// Session

let session = null; // { accessToken, refreshToken, expiresAt, userId }

function loadSession() {
  try {
    const raw = sessionStorage.getItem("wpg_admin_session");
    if (raw) session = JSON.parse(raw);
  } catch { /* ignore */ }
}

function saveSession() {
  sessionStorage.setItem("wpg_admin_session", JSON.stringify(session));
}

function clearSession() {
  session = null;
  sessionStorage.removeItem("wpg_admin_session");
}

async function ensureFreshToken() {
  if (!session) throw new Error("Not signed in.");
  if (Date.now() < session.expiresAt - 30000) return session.accessToken;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: session.refreshToken }),
  });
  if (!res.ok) { clearSession(); throw new Error("Session expired — please sign in again."); }
  const data = await res.json();
  session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    userId: session.userId,
  };
  saveSession();
  return session.accessToken;
}

async function signIn(email, password) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.msg || "Sign-in failed.");

  session = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    userId: data.user.id,
  };
  saveSession();

  const roleRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.userId}&select=role`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.accessToken}` } }
  );
  const rows = await roleRes.json();
  if (!roleRes.ok || rows[0]?.role !== "admin") {
    clearSession();
    throw new Error("That account isn't an admin.");
  }
  return data.user.email;
}

function signOut() {
  clearSession();
  location.reload();
}

// ---------------------------------------------------------------------------
// Image helpers

/** Downscales + re-encodes an image file to a bounded JPEG Blob (mirrors ImageOptimizer.swift). */
function toJpeg(file, maxDimension = 1600, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Could not encode image.")), "image/jpeg", quality);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error("Could not read that image."));
    };
    img.src = URL.createObjectURL(file);
  });
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read image data."));
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Flyer parsing

async function parseFlyer(jpegBlob) {
  const base64 = await blobToBase64(jpegBlob);
  const token = await ensureFreshToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/parse-flyer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ image: base64, media_type: "image/jpeg" }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Flyer import failed.");
  return data;
}

function mapCategory(raw) {
  if (CATEGORIES.includes(raw)) return raw;
  const s = (raw || "").toLowerCase();
  if (s.includes("sport")) return "Sports";
  if (s.includes("pok")) return "Pokémon";
  if (s.includes("tcg") || s.includes("magic") || s.includes("yu-gi") || s.includes("yugioh")) return "TCG";
  return "Multi-Genre";
}

function mapRegion(raw, city) {
  if (REGIONS.includes(raw)) return raw;
  const s = `${raw || ""} ${city || ""}`.toLowerCase();
  if (s.includes("winnipeg")) return "Winnipeg";
  return "Rural MB";
}

function parseAdmission(raw) {
  if (!raw) return 0;
  if (raw.toLowerCase().includes("free")) return 0;
  const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** Converts a Winnipeg wall-clock date+time into the correct UTC Date, handling CST/CDT. */
function winnipegLocalToUTC(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "10:00").split(":").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Winnipeg", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(guess).map((p) => [p.type, p.value]));
  const renderedAsUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offset = renderedAsUTC - guess.getTime();
  return new Date(guess.getTime() - offset);
}

// ---------------------------------------------------------------------------
// Rows

let rows = [];
let rowSeq = 0;

function addRow(file, parsed) {
  const id = ++rowSeq;
  rows.push({
    id,
    file,
    included: true,
    thumbURL: URL.createObjectURL(file),
    title: parsed.title || "",
    organizer: parsed.organizer || "",
    category: mapCategory(parsed.category),
    venue: parsed.venue || "",
    address: parsed.address || "",
    city: parsed.city || "",
    region: mapRegion(parsed.region, parsed.city),
    date: parsed.date || "",
    startTime: parsed.start_time || "10:00",
    endTime: parsed.end_time || "16:00",
    admission: parsed.admission || "",
    summary: parsed.summary || "",
    status: null, // 'ok' | 'fail' | null
    statusText: "",
  });
  renderRows();
}

function field(row, key, label, type = "text") {
  const inputId = `f-${row.id}-${key}`;
  if (type === "select") {
    const options = (key === "category" ? CATEGORIES : REGIONS)
      .map((o) => `<option value="${o}" ${row[key] === o ? "selected" : ""}>${o}</option>`).join("");
    return `<div class="field"><label for="${inputId}">${label}</label><select id="${inputId}" data-row="${row.id}" data-key="${key}">${options}</select></div>`;
  }
  if (type === "textarea") {
    return `<div class="field full"><label for="${inputId}">${label}</label><textarea id="${inputId}" data-row="${row.id}" data-key="${key}">${escapeHtml(row[key])}</textarea></div>`;
  }
  return `<div class="field"><label for="${inputId}">${label}</label><input type="${type}" id="${inputId}" data-row="${row.id}" data-key="${key}" value="${escapeHtml(row[key])}"></div>`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderRows() {
  const list = document.getElementById("flyer-list");
  list.innerHTML = rows.map((row) => `
    <div class="flyer-card ${row.included ? "" : "excluded"}" data-card="${row.id}">
      <div class="thumb"><img src="${row.thumbURL}" alt=""></div>
      <div>
        <div class="row-head">
          <h3>${escapeHtml(row.title) || "Untitled show"}</h3>
          <label class="include-toggle">
            <input type="checkbox" data-row="${row.id}" data-key="included" ${row.included ? "checked" : ""}>
            Include
          </label>
        </div>
        <div class="form-grid">
          ${field(row, "title", "Show title")}
          ${field(row, "organizer", "Organizer")}
          ${field(row, "category", "Category", "select")}
          ${field(row, "region", "Region", "select")}
          ${field(row, "venue", "Venue name")}
          ${field(row, "admission", "Admission")}
          ${field(row, "address", "Street address")}
          ${field(row, "city", "City")}
          ${field(row, "date", "Date", "date")}
          ${field(row, "startTime", "Start time", "time")}
          ${field(row, "endTime", "End time", "time")}
          ${field(row, "summary", "Summary", "textarea")}
        </div>
        ${row.status ? `<p class="row-status ${row.status}">${escapeHtml(row.statusText)}</p>` : ""}
      </div>
    </div>
  `).join("");

  list.querySelectorAll("[data-row]").forEach((el) => {
    el.addEventListener("input", onFieldChange);
    el.addEventListener("change", onFieldChange);
  });

  document.getElementById("import-actions").style.display = rows.length ? "block" : "none";
}

function onFieldChange(e) {
  const rowId = Number(e.target.dataset.row);
  const key = e.target.dataset.key;
  const row = rows.find((r) => r.id === rowId);
  if (!row) return;
  if (key === "included") {
    row.included = e.target.checked;
    document.querySelector(`[data-card="${rowId}"]`).classList.toggle("excluded", !row.included);
  } else {
    row[key] = e.target.value;
  }
}

// ---------------------------------------------------------------------------
// Import

async function uploadBanner(id, file) {
  const jpeg = await toJpeg(file);
  const token = await ensureFreshToken();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/card-images/banners/${id}.jpg`, {
    method: "POST",
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "image/jpeg", "x-upsert": "true" },
    body: jpeg,
  });
  if (!res.ok) throw new Error(`Banner upload failed (${res.status})`);
  return `banners/${id}.jpg`;
}

async function insertShow(row) {
  const id = crypto.randomUUID();
  let bannerPath = null;
  try {
    bannerPath = await uploadBanner(id, row.file);
  } catch {
    bannerPath = null; // keep the show even if the banner upload fails
  }

  const centroid = REGION_CENTROIDS[row.region] || REGION_CENTROIDS["Winnipeg"];
  const startAt = winnipegLocalToUTC(row.date, row.startTime) || new Date();
  const endAtRaw = winnipegLocalToUTC(row.date, row.endTime) || startAt;
  const endAt = endAtRaw < startAt ? startAt : endAtRaw;

  const body = {
    id,
    title: row.title.trim() || "Untitled show",
    category: row.category,
    venue_name: row.venue.trim() || "TBD",
    address: row.address,
    city: row.city || row.region,
    region: row.region,
    latitude: centroid.latitude,
    longitude: centroid.longitude,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    admission_cost: parseAdmission(row.admission),
    feature_tags: [],
    summary: row.summary.trim() || "Details coming soon.",
    organizer_name: row.organizer.trim() || "Independent organizer",
    is_featured: false,
    push_enabled: false,
    banner_path: bannerPath,
  };

  const token = await ensureFreshToken();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/shows`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(detail || `Insert failed (${res.status})`);
  }
}

async function importAll() {
  const importBtn = document.getElementById("import-btn");
  const status = document.getElementById("import-status");
  // Skip rows already imported — re-clicking after a partial failure must
  // only retry the failures, not insert the successes again (each insert
  // mints a fresh UUID, so a repeat would duplicate the show).
  const included = rows.filter((r) => r.included && r.status !== "ok");
  importBtn.disabled = true;
  status.style.display = "block";
  status.className = "msg info";

  if (!included.length) {
    status.textContent = "Nothing to import — every checked show is already imported.";
    importBtn.disabled = false;
    return;
  }

  let ok = 0, fail = 0;
  for (const row of included) {
    // A show without a date would be saved as starting right now and
    // immediately disappear from the app (past shows are hidden).
    if (!row.date) {
      row.status = "fail";
      row.statusText = "No date — fill in the date field, then import again.";
      fail++;
      renderRows();
      continue;
    }
    status.textContent = `Importing "${row.title || "Untitled show"}"… (${ok + fail + 1} of ${included.length})`;
    try {
      await insertShow(row);
      row.status = "ok";
      row.statusText = "Imported.";
      ok++;
    } catch (err) {
      row.status = "fail";
      row.statusText = err.message;
      fail++;
    }
    renderRows();
  }

  status.className = fail ? "msg error" : "msg success";
  status.textContent = fail
    ? `Imported ${ok} of ${included.length}. ${fail} failed — see details on each card above.`
    : `Imported all ${ok} shows. Open the app → Account → Admin tools → "Fix map locations" to geocode their map pins precisely.`;
  importBtn.disabled = false;
}

// ---------------------------------------------------------------------------
// File intake

async function handleFiles(fileList) {
  const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
  if (!files.length) return;

  const progress = document.getElementById("progress-line");
  const errorEl = document.getElementById("parse-error");
  errorEl.style.display = "none";

  const failures = [];
  let parsedCount = 0;
  for (let i = 0; i < files.length; i++) {
    progress.textContent = `Reading flyer ${i + 1} of ${files.length}…`;
    try {
      const jpeg = await toJpeg(files[i]);
      const parsed = await parseFlyer(jpeg);
      addRow(files[i], parsed);
      parsedCount++;
    } catch (err) {
      failures.push(`"${files[i].name}": ${err.message}`);
    }
    // Be gentle with the flyer-parsing API.
    await new Promise((r) => setTimeout(r, 300));
  }
  progress.textContent = `Parsed ${parsedCount} of ${files.length} flyer(s). Review the details below before importing.`;
  if (failures.length) {
    errorEl.textContent = failures.join(" — ");
    errorEl.style.display = "block";
  }
}

// ---------------------------------------------------------------------------
// Wiring

loadSession();

const signinPanel = document.getElementById("signin-panel");
const importPanel = document.getElementById("import-panel");
const signoutBtn = document.getElementById("signout-btn");

function showImportUI(email) {
  signinPanel.style.display = "none";
  importPanel.style.display = "block";
  signoutBtn.style.display = "inline-flex";
  document.getElementById("who-label").textContent = email;
}

document.getElementById("signin-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("signin-btn");
  const errorEl = document.getElementById("signin-error");
  errorEl.style.display = "none";
  btn.disabled = true;
  btn.textContent = "Signing in…";
  try {
    const email = await signIn(
      document.getElementById("signin-email").value.trim(),
      document.getElementById("signin-password").value
    );
    showImportUI(email);
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign in";
  }
});

signoutBtn.addEventListener("click", signOut);

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("file-input");
fileInput.addEventListener("change", () => handleFiles(fileInput.files));
["dragenter", "dragover"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((evt) =>
  dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
dropzone.addEventListener("drop", (e) => handleFiles(e.dataTransfer.files));

document.getElementById("import-btn").addEventListener("click", importAll);

// Resume an existing session without re-prompting for a password.
if (session) {
  (async () => {
    try {
      const token = await ensureFreshToken(); // refreshes if expired
      const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
      const [roleRes, userRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${session.userId}&select=role`, { headers }),
        fetch(`${SUPABASE_URL}/auth/v1/user`, { headers }),
      ]);
      const roleRows = await roleRes.json();
      const user = userRes.ok ? await userRes.json() : {};
      if (roleRes.ok && roleRows[0]?.role === "admin") {
        showImportUI(user.email || "");
      } else {
        clearSession();
      }
    } catch {
      clearSession();
    }
  })();
}
