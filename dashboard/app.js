/**
 * Test performance — configurable cohort, CSV upload, Supabase or localStorage.
 */

import * as data from "./data-service.js";

let cohortSettings = { ...data.DEFAULT_SETTINGS };
let allStudents = [];
let activePaath = "";
const guardianNotifiedIds = new Set();

let modalStudentId = null;
let activeChannel = "email";
let lastFocusEl = null;

let detailStudentId = null;
let lastFocusDetail = null;

const DEV_AUTO_DUMMY_KEY = "mentoral_dev_autoload_dummy";

function isDevMode() {
  return new URLSearchParams(window.location.search).get("dev") === "1";
}

function getActiveTestName() {
  const el = document.getElementById("filter-test");
  return el?.value?.trim() || "";
}

/** Score used for KPIs, charts, and table when a test filter is active. */
function viewScore(s) {
  const t = getActiveTestName();
  if (!t) return s.testScore;
  const a = (s.testAttempts || []).find((x) => x.testName === t);
  return a != null ? Number(a.score) : null;
}

function viewAttemptDate(s) {
  const t = getActiveTestName();
  if (!t) return s.attemptDate || "—";
  const a = (s.testAttempts || []).find((x) => x.testName === t);
  return a?.date || "—";
}

function setActivePaath(paath) {
  activePaath = paath;
  document.querySelectorAll(".paath-tab").forEach((btn) => {
    const selected = btn.dataset.paath === paath;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
  });
  const panel = document.getElementById("paath-panel");
  const idx = cohortSettings.paaths.indexOf(paath);
  if (panel && idx >= 0) {
    panel.setAttribute("aria-labelledby", `tab-paath-${idx}`);
  }
  refresh();
}

function filteredStudents() {
  if (!activePaath) return [];
  const c = document.getElementById("filter-class").value;
  const b = document.getElementById("filter-batch").value;
  const testName = getActiveTestName();
  return allStudents.filter((s) => {
    if (s.paath !== activePaath) return false;
    if (c && s.class !== c) return false;
    if (b && s.batch !== b) return false;
    if (testName && viewScore(s) == null) return false;
    return true;
  });
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, x) => a + x, 0) / arr.length;
}

function scoreClass(score) {
  if (score >= 75) return "score-high";
  if (score >= 55) return "score-mid";
  return "score-low";
}

function gradeLetter(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

function percentileRank(student, cohort) {
  if (!cohort.length) return 0;
  if (cohort.length === 1) return 100;
  const sc = viewScore(student);
  if (sc == null) return 0;
  const below = cohort.filter((x) => {
    const v = viewScore(x);
    return v != null && v < sc;
  }).length;
  const equal = cohort.filter((x) => viewScore(x) === sc).length;
  return Math.round(((below + 0.5 * equal) / cohort.length) * 100);
}

const chartFont = "'Plus Jakarta Sans', system-ui, sans-serif";
const chartTick = "rgba(45, 10, 13, 0.55)";
const chartGrid = "rgba(93, 31, 36, 0.12)";

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      labels: {
        color: chartTick,
        font: { family: chartFont, size: 11 },
        padding: 12,
      },
    },
  },
  scales: {
    x: {
      ticks: { color: chartTick, font: { family: chartFont, size: 11 } },
      grid: { color: chartGrid },
    },
    y: {
      ticks: { color: chartTick, font: { family: chartFont, size: 11 } },
      grid: { color: chartGrid },
    },
  },
};

let chartByClass;
let chartByBatch;
let chartPass;
let chartHistogram;

function destroyChart(ch) {
  if (ch) ch.destroy();
}

function updateKpis(students) {
  const scores = students.map((s) => viewScore(s)).filter((v) => v != null);
  const avg = mean(scores);
  const pass = scores.filter((s) => s >= 50).length;
  const passRate = scores.length ? (pass / scores.length) * 100 : 0;
  const top = scores.length ? Math.max(...scores) : 0;
  const low = scores.length ? Math.min(...scores) : 0;
  const testLabel = getActiveTestName();

  document.getElementById("kpi-count").textContent = students.length;
  document.getElementById("kpi-avg").textContent = scores.length
    ? avg.toFixed(1)
    : "—";
  document.getElementById("kpi-pass").textContent = scores.length
    ? `${passRate.toFixed(0)}%`
    : "—";
  document.getElementById("kpi-range").textContent = scores.length
    ? `${low} – ${top}`
    : "—";

  const subAvg = document.getElementById("kpi-avg-sub");
  if (subAvg) {
    subAvg.textContent = testLabel
      ? `For “${testLabel}” in this view`
      : "Mean across students — each row uses its latest score (not avg of attempts)";
  }
  const subPass = document.getElementById("kpi-pass-sub");
  if (subPass) {
    subPass.textContent = testLabel
      ? `Using selected test scores`
      : "Score ≥ 50 on each student’s latest score";
  }

  const hint = document.getElementById("table-filter-hint");
  if (hint) {
    const inPaath = allStudents.filter((s) => s.paath === activePaath).length;
    const testBit = testLabel ? ` · test: ${testLabel}` : "";
    hint.textContent =
      students.length === inPaath && !document.getElementById("filter-class").value && !document.getElementById("filter-batch").value && !testLabel
        ? `Sorted by score · ${activePaath} · click a row for detail`
        : `Sorted by score · ${students.length} in ${activePaath}${testBit}`;
  }
}

