// Course detail — manage which subjects are in the course and who is enrolled.

let COURSE_ID = null;
let course = null;
let allSubjects = [];        // rooms
let courseSubjectIds = new Set();
let enrolledStudents = [];   // full objects of students enrolled in THIS course
let enrolledIds = new Set();
let stuMap = {};             // id -> student object (enrolled + search results)
let stuSearchTimer = null;
let allExams = [];           // [{id, title, type}]
let courseExamIds = new Set();
let allTeachers = [];        // staff profiles [{id, full_name}]
let courseTeacherIds = new Set();
let courseRecordings = [];   // assigned recordings [{id, title, recorded_date}]
let recPickMap = {};         // id -> recording object (from search results + assigned)
let recPickTimer = null;
let IS_SUPER = false;        // superadmin manages; admins (teachers) view only

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function initCourse(courseId, profile) {
    COURSE_ID = courseId;
    const { data, error } = await db.from('courses').select('id, name, description').eq('id', courseId).single();
    if (error || !data) {
        renderLayout('courses', 'Course', '', profile);
        document.getElementById('page-content').innerHTML =
            `<div class="empty-state"><h3>Course not found</h3><p>It may have been deleted. <a href="courses.html">Back to all courses</a>.</p></div>`;
        return;
    }
    course = data;
    IS_SUPER = profile.role === 'superadmin';
    renderLayout('courses', escapeHtml(data.name), IS_SUPER ? 'Manage subjects & enrolled students' : 'Subjects in this course', profile);

    const studentsPanel = IS_SUPER ? `
            <div class="panel" style="padding:22px;">
                <div class="section-title">Enrolled students <span class="count-pill" id="enrolled-count">0</span></div>
                <p class="hint" style="margin:-8px 0 12px;">Showing only students enrolled in this course. Search by name or email to find and enrol anyone else.</p>
                <div class="search-box" style="margin:0 0 14px; min-width:0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" id="student-search" placeholder="Search to find or add a student…" oninput="onStudentSearch()">
                </div>
                <div id="students-list"><div class="loader">Loading…</div></div>
            </div>` : '';

    document.getElementById('page-content').innerHTML = `
        <style>
            .pill-label { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 7px; }
            .pill-zone { display: flex; flex-wrap: wrap; gap: 8px; align-content: flex-start; min-height: 46px; max-height: 190px; overflow-y: auto; padding: 11px; border: 1.5px dashed var(--border); border-radius: 12px; }
            .pill-zone-assigned { background: #fbfcfe; border-style: solid; }
            .pill { display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; user-select: none; transition: transform .06s, background .12s; }
            .pill:active { transform: scale(.96); }
            .pill-assigned { background: #fdecf3; color: #b91c5c; border: 1.5px solid #f3c6d9; }
            .pill-assigned:hover { background: #fbdbe8; }
            .pill-available { background: #f1f5f9; color: var(--text); border: 1.5px solid var(--border); }
            .pill-available:hover { background: #eaf1fb; border-color: #9cc0f0; }
            .pill .x { font-weight: 800; opacity: .55; }
            .pill .plus { font-weight: 800; opacity: .5; font-size: 15px; line-height: 1; }
            .pill-empty { font-size: 13px; color: var(--text-muted); padding: 5px 2px; }
        </style>
        <a class="back-link" href="courses.html">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            All Courses
        </a>
        <div class="card-grid" style="grid-template-columns: ${IS_SUPER ? '1fr 1fr' : '1fr'}; align-items:start;">
            <div style="display:flex; flex-direction:column; gap:18px;">
                <div class="panel" style="padding:22px;">
                    <div class="section-title">Subjects in this course</div>
                    <p class="hint" style="margin:-8px 0 14px;">${IS_SUPER ? 'Toggle which subjects belong to this course. Subjects come from your existing list.' : 'Subjects included in this course.'}</p>
                    <div id="subjects-list"><div class="loader">Loading…</div></div>
                </div>
                <div class="panel" style="padding:22px;">
                    <div class="section-title">Exams in this course</div>
                    <p class="hint" style="margin:-8px 0 12px;">Assign general exams to this course — enrolled students will see them.</p>
                    <div class="search-box" style="margin:0 0 12px; min-width:0;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="exam-search" placeholder="Search exams by title…" oninput="renderCourseExams()">
                    </div>
                    <div id="course-exams-list"><div class="loader">Loading…</div></div>
                </div>
                <div class="panel" style="padding:22px;">
                    <div class="section-title">Teachers on this course</div>
                    <p class="hint" style="margin:-8px 0 12px;">Assign the staff who teach this course — students will rate &amp; give feedback on each of them.</p>
                    <div id="course-teachers-list"><div class="loader">Loading…</div></div>
                </div>
                <div class="panel" style="padding:22px;">
                    <div class="section-title">Zoom recordings in this course</div>
                    <p class="hint" style="margin:-8px 0 12px;">Assign recordings to this course — enrolled students will see them.</p>
                    <div class="pill-label">In this course</div>
                    <div class="pill-zone pill-zone-assigned" id="course-recs-assigned"><div class="loader">Loading…</div></div>
                    <div class="pill-label" style="margin-top:14px;">Add a recording</div>
                    <div class="search-box" style="margin:0 0 10px; min-width:0;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input type="text" id="rec-pick-search" placeholder="Search recordings by title…" oninput="onRecPickSearch()">
                    </div>
                    <div class="pill-zone" id="course-recs-results"><span class="pill-empty">Type a title to find recordings to add.</span></div>
                </div>
                <div class="panel" style="padding:22px;">
                    <div class="section-title">Attendance</div>
                    <p class="hint" style="margin:-8px 0 14px;">Open a class to mark who attended — everyone starts present, then flip absentees. The date locks to today. Students see only their own attendance and percentage.</p>
                    <a class="btn btn-primary" href="attendance.html?course=${encodeURIComponent(COURSE_ID)}">Open Attendance Sheet →</a>
                </div>
            </div>
            ${studentsPanel}
        </div>
    `;

    await loadData();
}

