// Gradebook — exam/quiz scores per course (rows=students, cols=exams, + GPA).

let CURRENT_UID = null;
let gbCourses = [];
let currentCourseId = '';
let gbStudents = [];          // [{id, full_name}]
let gbExams = [];             // [{id, title, type, pass_threshold}]
let gbAttempts = {};          // `${studentId}_${examId}` -> {id, score, passed}
let gbDiplomas = {};          // studentId -> {issued_at} for the current course

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

// ── PAGINATION STATE ──
let gbStudentIds = [];   // all enrolled student ids for the course
let gbExamIds = [];      // exam ids assigned to the course
let gbPage = 1, gbPageSize = 50, gbTotal = 0, gbSearch = '', gbSearchTimer = null;

async function onCourseChange() {
    currentCourseId = document.getElementById('course-select').value;
    const container = document.getElementById('gradebook-container');
    document.getElementById('pager').style.display = 'none';
    if (!currentCourseId) { container.innerHTML = `<div class="loader">Choose a course to see its score card.</div>`; return; }
    container.innerHTML = `<div class="loader">Loading score card…</div>`;
    gbPage = 1; gbSearch = '';
    const sb = document.getElementById('gb-search'); if (sb) sb.value = '';

    // Enrolled students (ids), exams assigned to this course (cols).
    const [enrRes, ecRes] = await Promise.all([
        db.from('course_enrollments').select('student_id').eq('course_id', currentCourseId),
        db.from('exam_courses').select('exam_id').eq('course_id', currentCourseId)
    ]);
    gbStudentIds = [...new Set((enrRes.data || []).map(r => r.student_id))];
    gbExamIds = [...new Set((ecRes.data || []).map(r => r.exam_id))];

    const exRes = gbExamIds.length
        ? await db.from('exams').select('id, title, type, pass_threshold').in('id', gbExamIds).order('created_at', { ascending: true })
        : { data: [] };
    gbExams = exRes.data || [];

    loadGbPage();
}