function aggregateBy(students, key) {
  const map = new Map();
  for (const s of students) {
    const sc = viewScore(s);
    if (sc == null) continue;
    const k = s[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(sc);
  }
  const labels = [...map.keys()];
  const avgs = labels.map((l) => mean(map.get(l)));
  return { labels, avgs };
}

const BATCH_PALETTE = [
  { bg: "rgba(93, 31, 36, 0.82)", border: "#5d1f24" },
  { bg: "rgba(184, 134, 11, 0.82)", border: "#b8860b" },
  { bg: "rgba(61, 107, 46, 0.78)", border: "#3d6b2e" },
  { bg: "rgba(99, 102, 241, 0.72)", border: "#6366f1" },
];

/** One bar group per class; one series per batch (not merged). */
function aggregateClassBatchGrouped(students, classOrder) {
  const labels = classOrder.filter((c) => students.some((s) => s.class === c));
  const batchesPresent = [...new Set(students.map((s) => s.batch))].sort();
  const datasets = batchesPresent.map((batch, bi) => {
    const pal = BATCH_PALETTE[bi % BATCH_PALETTE.length];
    return {
      label: batch,
      data: labels.map((cls) => {
        const sc = students
          .filter((s) => s.class === cls && s.batch === batch)
          .map((s) => viewScore(s))
          .filter((v) => v != null);
        return sc.length ? mean(sc) : null;
      }),
      backgroundColor: pal.bg,
      borderColor: pal.border,
      borderWidth: 1,
      borderRadius: 5,
      maxBarThickness: 28,
    };
  });
  return { labels, datasets };
}

function updateCharts(students) {
  const scores = students.map((s) => viewScore(s)).filter((v) => v != null);
  const histLabels = ["0–20", "21–40", "41–60", "61–80", "81–100"];
  const hist = [0, 0, 0, 0, 0];
  for (const sc of scores) {
    if (sc <= 20) hist[0]++;
    else if (sc <= 40) hist[1]++;
    else if (sc <= 60) hist[2]++;
    else if (sc <= 80) hist[3]++;
    else hist[4]++;
  }

  const grouped = aggregateClassBatchGrouped(students, cohortSettings.classes);
  const byBatch = aggregateBy(students, "batch");
  const passCount = scores.filter((s) => s >= 50).length;
  const needCount = scores.length - passCount;

  const safe = (labels, avgs, fallback) =>
    labels.length ? { labels, data: avgs } : { labels: [fallback], data: [0] };

  const bt = safe(byBatch.labels, byBatch.avgs, "No data");
  const testHint = getActiveTestName();
  const batchDatasetLabel = testHint
    ? `Avg (${testHint.slice(0, 22)}${testHint.length > 22 ? "…" : ""})`
    : "Avg score";

  const barMaroon = "rgba(93, 31, 36, 0.78)";
  const barMaroonBorder = "#5d1f24";
  const barGold = "rgba(184, 134, 11, 0.75)";
  const barGoldBorder = "#b8860b";

  destroyChart(chartByClass);
  const classCanvas = document.getElementById("chart-class");
  if (!grouped.labels.length || !grouped.datasets.length) {
    chartByClass = new Chart(classCanvas, {
      type: "bar",
      data: {
        labels: ["No data"],
        datasets: [
          {
            label: "—",
            data: [0],
            backgroundColor: "rgba(93, 31, 36, 0.12)",
            borderColor: "rgba(93, 31, 36, 0.2)",
            borderWidth: 1,
            borderRadius: 6,
          },
        ],
      },
      options: {
        ...chartDefaults,
        plugins: { ...chartDefaults.plugins, legend: { display: false } },
        scales: {
          ...chartDefaults.scales,
          y: { ...chartDefaults.scales.y, max: 100, beginAtZero: true },
        },
      },
    });
  } else {
    chartByClass = new Chart(classCanvas, {
      type: "bar",
      data: {
        labels: grouped.labels,
        datasets: grouped.datasets,
      },
      options: {
        ...chartDefaults,
        plugins: {
          ...chartDefaults.plugins,
          legend: {
            display: true,
            position: "top",
            labels: {
              color: chartTick,
              font: { family: chartFont, size: 11 },
              boxWidth: 12,
              padding: 10,
            },
          },
        },
        scales: {
          ...chartDefaults.scales,
          x: {
            ...chartDefaults.scales.x,
            stacked: false,
          },
          y: {
            ...chartDefaults.scales.y,
            max: 100,
            beginAtZero: true,
          },
        },
      },
    });
  }

  destroyChart(chartByBatch);
  chartByBatch = new Chart(document.getElementById("chart-batch"), {
    type: "bar",
    data: {
      labels: bt.labels,
      datasets: [
        {
          label: batchDatasetLabel,
          data: bt.data,
          backgroundColor: barGold,
          borderColor: barGoldBorder,
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, max: 100, beginAtZero: true },
      },
    },
  });

  destroyChart(chartPass);
  const passEl = document.getElementById("chart-pass");
  if (scores.length === 0) {
    chartPass = new Chart(passEl, {
      type: "doughnut",
      data: {
        labels: ["No data"],
        datasets: [
          {
            data: [1],
            backgroundColor: ["rgba(93, 31, 36, 0.12)"],
            borderColor: ["rgba(93, 31, 36, 0.2)"],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: chartTick, font: { family: chartFont, size: 11 } },
          },
        },
      },
    });
  } else {
    chartPass = new Chart(passEl, {
      type: "doughnut",
      data: {
        labels: ["Pass (≥50)", "Needs support"],
        datasets: [
          {
            data: [passCount, needCount],
            backgroundColor: [
              "rgba(61, 107, 46, 0.82)",
              "rgba(93, 31, 36, 0.75)",
            ],
            borderColor: ["#3d6b2e", "#5d1f24"],
            borderWidth: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "58%",
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: chartTick, font: { family: chartFont, size: 11 } },
          },
        },
      },
    });
  }

  destroyChart(chartHistogram);
  chartHistogram = new Chart(document.getElementById("chart-hist"), {
    type: "bar",
    data: {
      labels: histLabels,
      datasets: [
        {
          label: "Students",
          data: hist,
          backgroundColor: "rgba(212, 175, 55, 0.55)",
          borderColor: "#b8860b",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, legend: { display: false } },
      scales: {
        ...chartDefaults.scales,
        y: {
          ...chartDefaults.scales.y,
          beginAtZero: true,
          ticks: { maxTicksLimit: 8 },
        },
      },
    },
  });
}

