// Usage Analytics — per-course engagement, student time-in-portal, staff admin-panel usage.

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

async function loadUsage() {
    const [
        coursesRes, enrollRes, courseSubjRes, quizzesRes, quizAttemptsRes,
        loginRes, studentsRes,
        adminSessRes, staffRes
    ] = await Promise.all([
        db.from('courses').select('id, name').order('name', { ascending: true }),
        db.from('course_enrollments').select('course_id, student_id'),
        db.from('course_subjects').select('course_id, room_id'),
        db.from('quizzes').select('id, room_id'),
        db.from('quiz_attempts').select('quiz_id, student_id'),
        db.from('login_sessions').select('student_id, started_at, last_seen_at, ended_at'),
        db.from('profiles').select('id, full_name').eq('role', 'student'),
        db.from('admin_sessions').select('admin_id, started_at, last_seen_at, ended_at'),
        db.from('profiles').select('id, full_name, role').in('role', ['admin', 'superadmin'])
    ]);

    renderCourseEngagement(coursesRes.data || [], enrollRes.data || [], courseSubjRes.data || [], quizzesRes.data || [], quizAttemptsRes.data || [], loginRes.data || []);
    renderStudentTime(studentsRes.data || [], loginRes.data || []);
    renderStaffUsage(staffRes.data || [], adminSessRes.data || []);
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

function renderStudentTime(students, loginSessions) {
    const tbody = document.getElementById('student-tbody');
    if (!students.length) { tbody.innerHTML = `<tr><td colspan="4" class="loader">No students yet.</td></tr>`; return; }

    const agg = aggregateSessions(loginSessions, 'student_id');
    const rows = students.map(s => {
        const a = agg[s.id] || { totalSecs: 0, count: 0, lastActive: null };
        return { name: s.full_name || '—', ...a };
    }).sort((a, b) => b.totalSecs - a.totalSecs);

    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.name)}</strong></td>
            <td class="stat-cell">${fmtDur(r.totalSecs)}</td>
            <td class="stat-cell">${r.count}</td>
            <td>${escapeHtml(fmtWhen(r.lastActive))}</td>
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
