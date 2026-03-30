/**
 * Persistence: Supabase when configured, otherwise localStorage.
 * When Supabase credentials are present, localStorage is never read or written.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const LS_SETTINGS = "mentoral_settings_v2";
const LS_STUDENTS = "mentoral_students_v2";

export const DEFAULT_SETTINGS = {
  classes: ["Class Alpha", "Class Beta", "Class Gamma"],
  batches: ["Batch 1", "Batch 2"],
  paaths: ["Paath A", "Paath B"],
  /** Per-class batch lists; any class not listed uses `batches`. */
  batchesByClass: {
    "Class Alpha": ["Batch 1", "Batch 2", "Batch 3"],
  },
};

const ATTEMPT_NAMES = [
  "Diagnostic check-in",
  "Module quiz",
  "Summative assessment",
];

function getWindowConfig() {
  if (typeof window === "undefined") return {};
  return window.__MENTORAL_CONFIG__ || {};
}

export function persistenceLabel() {
  const c = getWindowConfig();
  if (c.supabaseUrl && c.supabaseAnonKey) return "Supabase";
  return "Local storage";
}

export function hasRemote() {
  const c = getWindowConfig();
  return Boolean(c.supabaseUrl?.trim() && c.supabaseAnonKey?.trim());
}

let _sb = null;
function supabase() {
  if (!hasRemote()) return null;
  if (!_sb) {
    const c = getWindowConfig();
    _sb = createClient(c.supabaseUrl.trim(), c.supabaseAnonKey.trim());
  }
  return _sb;
}

function normalizeSettings(raw) {
  const d = {
    classes: [...DEFAULT_SETTINGS.classes],
    batches: [...DEFAULT_SETTINGS.batches],
    paaths: [...DEFAULT_SETTINGS.paaths],
    batchesByClass: { ...DEFAULT_SETTINGS.batchesByClass },
  };
  if (!raw || typeof raw !== "object") return d;
  if (Array.isArray(raw.classes) && raw.classes.length)
    d.classes = raw.classes.map(String).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw.batches) && raw.batches.length)
    d.batches = raw.batches.map(String).map((s) => s.trim()).filter(Boolean);
  if (Array.isArray(raw.paaths) && raw.paaths.length)
    d.paaths = raw.paaths.map(String).map((s) => s.trim()).filter(Boolean);
  const bbc = raw.batchesByClass ?? raw.batches_by_class;
  if (bbc && typeof bbc === "object" && !Array.isArray(bbc)) {
    const keys = Object.keys(bbc);
    if (keys.length) {
      for (const [k, v] of Object.entries(bbc)) {
        const key = String(k).trim();
        if (!key) continue;
        if (Array.isArray(v) && v.length) {
          d.batchesByClass[key] = v
            .map(String)
            .map((s) => s.trim())
            .filter(Boolean);
        } else if (Array.isArray(v) && v.length === 0) {
          delete d.batchesByClass[key];
        }
      }
    }
  }
  return d;
}

/** Batches for one class (override or default list). */
export function getBatchesForClass(settings, className) {
  const S = normalizeSettings(settings);
  const list = S.batchesByClass[className];
  if (Array.isArray(list) && list.length) return list;
  return S.batches;
}

