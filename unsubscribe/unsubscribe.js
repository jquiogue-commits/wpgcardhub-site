const form = document.getElementById("unsub-form");
const emailInput = document.getElementById("unsub-email");
const submitBtn = document.getElementById("unsub-submit");
const successEl = document.getElementById("unsub-success");
const errorEl = document.getElementById("unsub-error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.style.display = "none";
  successEl.style.display = "none";
  submitBtn.disabled = true;
  submitBtn.textContent = "Removing…";

  const email = emailInput.value.trim();
  try {
    // Goes through a SECURITY DEFINER RPC rather than a raw table DELETE —
    // see supabase/waitlist.sql for why (a plain RLS delete policy doesn't
    // work here). Not finding the address is still success: the visitor's
    // goal (not being on the list) is already true either way.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/unsubscribe_from_waitlist`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ target_email: email }),
      }
    );
    if (!res.ok) throw new Error(`Request failed (${res.status})`);
    form.style.display = "none";
    successEl.style.display = "block";
  } catch (err) {
    errorEl.textContent = "Something went wrong — mind trying again in a moment?";
    errorEl.style.display = "block";
    submitBtn.disabled = false;
    submitBtn.textContent = "Unsubscribe";
  }
});
