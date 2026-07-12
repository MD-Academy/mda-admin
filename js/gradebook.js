// Gradebook — exam/quiz scores per course (rows=students, cols=exams, + GPA).

let CURRENT_UID = null;
let gbCourses = [];
let currentCourseId = '';
let gbStudents = [];          // [{id, full_name}]
let gbExams = [];             // [{id, title, type, pass_threshold, weight_percent}]
let gbOrals = [];             // [{id, title, weight_percent, order_index}]
let gbAttempts = {};          // `${studentId}_${examId}` -> {id, score, passed}
let gbOralGrades = {};        // `${studentId}_${oralId}` -> {id, score, feedback}
let gbAdjust = {};            // studentId -> {id, adjustment, note}
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

    // Enrolled students (ids), exams assigned to this course (cols), oral presentations for the course.
    const [enrRes, ecRes, opRes] = await Promise.all([
        db.from('course_enrollments').select('student_id').eq('course_id', currentCourseId),
        db.from('exam_courses').select('exam_id').eq('course_id', currentCourseId),
        db.from('oral_presentations').select('id, title, weight_percent, order_index').eq('course_id', currentCourseId).order('order_index', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
    ]);
    gbStudentIds = [...new Set((enrRes.data || []).map(r => r.student_id))];
    gbExamIds = [...new Set((ecRes.data || []).map(r => r.exam_id))];
    gbOrals = opRes.data || [];

    const exRes = gbExamIds.length
        ? await db.from('exams').select('id, title, type, pass_threshold, weight_percent').in('id', gbExamIds).order('created_at', { ascending: true })
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
    if (gbStudentIds.length === 0 || (gbExams.length === 0 && gbOrals.length === 0)) {
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
    gbOralGrades = {};
    gbAdjust = {};
    gbDiplomas = {};
    const pageIds = gbStudents.map(s => s.id);
    if (pageIds.length) {
        if (gbExamIds.length) {
            const atRes = await db.from('exam_attempts').select('id, exam_id, student_id, score, passed')
                .in('exam_id', gbExamIds).in('student_id', pageIds);
            (atRes.data || []).forEach(a => { gbAttempts[`${a.student_id}_${a.exam_id}`] = a; });
        }
        const oralIds = gbOrals.map(o => o.id);
        if (oralIds.length) {
            const ogRes = await db.from('oral_grades').select('id, oral_presentation_id, student_id, score, feedback')
                .in('oral_presentation_id', oralIds).in('student_id', pageIds);
            (ogRes.data || []).forEach(g => { gbOralGrades[`${g.student_id}_${g.oral_presentation_id}`] = g; });
        }
        const adjRes = await db.from('course_grade_adjustments').select('id, student_id, adjustment, note')
            .eq('course_id', currentCourseId).in('student_id', pageIds);
        (adjRes.data || []).forEach(a => { gbAdjust[a.student_id] = a; });

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

const clampPct = n => Math.max(0, Math.min(100, n));

// Total weight configured for the course (exams + orals). Ideally 100.
function totalCourseWeight() {
    return gbExams.reduce((t, e) => t + Number(e.weight_percent || 0), 0)
         + gbOrals.reduce((t, o) => t + Number(o.weight_percent || 0), 0);
}

// Current standing: weighted average across GRADED items only, plus the ± adjustment.
function computeStanding(sid) {
    let earned = 0, wsum = 0, graded = 0;
    const total = gbExams.length + gbOrals.length;
    gbExams.forEach(e => {
        const a = gbAttempts[`${sid}_${e.id}`];
        if (a && a.score != null) { earned += Number(a.score) * Number(e.weight_percent || 0); wsum += Number(e.weight_percent || 0); graded++; }
    });
    gbOrals.forEach(o => {
        const g = gbOralGrades[`${sid}_${o.id}`];
        if (g && g.score != null) { earned += Number(g.score) * Number(o.weight_percent || 0); wsum += Number(o.weight_percent || 0); graded++; }
    });
    const net = wsum > 0 ? earned / wsum : null;
    const adj = gbAdjust[sid] ? Number(gbAdjust[sid].adjustment || 0) : 0;
    const overall = net != null ? clampPct(net + adj) : null;
    return { net, adj, overall, graded, total };
}

function renderGradebook() {
    const container = document.getElementById('gradebook-container');
    if (gbStudentIds.length === 0) {
        container.innerHTML = `${gradingToolbar()}<div class="empty-state"><h3>No students enrolled</h3><p>Enrol students in this course (Courses → open the course) to see them here.</p></div>`;
        return;
    }
    if (gbExams.length === 0 && gbOrals.length === 0) {
        container.innerHTML = `${gradingToolbar()}<div class="empty-state"><h3>No exams or oral presentations yet</h3><p>Assign exams to this course (Exams section), or add oral presentations via <strong>Manage grading</strong> above.</p></div>`;
        return;
    }
    if (gbStudents.length === 0) {
        container.innerHTML = `${gradingToolbar()}<div class="empty-state"><h3>No students match</h3><p>No enrolled student matches "${escapeHtml(gbSearch)}".</p></div>`;
        return;
    }

    const examHeads = gbExams.map(e =>
        `<th>${escapeHtml(e.title)}<br><span style="font-weight:400;color:var(--text-muted);">${e.type === 'pdf' ? 'PDF' : 'MCQ'} · ${Number(e.weight_percent)}%</span></th>`).join('');
    const oralHeads = gbOrals.map(o =>
        `<th>${escapeHtml(o.title)}<br><span style="font-weight:400;color:var(--text-muted);">Oral · ${Number(o.weight_percent)}%</span></th>`).join('');
    const head = `<tr><th>Student</th>${examHeads}${oralHeads}<th>Overall</th><th>Adj.</th><th>Diploma</th></tr>`;

    const rows = gbStudents.map(s => {
        const examCells = gbExams.map(e => {
            const a = gbAttempts[`${s.id}_${e.id}`];
            if (a && a.score != null) {
                const cls = a.score >= e.pass_threshold ? 'pass' : 'fail';
                const inner = `<span class="gb-cell ${cls}">${Math.round(a.score)}%</span>`;
                return `<td>${e.type === 'pdf'
                    ? `<button class="btn btn-ghost btn-sm gb-enter" onclick="openScoreEntry('${s.id}','${e.id}')">${inner}</button>`
                    : inner}</td>`;
            }
            return `<td>${e.type === 'pdf'
                ? `<button class="btn btn-ghost btn-sm gb-enter" onclick="openScoreEntry('${s.id}','${e.id}')">+ Score</button>`
                : '<span class="gb-cell pending">— auto —</span>'}</td>`;
        }).join('');

        const oralCells = gbOrals.map(o => {
            const g = gbOralGrades[`${s.id}_${o.id}`];
            const label = (g && g.score != null) ? `${Math.round(g.score)}%${g.feedback ? ' 💬' : ''}` : '+ Grade & feedback';
            return `<td><button class="btn btn-ghost btn-sm gb-enter" onclick="openOralEntry('${s.id}','${o.id}')">${label}</button></td>`;
        }).join('');

        const st = computeStanding(s.id);
        const gpa = st.net != null
            ? `<span class="gb-gpa">${Math.round(st.overall)}%</span><br><span style="font-size:10px;color:var(--text-muted);">${st.graded}/${st.total} graded</span>`
            : '<span class="gb-cell pending">—</span>';

        const av = gbAdjust[s.id] ? Number(gbAdjust[s.id].adjustment || 0) : 0;
        const adjLabel = av > 0 ? `+${av}` : (av < 0 ? `${av}` : '±0');
        const adjCell = `<button class="btn btn-ghost btn-sm" onclick="openAdjust('${s.id}')" title="Participation / attendance adjustment">${adjLabel}</button>`;

        const issued = gbDiplomas[s.id];
        const dipBtn = issued
            ? `<button class="btn btn-ghost btn-sm" style="color:var(--green);border-color:var(--green);" onclick="openDiploma('${s.id}')" title="Issued ${escapeHtml((issued.issued_at || '').slice(0,10))}">🎓 Issued · re-send</button>`
            : `<button class="btn btn-primary btn-sm" onclick="openDiploma('${s.id}')">Issue diploma</button>`;
        return `<tr><td><strong>${escapeHtml(s.full_name || '—')}</strong></td>${examCells}${oralCells}<td>${gpa}</td><td>${adjCell}</td><td>${dipBtn}</td></tr>`;
    }).join('');

    container.innerHTML = `
        ${gradingToolbar()}
        <p class="hint" style="margin-bottom:12px;">Click a score cell to set a mark. <strong>PDF exams</strong> &amp; <strong>oral presentations</strong> are graded here (orals also take feedback); multiple-choice exams fill in automatically. <strong>Overall</strong> = weighted average of graded items + adjustment (current standing).</p>
        <div class="panel" style="overflow-x:auto;">
            <table class="data-table"><thead>${head}</thead><tbody>${rows}</tbody></table>
        </div>`;
}

function gradingToolbar() {
    const tw = totalCourseWeight();
    const warn = Math.abs(tw - 100) > 0.01
        ? `<span style="color:#b45309;font-weight:600;">Weights total ${tw}% (aim for 100%)</span>`
        : `<span style="color:var(--green);font-weight:600;">Weights total 100% ✓</span>`;
    return `<div class="subtoolbar" style="margin-bottom:12px;">
        <div style="font-size:13px;">${warn}</div>
        <button class="btn btn-ghost btn-sm" onclick="openGradingSetup()">⚙ Manage grading (weights &amp; orals)</button>
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

// ── ORAL PRESENTATION GRADE + FEEDBACK ──
function openOralEntry(studentId, oralId) {
    const s = gbStudents.find(x => x.id === studentId);
    const o = gbOrals.find(x => x.id === oralId);
    if (!s || !o) return;
    document.getElementById('oral-alert').style.display = 'none';
    document.getElementById('oral-student').value = studentId;
    document.getElementById('oral-id').value = oralId;
    document.getElementById('oral-context').textContent = `${s.full_name} — ${o.title}`;
    const g = gbOralGrades[`${studentId}_${oralId}`];
    document.getElementById('oral-score').value = (g && g.score != null) ? g.score : '';
    document.getElementById('oral-feedback').value = (g && g.feedback) ? g.feedback : '';
    openModal('oral-modal');
}

async function saveOral(ev) {
    ev.preventDefault();
    const btn = document.getElementById('oral-save-btn');
    const alert = document.getElementById('oral-alert');
    alert.style.display = 'none';
    const studentId = document.getElementById('oral-student').value;
    const oralId = document.getElementById('oral-id').value;
    const raw = document.getElementById('oral-score').value;
    const feedback = document.getElementById('oral-feedback').value.trim();
    const score = raw === '' ? null : parseFloat(raw);
    if (score != null && (isNaN(score) || score < 0 || score > 100)) { showModalAlert(alert, 'Enter a score between 0 and 100, or leave it blank.', 'error'); return; }
    if (!ensureSafe(alert, [['Feedback', feedback]])) return;

    const existing = gbOralGrades[`${studentId}_${oralId}`];
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const payload = { score, feedback: feedback || null, graded_by: CURRENT_UID, graded_at: new Date().toISOString() };
        let newId;
        if (existing && existing.id) {
            const res = await db.from('oral_grades').update(payload).eq('id', existing.id);
            if (res.error) throw new Error(res.error.message);
            newId = existing.id;
        } else {
            const res = await db.from('oral_grades').insert({ oral_presentation_id: oralId, student_id: studentId, ...payload }).select('id').single();
            if (res.error) throw new Error(res.error.message);
            newId = res.data.id;
        }
        gbOralGrades[`${studentId}_${oralId}`] = { id: newId, oral_presentation_id: oralId, student_id: studentId, score, feedback: feedback || null };
        closeModal('oral-modal');
        renderGradebook();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}

// ── PARTICIPATION / ATTENDANCE ADJUSTMENT ──
function openAdjust(studentId) {
    const s = gbStudents.find(x => x.id === studentId);
    if (!s) return;
    document.getElementById('adjust-alert').style.display = 'none';
    document.getElementById('adjust-student').value = studentId;
    document.getElementById('adjust-context').textContent = s.full_name || 'Student';
    const a = gbAdjust[studentId];
    document.getElementById('adjust-value').value = a ? Number(a.adjustment) : '';
    document.getElementById('adjust-note').value = (a && a.note) ? a.note : '';
    openModal('adjust-modal');
}

async function saveAdjust(ev) {
    ev.preventDefault();
    const btn = document.getElementById('adjust-save-btn');
    const alert = document.getElementById('adjust-alert');
    alert.style.display = 'none';
    const studentId = document.getElementById('adjust-student').value;
    const raw = document.getElementById('adjust-value').value;
    const note = document.getElementById('adjust-note').value.trim();
    const adjustment = raw === '' ? 0 : parseFloat(raw);
    if (isNaN(adjustment) || adjustment < -100 || adjustment > 100) { showModalAlert(alert, 'Enter an adjustment between -100 and 100.', 'error'); return; }
    if (!ensureSafe(alert, [['Note', note]])) return;

    const existing = gbAdjust[studentId];
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const payload = { adjustment, note: note || null, updated_by: CURRENT_UID, updated_at: new Date().toISOString() };
        let newId;
        if (existing && existing.id) {
            const res = await db.from('course_grade_adjustments').update(payload).eq('id', existing.id);
            if (res.error) throw new Error(res.error.message);
            newId = existing.id;
        } else {
            const res = await db.from('course_grade_adjustments').insert({ course_id: currentCourseId, student_id: studentId, ...payload }).select('id').single();
            if (res.error) throw new Error(res.error.message);
            newId = res.data.id;
        }
        gbAdjust[studentId] = { id: newId, student_id: studentId, adjustment, note: note || null };
        closeModal('adjust-modal');
        renderGradebook();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}

// ── MANAGE GRADING (exam weights + oral presentations) ──
function openGradingSetup() {
    if (!currentCourseId) return;
    renderGradingSetup();
    openModal('grading-modal');
}

function renderGradingSetup() {
    const body = document.getElementById('grading-body');
    const examRows = gbExams.length ? gbExams.map(e => `
        <div class="list-row">
            <div class="lr-body"><div class="lr-title">${escapeHtml(e.title)}</div><div class="lr-sub">${e.type === 'pdf' ? 'PDF' : 'MCQ'} exam</div></div>
            <div class="lr-actions"><label style="font-size:12px;color:var(--text-muted);">Weight %</label><input type="number" min="0" max="100" step="1" value="${Number(e.weight_percent)}" data-exam="${e.id}" class="gs-exam-w" style="width:80px;"></div>
        </div>`).join('') : `<p class="hint">No exams assigned to this course (assign them in the Exams section).</p>`;

    const oralRows = gbOrals.length ? gbOrals.map(o => `
        <div class="list-row" data-oral="${o.id}">
            <div class="lr-body"><input type="text" value="${escapeHtml(o.title)}" class="gs-oral-title" data-oral="${o.id}" style="width:100%;font-weight:600;padding:7px 9px;"></div>
            <div class="lr-actions">
                <label style="font-size:12px;color:var(--text-muted);">Weight %</label>
                <input type="number" min="0" max="100" step="1" value="${Number(o.weight_percent)}" class="gs-oral-w" data-oral="${o.id}" style="width:80px;">
                <button class="btn btn-danger btn-sm" onclick="deleteOral('${o.id}')">Delete</button>
            </div>
        </div>`).join('') : `<p class="hint">No oral presentations yet — add one below.</p>`;

    body.innerHTML = `
        <div class="alert" id="grading-alert" style="display:none;"></div>
        <div class="section-title" style="font-size:15px;">Written exams</div>
        <div class="list-rows">${examRows}</div>
        <div class="section-title" style="font-size:15px;margin-top:20px;">Oral presentations</div>
        <div class="list-rows">${oralRows}</div>
        <div style="display:flex;gap:8px;margin-top:14px;align-items:flex-end;flex-wrap:wrap;">
            <div class="form-field" style="flex:1;min-width:180px;margin:0;"><label>New oral title</label><input type="text" id="new-oral-title" placeholder="e.g. Oral Presentation 1"></div>
            <div class="form-field" style="margin:0;"><label>Weight %</label><input type="number" id="new-oral-weight" min="0" max="100" step="1" value="10" style="width:90px;"></div>
            <button type="button" class="btn btn-ghost btn-sm" onclick="addOral()">+ Add oral</button>
        </div>
        <div style="margin-top:14px;font-size:13px;">Current total weight: <strong>${totalCourseWeight()}%</strong> <span style="color:var(--text-muted);">(aim for 100%)</span></div>`;
}

async function addOral() {
    const alert = document.getElementById('grading-alert');
    alert.style.display = 'none';
    const title = document.getElementById('new-oral-title').value.trim();
    const w = parseFloat(document.getElementById('new-oral-weight').value);
    if (!title) { showModalAlert(alert, 'Enter a title for the oral presentation.', 'error'); return; }
    if (!ensureSafe(alert, [['Oral title', title]])) return;
    const order = gbOrals.length ? Math.max(...gbOrals.map(o => o.order_index || 0)) + 1 : 1;
    const { data, error } = await db.from('oral_presentations')
        .insert({ course_id: currentCourseId, title, weight_percent: isNaN(w) ? 10 : w, order_index: order })
        .select('id, title, weight_percent, order_index').single();
    if (error) { showModalAlert(alert, error.message, 'error'); return; }
    gbOrals.push(data);
    renderGradingSetup();
    await loadGbPage();
}

async function deleteOral(id) {
    const o = gbOrals.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete oral presentation?',
        message: `"${o ? o.title : 'This oral'}" and every student's grade + feedback for it will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('oral_presentations').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    gbOrals = gbOrals.filter(x => x.id !== id);
    renderGradingSetup();
    await loadGbPage();
}

async function saveGrading() {
    const alert = document.getElementById('grading-alert');
    alert.style.display = 'none';
    const btn = document.getElementById('grading-save-btn');
    // Validate oral titles first.
    const titleChecks = [];
    document.querySelectorAll('.gs-oral-title').forEach((inp, i) => titleChecks.push([`Oral title ${i + 1}`, inp.value.trim()]));
    if (!ensureSafe(alert, titleChecks)) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const ops = [];
        document.querySelectorAll('.gs-exam-w').forEach(inp => {
            const id = inp.dataset.exam; const w = parseFloat(inp.value);
            if (!isNaN(w)) ops.push(db.from('exams').update({ weight_percent: w }).eq('id', id).then(r => { if (r.error) throw new Error(r.error.message); const e = gbExams.find(x => x.id === id); if (e) e.weight_percent = w; }));
        });
        document.querySelectorAll('.gs-oral-title').forEach(inp => {
            const id = inp.dataset.oral; const title = inp.value.trim();
            const wInp = document.querySelector(`.gs-oral-w[data-oral="${id}"]`); const w = parseFloat(wInp.value);
            const payload = {}; if (title) payload.title = title; if (!isNaN(w)) payload.weight_percent = w;
            if (Object.keys(payload).length) ops.push(db.from('oral_presentations').update(payload).eq('id', id).then(r => { if (r.error) throw new Error(r.error.message); const o = gbOrals.find(x => x.id === id); if (o) Object.assign(o, payload); }));
        });
        await Promise.all(ops);
        closeModal('grading-modal');
        await loadGbPage();
    } catch (err) {
        showModalAlert(alert, err.message || 'Save failed', 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save changes';
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