function formatAttemptsForMessage(s) {
  const rows = s.testAttempts?.length
    ? s.testAttempts.map(
        (a) => `• ${a.testName}: ${a.score}/100 — submitted ${a.date}`
      )
    : [`• Latest recorded score: ${s.testScore}/100 (${s.attemptDate})`];
  return rows.join("\n");
}

function defaultGuardianMessage(s) {
  const first = s.guardianName.split(/\s+/)[0] || "Guardian";
  const attemptBlock = formatAttemptsForMessage(s);
  return `Dear ${first},

Here is an update on ${s.name}'s assessment activity.

${attemptBlock}

Program: ${s.class} · ${s.batch} · ${s.paath}

Please reply if you would like to discuss support or next steps.

Thank you,
Mentoral Faculty`;
}

function digitsOnly(phone) {
  return phone.replace(/\D/g, "");
}

function showToast(title, message) {
  const host = document.getElementById("toast-host");
  const el = document.createElement("div");
  el.className = "toast";
  el.setAttribute("role", "status");
  el.innerHTML = `
    <svg class="toast-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
    </svg>
    <div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>
  `;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    el.style.transform = "translateY(8px)";
    el.style.transition = "opacity 0.25s, transform 0.25s";
    setTimeout(() => el.remove(), 280);
  }, 4200);
}

function getModalStudent() {
  return allStudents.find((x) => x.id === modalStudentId) || null;
}

function openGuardianModal(studentId) {
  const s = allStudents.find((x) => x.id === studentId);
  if (!s) return;
  modalStudentId = studentId;
  activeChannel = "email";

  document.getElementById("guardian-name").value = s.guardianName;
  document.getElementById("guardian-email").value = s.guardianEmail;
  document.getElementById("guardian-phone").value = s.guardianPhone;
  document.getElementById("guardian-message").value = defaultGuardianMessage(s);

  const attemptsHtml = s.testAttempts?.length
    ? `<ul style="margin:0.35rem 0 0;padding-left:1.1rem">${s.testAttempts
        .map(
          (a) =>
            `<li>${escapeHtml(a.testName)} — <strong>${a.score}</strong>/100 · ${a.date}</li>`
        )
        .join("")}</ul>`
    : `<p style="margin:0.35rem 0 0">${s.testScore}/100 · ${s.attemptDate}</p>`;

  document.getElementById("modal-student-summary").innerHTML = `
    <dl>
      <dt>Student</dt><dd>${escapeHtml(s.name)}</dd>
      <dt>Tests</dt><dd>${attemptsHtml}</dd>
      <dt>Latest</dt><dd>${s.testScore}/100 · ${s.attemptDate}</dd>
      <dt>Program</dt><dd>${escapeHtml(s.class)} · ${escapeHtml(s.batch)} · ${escapeHtml(s.paath)}</dd>
    </dl>
  `;

  document.querySelectorAll(".channel-chip").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.channel === "email");
  });
  const sendBtn = document.getElementById("modal-send");
  if (sendBtn) sendBtn.textContent = "Send notification";

  const backdrop = document.getElementById("guardian-modal");
  lastFocusEl = document.activeElement;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    document.getElementById("guardian-message").focus();
  });
}