async function loadData() {
    const [subRes, csRes, exRes, ecRes] = await Promise.all([
        db.from('rooms').select('id, name').order('order_index', { ascending: true }),
        db.from('course_subjects').select('room_id').eq('course_id', COURSE_ID),
        db.from('exams').select('id, title, type').order('created_at', { ascending: false }),
        db.from('exam_courses').select('exam_id').eq('course_id', COURSE_ID)
    ]);
    allSubjects = subRes.data || [];
    courseSubjectIds = new Set((csRes.data || []).map(r => r.room_id));
    renderSubjects();

    allExams = exRes.data || [];
    courseExamIds = new Set((ecRes.data || []).map(r => r.exam_id));
    renderCourseExams();

    // Teachers (staff) assigned to this course.
    const [staffRes, ctRes] = await Promise.all([
        db.from('profiles').select('id, full_name').in('role', ['admin', 'superadmin']).order('full_name', { ascending: true }),
        db.from('course_teachers').select('teacher_id').eq('course_id', COURSE_ID)
    ]);
    allTeachers = staffRes.data || [];
    courseTeacherIds = new Set((ctRes.data || []).map(r => r.teacher_id));
    renderCourseTeachers();

    // Recordings assigned to this course (search-to-add for the rest, since recordings grow large).
    const recLinks = await db.from('recording_courses').select('recording_id').eq('course_id', COURSE_ID);
    const recIds = [...new Set((recLinks.data || []).map(r => r.recording_id))];
    courseRecordings = [];
    if (recIds.length) {
        const rr = await db.from('recordings').select('id, title, recorded_date').in('id', recIds);
        courseRecordings = rr.data || [];
    }
    courseRecordings.forEach(r => { recPickMap[r.id] = r; });
    renderCourseRecAssigned();
    runRecPickSearch();   // show the most recent recordings to add, by default

    // Enrolment is superadmin-only. Load ONLY the enrolled students (the roster);
    // adding others is search-driven so the panel scales to thousands across schools.
    if (IS_SUPER) {
        const enrRes = await db.from('course_enrollments').select('student_id').eq('course_id', COURSE_ID);
        const ids = [...new Set((enrRes.data || []).map(r => r.student_id))];
        enrolledIds = new Set(ids);
        enrolledStudents = [];
        if (ids.length) {
            let res = await db.from('profiles').select('id, full_name, status, email').in('id', ids).order('full_name', { ascending: true });
            if (res.error && /email/i.test(res.error.message || '')) {
                res = await db.from('profiles').select('id, full_name, status').in('id', ids).order('full_name', { ascending: true });
            }
            enrolledStudents = res.data || [];
        }
        enrolledStudents.forEach(s => { stuMap[s.id] = s; });
        renderStudents();
    }
}

