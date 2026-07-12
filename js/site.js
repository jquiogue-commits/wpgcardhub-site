const form = document.getElementById("waitlist-form");
const emailInput = document.getElementById("waitlist-email");
const submitBtn = document.getElementById("waitlist-submit");
const successEl = document.getElementById("waitlist-success");
const errorEl = document.getElementById("waitlist-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.style.display = "none";
  successEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Joining…";

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/waitlist`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ email: emailInput.value.trim() }),
    });
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    form.style.display = "none";
    successEl.style.display = "block";
  } catch (err) {
    errorEl.textContent = "Something went wrong — mind trying again in a moment?";
    errorEl.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Notify Me";
  }
});
