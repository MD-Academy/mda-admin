// Course detail — manage which subjects are in the course and who is enrolled.

let COURSE_ID = null;
let course = null;
let allSubjects = [];        // rooms
let courseSubjectIds = new Set();
let allStudents = [];        // profiles role=student
let enrolledIds = new Set();
let allExams = [];           // [{id, title, type}]
let courseExamIds = new Set();
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
                <div class="search-box" style="margin:6px 0 14px; min-width:0;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input type="text" id="student-search" placeholder="Search by name or email…" oninput="renderStudents()">
                </div>
                <div id="students-list"><div class="loader">Loading…</div></div>
            </div>` : '';

    document.getElementById('page-content').innerHTML = `
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

    // Enrolment is superadmin-only.
    if (IS_SUPER) {
        const [students, enrRes] = await Promise.all([
            fetchStudents(),
            db.from('course_enrollments').select('student_id').eq('course_id', COURSE_ID)
        ]);
        allStudents = students;
        enrolledIds = new Set((enrRes.data || []).map(r => r.student_id));
        renderStudents();
    }
}

// Fetch students with email; fall back to name-only if the profiles.email migration isn't applied yet.
async function fetchStudents() {
    let res = await db.from('profiles').select('id, full_name, status, email').eq('role', 'student').order('full_name', { ascending: true });
    if (res.error && /email/i.test(res.error.message || '')) {
        res = await db.from('profiles').select('id, full_name, status').eq('role', 'student').order('full_name', { ascending: true });
    }
    return res.data || [];
}

// ── EXAMS IN THIS COURSE ──
function renderCourseExams() {
    const el = document.getElementById('course-exams-list');
    if (!el) return;
    if (allExams.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:24px;"><p>No exams exist yet. Create some in the Exams section first.</p></div>`;
        return;
    }
    const q = (document.getElementById('exam-search')?.value || '').toLowerCase();
    let list = allExams.filter(e => (e.title || '').toLowerCase().includes(q));
    // Assigned first.
    list.sort((a, b) => (courseExamIds.has(b.id) ? 1 : 0) - (courseExamIds.has(a.id) ? 1 : 0));
    if (list.length === 0) { el.innerHTML = `<div class="loader">No exams match your search.</div>`; return; }
    el.innerHTML = `<div class="list-rows">${list.map(e => {
        const assigned = courseExamIds.has(e.id);
        return `
            <div class="list-row">
                <div class="lr-body"><div class="lr-title">${escapeHtml(e.title)}</div><div class="lr-sub">${e.type === 'pdf' ? 'PDF paper' : 'Multiple-choice'}</div></div>
                <div class="lr-actions">
                    <button class="btn btn-sm ${assigned ? 'btn-danger' : 'btn-primary'}" onclick="toggleExam('${e.id}')">${assigned ? 'Remove' : 'Add'}</button>
                </div>
            </div>`;
    }).join('')}</div>`;
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
                    ${inCourse ? `<button class="btn btn-ghost btn-sm" onclick="openSubject('${s.id}')">Open</button>` : ''}
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

// ── STUDENTS / ENROLLMENT ──
function renderStudents() {
    const el = document.getElementById('students-list');
    document.getElementById('enrolled-count').textContent = enrolledIds.size;

    const q = (document.getElementById('student-search')?.value || '').toLowerCase();
    const list = allStudents.filter(s =>
        (s.full_name || '').toLowerCase().includes(q) ||
        (s.email || '').toLowerCase().includes(q)
    );

    if (allStudents.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:24px;"><p>No students exist yet. Create accounts in the Students section first.</p></div>`;
        return;
    }
    if (list.length === 0) {
        el.innerHTML = `<div class="loader">No students match your search.</div>`;
        return;
    }

    // Enrolled first, then the rest.
    list.sort((a, b) => (enrolledIds.has(b.id) ? 1 : 0) - (enrolledIds.has(a.id) ? 1 : 0));

    el.innerHTML = `<div class="list-rows">${list.map(s => {
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
                    <button class="btn btn-sm ${enrolled ? 'btn-danger' : 'btn-primary'}" onclick="toggleEnroll('${s.id}')">
                        ${enrolled ? 'Remove' : 'Enrol'}
                    </button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

async function toggleEnroll(studentId) {
    if (enrolledIds.has(studentId)) {
        const { error } = await db.from('course_enrollments').delete().eq('course_id', COURSE_ID).eq('student_id', studentId);
        if (error) { alert(`Failed: ${error.message}`); return; }
        enrolledIds.delete(studentId);
    } else {
        const { error } = await db.from('course_enrollments').insert({ course_id: COURSE_ID, student_id: studentId });
        if (error) { alert(`Failed: ${error.message}`); return; }
        enrolledIds.add(studentId);
    }
    renderStudents();
}