// ── EXAMS IN THIS COURSE (two-zone pill picker, click to move) ──
function renderCourseExams() {
    const el = document.getElementById('course-exams-list');
    if (!el) return;
    if (allExams.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:18px;"><p>No exams exist yet. Create some in the Exams section first.</p></div>`;
        return;
    }
    const q = (document.getElementById('exam-search')?.value || '').toLowerCase();
    const assigned = allExams.filter(e => courseExamIds.has(e.id));
    const available = allExams.filter(e => !courseExamIds.has(e.id) && (e.title || '').toLowerCase().includes(q));

    const assignedHtml = assigned.length
        ? assigned.map(e => `<span class="pill pill-assigned" onclick="toggleExam('${e.id}')" title="Click to remove from this course">${escapeHtml(e.title)} <span class="x">✕</span></span>`).join('')
        : `<span class="pill-empty">No exams assigned yet — click one below to add it.</span>`;

    const availHtml = available.length
        ? available.map(e => `<span class="pill pill-available" onclick="toggleExam('${e.id}')" title="Click to add to this course">${escapeHtml(e.title)} <span class="plus">+</span></span>`).join('')
        : `<span class="pill-empty">${q ? 'No exams match your search.' : 'All exams are already assigned.'}</span>`;

    el.innerHTML = `
        <div class="pill-label">In this course</div>
        <div class="pill-zone pill-zone-assigned">${assignedHtml}</div>
        <div class="pill-label" style="margin-top:14px;">Available — click to add</div>
        <div class="pill-zone">${availHtml}</div>`;
}