/** Union of all batch labels across classes (for “All classes” filter). */
export function allConfiguredBatches(settings) {
  const S = normalizeSettings(settings);
  const set = new Set();
  for (const c of S.classes) {
    for (const b of getBatchesForClass(S, c)) set.add(b);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export async function loadSettings() {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb
      .from("mentoral_settings")
      .select("classes, batches, paaths, batches_by_class")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new Error(`Supabase settings load failed: ${error.message}`);
    if (data) {
      return normalizeSettings({
        classes: data.classes,
        batches: data.batches,
        paaths: data.paaths,
        batchesByClass: data.batches_by_class,
      });
    }
    // No row yet — return defaults so the app boots; first save will create it.
    return { ...DEFAULT_SETTINGS };
  }
  // localStorage-only mode.
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (raw) return normalizeSettings(JSON.parse(raw));
  } catch (_) {}
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings) {
  const s = normalizeSettings(settings);
  const sb = supabase();
  if (sb) {
    const { error } = await sb.from("mentoral_settings").upsert(
      {
        id: 1,
        classes: s.classes,
        batches: s.batches,
        paaths: s.paaths,
        batches_by_class: s.batchesByClass || {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) throw error;
    return s;
  }
  // localStorage-only mode.
  try {
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
  } catch (_) {}
  return s;
}

function studentToApp(r) {
  const attempts = Array.isArray(r.attempts) ? r.attempts : [];
  const ext = r.external_id ?? r.externalId ?? String(r.id);
  const idNum = Number(ext);
  const id = Number.isFinite(idNum) ? idNum : hashId(String(ext));
  return {
    id,
    externalId: String(ext),
    name: r.full_name,
    studentEmail: r.student_email || "",
    enrollmentRef: r.enrollment_ref || "",
    guardianName: r.guardian_name || "",
    guardianEmail: r.guardian_email || "",
    guardianPhone: r.guardian_phone || "",
    class: r.class_name || "",
    batch: r.batch_name || "",
    paath: r.paath_name || "",
    testScore: Number(r.latest_score) || 0,
    attemptDate: r.latest_attempt_date
      ? String(r.latest_attempt_date).slice(0, 10)
      : "",
    testAttempts: attempts.length
      ? [...attempts].sort((a, b) =>
          a.date < b.date ? 1 : a.date > b.date ? -1 : 0
        )
      : defaultAttemptsFromLatest(
          Number(r.latest_score) || 0,
          r.latest_attempt_date || ""
        ),
  };
}

function defaultAttemptsFromLatest(score, date) {
  const d = date || new Date().toISOString().slice(0, 10);
  return [
    {
      testName: "Recorded assessment",
      date: d,
      score,
    },
  ];
}

function hashId(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++)
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h) % 900000 + 100000;
}

function studentToRow(s) {
  const d = (s.attemptDate || "").trim();
  return {
    external_id: String(s.externalId ?? s.id),
    full_name: s.name,
    student_email: s.studentEmail || "",
    enrollment_ref: s.enrollmentRef || "",
    guardian_name: s.guardianName || "",
    guardian_email: s.guardianEmail || "",
    guardian_phone: s.guardianPhone || "",
    class_name: s.class || "",
    batch_name: s.batch || "",
    paath_name: s.paath || "",
    latest_score: Number(s.testScore) || 0,
    latest_attempt_date: d || null,
    attempts: s.testAttempts || defaultAttemptsFromLatest(s.testScore, s.attemptDate),
    updated_at: new Date().toISOString(),
  };
}

export async function loadStudents() {
  const sb = supabase();
  if (sb) {
    const { data, error } = await sb
      .from("mentoral_students")
      .select("*")
      .order("external_id");
    if (error) throw new Error(`Supabase students load failed: ${error.message}`);
    // Return whatever Supabase has — including an empty array. No localStorage fallback.
    return (data || []).map((r) => studentToApp(r));
  }
  // localStorage-only mode.
  try {
    const raw = localStorage.getItem(LS_STUDENTS);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length)
        return arr.map((s) => ({
          ...s,
          testAttempts: s.testAttempts?.length
            ? s.testAttempts
            : defaultAttemptsFromLatest(s.testScore, s.attemptDate),
        }));
    }
  } catch (_) {}
  return [];
}

export async function saveStudents(students) {
  const rows = students.map((s) => studentToRow(s));
  const sb = supabase();
  if (sb) {
    const { error: delErr } = await sb
      .from("mentoral_students")
      .delete()
      .neq("external_id", "__none__");
    if (delErr) throw delErr;
    if (rows.length) {
      const { error: insErr } = await sb.from("mentoral_students").insert(rows);
      if (insErr) throw insErr;
    }
    return;
  }
  // localStorage-only mode.
  try {
    localStorage.setItem(LS_STUDENTS, JSON.stringify(students));
  } catch (_) {}
}

