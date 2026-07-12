const FORMSPREE_URL = "https://formspree.io/f/mlgqrpee";

const form = document.getElementById("waitlist-form");
const emailInput = document.getElementById("waitlist-email");
const submitBtn = document.getElementById("waitlist-submit");
const successEl = document.getElementById("waitlist-success");
const errorEl = document.getElementById("waitlist-error");

function submitToFormspree(email) {
  return fetch(FORMSPREE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Formspree request failed (${res.status})`);
  });
}

function submitToSupabase(email) {
  return fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ email }),
  }).then((res) => {
    if (!res.ok) throw new Error(`Supabase request failed (${res.status})`);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.style.display = "none";
  successEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";

  const email = emailInput.value.trim();
  // Submit to both in parallel — Formspree emails a notification, Supabase
  // keeps a queryable record. Either one succeeding counts as a save.
  const results = await Promise.allSettled([submitToFormspree(email), submitToSupabase(email)]);
  const anyOk = results.some((r) => r.status === "fulfilled");

  if (anyOk) {
    form.style.display = "none";
    successEl.style.display = "block";
  } else {
    errorEl.textContent = "Something went wrong — mind trying again in a moment?";
    errorEl.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Notify Me";
  }
});