function closeGuardianModal() {
  const backdrop = document.getElementById("guardian-modal");
  backdrop.classList.remove("is-open");
  setTimeout(() => {
    backdrop.hidden = true;
    modalStudentId = null;
    if (lastFocusEl && typeof lastFocusEl.focus === "function") {
      lastFocusEl.focus();
    }
  }, 200);
}

function setChannel(channel) {
  activeChannel = channel;
  document.querySelectorAll(".channel-chip").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.channel === channel);
  });
  const sendBtn = document.getElementById("modal-send");
  if (sendBtn) {
    sendBtn.textContent = channel === "whatsapp" ? "Open WhatsApp" : "Send notification";
  }
}

function sendGuardianNotification() {
  const s = getModalStudent();
  if (!s) return;

  const name = document.getElementById("guardian-name").value.trim();
  const email = document.getElementById("guardian-email").value.trim();
  const phone = document.getElementById("guardian-phone").value.trim();
  const message = document.getElementById("guardian-message").value.trim();

  if (!message) {
    showToast("Add a message", "Write something before sending.");
    return;
  }

  const subject = `Test result: ${s.name}`;

  if (activeChannel === "email") {
    if (!email || !email.includes("@")) {
      showToast("Check email", "Enter a valid guardian email address.");
      document.getElementById("guardian-email").focus();
      return;
    }
    const mailto = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}`;
    guardianNotifiedIds.add(s.id);
    showToast(
      "Opening mail",
      `Your client should open a draft to ${name || email}.`
    );
    closeGuardianModal();
    refresh();
    window.location.href = mailto;
    return;
  }

  if (activeChannel === "sms") {
    const d = digitsOnly(phone);
    if (d.length < 10) {
      showToast("Check mobile", "Enter a valid phone number for SMS.");
      document.getElementById("guardian-phone").focus();
      return;
    }
    const body = encodeURIComponent(message);
    window.location.href = `sms:${d}?&body=${body}`;
    guardianNotifiedIds.add(s.id);
    showToast("Opening SMS", `Draft created for ${name || phone}.`);
    closeGuardianModal();
    refresh();
    return;
  }

  if (activeChannel === "whatsapp") {
    const d = digitsOnly(phone);
    if (d.length < 10) {
      showToast("Check mobile", "Enter a valid phone number with country code (e.g. 919876543210).");
      document.getElementById("guardian-phone").focus();
      return;
    }
    const waUrl = `https://wa.me/${d}?text=${encodeURIComponent(message)}`;
    guardianNotifiedIds.add(s.id);
    showToast("Opening WhatsApp", `Chat with ${name || phone} will open.`);
    closeGuardianModal();
    refresh();
    window.open(waUrl, "_blank", "noopener");
    return;
  }

  if (activeChannel === "copy") {
    if (!navigator.clipboard || !navigator.clipboard.writeText) {
      showToast("Copy unavailable", "Clipboard API is not available in this context.");
      return;
    }
    navigator.clipboard.writeText(message).then(() => {
      guardianNotifiedIds.add(s.id);
      showToast("Copied", "Message copied. Paste into your SMS or email tool.");
      closeGuardianModal();
      refresh();
    });
  }
}