/** Parse CSV text into student objects (app shape). */
export function parseStudentsFromCSV(text, settings) {
  const table = parseCSV(text);
  if (table.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const headers = table[0].map((h) =>
    String(h)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
  );
  const idx = (name) => headers.indexOf(name);
  const col = (row, ...names) => {
    for (const n of names) {
      const i = idx(n);
      if (i >= 0 && row[i] != null && String(row[i]).trim() !== "")
        return String(row[i]).trim();
    }
    return "";
  };

  const out = [];
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (!row.some((c) => String(c).trim())) continue;

    const idStr = col(row, "id", "student_id", "learner_id");
    const name = col(row, "name", "full_name", "student_name");
    if (!name) continue;

    const idNum = Number(idStr);
    const id = idStr && Number.isFinite(idNum) ? idNum : hashId(idStr || `${r}-${name}`);

    let attempts = [];
    let usedJsonAttempts = false;
    const aj = col(row, "test_attempts_json", "attempts_json", "attempts");
    if (aj) {
      try {
        const parsed = JSON.parse(aj);
        if (Array.isArray(parsed) && parsed.length) {
          usedJsonAttempts = true;
          attempts = parsed.map((a) => ({
            testName: String(a.testName || a.name || "Assessment"),
            date: String(a.date || a.submitted || "").slice(0, 10),
            score: Number(a.score) || 0,
          }));
        }
      } catch (_) {}
    }

    const score = Number(col(row, "test_score", "score", "latest_score")) || 0;
    const attemptDate =
      col(row, "attempt_date", "latest_attempt_date", "date") ||
      new Date().toISOString().slice(0, 10);

    if (!attempts.length) {
      attempts = defaultAttemptsFromLatest(score, attemptDate);
    } else {
      attempts.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      attempts[0].score = score;
      attempts[0].date = attemptDate;
    }

    const assessmentLabel = col(
      row,
      "assessment_name",
      "test_name",
      "latest_test_name"
    );
    if (assessmentLabel && !usedJsonAttempts && attempts[0]) {
      attempts[0].testName = assessmentLabel;
    }

    const classVal = col(row, "class", "class_name") || settings.classes[0] || "";

    out.push({
      id,
      externalId: idStr || String(id),
      name,
      studentEmail: col(row, "student_email", "email", "school_email"),
      enrollmentRef: col(row, "enrollment_ref", "enrollment", "enr"),
      guardianName: col(row, "guardian_name", "parent_name"),
      guardianEmail: col(row, "guardian_email", "parent_email"),
      guardianPhone: col(row, "guardian_phone", "parent_phone", "phone"),
      class: classVal,
      batch:
        col(row, "batch", "batch_name") ||
        getBatchesForClass(settings, classVal)[0] ||
        settings.batches[0] ||
        "",
      paath: col(row, "paath", "paath_name", "path") || settings.paaths[0] || "",
      testScore: score,
      attemptDate,
      testAttempts: attempts,
    });
  }
  return out;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") {
      row.push(cur);
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((c) => String(c).trim())) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => String(c).trim())) rows.push(row);
  return rows;
}

