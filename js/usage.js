// Usage Analytics — per-course engagement, student engagement (search/filter/sort), staff admin-panel usage.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function fmtDur(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${secs}s`;
}

function fmtWhen(iso) {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// A session's duration and its "last touched" timestamp, from whichever
// of ended_at / last_seen_at / started_at is most recent (mirrors activity.js).
function sessionEnd(s) { return s.ended_at || s.last_seen_at || s.started_at; }
function sessionDurationSecs(s) {
    const start = new Date(s.started_at).getTime();
    const end = new Date(sessionEnd(s)).getTime();
    return Math.max(0, (end - start) / 1000);
}

// Aggregate a list of {*_id, started_at, last_seen_at, ended_at} rows into
// per-person totals: { totalSecs, count, lastActive }.
function aggregateSessions(sessions, idKey) {
    const byId = {};
    sessions.forEach(s => {
        const id = s[idKey];
        if (!byId[id]) byId[id] = { totalSecs: 0, count: 0, lastActive: null };
        const agg = byId[id];
        agg.totalSecs += sessionDurationSecs(s);
        agg.count += 1;
        const end = sessionEnd(s);
        if (!agg.lastActive || end > agg.lastActive) agg.lastActive = end;
    });
    return byId;
}

// Per-student quiz attempt stats: { count, avgScore }.
function aggregateQuizAttempts(attempts) {
    const byId = {};
    attempts.forEach(a => {
        const b = (byId[a.student_id] ||= { count: 0, sum: 0 });
        b.count += 1;
        if (a.score != null) b.sum += Number(a.score);
    });
    const out = {};
    Object.keys(byId).forEach(id => { const b = byId[id]; out[id] = { count: b.count, avgScore: b.count ? Math.round(b.sum / b.count) : null }; });
    return out;
}

// Per-student exam attempt stats: { count, avgScore, passRate }.
function aggregateExamAttempts(attempts) {
    const byId = {};
    attempts.forEach(a => {
        const b = (byId[a.student_id] ||= { count: 0, sum: 0, passed: 0 });
        b.count += 1;
        if (a.score != null) b.sum += Number(a.score);
        if (a.passed) b.passed += 1;
    });
    const out = {};
    Object.keys(byId).forEach(id => {
        const b = byId[id];
        out[id] = { count: b.count, avgScore: b.count ? Math.round(b.sum / b.count) : null, passRate: b.count ? Math.round((b.passed / b.count) * 100) : null };
    });
    return out;
}

// Per-student attendance stats: { marks, pct }.
function aggregateAttendance(records) {
    const byId = {};
    records.forEach(r => {
        const b = (byId[r.student_id] ||= { total: 0, present: 0 });
        b.total += 1;
        if (r.present) b.present += 1;
    });
    const out = {};
    Object.keys(byId).forEach(id => { const b = byId[id]; out[id] = { marks: b.total, pct: b.total ? Math.round((b.present / b.total) * 100) : null }; });
    return out;
}

// A green/amber/red/gray pill for a 0-100 score. null = no data yet.
function scoreBadge(pct) {
    if (pct == null) return `<span style="font-size:12px;color:var(--text-muted);">—</span>`;
    const [bg, fg] = pct >= 80 ? ['#dcfce7', '#15803d'] : pct >= 50 ? ['#fef3c7', '#b45309'] : ['#fee2e2', '#b91c1c'];
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};white-space:nowrap;">${pct}%</span>`;
}

// A green/amber/red/gray pill for how recently a student was last active.
function recencyBadge(lastActive) {
    if (!lastActive) return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#f1f5f9;color:#64748b;white-space:nowrap;">Never</span>`;
    const days = (Date.now() - new Date(lastActive).getTime()) / 86400000;
    const [bg, fg, label] = days <= 7 ? ['#dcfce7', '#15803d', 'Active'] : days <= 30 ? ['#fef3c7', '#b45309', 'Quiet'] : ['#fee2e2', '#b91c1c', 'Inactive'];
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};white-space:nowrap;">${label}</span>`;
}

let STUDENT_ROWS = [];          // every student, fully enriched — built once per load
let US_COURSE_STUDENTS = {};    // course_id -> Set(student_id)
let US_SEARCH = '', US_COURSE = '', US_SORT = 'time', US_TIMER = null;

