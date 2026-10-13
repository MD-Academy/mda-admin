// Student Activity Report — logins, quiz/exam attempts, and attendance for one
// student, all filterable by the same date range and printable to PDF.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtDur(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
function fmtTime(d) { return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function fmtDateTime(d) { return d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; }
function fmtDateOnly(d) { return d ? new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function dayKey(d) { return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }

// A green/amber/red pill for a 0-100 score. null = no data.
function scoreBadge(pct) {
    if (pct == null) return `<span style="color:var(--text-muted);">—</span>`;
    const [bg, fg] = pct >= 80 ? ['#dcfce7', '#15803d'] : pct >= 50 ? ['#fef3c7', '#b45309'] : ['#fee2e2', '#b91c1c'];
    return `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:${bg};color:${fg};white-space:nowrap;">${pct}%</span>`;
}

let _actAllSessions = [];       // [{started_at, last_seen_at, ended_at}]
let _actAllQuizAttempts = [];   // [{quiz_id, score, completed_at, quizTitle, roomName}]
let _actAllExamAttempts = [];   // [{exam_id, score, passed, attempts, completed_at, examTitle}]
let _actAllAttendance = [];     // [{session_id, session_date, courseName, present, updated_at}]
let _actAllSectionTime = [];    // [{section_type, section_ref, started_at, last_seen_at, ended_at, label}]
let _actFilterFrom = null;   // Date or null (null = no lower bound)
let _actFilterTo = null;     // Date or null (null = no upper bound)
let _actActivePreset = 'all';

function _dateInputVal(d) { return d ? new Date(d).toISOString().slice(0, 10) : ''; }

function _actFilterBarHtml() {
    const presets = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['all', 'All time']];
    return `
        <div class="toolbar no-print" id="act-filter-bar" style="flex-wrap:wrap;gap:8px;margin-bottom:14px;">
            ${presets.map(([id, label]) => `<button class="btn btn-sm ${_actActivePreset === id ? 'btn-primary' : 'btn-ghost'}" onclick="setActivityFilter('${id}')">${label}</button>`).join('')}
            <input type="date" id="act-from" class="filter-select" style="width:auto;" value="${_actActivePreset === 'custom' ? _dateInputVal(_actFilterFrom) : ''}">
            <span style="color:var(--text-muted);font-size:13px;">to</span>
            <input type="date" id="act-to" class="filter-select" style="width:auto;" value="${_actActivePreset === 'custom' ? _dateInputVal(_actFilterTo) : ''}">
            <button class="btn btn-sm ${_actActivePreset === 'custom' ? 'btn-primary' : 'btn-ghost'}" onclick="applyCustomActivityFilter()">Apply custom range</button>
        </div>`;
}

function setActivityFilter(preset) {
    _actActivePreset = preset;
    const now = new Date();
    const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
    if (preset === 'today') { _actFilterFrom = startOfDay(now); _actFilterTo = null; }
    else if (preset === 'week') { const f = startOfDay(now); f.setDate(f.getDate() - f.getDay()); _actFilterFrom = f; _actFilterTo = null; }
    else if (preset === 'month') { _actFilterFrom = new Date(now.getFullYear(), now.getMonth(), 1); _actFilterTo = null; }
    else { _actFilterFrom = null; _actFilterTo = null; }
    document.getElementById('act-from').value = '';
    document.getElementById('act-to').value = '';
    renderActivityFiltered();
}

function applyCustomActivityFilter() {
    const fromVal = document.getElementById('act-from').value;
    const toVal = document.getElementById('act-to').value;
    _actActivePreset = 'custom';
    _actFilterFrom = fromVal ? new Date(fromVal + 'T00:00:00') : null;
    _actFilterTo = toVal ? new Date(toVal + 'T23:59:59') : null;
    renderActivityFiltered();
}

function renderActivityFiltered() {
    const filterBar = document.getElementById('act-filter-bar');
    if (filterBar) filterBar.outerHTML = _actFilterBarHtml();

    const inRange = t => {
        if (_actFilterFrom && t < _actFilterFrom.getTime()) return false;
        if (_actFilterTo && t > _actFilterTo.getTime()) return false;
        return true;
    };

    const sessions = _actAllSessions.filter(s => inRange(new Date(s.started_at).getTime()));
    // An attempt with no completed_at (still in progress) is always kept — it's real activity, just undated.
    const quizAttempts = _actAllQuizAttempts.filter(a => !a.completed_at || inRange(new Date(a.completed_at).getTime()));
    const examAttempts = _actAllExamAttempts.filter(a => !a.completed_at || inRange(new Date(a.completed_at).getTime()));
    const attendance = _actAllAttendance.filter(a => !a.session_date || inRange(new Date(a.session_date + 'T00:00:00').getTime()));
    const sectionTime = _actAllSectionTime.filter(s => inRange(new Date(s.started_at).getTime()));

    renderFullReport(sessions, quizAttempts, examAttempts, attendance, sectionTime);
}

async function initActivity(studentId, profile) {
    const { data: student } = await db.from('profiles').select('full_name').eq('id', studentId).single();
    const name = (student && student.full_name) || 'Student';
    renderLayout('students', 'Student Activity Report', `Everything recorded for this student in the LMS — ${escapeHtml(name)}`, profile);

    document.getElementById('page-content').innerHTML = `
        <a class="back-link no-print" href="students.html" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text-muted);text-decoration:none;margin-bottom:14px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Back to Students
        </a>
        <div style="display:flex;justify-content:flex-end;margin-bottom:14px;" class="no-print">
            <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
        </div>
        <div class="report-head">
            <img src="assets/images/mda-logo.png" alt="MDA">
            <div class="rh-text">
                <strong>Student Activity Report</strong>
                <div style="margin:8px 0 4px;">
                    <span style="display:inline-flex;align-items:center;gap:9px;background:linear-gradient(135deg,#2563eb 0%,#7a2a6b 55%,#b91c5c 100%);color:#fff;font-weight:700;font-size:15px;padding:10px 20px;border-radius:12px;text-shadow:0 1px 2px rgba(0,0,0,.22);box-shadow:0 6px 16px rgba(37,99,235,.28),0 3px 6px rgba(185,28,92,.28),inset 0 1px 0 rgba(255,255,255,.38),inset 0 -2px 5px rgba(0,0,0,.18);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M21 8v4.5"/><circle cx="12" cy="14.5" r="2.4"/><path d="M7.6 21a4.4 4.4 0 0 1 8.8 0"/>
                        </svg>
                        ${escapeHtml(name)}
                    </span>
                </div>
                <span id="gen-time">Updated ${new Date().toLocaleString('en-GB')} · refreshes automatically</span>
            </div>
        </div>
        ${_actFilterBarHtml()}
        <div id="report"><div class="loader">Loading activity…</div></div>
    `;

    // The report is a live view — re-query every 30s so "Active/Ended" reflects
    // the student's current state without the admin reloading the page.
    refreshActivity(studentId);
    if (window._actTimer) clearInterval(window._actTimer);
    window._actTimer = setInterval(() => refreshActivity(studentId), 30000);
}

async function refreshActivity(studentId) {
    const report = document.getElementById('report');
    if (!report) { if (window._actTimer) clearInterval(window._actTimer); return; }

    const [sessRes, qaRes, eaRes, enrRes, secRes] = await Promise.all([
        db.from('login_sessions').select('started_at, last_seen_at, ended_at').eq('student_id', studentId).order('started_at', { ascending: false }),
        db.from('quiz_attempts').select('quiz_id, score, completed_at').eq('student_id', studentId).order('completed_at', { ascending: false }),
        db.from('exam_attempts').select('exam_id, score, passed, attempts, completed_at').eq('student_id', studentId).order('completed_at', { ascending: false }),
        db.from('course_enrollments').select('course_id').eq('student_id', studentId),
        db.from('section_sessions').select('section_type, section_ref, started_at, last_seen_at, ended_at').eq('student_id', studentId).order('started_at', { ascending: false }),
    ]);

    const gt = document.getElementById('gen-time');
    if (gt) gt.textContent = `Updated ${new Date().toLocaleString('en-GB')} · refreshes automatically`;

    if (sessRes.error) { report.innerHTML = `<div class="loader" style="color:var(--red)">Error: ${escapeHtml(sessRes.error.message)}</div>`; return; }
    _actAllSessions = sessRes.data || [];

    const quizAttempts = qaRes.data || [];
    const examAttempts = eaRes.data || [];
    const sectionRows = secRes.data || [];
    const sectionQuizIds = sectionRows.filter(r => r.section_type === 'quiz').map(r => r.section_ref);
    const sectionExamIds = sectionRows.filter(r => r.section_type === 'exam').map(r => r.section_ref);
    const sectionRoomIds = sectionRows.filter(r => r.section_type === 'subject').map(r => r.section_ref);

    // Resolve quiz titles + room names — covers both attempted quizzes and
    // quizzes that were only opened (a section_session with no attempt yet).
    const quizIds = [...new Set([...quizAttempts.map(a => a.quiz_id), ...sectionQuizIds])];
    const quizMeta = {};
    const roomNames = {};
    if (quizIds.length) {
        const { data: quizzes } = await db.from('quizzes').select('id, title, room_id').in('id', quizIds);
        (quizzes || []).forEach(q => { quizMeta[q.id] = { title: q.title || 'Untitled quiz', room_id: q.room_id }; });
    }
    const roomIds = [...new Set([...Object.values(quizMeta).map(q => q.room_id).filter(Boolean), ...sectionRoomIds])];
    if (roomIds.length) {
        const { data: rooms } = await db.from('rooms').select('id, name').in('id', roomIds);
        (rooms || []).forEach(r => { roomNames[r.id] = r.name; });
    }
    _actAllQuizAttempts = quizAttempts.map(a => ({
        ...a,
        quizTitle: (quizMeta[a.quiz_id] || {}).title || 'Untitled quiz',
        roomName: roomNames[(quizMeta[a.quiz_id] || {}).room_id] || '—',
    }));

    // Resolve exam titles — covers attempted exams and exams only opened.
    const examIds = [...new Set([...examAttempts.map(a => a.exam_id), ...sectionExamIds])];
    const examTitles = {};
    if (examIds.length) {
        const { data: exams } = await db.from('exams').select('id, title').in('id', examIds);
        (exams || []).forEach(e => { examTitles[e.id] = e.title || 'Untitled exam'; });
    }
    _actAllExamAttempts = examAttempts.map(a => ({ ...a, examTitle: examTitles[a.exam_id] || 'Untitled exam' }));

    // Per-section time: label each page-view row using the same lookups above.
    _actAllSectionTime = sectionRows.map(r => {
        let label;
        if (r.section_type === 'quiz') label = `Quiz: ${(quizMeta[r.section_ref] || {}).title || 'Untitled quiz'}`;
        else if (r.section_type === 'exam') label = `Exam: ${examTitles[r.section_ref] || 'Untitled exam'}`;
        else if (r.section_type === 'subject') label = `Subject: ${roomNames[r.section_ref] || 'Untitled subject'}`;
        else label = r.section_type.charAt(0).toUpperCase() + r.section_type.slice(1);
        return { ...r, label };
    });

    // Attendance across every course this student is/was enrolled in.
    const courseIds = [...new Set((enrRes.data || []).map(e => e.course_id))];
    _actAllAttendance = [];
    if (courseIds.length) {
        const [sesRes, courseRes] = await Promise.all([
            db.from('class_sessions').select('id, session_date, course_id').in('course_id', courseIds),
            db.from('courses').select('id, name').in('id', courseIds),
        ]);
        const sessions = sesRes.data || [];
        const courseNames = {};
        (courseRes.data || []).forEach(c => { courseNames[c.id] = c.name; });
        const sessionIds = sessions.map(s => s.id);
        const marks = {};
        if (sessionIds.length) {
            const { data: att } = await db.from('attendance').select('session_id, present, updated_at').eq('student_id', studentId).in('session_id', sessionIds);
            (att || []).forEach(m => { marks[m.session_id] = m; });
        }
        _actAllAttendance = sessions.map(s => {
            const m = marks[s.id];
            return {
                session_id: s.id,
                session_date: s.session_date,
                courseName: courseNames[s.course_id] || '—',
                present: m ? m.present === true : null,   // null = no attendance mark found for this session
                updated_at: m ? m.updated_at : null,
            };
        });
    }

    if (!_actAllSessions.length && !_actAllQuizAttempts.length && !_actAllExamAttempts.length && !_actAllAttendance.length && !_actAllSectionTime.length) {
        report.innerHTML = `<div class="empty-state"><h3>No activity yet</h3><p>This student hasn't used the portal yet, or data is still being recorded.</p></div>`;
        return;
    }
    renderActivityFiltered();
}

// Group login sessions by day; returns { grand, html }.
function buildSessionsReport(sessions) {
    if (sessions.length === 0) {
        return { grand: 0, html: `<div class="empty-state"><h3>No logins in this range</h3><p>Try a wider date range.</p></div>` };
    }

    const days = {};   // dayKey -> { total, rows: [] }
    let grand = 0;
    const now = Date.now();
    sessions.forEach(s => {
        const start = new Date(s.started_at);
        const endedAt = s.ended_at ? new Date(s.ended_at) : null;
        const lastSeen = s.last_seen_at ? new Date(s.last_seen_at) : null;
        const end = endedAt || lastSeen || start;
        const active = !endedAt && (now - (lastSeen || start).getTime()) < 600000;  // seen in last 10 min
        const dur = Math.max(0, (end - start) / 1000);
        grand += dur;
        const k = dayKey(s.started_at);
        if (!days[k]) days[k] = { total: 0, rows: [], sort: start.getTime() };
        days[k].total += dur;
        days[k].sort = Math.max(days[k].sort, start.getTime());
        days[k].rows.push({ start, end, dur, active });
    });

    const ordered = Object.keys(days).sort((a, b) => days[b].sort - days[a].sort);
    const badgeActive = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#15803d;white-space:nowrap;">● Active</span>`;
    const badgeEnded = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#fee2e2;color:#b91c1c;white-space:nowrap;">Ended</span>`;

    const html = ordered.map(k => {
        const d = days[k];
        d.rows.sort((a, b) => a.start - b.start);
        return `
        <div class="day-card">
            <div class="day-head"><div class="d-date">${escapeHtml(k)}</div><div class="d-total">Total: ${fmtDur(d.total)}</div></div>
            ${d.rows.map(r => {
                const endPart = r.active
                    ? `<span style="color:#15803d;font-weight:600;">still active</span>`
                    : `<strong>Ended</strong> ${fmtTime(r.end)}`;
                return `<div class="sess-row">
                    <span><strong>Started</strong> ${fmtTime(r.start)} <span style="color:var(--text-muted);">→</span> ${endPart}</span>
                    <span style="display:inline-flex;align-items:center;gap:12px;">
                        <span class="dur">${fmtDur(r.dur)}</span>
                        ${r.active ? badgeActive : badgeEnded}
                    </span>
                </div>`;
            }).join('')}
        </div>`;
    }).join('');

    return { grand, html };
}

function buildQuizSection(attempts) {
    if (!attempts.length) return `<div class="panel" style="padding:16px 20px;"><p class="hint" style="margin:0;">No quiz attempts in this range.</p></div>`;
    return `<div class="panel"><table class="data-table">
        <thead><tr><th>Quiz</th><th>Room</th><th>Score</th><th>Completed at</th></tr></thead>
        <tbody>${attempts.map(a => `
            <tr>
                <td><strong>${escapeHtml(a.quizTitle)}</strong></td>
                <td>${escapeHtml(a.roomName)}</td>
                <td class="stat-cell">${a.score != null ? scoreBadge(Math.round(a.score)) : '—'}</td>
                <td>${escapeHtml(fmtDateTime(a.completed_at))}</td>
            </tr>`).join('')}</tbody>
    </table></div>`;
}

function buildExamSection(attempts) {
    if (!attempts.length) return `<div class="panel" style="padding:16px 20px;"><p class="hint" style="margin:0;">No exam attempts in this range.</p></div>`;
    return `<div class="panel"><table class="data-table">
        <thead><tr><th>Exam</th><th>Score</th><th>Passed</th><th>Attempt #</th><th>Completed at</th></tr></thead>
        <tbody>${attempts.map(a => `
            <tr>
                <td><strong>${escapeHtml(a.examTitle)}</strong></td>
                <td class="stat-cell">${a.score != null ? scoreBadge(Math.round(a.score)) : '—'}</td>
                <td>${a.passed ? '<span style="color:#15803d;font-weight:700;">Yes</span>' : '<span style="color:#b91c1c;font-weight:700;">No</span>'}</td>
                <td class="stat-cell">${a.attempts || 1}</td>
                <td>${escapeHtml(fmtDateTime(a.completed_at))}</td>
            </tr>`).join('')}</tbody>
    </table></div>`;
}

function buildAttendanceSection(records) {
    if (!records.length) return `<div class="panel" style="padding:16px 20px;"><p class="hint" style="margin:0;">No class sessions in this range.</p></div>`;
    const sorted = records.slice().sort((a, b) => new Date(b.session_date) - new Date(a.session_date));
    return `<div class="panel"><table class="data-table">
        <thead><tr><th>Course</th><th>Date</th><th>Attendance</th><th>Marked at</th></tr></thead>
        <tbody>${sorted.map(r => `
            <tr>
                <td><strong>${escapeHtml(r.courseName)}</strong></td>
                <td>${fmtDateOnly(r.session_date)}</td>
                <td>${r.present === null ? '<span style="color:var(--text-muted);">Not marked</span>' : r.present ? '<span style="color:#15803d;font-weight:700;">Present</span>' : '<span style="color:#b91c1c;font-weight:700;">Absent</span>'}</td>
                <td>${escapeHtml(fmtDateTime(r.updated_at))}</td>
            </tr>`).join('')}</tbody>
    </table></div>`;
}

// Group per-section page views by day — same shape as buildSessionsReport,
// but each row is one page view of a specific section instead of a login.
function buildSectionTimeReport(records) {
    if (records.length === 0) {
        return `<div class="panel" style="padding:16px 20px;"><p class="hint" style="margin:0;">No section-level activity recorded yet — this tracks forward from when it was turned on, not retroactively.</p></div>`;
    }

    const days = {};
    const now = Date.now();
    records.forEach(r => {
        const start = new Date(r.started_at);
        const endedAt = r.ended_at ? new Date(r.ended_at) : null;
        const lastSeen = r.last_seen_at ? new Date(r.last_seen_at) : null;
        const end = endedAt || lastSeen || start;
        const active = !endedAt && (now - (lastSeen || start).getTime()) < 600000;
        const dur = Math.max(0, (end - start) / 1000);
        const k = dayKey(r.started_at);
        if (!days[k]) days[k] = { total: 0, rows: [], sort: start.getTime() };
        days[k].total += dur;
        days[k].sort = Math.max(days[k].sort, start.getTime());
        days[k].rows.push({ label: r.label, start, end, dur, active });
    });

    const ordered = Object.keys(days).sort((a, b) => days[b].sort - days[a].sort);
    const badgeActive = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#15803d;white-space:nowrap;">● Active</span>`;
    const badgeEnded = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#fee2e2;color:#b91c1c;white-space:nowrap;">Ended</span>`;

    return ordered.map(k => {
        const d = days[k];
        d.rows.sort((a, b) => a.start - b.start);
        return `
        <div class="day-card">
            <div class="day-head"><div class="d-date">${escapeHtml(k)}</div><div class="d-total">Total: ${fmtDur(d.total)}</div></div>
            ${d.rows.map(r => `<div class="sess-row">
                <span><strong>${escapeHtml(r.label)}</strong> <span style="color:var(--text-muted);">— ${fmtTime(r.start)} <span style="color:var(--text-muted);">→</span> ${r.active ? '<span style="color:#15803d;font-weight:600;">still active</span>' : fmtTime(r.end)}</span></span>
                <span style="display:inline-flex;align-items:center;gap:12px;">
                    <span class="dur">${fmtDur(r.dur)}</span>
                    ${r.active ? badgeActive : badgeEnded}
                </span>
            </div>`).join('')}
        </div>`;
    }).join('');
}

function renderFullReport(sessions, quizAttempts, examAttempts, attendance, sectionTime) {
    const report = document.getElementById('report');
    const { grand, html: sessionsHtml } = buildSessionsReport(sessions);

    const quizScores = quizAttempts.filter(a => a.score != null).map(a => Number(a.score));
    const quizAvg = quizScores.length ? Math.round(quizScores.reduce((s, v) => s + v, 0) / quizScores.length) : null;

    const examScores = examAttempts.filter(a => a.score != null).map(a => Number(a.score));
    const examAvg = examScores.length ? Math.round(examScores.reduce((s, v) => s + v, 0) / examScores.length) : null;
    const examPassRate = examAttempts.length ? Math.round((examAttempts.filter(a => a.passed).length / examAttempts.length) * 100) : null;

    const markedAttendance = attendance.filter(a => a.present !== null);
    const attPct = markedAttendance.length ? Math.round((markedAttendance.filter(a => a.present).length / markedAttendance.length) * 100) : null;

    const rangeLabel = { today: 'today', week: 'this week', month: 'this month', all: 'all time', custom: 'selected range' }[_actActivePreset] || 'all time';

    const statCardStyle = 'background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 16px;flex:1;min-width:140px;';
    const statLabelStyle = 'font-size:12px;color:var(--text-muted);margin-bottom:4px;';
    const statValStyle = 'font-size:19px;font-weight:800;color:var(--navy-800);';

    report.innerHTML = `
        <p class="hint" style="margin:0 0 12px 2px;">Summary for <strong>${escapeHtml(rangeLabel)}</strong> — logins, quiz/exam activity, and attendance recorded for this student.</p>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:22px;">
            <div style="${statCardStyle}"><div style="${statLabelStyle}">Time in portal</div><div style="${statValStyle}">${fmtDur(grand)}</div></div>
            <div style="${statCardStyle}"><div style="${statLabelStyle}">Login sessions</div><div style="${statValStyle}">${sessions.length}</div></div>
            <div style="${statCardStyle}"><div style="${statLabelStyle}">Quiz attempts</div><div style="${statValStyle}">${quizAttempts.length}${quizAvg != null ? ` <span style="font-size:13px;font-weight:600;color:var(--text-muted);">(avg ${quizAvg}%)</span>` : ''}</div></div>
            <div style="${statCardStyle}"><div style="${statLabelStyle}">Exam attempts</div><div style="${statValStyle}">${examAttempts.length}${examPassRate != null ? ` <span style="font-size:13px;font-weight:600;color:var(--text-muted);">(${examPassRate}% passed)</span>` : ''}</div></div>
            <div style="${statCardStyle}"><div style="${statLabelStyle}">Attendance</div><div style="${statValStyle}">${attPct != null ? `${attPct}%` : '—'}${markedAttendance.length ? ` <span style="font-size:13px;font-weight:600;color:var(--text-muted);">(${markedAttendance.filter(a => a.present).length}/${markedAttendance.length})</span>` : ''}</div></div>
        </div>

        <h3 style="font-size:15px;margin:0 0 10px;">Login sessions</h3>
        ${sessionsHtml}

        <h3 style="font-size:15px;margin:22px 0 10px;">Quiz attempts</h3>
        ${buildQuizSection(quizAttempts)}

        <h3 style="font-size:15px;margin:22px 0 10px;">Exam attempts</h3>
        ${buildExamSection(examAttempts)}

        <h3 style="font-size:15px;margin:22px 0 10px;">Attendance</h3>
        ${buildAttendanceSection(attendance)}

        <h3 style="font-size:15px;margin:22px 0 10px;">Time per section</h3>
        ${buildSectionTimeReport(sectionTime)}
    `;
}
