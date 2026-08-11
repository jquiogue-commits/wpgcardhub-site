// ---------------------------------------------------------------------------
// Screenshot carousel: native scroll-snap does the swiping, this just adds
// arrows, dots, and keyboard support on top of it.

(function initCarousel() {
  const track = document.getElementById("shots-track");
  const dotsBox = document.getElementById("shots-dots");
  const prev = document.getElementById("shots-prev");
  const next = document.getElementById("shots-next");
  if (!track || !dotsBox) return;

  const slides = Array.from(track.querySelectorAll(".slide"));
  if (!slides.length) return;

  slides.forEach((slide, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("role", "tab");
    dot.setAttribute("aria-label", `Screenshot ${i + 1} of ${slides.length}`);
    dot.addEventListener("click", () => scrollToSlide(i));
    dotsBox.appendChild(dot);
  });
  const dots = Array.from(dotsBox.children);

  /// Index of the slide whose centre is nearest the track's centre.
  function currentIndex() {
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best = 0;
    let bestDistance = Infinity;
    slides.forEach((slide, i) => {
      const distance = Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - mid);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    });
    return best;
  }

  function scrollToSlide(i) {
    const slide = slides[Math.max(0, Math.min(i, slides.length - 1))];
    track.scrollTo({
      left: slide.offsetLeft - (track.clientWidth - slide.offsetWidth) / 2,
      behavior: "smooth",
    });
  }

  function sync() {
    const i = currentIndex();
    dots.forEach((dot, n) => dot.setAttribute("aria-selected", String(n === i)));
    if (prev) prev.disabled = i === 0;
    if (next) next.disabled = i === slides.length - 1;
  }

  prev?.addEventListener("click", () => scrollToSlide(currentIndex() - 1));
  next?.addEventListener("click", () => scrollToSlide(currentIndex() + 1));

  track.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); scrollToSlide(currentIndex() - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); scrollToSlide(currentIndex() + 1); }
  });

  let raf = 0;
  track.addEventListener("scroll", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(sync);
  }, { passive: true });
  window.addEventListener("resize", sync);

  sync();
})();

// ---------------------------------------------------------------------------
// Waitlist

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
    // 409 = this email is already on the waitlist, which is what they wanted.
    if (!res.ok && res.status !== 409) throw new Error(`Supabase request failed (${res.status})`);
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