function renderStudentDetail(s, cohort) {
  const pct = percentileRank(s, cohort);
  const testSel = getActiveTestName();
  const vs = viewScore(s);
  const headlineScore = vs != null ? vs : s.testScore;
  const pill = scoreClass(headlineScore);
  const passLabel = headlineScore >= 50 ? "Pass" : "Below threshold";
  const initial = s.name.replace(/[^a-zA-Z]/g, "").slice(0, 1) || "S";
  const notified = guardianNotifiedIds.has(s.id);
  const attempts = s.testAttempts || [];
  const avgAttempts =
    attempts.length > 0
      ? mean(attempts.map((a) => a.score)).toFixed(1)
      : "—";
  const overviewDate = testSel ? viewAttemptDate(s) : s.attemptDate;

  const attemptRows = attempts
    .map((a, idx) => {
      const latest = idx === 0;
      const selectedTest = testSel && a.testName === testSel;
      const rowClass = [latest ? "is-latest" : "", selectedTest ? "is-test-selected" : ""]
        .filter(Boolean)
        .join(" ");
      const pillCls = scoreClass(a.score);
      return `<tr class="${rowClass}">
        <td>${escapeHtml(a.testName)}${latest ? ' <span class="detail-latest-tag">Latest</span>' : ""}${selectedTest ? ' <span class="detail-latest-tag" style="background:var(--gold-from);color:var(--charcoal)">Filtered</span>' : ""}</td>
        <td>${a.date}</td>
        <td><span class="score-pill ${pillCls}">${a.score}</span></td>
      </tr>`;
    })
    .join("");

  return `
    <div class="detail-overview-header">
      <div class="detail-hero">
        <div class="detail-avatar" aria-hidden="true">${escapeHtml(initial)}</div>
        <div class="detail-hero-text">
          <h5>${escapeHtml(s.name)}</h5>
          <p>ID ${s.id} · ${escapeHtml(s.enrollmentRef)}</p>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-notify-parent" id="detail-open-guardian">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        Notify parent
      </button>
    </div>
    ${testSel ? `<p class="detail-filter-note">You are viewing the dashboard filtered by <strong>${escapeHtml(testSel)}</strong>. Overview below uses that score where available.</p>` : ""}

    <div class="detail-section">
      <h6 class="detail-section-title">Test attempts &amp; scores</h6>
      <div class="detail-attempts-table-wrap">
        <table class="detail-attempts-table">
          <thead>
            <tr>
              <th>Assessment</th>
              <th>Submitted</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            ${attemptRows || `<tr><td colspan="3">No attempt history</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="detail-attempts-summary">
        <strong>Overview:</strong> ${testSel ? `Score for <strong>${escapeHtml(testSel)}</strong>: <strong>${headlineScore}/100</strong>` : `Latest score <strong>${headlineScore}/100</strong>`}
        (Grade ${gradeLetter(headlineScore)}, ${passLabel}).
        Submitted: <strong>${overviewDate}</strong>.
        Average across attempts: <strong>${avgAttempts}</strong>.
        Cohort percentile in this view: <strong>${pct}%</strong>.
      </p>
    </div>

    <details class="detail-more">
      <summary>Program &amp; parent / guardian</summary>
      <div class="detail-section">
        <h6 class="detail-section-title">Enrollment</h6>
        <dl class="detail-grid">
          <div class="detail-item">
            <dt>Paath</dt>
            <dd>${escapeHtml(s.paath)}</dd>
          </div>
          <div class="detail-item">
            <dt>Class</dt>
            <dd>${escapeHtml(s.class)}</dd>
          </div>
          <div class="detail-item">
            <dt>Batch</dt>
            <dd>${escapeHtml(s.batch)}</dd>
          </div>
          <div class="detail-item">
            <dt>School email</dt>
            <dd>${escapeHtml(s.studentEmail)}</dd>
          </div>
        </dl>
      </div>
      <div class="detail-section">
        <h6 class="detail-section-title">Parent / guardian</h6>
        <div class="guardian-card">
          <strong>${escapeHtml(s.guardianName)}</strong>
          <p>${escapeHtml(s.guardianEmail)}</p>
          <p>${escapeHtml(s.guardianPhone)}</p>
          ${notified ? '<p style="margin-top:0.5rem;font-weight:600;color:var(--success)">Parent notified this session</p>' : ""}
        </div>
      </div>
    </details>
  `;
}

function openStudentDetailModal(studentId) {
  const cohort = filteredStudents();
  const s = cohort.find((x) => x.id === studentId);
  if (!s) return;

  detailStudentId = studentId;
  const body = document.getElementById("student-detail-body");
  body.innerHTML = renderStudentDetail(s, cohort);

  document.getElementById("detail-open-guardian").addEventListener("click", () => {
    const id = detailStudentId;
    const detailBackdrop = document.getElementById("student-detail-modal");
    detailBackdrop.classList.remove("is-open");
    setTimeout(() => {
      detailBackdrop.hidden = true;
      detailStudentId = null;
      openGuardianModal(id);
    }, 200);
  });

  const backdrop = document.getElementById("student-detail-modal");
  lastFocusDetail = document.activeElement;
  backdrop.hidden = false;
  requestAnimationFrame(() => {
    backdrop.classList.add("is-open");
    document.getElementById("detail-modal-close").focus();
  });
}

function closeStudentDetailModal() {
  const backdrop = document.getElementById("student-detail-modal");
  backdrop.classList.remove("is-open");
  setTimeout(() => {
    backdrop.hidden = true;
    detailStudentId = null;
    if (lastFocusDetail && typeof lastFocusDetail.focus === "function") {
      lastFocusDetail.focus();
    }
  }, 200);
}

function updateTable(students) {
  const tbody = document.querySelector("#student-table tbody");
  tbody.innerHTML = "";
  const sorted = [...students].sort((a, b) => {
    const va = viewScore(a);
    const vb = viewScore(b);
    return (vb ?? -1) - (va ?? -1);
  });
  const testSel = getActiveTestName();
  for (const s of sorted) {
    const tr = document.createElement("tr");
    tr.className = "row-student";
    tr.dataset.studentId = String(s.id);
    const sc = viewScore(s);
    const pillClass = scoreClass(sc != null ? sc : 0);
    const sent = guardianNotifiedIds.has(s.id);
    const sentCell = sent
      ? `<span class="sent-badge" title="Notification recorded this session">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
          Sent
        </span>`
      : "—";
    tr.innerHTML = `
      <td>${s.id}</td>
      <td><strong>${escapeHtml(s.name)}</strong></td>
      <td>${escapeHtml(s.guardianName)}</td>
      <td>${escapeHtml(s.class)}</td>
      <td>${escapeHtml(s.batch)}</td>
      <td><span class="score-pill ${pillClass}" title="${testSel ? escapeHtml(testSel) : "Latest score"}">${sc != null ? sc : "—"}</span></td>
      <td>${escapeHtml(String(viewAttemptDate(s)))}</td>
      <td class="col-narrow">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:flex-end">
          ${sentCell}
          <button type="button" class="btn btn-ghost btn-sm btn-notify" data-student-id="${s.id}" aria-label="Notify guardian for ${escapeHtml(s.name)}">
            <svg fill="none" stroke="currentColor" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            Notify
          </button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll(".btn-notify").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.studentId);
      openGuardianModal(id);
    });
  });

  tbody.querySelectorAll("tr.row-student").forEach((tr) => {
    tr.addEventListener("click", (e) => {
      if (e.target.closest(".btn-notify")) return;
      const id = Number(tr.dataset.studentId);
      openStudentDetailModal(id);
    });
  });
}