async function toggleExam(examId) {
    if (courseExamIds.has(examId)) {
        const { error } = await db.from('exam_courses').delete().eq('course_id', COURSE_ID).eq('exam_id', examId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseExamIds.delete(examId);
    } else {
        const { error } = await db.from('exam_courses').insert({ course_id: COURSE_ID, exam_id: examId });
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseExamIds.add(examId);
    }
    renderCourseExams();
}

// ── TEACHERS ON THIS COURSE (two-zone pill picker) ──
function renderCourseTeachers() {
    const el = document.getElementById('course-teachers-list');
    if (!el) return;
    if (allTeachers.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:18px;"><p>No staff accounts exist yet. Create teachers in the Admins section first.</p></div>`;
        return;
    }
    const assigned = allTeachers.filter(t => courseTeacherIds.has(t.id));
    const available = allTeachers.filter(t => !courseTeacherIds.has(t.id));
    const nm = t => escapeHtml(t.full_name || '(no name)');
    const assignedHtml = assigned.length
        ? assigned.map(t => `<span class="pill pill-assigned" onclick="toggleTeacher('${t.id}')" title="Click to remove from this course">${nm(t)} <span class="x">✕</span></span>`).join('')
        : `<span class="pill-empty">No teachers assigned yet — click one below to add.</span>`;
    const availHtml = available.length
        ? available.map(t => `<span class="pill pill-available" onclick="toggleTeacher('${t.id}')" title="Click to add to this course">${nm(t)} <span class="plus">+</span></span>`).join('')
        : `<span class="pill-empty">All staff are already assigned.</span>`;
    el.innerHTML = `
        <div class="pill-label">On this course</div>
        <div class="pill-zone pill-zone-assigned">${assignedHtml}</div>
        <div class="pill-label" style="margin-top:14px;">Available — click to add</div>
        <div class="pill-zone">${availHtml}</div>`;
}

async function toggleTeacher(teacherId) {
    if (courseTeacherIds.has(teacherId)) {
        const { error } = await db.from('course_teachers').delete().eq('course_id', COURSE_ID).eq('teacher_id', teacherId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseTeacherIds.delete(teacherId);
    } else {
        const t = allTeachers.find(x => x.id === teacherId);
        const { error } = await db.from('course_teachers').insert({ course_id: COURSE_ID, teacher_id: teacherId, teacher_name: t ? (t.full_name || null) : null });
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseTeacherIds.add(teacherId);
    }
    renderCourseTeachers();
}

// ── RECORDINGS IN THIS COURSE (assigned pills + search-to-add) ──
function fmtRecDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : ''; }

function renderCourseRecAssigned() {
    const el = document.getElementById('course-recs-assigned');
    if (!el) return;
    if (courseRecordings.length === 0) {
        el.innerHTML = `<span class="pill-empty">No recordings assigned yet — search below to add.</span>`;
        return;
    }
    const sorted = [...courseRecordings].sort((a, b) => (b.recorded_date || '').localeCompare(a.recorded_date || ''));
    el.innerHTML = sorted.map(r => `
        <span class="pill pill-assigned" onclick="toggleCourseRecording('${r.id}')" title="Click to remove from this course">${escapeHtml(r.title)} <span style="opacity:.6;font-weight:500;">· ${fmtRecDate(r.recorded_date)}</span> <span class="x">✕</span></span>`).join('');
}

function onRecPickSearch() {
    clearTimeout(recPickTimer);
    recPickTimer = setTimeout(runRecPickSearch, 300);
}

async function runRecPickSearch() {
    const el = document.getElementById('course-recs-results');
    if (!el) return;
    const term = (document.getElementById('rec-pick-search').value || '').replace(/[%,()]/g, ' ').trim();
    el.innerHTML = `<span class="pill-empty">Searching…</span>`;
    // Newest first. With no search term we show the most recent few; searching finds older ones.
    let q = db.from('recordings').select('id, title, recorded_date').eq('kind', 'zoom');
    if (term) q = q.ilike('title', `%${term}%`);
    const { data, error } = await q.order('recorded_date', { ascending: false }).limit(term ? 30 : 12);
    if (error) { el.innerHTML = `<span class="pill-empty" style="color:var(--red)">${escapeHtml(error.message)}</span>`; return; }
    const assigned = new Set(courseRecordings.map(r => r.id));
    const avail = (data || []).filter(r => !assigned.has(r.id));
    avail.forEach(r => { recPickMap[r.id] = r; });
    if (avail.length === 0) { el.innerHTML = `<span class="pill-empty">${term ? 'No recordings match.' : 'No more recordings to add.'}</span>`; return; }
    const hint = term ? '' : `<div class="pill-empty" style="width:100%;margin:0 0 2px;">Most recent recordings — type a title to find older ones.</div>`;
    el.innerHTML = hint + avail.map(r => `
        <span class="pill pill-available" onclick="toggleCourseRecording('${r.id}')" title="Click to add to this course">${escapeHtml(r.title)} <span style="opacity:.55;font-weight:500;">· ${fmtRecDate(r.recorded_date)}</span> <span class="plus">+</span></span>`).join('');
}

async function toggleCourseRecording(recId) {
    const isAssigned = courseRecordings.some(r => r.id === recId);
    if (isAssigned) {
        const { error } = await db.from('recording_courses').delete().eq('course_id', COURSE_ID).eq('recording_id', recId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseRecordings = courseRecordings.filter(r => r.id !== recId);
    } else {
        const { error } = await db.from('recording_courses').insert({ course_id: COURSE_ID, recording_id: recId });
        if (error) { alert(`Failed: ${error.message}`); return; }
        if (recPickMap[recId]) courseRecordings.push(recPickMap[recId]);
    }
    renderCourseRecAssigned();
    runRecPickSearch();
}

// ── SUBJECTS ──
function renderSubjects() {
    const el = document.getElementById('subjects-list');

    if (allSubjects.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:24px;"><p>No subjects exist yet. Create some in the Subjects section first.</p></div>`;
        return;
    }
    el.innerHTML = `<div class="list-rows">${allSubjects.map(s => {
        const inCourse = courseSubjectIds.has(s.id);
        return `
            <div class="list-row">
                <div class="lr-body"><div class="lr-title">${escapeHtml(s.name)}</div></div>
                <div class="lr-actions">
                    ${inCourse ? `<button class="btn btn-ghost btn-sm" onclick="openSubject('${s.id}')">Manage</button>` : ''}
                    <button class="btn btn-sm ${inCourse ? 'btn-danger' : 'btn-primary'}" onclick="toggleSubject('${s.id}')">
                        ${inCourse ? 'Remove' : 'Add'}
                    </button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function openSubject(id) {
    window.location.href = `subject.html?id=${encodeURIComponent(id)}`;
}

async function toggleSubject(roomId) {
    if (courseSubjectIds.has(roomId)) {
        const { error } = await db.from('course_subjects').delete().eq('course_id', COURSE_ID).eq('room_id', roomId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseSubjectIds.delete(roomId);
    } else {
        const { error } = await db.from('course_subjects').insert({ course_id: COURSE_ID, room_id: roomId });
        if (error) { alert(`Failed: ${error.message}`); return; }
        courseSubjectIds.add(roomId);
    }
    renderSubjects();
}

// ── STUDENTS / ENROLLMENT (enrolled roster by default; search to add anyone) ──
function _studentRows(list) {
    return `<div class="list-rows">${list.map(s => {
        const enrolled = enrolledIds.has(s.id);
        const suspended = s.status === 'suspended';
        return `
            <div class="list-row">
                <div class="lr-body">
                    <div class="lr-title">${escapeHtml(s.full_name || '—')}</div>
                    ${s.email ? `<div class="lr-sub">${escapeHtml(s.email)}</div>` : ''}
                    ${suspended ? '<div class="lr-sub" style="color:var(--red)">Suspended</div>' : ''}
                </div>
                <div class="lr-actions">
                    <button class="btn btn-sm ${enrolled ? 'btn-danger' : 'btn-primary'}" onclick="toggleEnroll('${s.id}')">${enrolled ? 'Remove' : 'Enrol'}</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

// Default view = the enrolled roster (no global list).
function renderStudents() {
    const el = document.getElementById('students-list');
    if (!el) return;
    document.getElementById('enrolled-count').textContent = enrolledIds.size;
    if ((document.getElementById('student-search')?.value || '').trim()) return;  // a search is showing
    const sorted = [...enrolledStudents].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
    el.innerHTML = sorted.length
        ? _studentRows(sorted)
        : `<div class="empty-state" style="padding:24px;"><p>No students enrolled yet. Search above to find and enrol students, or enrol a whole intake from <strong>Students → Bulk Import</strong>.</p></div>`;
}

function onStudentSearch() {
    clearTimeout(stuSearchTimer);
    stuSearchTimer = setTimeout(runStudentSearch, 300);
}

async function runStudentSearch() {
    const el = document.getElementById('students-list');
    const term = (document.getElementById('student-search').value || '').replace(/[%,()]/g, ' ').trim();
    if (!term) { renderStudents(); return; }
    el.innerHTML = `<div class="loader">Searching…</div>`;
    let res = await db.from('profiles').select('id, full_name, status, email').eq('role', 'student')
        .or(`full_name.ilike.%${term}%,email.ilike.%${term}%`).order('full_name', { ascending: true }).limit(30);
    if (res.error && /email/i.test(res.error.message || '')) {
        res = await db.from('profiles').select('id, full_name, status').eq('role', 'student')
            .ilike('full_name', `%${term}%`).order('full_name', { ascending: true }).limit(30);
    }
    if (res.error) { el.innerHTML = `<div class="loader" style="color:var(--red)">${escapeHtml(res.error.message)}</div>`; return; }
    const results = res.data || [];
    results.forEach(s => { stuMap[s.id] = s; });
    el.innerHTML = results.length ? _studentRows(results) : `<div class="loader">No students match "${escapeHtml(term)}".</div>`;
}

async function toggleEnroll(studentId) {
    if (enrolledIds.has(studentId)) {
        const { error } = await db.from('course_enrollments').delete().eq('course_id', COURSE_ID).eq('student_id', studentId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        enrolledIds.delete(studentId);
        enrolledStudents = enrolledStudents.filter(s => s.id !== studentId);
    } else {
        const { error } = await db.from('course_enrollments').insert({ course_id: COURSE_ID, student_id: studentId });
        if (error) { alert(`Failed: ${error.message}`); return; }
        enrolledIds.add(studentId);
        if (stuMap[studentId] && !enrolledStudents.some(s => s.id === studentId)) enrolledStudents.push(stuMap[studentId]);
    }
    document.getElementById('enrolled-count').textContent = enrolledIds.size;
    // Refresh: if a search is active, re-render results (button labels flip); else show roster.
    if ((document.getElementById('student-search')?.value || '').trim()) runStudentSearch();
    else renderStudents();
}