export function studentsToCSV(students) {
  const headers = [
    "id",
    "name",
    "student_email",
    "enrollment_ref",
    "guardian_name",
    "guardian_email",
    "guardian_phone",
    "class",
    "batch",
    "paath",
    "test_score",
    "attempt_date",
    "assessment_name",
    "test_attempts_json",
  ];
  const lines = [headers.join(",")];
  for (const s of students) {
    const att = Array.isArray(s.testAttempts) ? s.testAttempts : [];
    const multi = att.length > 1;
    const attemptsJson = multi
      ? JSON.stringify(att).replace(/"/g, '""')
      : "";
    const assessmentName = att[0]?.testName || "";
    const esc = (v) => {
      const t = String(v ?? "");
      if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
      return t;
    };
    const jsonCell =
      multi && attemptsJson ? `"${attemptsJson}"` : esc("");
    lines.push(
      [
        esc(s.externalId ?? s.id),
        esc(s.name),
        esc(s.studentEmail),
        esc(s.enrollmentRef),
        esc(s.guardianName),
        esc(s.guardianEmail),
        esc(s.guardianPhone),
        esc(s.class),
        esc(s.batch),
        esc(s.paath),
        esc(s.testScore),
        esc(s.attemptDate),
        esc(assessmentName),
        jsonCell,
      ].join(",")
    );
  }
  return lines.join("\n");
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function slugPart(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 12);
}

const GUARDIAN_FIRST = [
  "Anita",
  "Rahul",
  "Priya",
  "Vikram",
  "Sunita",
  "James",
  "Maria",
  "David",
  "Elena",
  "Kenji",
];
const GUARDIAN_LAST = [
  "Patel",
  "Sharma",
  "Nguyen",
  "García",
  "Okafor",
  "Kim",
  "Andersson",
  "Brown",
  "Silva",
  "Tanaka",
];

function buildGuardian(rand, studentId) {
  const fn = GUARDIAN_FIRST[Math.floor(rand() * GUARDIAN_FIRST.length)];
  const ln = GUARDIAN_LAST[Math.floor(rand() * GUARDIAN_LAST.length)];
  const guardianName = `${fn} ${ln}`;
  const emailLocal = `${slugPart(fn)}.${slugPart(ln)}.${studentId}`;
  const phoneMid = String(200 + (studentId % 700)).padStart(3, "0");
  const phoneLast = String(1000 + (studentId * 17) % 9000).padStart(4, "0");
  return {
    guardianName,
    guardianEmail: `${emailLocal}@family.example.com`,
    guardianPhone: `+1 (555) ${phoneMid}-${phoneLast}`,
  };
}

/** Deterministic demo cohort (~200) using current settings dimensions. */
export function buildDemoStudents(settings) {
  const S = normalizeSettings(settings);
  const rand = mulberry32(42);
  const cells = [];
  for (const cls of S.classes) {
    const batchesForClass = getBatchesForClass(S, cls);
    for (const batch of batchesForClass) {
      for (const paath of S.paaths) {
        cells.push({ class: cls, batch, paath });
      }
    }
  }
  const n = cells.length;
  if (!n) return [];
  const target = 200;
  const base = Math.floor(target / n);
  let rem = target % n;
  const students = [];
  let nextId = 1;
  for (const cell of cells) {
    const count = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    const ci = S.classes.indexOf(cell.class);
    const classBias =
      ci === 0 ? 4 : ci === 1 ? 0 : ci === 2 ? -3 : ci % 2 === 0 ? 2 : -1;
    const firstBatch = getBatchesForClass(S, cell.class)[0] || "";
    const batchBias = cell.batch === firstBatch ? 2 : -1;
    const paathBias = cell.paath === S.paaths[0] ? 1 : -1;
    for (let i = 0; i < count; i++) {
      const sid = nextId++;
      const noise = (rand() - 0.5) * 28;
      const raw = 58 + classBias + batchBias + paathBias + noise;
      const testScore = Math.round(Math.min(100, Math.max(0, raw)));
      const attemptDate = new Date(2025, 2, 1 + Math.floor(rand() * 20))
        .toISOString()
        .slice(0, 10);

      const nAtt = 2 + (sid % 2);
      const [y, mo, da] = attemptDate.split("-").map(Number);
      const testAttempts = [];
      for (let j = 0; j < nAtt; j++) {
        const isLast = j === nAtt - 1;
        const daysBack = (nAtt - 1 - j) * 14 + Math.floor(rand() * 5);
        const d = new Date(y, mo - 1, da - daysBack);
        const iso = d.toISOString().slice(0, 10);
        const score = isLast
          ? testScore
          : Math.min(100, Math.max(0, testScore + Math.round((rand() - 0.5) * 22)));
        const nameIdx = Math.min(j, ATTEMPT_NAMES.length - 1);
        let testName = ATTEMPT_NAMES[nameIdx];
        if (j >= ATTEMPT_NAMES.length) testName = `Practice set ${j}`;
        testAttempts.push({ testName, date: iso, score });
      }
      testAttempts[nAtt - 1].score = testScore;
      testAttempts[nAtt - 1].date = attemptDate;
      testAttempts.sort((a, b) =>
        a.date < b.date ? 1 : a.date > b.date ? -1 : 0
      );

      students.push({
        id: sid,
        externalId: String(sid),
        name: `Student ${String(sid).padStart(3, "0")}`,
        studentEmail: `s${String(sid).padStart(3, "0")}@learner.mentoral.edu`,
        enrollmentRef: `ENR-2025-${String(sid).padStart(4, "0")}`,
        ...buildGuardian(rand, sid),
        ...cell,
        testScore,
        attemptDate,
        testAttempts,
      });
    }
  }
  return students;
}

export async function loadOptionalConfigScript() {
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "config.js";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
}