function escapeHtml(text) {
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML;
}

function toggleEmptyUI() {
  const banner = document.getElementById("data-empty-banner");
  const grid = document.getElementById("dashboard-charts");
  const kpis = document.getElementById("dashboard-kpis");
  const tbl = document.getElementById("dashboard-table");
  if (!allStudents.length) {
    banner?.classList.remove("hidden");
    grid?.classList.add("hidden");
    kpis?.classList.add("hidden");
    tbl?.classList.add("hidden");
  } else {
    banner?.classList.add("hidden");
    grid?.classList.remove("hidden");
    kpis?.classList.remove("hidden");
    tbl?.classList.remove("hidden");
  }
}

function buildPaathTabsDOM() {
  const host = document.querySelector(".paath-tabs");
  if (!host) return;
  host.innerHTML = "";
  cohortSettings.paaths.forEach((paath, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "paath-tab";
    btn.setAttribute("role", "tab");
    btn.id = `tab-paath-${i}`;
    btn.dataset.paath = paath;
    btn.setAttribute("aria-controls", "paath-panel");
    btn.textContent = paath;
    btn.addEventListener("click", () => setActivePaath(paath));
    host.appendChild(btn);
  });
  if (!cohortSettings.paaths.length) {
    activePaath = "";
    return;
  }
  if (!cohortSettings.paaths.includes(activePaath)) {
    activePaath = cohortSettings.paaths[0];
  }
  document.querySelectorAll(".paath-tab").forEach((btn) => {
    btn.setAttribute(
      "aria-selected",
      btn.dataset.paath === activePaath ? "true" : "false"
    );
  });
  const panel = document.getElementById("paath-panel");
  const idx = cohortSettings.paaths.indexOf(activePaath);
  if (panel && idx >= 0) {
    panel.setAttribute("aria-labelledby", `tab-paath-${idx}`);
  }
}

function rebuildClassBatchFilters() {
  const fc = document.getElementById("filter-class");
  const fb = document.getElementById("filter-batch");
  if (!fc || !fb) return;
  const cv = fc.value;
  const bv = fb.value;
  fc.innerHTML = '<option value="">All classes</option>';
  cohortSettings.classes.forEach((c) => {
    const o = document.createElement("option");
    o.value = c;
    o.textContent = c;
    fc.appendChild(o);
  });
  fb.innerHTML = '<option value="">All batches</option>';
  const batchList = cv
    ? data.getBatchesForClass(cohortSettings, cv)
    : data.allConfiguredBatches(cohortSettings);
  batchList.forEach((b) => {
    const o = document.createElement("option");
    o.value = b;
    o.textContent = b;
    fb.appendChild(o);
  });
  if ([...fc.options].some((o) => o.value === cv)) fc.value = cv;
  if ([...fb.options].some((o) => o.value === bv)) fb.value = bv;
}

