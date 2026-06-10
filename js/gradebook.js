// Gradebook — exam/quiz scores per course (rows=students, cols=exams, + GPA).

let CURRENT_UID = null;
let gbCourses = [];
let currentCourseId = '';
let gbStudents = [];          // [{id, full_name}]
let gbExams = [];             // [{id, title, type, pass_threshold}]
let gbAttempts = {};          // `${studentId}_${examId}` -> {id, score, passed}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }
function examById(id) { return gbExams.find(e => e.id === id); }

async function loadCourses() {
    const { data, error } = await db.from('courses').select('id, name').order('created_at', { ascending: false });
    if (error) { return; }
    gbCourses = data || [];
    const sel = document.getElementById('course-select');
    gbCourses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        sel.appendChild(opt);
    });
}

async function onCourseChange() {
    currentCourseId = document.getElementById('course-select').value;
    const container = document.getElementById('gradebook-container');
    if (!currentCourseId) { container.innerHTML = `<div class="loader">Choose a course to see its score card.</div>`; return; }
    container.innerHTML = `<div class="loader">Loading score card…</div>`;

    // Enrolled students, exams assigned to this course, and any attempts.
    const [enrRes, ecRes] = await Promise.all([
        db.from('course_enrollments').select('student_id').eq('course_id', currentCourseId),
        db.from('exam_courses').select('exam_id').eq('course_id', currentCourseId)
    ]);

    const studentIds = (enrRes.data || []).map(r => r.student_id);
    const examIds = (ecRes.data || []).map(r => r.exam_id);

    const [stuRes, exRes] = await Promise.all([
        studentIds.length ? db.from('profiles').select('id, full_name').in('id', studentIds).order('full_name', { ascending: true }) : Promise.resolve({ data: [] }),
        examIds.length ? db.from('exams').select('id, title, type, pass_threshold').in('id', examIds).order('created_at', { ascending: true }) : Promise.resolve({ data: [] })
    ]);

    gbStudents = stuRes.data || [];
    gbExams = exRes.data || [];

    gbAttempts = {};
    if (examIds.length && studentIds.length) {
        const atRes = await db.from('exam_attempts').select('id, exam_id, student_id, score, passed').in('exam_id', examIds);
        (atRes.data || []).forEach(a => { gbAttempts[`${a.student_id}_${a.exam_id}`] = a; });
    }

    renderGradebook();
}

function renderGradebook() {
    const container = document.getElementById('gradebook-container');
    if (gbStudents.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No students enrolled</h3><p>Enrol students in this course (Courses → open the course) to see them here.</p></div>`;
        return;
    }
    if (gbExams.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No exams assigned</h3><p>Assign exams to this course in the Exams section to build the score card.</p></div>`;
        return;
    }

    const head = `<tr><th>Student</th>${gbExams.map(e =>
        `<th>${escapeHtml(e.title)}<br><span style="font-weight:400;color:var(--text-muted);">${e.type === 'pdf' ? 'PDF' : 'MCQ'} · pass ${e.pass_threshold}%</span></th>`
    ).join('')}<th>GPA</th></tr>`;

    const rows = gbStudents.map(s => {
        let sum = 0, n = 0;
        const cells = gbExams.map(e => {
            const a = gbAttempts[`${s.id}_${e.id}`];
            if (a && a.score != null) {
                sum += a.score; n++;
                const cls = a.score >= e.pass_threshold ? 'pass' : 'fail';
                const inner = `<span class="gb-cell ${cls}">${a.score}%</span>`;
                // PDF scores are editable by the teacher; MCQ are auto from the student.
                return `<td>${e.type === 'pdf'
                    ? `<button class="btn btn-ghost btn-sm gb-enter" onclick="openScoreEntry('${s.id}','${e.id}')">${inner}</button>`
                    : inner}</td>`;
            }
            // No score yet.
            return `<td>${e.type === 'pdf'
                ? `<button class="btn btn-ghost btn-sm gb-enter" onclick="openScoreEntry('${s.id}','${e.id}')">Enter</button>`
                : '<span class="gb-cell pending">—</span>'}</td>`;
        }).join('');
        const gpa = n ? `<span class="gb-gpa">${Math.round(sum / n)}%</span>` : '<span class="gb-cell pending">—</span>';
        return `<tr><td><strong>${escapeHtml(s.full_name || '—')}</strong></td>${cells}<td>${gpa}</td></tr>`;
    }).join('');

    container.innerHTML = `
        <p class="hint" style="margin-bottom:12px;">Click an <strong>Enter</strong> / score cell on a PDF exam to set a student's mark. Multiple-choice scores fill in automatically when students submit. GPA is the average across scored exams.</p>
        <div class="panel" style="overflow-x:auto;">
            <table class="data-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
        </div>`;
}

// ── MANUAL SCORE ENTRY (PDF exams) ──
function openScoreEntry(studentId, examId) {
    const s = gbStudents.find(x => x.id === studentId);
    const e = examById(examId);
    if (!s || !e) return;
    document.getElementById('score-alert').style.display = 'none';
    document.getElementById('score-student').value = studentId;
    document.getElementById('score-exam').value = examId;
    document.getElementById('score-context').textContent = `${s.full_name} — ${e.title}`;
    document.getElementById('score-pass-hint').textContent = `Pass mark is ${e.pass_threshold}%.`;
    const a = gbAttempts[`${studentId}_${examId}`];
    document.getElementById('score-value').value = (a && a.score != null) ? a.score : '';
    openModal('score-modal');
}

async function saveScore(ev) {
    ev.preventDefault();
    const btn = document.getElementById('score-save-btn');
    const alert = document.getElementById('score-alert');
    alert.style.display = 'none';

    const studentId = document.getElementById('score-student').value;
    const examId = document.getElementById('score-exam').value;
    const e = examById(examId);
    const score = parseInt(document.getElementById('score-value').value, 10);
    if (isNaN(score) || score < 0 || score > 100) { showModalAlert(alert, 'Enter a score between 0 and 100.', 'error'); return; }

    const passed = score >= e.pass_threshold;
    const existing = gbAttempts[`${studentId}_${examId}`];

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (existing && existing.id) {
            res = await db.from('exam_attempts').update({
                score, passed, graded_by: CURRENT_UID, completed_at: new Date().toISOString()
            }).eq('id', existing.id);
        } else {
            res = await db.from('exam_attempts').insert({
                exam_id: examId, student_id: studentId, score, passed,
                graded_by: CURRENT_UID, completed_at: new Date().toISOString()
            }).select('id').single();
        }
        if (res.error) throw new Error(res.error.message);
        // Update local state.
        gbAttempts[`${studentId}_${examId}`] = {
            id: existing && existing.id ? existing.id : res.data.id, exam_id: examId, student_id: studentId, score, passed
        };
        closeModal('score-modal');
        renderGradebook();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Score';
    }
}