function onGbSearch() {
    clearTimeout(gbSearchTimer);
    gbSearchTimer = setTimeout(() => {
        gbSearch = (document.getElementById('gb-search').value || '').trim();
        gbPage = 1; loadGbPage();
    }, 300);
}
function onGbPageSize() {
    gbPageSize = parseInt(document.getElementById('page-size').value, 10) || 50;
    gbPage = 1; loadGbPage();
}
function changeGbPage(delta) {
    const totalPages = Math.max(1, Math.ceil(gbTotal / gbPageSize));
    const n = gbPage + delta;
    if (n < 1 || n > totalPages) return;
    gbPage = n; loadGbPage(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Load one page of student rows + their attempts for this course's exams.
async function loadGbPage() {
    const container = document.getElementById('gradebook-container');
    if (gbStudentIds.length === 0 || gbExams.length === 0) {
        gbStudents = []; gbTotal = 0;
        renderGradebook();
        document.getElementById('pager').style.display = 'none';
        return;
    }
    container.innerHTML = `<div class="loader">Loading score card…</div>`;

    const from = (gbPage - 1) * gbPageSize, to = from + gbPageSize - 1;
    let q = db.from('profiles').select('id, full_name', { count: 'exact' }).in('id', gbStudentIds);
    const term = gbSearch.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.ilike('full_name', `%${term}%`);
    q = q.order('full_name', { ascending: true }).range(from, to);

    const { data, count, error } = await q;
    if (error) { container.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load the score card</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    gbStudents = data || [];
    gbTotal = count || 0;

    gbAttempts = {};
    gbDiplomas = {};
    const pageIds = gbStudents.map(s => s.id);
    if (pageIds.length) {
        const atRes = await db.from('exam_attempts').select('id, exam_id, student_id, score, passed')
            .in('exam_id', gbExamIds).in('student_id', pageIds);
        (atRes.data || []).forEach(a => { gbAttempts[`${a.student_id}_${a.exam_id}`] = a; });

        // Which of these students already have a diploma issued for this course.
        const dipRes = await db.from('diplomas').select('student_id, issued_at')
            .eq('course_id', currentCourseId).in('student_id', pageIds);
        (dipRes.data || []).forEach(d => { gbDiplomas[d.student_id] = d; });
    }

    renderGradebook();
    renderGbPager();
}

function renderGbPager() {
    const pager = document.getElementById('pager');
    if (gbStudents.length === 0 && !gbSearch) { pager.style.display = 'none'; return; }
    pager.style.display = 'flex';
    const totalPages = Math.max(1, Math.ceil(gbTotal / gbPageSize));
    if (gbPage > totalPages) gbPage = totalPages;
    const info = document.getElementById('pager-info');
    if (gbTotal === 0) info.textContent = 'No students match.';
    else {
        const start = (gbPage - 1) * gbPageSize + 1, end = Math.min(gbPage * gbPageSize, gbTotal);
        info.textContent = `Showing ${start}–${end} of ${gbTotal} student${gbTotal === 1 ? '' : 's'}`;
    }
    document.getElementById('page-label').textContent = `Page ${gbPage} of ${totalPages}`;
    const prev = document.getElementById('prev-btn'), next = document.getElementById('next-btn');
    prev.disabled = gbPage <= 1; next.disabled = gbPage >= totalPages;
    prev.style.opacity = prev.disabled ? '.4' : '1'; next.style.opacity = next.disabled ? '.4' : '1';
}

function renderGradebook() {
    const container = document.getElementById('gradebook-container');
    if (gbStudentIds.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No students enrolled</h3><p>Enrol students in this course (Courses → open the course) to see them here.</p></div>`;
        return;
    }
    if (gbExams.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No exams assigned</h3><p>Assign exams to this course in the Exams section to build the score card.</p></div>`;
        return;
    }
    if (gbStudents.length === 0) {
        container.innerHTML = `<div class="empty-state"><h3>No students match</h3><p>No enrolled student matches "${escapeHtml(gbSearch)}".</p></div>`;
        return;
    }

    const head = `<tr><th>Student</th>${gbExams.map(e =>
        `<th>${escapeHtml(e.title)}<br><span style="font-weight:400;color:var(--text-muted);">${e.type === 'pdf' ? 'PDF' : 'MCQ'} · pass ${e.pass_threshold}%</span></th>`
    ).join('')}<th>GPA</th><th>Diploma</th></tr>`;

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
        const issued = gbDiplomas[s.id];
        const dipBtn = issued
            ? `<button class="btn btn-ghost btn-sm" style="color:var(--green);border-color:var(--green);" onclick="openDiploma('${s.id}')" title="Issued ${escapeHtml((issued.issued_at || '').slice(0,10))}">🎓 Issued · re-send</button>`
            : `<button class="btn btn-primary btn-sm" onclick="openDiploma('${s.id}')">Issue diploma</button>`;
        return `<tr><td><strong>${escapeHtml(s.full_name || '—')}</strong></td>${cells}<td>${gpa}</td><td>${dipBtn}</td></tr>`;
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

// ── DIPLOMA + RECOMMENDATION LETTER ──
let dipStudentName = '';

async function openDiploma(studentId) {
    const s = gbStudents.find(x => x.id === studentId);
    if (!s) return;
    dipStudentName = s.full_name || 'Student';
    const courseName = document.getElementById('course-select').selectedOptions[0]?.textContent || '';

    document.getElementById('diploma-alert').style.display = 'none';
    document.getElementById('dip-student').value = studentId;
    document.getElementById('dip-context').textContent = `${dipStudentName} — ${courseName}`;
    document.getElementById('dip-grade').value = '';
    document.getElementById('dip-remark').value = '';
    document.getElementById('dip-letter').value = '';
    document.getElementById('dip-status').innerHTML = `<div class="loader">Checking the student's standing…</div>`;
    const issued = gbDiplomas[studentId];
    document.getElementById('dip-title').textContent = issued
        ? 'Re-issue Diploma & Recommendation Letter' : 'Issue Diploma & Recommendation Letter';
    document.getElementById('dip-send-btn').textContent = issued ? 'Re-issue & Send' : 'Approve & Send';
    openModal('diploma-modal');

    try {
        const st = await apiRequest('POST', '/graduation/status', { student_id: studentId, course_id: currentCourseId });
        renderDipStatus(st);
        if (st.issued) {
            if (st.final_grade) document.getElementById('dip-grade').value = st.final_grade;
            if (st.remark) document.getElementById('dip-remark').value = st.remark;
        }
    } catch (err) {
        document.getElementById('dip-status').innerHTML =
            `<div class="alert error" style="display:block;">Couldn't load standing: ${escapeHtml(err.message)}</div>`;
    }
}

function renderDipStatus(st) {
    const ok = st.all_passed;
    const color = ok ? 'var(--green)' : '#b45309';
    const bg = ok ? '#ecfdf5' : '#fffbeb';
    const border = ok ? '#a7f3d0' : '#fde68a';
    const gpaTxt = st.gpa != null ? `${st.gpa}%` : '—';
    let warn = '';
    if (st.mandatory_total === 0) {
        warn = `<div style="margin-top:6px;">No exams are marked “counts toward graduation” for this course yet — eligibility can't be confirmed automatically.</div>`;
    } else if (!ok) {
        warn = `<div style="margin-top:6px;">⚠️ This student has <strong>not</strong> completed and passed all mandatory exams. You can still issue the diploma — the decision is yours — but please confirm this is intended.</div>`;
    } else {
        warn = `<div style="margin-top:6px;">✓ All mandatory exams completed and passed. This student is eligible.</div>`;
    }
    document.getElementById('dip-status').innerHTML = `
        <div style="background:${bg};border:1px solid ${border};color:${color};border-radius:10px;padding:12px 14px;margin-bottom:16px;font-size:13.5px;line-height:1.5;">
            <strong>Mandatory exams:</strong> ${st.completed} / ${st.mandatory_total} completed &nbsp;·&nbsp;
            <strong>Final GPA:</strong> ${gpaTxt}
            ${warn}
        </div>`;
}

async function draftLetter() {
    const btn = document.getElementById('dip-draft-btn');
    const alert = document.getElementById('diploma-alert');
    alert.style.display = 'none';
    btn.disabled = true; btn.textContent = 'Drafting…';
    try {
        const res = await apiRequest('POST', '/graduation/draft-letter', {
            student_id: document.getElementById('dip-student').value,
            course_id: currentCourseId,
            final_grade: document.getElementById('dip-grade').value.trim() || null,
            remark: document.getElementById('dip-remark').value.trim() || null
        });
        document.getElementById('dip-letter').value = res.text || '';
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = '✨ Draft with AI';
    }
}

async function issueDiploma(ev) {
    ev.preventDefault();
    const alert = document.getElementById('diploma-alert');
    alert.style.display = 'none';
    const studentId = document.getElementById('dip-student').value;
    const letter = document.getElementById('dip-letter').value.trim();
    if (!letter) { showModalAlert(alert, 'Please write or draft the recommendation letter before sending.', 'error'); return; }

    const reissue = !!gbDiplomas[studentId];
    const okToSend = await confirmDialog({
        title: reissue ? 'Re-issue and send?' : 'Issue diploma and send?',
        message: reissue
            ? `This will regenerate ${dipStudentName}'s diploma and recommendation letter and email them again to their registered address. Continue?`
            : `This will generate ${dipStudentName}'s diploma and recommendation letter and email both to their registered address. Continue?`,
        confirmText: reissue ? 'Re-issue & Send' : 'Approve & Send'
    });
    if (!okToSend) return;

    const btn = document.getElementById('dip-send-btn');
    btn.disabled = true; btn.textContent = 'Generating & sending…';
    try {
        const res = await apiRequest('POST', '/graduation/issue', {
            student_id: studentId,
            course_id: currentCourseId,
            final_grade: document.getElementById('dip-grade').value.trim() || null,
            remark: document.getElementById('dip-remark').value.trim() || null,
            recommendation_text: letter
        });
        gbDiplomas[studentId] = { issued_at: new Date().toISOString() };
        closeModal('diploma-modal');
        renderGradebook();
        const note = res.emailed
            ? `Diploma & letter issued and emailed to ${dipStudentName}.`
            : `Diploma & letter issued for ${dipStudentName}, but the email could not be sent (check their address). They can still download it from their portal.`;
        await confirmDialog({ title: 'Done 🎓', message: note, confirmText: 'OK', cancelText: 'Close' });
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = reissue ? 'Re-issue & Send' : 'Approve & Send';
    }
}