function rebuildTestFilterOptions() {
  const sel = document.getElementById("filter-test");
  if (!sel) return;
  const cur = sel.value;
  const names = new Set();
  for (const s of allStudents) {
    for (const a of s.testAttempts || []) {
      if (a.testName) names.add(String(a.testName));
    }
  }
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  sel.innerHTML =
    '<option value="">Latest recorded score</option>';
  for (const n of sorted) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function refresh() {
  toggleEmptyUI();
  rebuildTestFilterOptions();
  const students = filteredStudents();
  updateKpis(students);
  updateCharts(students);
  updateTable(students);
}

function initFilters() {
  document.getElementById("filter-class").addEventListener("change", () => {
    rebuildClassBatchFilters();
    refresh();
  });
  document.getElementById("filter-batch").addEventListener("change", refresh);
  document.getElementById("filter-test")?.addEventListener("change", refresh);
}

function initStudentDetailModal() {
  document.getElementById("detail-modal-close").addEventListener("click", closeStudentDetailModal);
  document.getElementById("detail-modal-done").addEventListener("click", closeStudentDetailModal);
  const backdrop = document.getElementById("student-detail-modal");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeStudentDetailModal();
  });
}

function initModal() {
  document.getElementById("modal-close").addEventListener("click", closeGuardianModal);
  document.getElementById("modal-cancel").addEventListener("click", closeGuardianModal);
  document.getElementById("modal-send").addEventListener("click", sendGuardianNotification);

  document.querySelectorAll(".channel-chip").forEach((btn) => {
    btn.addEventListener("click", () => setChannel(btn.dataset.channel));
  });

  const backdrop = document.getElementById("guardian-modal");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeGuardianModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const g = document.getElementById("guardian-modal");
    const d = document.getElementById("student-detail-modal");
    const st = document.getElementById("settings-modal");
    if (!g.hidden && g.classList.contains("is-open")) {
      e.preventDefault();
      closeGuardianModal();
      return;
    }
    if (!d.hidden && d.classList.contains("is-open")) {
      e.preventDefault();
      closeStudentDetailModal();
      return;
    }
    if (st && !st.hidden && st.classList.contains("is-open")) {
      e.preventDefault();
      closeSettingsModal();
    }
  });
}

function parseLinesFromTextarea(id) {
  const ta = document.getElementById(id);
  if (!ta) return [];
  return ta.value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderPerClassBatchFields() {
  const container = document.getElementById("settings-per-class-batches");
  if (!container) return;
  const classes = parseLinesFromTextarea("settings-classes");
  container.innerHTML = "";
  classes.forEach((cls, i) => {
    const specific = cohortSettings.batchesByClass?.[cls];
    const val =
      Array.isArray(specific) && specific.length ? specific.join("\n") : "";
    const wrap = document.createElement("div");
    wrap.className = "form-group settings-batch-override";
    wrap.innerHTML = `
      <label for="settings-batches-idx-${i}">Batches for <strong>${escapeHtml(cls)}</strong> <span class="label-hint">(optional — blank uses default list above)</span></label>
      <textarea id="settings-batches-idx-${i}" rows="3" placeholder="Batch 1"></textarea>
    `;
    container.appendChild(wrap);
    const ta = wrap.querySelector("textarea");
    ta.value = val;
  });
}

function openSettingsModal() {
  document.getElementById("settings-classes").value =
    cohortSettings.classes.join("\n");
  document.getElementById("settings-batches-default").value =
    cohortSettings.batches.join("\n");
  document.getElementById("settings-paaths").value =
    cohortSettings.paaths.join("\n");
  renderPerClassBatchFields();
  const el = document.getElementById("settings-modal");
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add("is-open"));
}

function closeSettingsModal() {
  const el = document.getElementById("settings-modal");
  el.classList.remove("is-open");
  setTimeout(() => {
    el.hidden = true;
  }, 200);
}

async function saveCohortSettings() {
  const classes = parseLinesFromTextarea("settings-classes");
  const defaultBatches = parseLinesFromTextarea("settings-batches-default");
  const paaths = parseLinesFromTextarea("settings-paaths");
  const batchesByClass = {};
  classes.forEach((cls, i) => {
    const ta = document.getElementById(`settings-batches-idx-${i}`);
    if (!ta) return;
    const lines = ta.value
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (lines.length) batchesByClass[cls] = lines;
  });
  const next = {
    classes,
    batches: defaultBatches,
    paaths,
    batchesByClass,
  };
  if (!next.classes.length || !next.batches.length || !next.paaths.length) {
    showToast(
      "Check lists",
      "Add at least one class, default batch list, and paath."
    );
    return;
  }
  try {
    cohortSettings = await data.saveSettings(next);
    buildPaathTabsDOM();
    rebuildClassBatchFilters();
    if (!cohortSettings.paaths.includes(activePaath)) {
      activePaath = cohortSettings.paaths[0];
    }
    setActivePaath(activePaath);
    closeSettingsModal();
    showToast("Saved", "Cohort labels updated.");
  } catch (e) {
    showToast("Save failed", String(e.message || e));
  }
}