async function loadUsage() {
    const [
        coursesRes, enrollRes, courseSubjRes, quizzesRes, quizAttemptsRes,
        examAttemptsRes, attendanceRes,
        loginRes, studentsRes,
        adminSessRes, staffRes
    ] = await Promise.all([
        db.from('courses').select('id, name').order('name', { ascending: true }),
        db.from('course_enrollments').select('course_id, student_id'),
        db.from('course_subjects').select('course_id, room_id'),
        db.from('quizzes').select('id, room_id'),
        db.from('quiz_attempts').select('quiz_id, student_id, score'),
        db.from('exam_attempts').select('student_id, score, passed'),
        db.from('attendance').select('student_id, present'),
        db.from('login_sessions').select('student_id, started_at, last_seen_at, ended_at'),
        db.from('profiles').select('id, full_name').eq('role', 'student'),
        db.from('admin_sessions').select('admin_id, started_at, last_seen_at, ended_at'),
        db.from('profiles').select('id, full_name, role').in('role', ['admin', 'superadmin'])
    ]);

    const courses = coursesRes.data || [];
    const enrollments = enrollRes.data || [];

    populateUsageCourseFilter(courses);
    US_COURSE_STUDENTS = {};
    enrollments.forEach(e => { (US_COURSE_STUDENTS[e.course_id] ||= new Set()).add(e.student_id); });

    renderCourseEngagement(courses, enrollments, courseSubjRes.data || [], quizzesRes.data || [], quizAttemptsRes.data || [], loginRes.data || []);
    buildStudentRows(studentsRes.data || [], loginRes.data || [], quizAttemptsRes.data || [], examAttemptsRes.data || [], attendanceRes.data || []);
    renderStudentRows();
    renderStaffUsage(staffRes.data || [], adminSessRes.data || []);
}

function populateUsageCourseFilter(courses) {
    const sel = document.getElementById('usage-course-filter');
    if (!sel) return;
    sel.innerHTML = `<option value="">All courses</option>` + courses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
}

function renderCourseEngagement(courses, enrollments, courseSubjects, quizzes, quizAttempts, loginSessions) {
    const tbody = document.getElementById('course-tbody');
    if (!courses.length) { tbody.innerHTML = `<tr><td colspan="4" class="loader">No courses yet.</td></tr>`; return; }

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const activeStudentIds = new Set(
        loginSessions.filter(s => new Date(sessionEnd(s)).getTime() >= thirtyDaysAgo).map(s => s.student_id)
    );

    const roomsByCourse = {};
    courseSubjects.forEach(cs => { (roomsByCourse[cs.course_id] ||= []).push(cs.room_id); });

    const quizIdsByRoom = {};
    quizzes.forEach(q => { (quizIdsByRoom[q.room_id] ||= []).push(q.id); });

    const attemptCountByQuiz = {};
    quizAttempts.forEach(a => { attemptCountByQuiz[a.quiz_id] = (attemptCountByQuiz[a.quiz_id] || 0) + 1; });

    const rows = courses.map(c => {
        const enrolled = enrollments.filter(e => e.course_id === c.id).map(e => e.student_id);
        const activeCount = enrolled.filter(sid => activeStudentIds.has(sid)).length;
        const roomIds = roomsByCourse[c.id] || [];
        const quizIds = roomIds.flatMap(rid => quizIdsByRoom[rid] || []);
        const attemptCount = quizIds.reduce((sum, qid) => sum + (attemptCountByQuiz[qid] || 0), 0);
        const pct = enrolled.length ? Math.round((activeCount / enrolled.length) * 100) : 0;
        return { name: c.name, enrolled: enrolled.length, activeCount, pct, attemptCount };
    }).sort((a, b) => b.pct - a.pct);

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.name)}</strong></td>
            <td class="stat-cell">${r.enrolled}</td>
            <td class="stat-cell"><span class="pct-bar"><i style="width:${r.pct}%;"></i></span>${r.activeCount} / ${r.enrolled} (${r.pct}%)</td>
            <td class="stat-cell">${r.attemptCount}</td>
        </tr>`).join('');
}

// Build the full per-student engagement dataset once; search/filter/sort just re-render it.
function buildStudentRows(students, loginSessions, quizAttempts, examAttempts, attendanceRecords) {
    const sessAgg = aggregateSessions(loginSessions, 'student_id');
    const quizAgg = aggregateQuizAttempts(quizAttempts);
    const examAgg = aggregateExamAttempts(examAttempts);
    const attAgg = aggregateAttendance(attendanceRecords);

    STUDENT_ROWS = students.map(s => {
        const sess = sessAgg[s.id] || { totalSecs: 0, count: 0, lastActive: null };
        return {
            id: s.id,
            name: s.full_name || '—',
            totalSecs: sess.totalSecs, sessionCount: sess.count, lastActive: sess.lastActive,
            quiz: quizAgg[s.id] || { count: 0, avgScore: null },
            exam: examAgg[s.id] || { count: 0, avgScore: null, passRate: null },
            att: attAgg[s.id] || { marks: 0, pct: null },
        };
    });
}

function onUsageSearch() {
    clearTimeout(US_TIMER);
    US_TIMER = setTimeout(() => {
        US_SEARCH = (document.getElementById('usage-search').value || '').trim().toLowerCase();
        renderStudentRows();
    }, 300);
}
function onUsageCourseFilter() { US_COURSE = document.getElementById('usage-course-filter').value || ''; renderStudentRows(); }
function onUsageSort() { US_SORT = document.getElementById('usage-sort').value || 'time'; renderStudentRows(); }

function renderStudentRows() {
    const tbody = document.getElementById('student-tbody');
    if (!STUDENT_ROWS.length) { tbody.innerHTML = `<tr><td colspan="7" class="loader">No students yet.</td></tr>`; return; }

    let rows = STUDENT_ROWS;
    if (US_COURSE) { const ids = US_COURSE_STUDENTS[US_COURSE] || new Set(); rows = rows.filter(r => ids.has(r.id)); }
    if (US_SEARCH) rows = rows.filter(r => r.name.toLowerCase().includes(US_SEARCH));

    // "Never active" sorts as oldest so it surfaces first in ascending (least-active) sorts.
    const lastActiveTime = r => r.lastActive ? new Date(r.lastActive).getTime() : -Infinity;

    rows = rows.slice().sort((a, b) => {
        if (US_SORT === 'inactive') return lastActiveTime(a) - lastActiveTime(b);
        if (US_SORT === 'quiz') return (a.quiz.avgScore ?? -1) - (b.quiz.avgScore ?? -1);
        if (US_SORT === 'exam') return (a.exam.avgScore ?? -1) - (b.exam.avgScore ?? -1);
        if (US_SORT === 'attendance') return (a.att.pct ?? -1) - (b.att.pct ?? -1);
        return b.totalSecs - a.totalSecs;   // default: most time in portal first
    });

    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="7" class="loader">No students match.</td></tr>`; return; }

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><a href="activity.html?id=${encodeURIComponent(r.id)}" style="font-weight:700;color:var(--navy-800);text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${escapeHtml(r.name)}</a></td>
            <td class="stat-cell">${fmtDur(r.totalSecs)}</td>
            <td class="stat-cell">${r.sessionCount}</td>
            <td>${escapeHtml(fmtWhen(r.lastActive))} ${recencyBadge(r.lastActive)}</td>
            <td class="stat-cell">${r.quiz.count} ${scoreBadge(r.quiz.avgScore)}</td>
            <td class="stat-cell">${r.exam.count} ${scoreBadge(r.exam.avgScore)}${r.exam.count ? ` <span style="font-size:11px;color:var(--text-muted);">(${r.exam.passRate}% passed)</span>` : ''}</td>
            <td class="stat-cell">${r.att.marks ? `<span class="pct-bar"><i style="width:${r.att.pct}%;"></i></span>` : ''}${scoreBadge(r.att.pct)}</td>
        </tr>`).join('');
}

function renderStaffUsage(staff, adminSessions) {
    const tbody = document.getElementById('staff-tbody');
    if (!staff.length) { tbody.innerHTML = `<tr><td colspan="5" class="loader">No staff yet.</td></tr>`; return; }

    const agg = aggregateSessions(adminSessions, 'admin_id');
    const rows = staff.map(s => {
        const a = agg[s.id] || { totalSecs: 0, count: 0, lastActive: null };
        return { name: s.full_name || '—', role: s.role, ...a };
    }).sort((a, b) => b.totalSecs - a.totalSecs);

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.name)}</strong></td>
            <td>${r.role === 'superadmin' ? 'Superadmin' : 'Admin'}</td>
            <td class="stat-cell">${fmtDur(r.totalSecs)}</td>
            <td class="stat-cell">${r.count}</td>
            <td>${escapeHtml(fmtWhen(r.lastActive))}</td>
        </tr>`).join('');
}