async function handleCsvUpload(file) {
  if (!file) return;
  const text = await file.text();
  try {
    const parsed = data.parseStudentsFromCSV(text, cohortSettings);
    if (!parsed.length) {
      showToast("No rows", "No valid student rows found.");
      return;
    }
    if (
      !confirm(
        `Replace all ${allStudents.length} loaded students with ${parsed.length} from file?`
      )
    ) {
      return;
    }
    allStudents = parsed;
    await data.saveStudents(allStudents);
    refresh();
    showToast("Upload complete", `${parsed.length} students saved.`);
  } catch (e) {
    showToast("CSV error", String(e.message || e));
  }
}

async function loadDemoData() {
  allStudents = data.buildDemoStudents(cohortSettings);
  await data.saveStudents(allStudents);
  refresh();
  showToast("Dummy data loaded", `${allStudents.length} sample students.`);
}

function exportCurrentCsv() {
  const csv = data.studentsToCSV(allStudents);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mentoral-students.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function downloadTemplate() {
  const sample = `id,name,student_email,enrollment_ref,guardian_name,guardian_email,guardian_phone,class,batch,paath,test_score,attempt_date,assessment_name
1,Asha Verma,asha@school.edu,ENR-001,Priya Verma,priya@email.com,+15551230101,Class Alpha,Batch 1,Paath A,78,2025-03-15,Midterm exam`;
  const blob = new Blob([sample], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mentoral-students-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

function initDevDummyToggle() {
  const cb = document.getElementById("dev-autoload-dummy");
  const btn = document.getElementById("btn-load-demo");
  const toggleLabel = cb?.closest("label");

  if (!isDevMode()) {
    btn?.classList.add("hidden");
    if (toggleLabel) toggleLabel.classList.add("hidden");
    return;
  }
  if (!cb) return;
  cb.checked = localStorage.getItem(DEV_AUTO_DUMMY_KEY) === "1";
  cb.addEventListener("change", () => {
    localStorage.setItem(DEV_AUTO_DUMMY_KEY, cb.checked ? "1" : "0");
  });
}

function initDataToolbar() {
  initDevDummyToggle();
  document.getElementById("settings-classes")?.addEventListener("blur", () => {
    renderPerClassBatchFields();
  });
  document.getElementById("btn-upload-csv")?.addEventListener("click", () => {
    document.getElementById("file-csv-upload")?.click();
  });
  document.getElementById("file-csv-upload")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    handleCsvUpload(f);
    e.target.value = "";
  });
  document.getElementById("btn-export-csv")?.addEventListener("click", () => {
    if (!allStudents.length) {
      showToast("Nothing to export", "Upload or load dummy data first.");
      return;
    }
    exportCurrentCsv();
  });
  document.getElementById("btn-cohort-settings")?.addEventListener("click", openSettingsModal);
  document.getElementById("settings-modal-close")?.addEventListener("click", closeSettingsModal);
  document.getElementById("settings-modal-cancel")?.addEventListener("click", closeSettingsModal);
  document.getElementById("settings-modal-save")?.addEventListener("click", () => {
    saveCohortSettings();
  });
  document.getElementById("settings-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "settings-modal") closeSettingsModal();
  });
  document.getElementById("btn-load-demo")?.addEventListener("click", () => {
    loadDemoData();
  });
  document.getElementById("btn-template-csv")?.addEventListener("click", downloadTemplate);
}

async function bootstrap() {
  await data.loadOptionalConfigScript();
  const pill = document.getElementById("data-source-pill");
  if (pill) pill.textContent = data.persistenceLabel();
  cohortSettings = await data.loadSettings();
  allStudents = await data.loadStudents();
  if (
    !allStudents.length &&
    localStorage.getItem(DEV_AUTO_DUMMY_KEY) === "1"
  ) {
    allStudents = data.buildDemoStudents(cohortSettings);
    await data.saveStudents(allStudents);
  }
  activePaath = cohortSettings.paaths[0] || "";
  buildPaathTabsDOM();
  rebuildClassBatchFilters();
  initFilters();
  initDataToolbar();
  initStudentDetailModal();
  initModal();
  refresh();
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((e) => {
    console.error(e);
    showToast("Init error", String(e.message || e));
  });
});
