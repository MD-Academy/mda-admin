// Presentations — create oral presentations per course, grade each enrolled
// student with an optional comment. Writes the same oral_presentations /
// oral_grades rows Gradebook already reads, so scores keep counting toward
// the course's overall grade with no change to that calculation.

let PR_CURRENT_UID = null;
let PR_CURRENT_NAME = '';
let PR_IS_SUPER = false;

let prCourses = [];
let prCourseId = '';
let prList = [];          // [{id, title, weight_percent, order_index, presentation_date}]
let prStudentIds = [];    // enrolled student ids for the course

let prView = 'list';      // 'list' | 'grade'
let prActiveId = null;    // presentation currently being graded
let prActiveTitle = '';

let prPage = 1, prPageSize = 50, prTotal = 0, prSearch = '', prSearchTimer = null;
let prStudents = [];       // paged profiles [{id, full_name}]
let prGrades = {};         // studentId -> {id, score, feedback}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }

// Format a plain "YYYY-MM-DD" date without going through Date()/timezones.
function fmtPrDate(d) {
    if (!d) return '';
    const parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return escapeHtml(d);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const y = Number(parts[0]), m = Number(parts[1]), day = Number(parts[2]);
    if (!y || !m || !day) return escapeHtml(d);
    return `${String(day).padStart(2, '0')} ${months[m - 1]} ${y}`;
}

async function loadPrCourses() {
    const { data, error } = await db.from('courses').select('id, name').order('created_at', { ascending: false });
    if (error) return;
    prCourses = data || [];
    const sel = document.getElementById('pr-course-select');
    prCourses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        sel.appendChild(opt);
    });
}

async function onPrCourseChange() {
    prCourseId = document.getElementById('pr-course-select').value;
    prView = 'list'; prActiveId = null;
    const body = document.getElementById('pr-body');
    if (!prCourseId) { body.innerHTML = `<div class="loader">Choose a course to see its presentations.</div>`; return; }
    body.innerHTML = `<div class="loader">Loading presentations…</div>`;

    const [prRes, enrRes] = await Promise.all([
        db.from('oral_presentations').select('id, title, weight_percent, order_index, presentation_date')
            .eq('course_id', prCourseId)
            .order('presentation_date', { ascending: true, nullsFirst: false })
            .order('order_index', { ascending: true, nullsFirst: false }),
        db.from('course_enrollments').select('student_id').eq('course_id', prCourseId)
    ]);
    if (prRes.error) {
        // Migration not run yet — fall back without presentation_date so the page still works.
        const fb = await db.from('oral_presentations').select('id, title, weight_percent, order_index')
            .eq('course_id', prCourseId)
            .order('order_index', { ascending: true, nullsFirst: false });
        prList = (fb.data || []).map(p => ({ ...p, presentation_date: null }));
    } else {
        prList = prRes.data || [];
    }
    prStudentIds = [...new Set((enrRes.data || []).map(r => r.student_id))];

    renderPrRoot();
}

function renderPrRoot() {
    if (prView === 'grade') renderGradePanel();
    else renderPrList();
}

function renderPrList() {
    const body = document.getElementById('pr-body');
    const newBtn = `<button class="btn btn-primary btn-sm" onclick="openNewPresentation()">+ New presentation</button>`;
    const hint = `<p class="hint" style="margin:0;">Grades count toward this course's overall score. Weights default to 10% — rebalance them any time in Gradebook → ⚙ Manage grading.</p>`;

    if (!prList.length) {
        body.innerHTML = `<div class="toolbar">${hint}${newBtn}</div><div class="empty-state"><h3>No presentations yet</h3><p>Create the first one for this course.</p></div>`;
        return;
    }

    const rows = prList.map(p => {
        const dateLabel = p.presentation_date ? fmtPrDate(p.presentation_date) : '<span style="color:var(--text-muted);">No date set</span>';
        return `<div class="list-row">
            <div class="lr-body">
                <div class="lr-title">${escapeHtml(p.title)}</div>
                <div class="lr-sub">${dateLabel} · Weight ${Number(p.weight_percent)}%</div>
            </div>
            <div class="lr-actions">
                <button class="btn btn-ghost btn-sm" onclick="openEditPresentation('${p.id}')">Edit</button>
                ${PR_IS_SUPER ? `<button class="btn btn-danger btn-sm" onclick="deletePresentation('${p.id}')">Delete</button>` : ''}
                <button class="btn btn-primary btn-sm" onclick="openGrading('${p.id}')">Grade students →</button>
            </div>
        </div>`;
    }).join('');

    body.innerHTML = `<div class="toolbar">${hint}${newBtn}</div><div class="list-rows">${rows}</div>`;
}

// ── CREATE / EDIT ──
function openNewPresentation() {
    if (!prCourseId) return;
    document.getElementById('pr-modal-alert').style.display = 'none';
    document.getElementById('pr-modal-title').textContent = 'New presentation';
    document.getElementById('pr-edit-id').value = '';
    document.getElementById('pr-title').value = '';
    document.getElementById('pr-date').value = '';
    openModal('pr-modal');
}

function openEditPresentation(id) {
    const p = prList.find(x => x.id === id);
    if (!p) return;
    document.getElementById('pr-modal-alert').style.display = 'none';
    document.getElementById('pr-modal-title').textContent = 'Edit presentation';
    document.getElementById('pr-edit-id').value = id;
    document.getElementById('pr-title').value = p.title || '';
    document.getElementById('pr-date').value = p.presentation_date ? String(p.presentation_date).slice(0, 10) : '';
    openModal('pr-modal');
}

async function savePresentation(ev) {
    ev.preventDefault();
    const alert = document.getElementById('pr-modal-alert');
    alert.style.display = 'none';
    const btn = document.getElementById('pr-save-btn');

    const id = document.getElementById('pr-edit-id').value;
    const title = document.getElementById('pr-title').value.trim();
    const dateVal = document.getElementById('pr-date').value || null;
    if (!title) { showModalAlert(alert, 'Enter a title for the presentation.', 'error'); return; }
    if (!ensureSafe(alert, [['Title', title]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (id) {
            const res = await db.from('oral_presentations')
                .update({ title, presentation_date: dateVal }).eq('id', id)
                .select('id, title, weight_percent, order_index, presentation_date').single();
            if (res.error || !res.data) throw new Error(res.error ? res.error.message : 'Save blocked — check permissions and try again.');
            const p = prList.find(x => x.id === id);
            if (p) Object.assign(p, res.data);
        } else {
            const order = prList.length ? Math.max(...prList.map(p => p.order_index || 0)) + 1 : 1;
            const res = await db.from('oral_presentations')
                .insert({ course_id: prCourseId, title, presentation_date: dateVal, weight_percent: 10, order_index: order })
                .select('id, title, weight_percent, order_index, presentation_date').single();
            if (res.error || !res.data) throw new Error(res.error ? res.error.message : 'Create blocked — check permissions and try again.');
            prList.push(res.data);
        }
        closeModal('pr-modal');
        renderPrList();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}

async function deletePresentation(id) {
    const p = prList.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete presentation?',
        message: `"${p ? p.title : 'This presentation'}" and every student's grade + comment for it will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('oral_presentations').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    prList = prList.filter(x => x.id !== id);
    renderPrList();
}

// ── GRADE STUDENTS FOR ONE PRESENTATION ──
function openGrading(id) {
    const p = prList.find(x => x.id === id);
    if (!p) return;
    prActiveId = id;
    prActiveTitle = p.title;
    prView = 'grade';
    prPage = 1; prSearch = '';
    loadPrGradePage();
}

function backToPrList() {
    prView = 'list';
    prActiveId = null;
    renderPrList();
}

function onPrSearch() {
    clearTimeout(prSearchTimer);
    prSearchTimer = setTimeout(() => {
        prSearch = (document.getElementById('pr-grade-search').value || '').trim();
        prPage = 1; loadPrGradePage();
    }, 300);
}
function onPrPageSize() {
    prPageSize = parseInt(document.getElementById('pr-page-size').value, 10) || 50;
    prPage = 1; loadPrGradePage();
}
function changePrPage(delta) {
    const totalPages = Math.max(1, Math.ceil(prTotal / prPageSize));
    const n = prPage + delta;
    if (n < 1 || n > totalPages) return;
    prPage = n; loadPrGradePage(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadPrGradePage() {
    const body = document.getElementById('pr-body');
    body.innerHTML = `<div class="loader">Loading students…</div>`;

    if (prStudentIds.length === 0) {
        prStudents = []; prTotal = 0; prGrades = {};
        renderGradePanel();
        return;
    }

    const from = (prPage - 1) * prPageSize, to = from + prPageSize - 1;
    let q = db.from('profiles').select('id, full_name', { count: 'exact' }).in('id', prStudentIds);
    const term = prSearch.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.ilike('full_name', `%${term}%`);
    q = q.order('full_name', { ascending: true }).range(from, to);

    const { data, count, error } = await q;
    if (error) { body.innerHTML = `<div class="empty-state"><h3 style="color:var(--red)">Couldn't load students</h3><p>${escapeHtml(error.message)}</p></div>`; return; }
    prStudents = data || [];
    prTotal = count || 0;
    prGrades = {};
    const ids = prStudents.map(s => s.id);
    if (ids.length) {
        const { data: grades } = await db.from('oral_grades').select('id, student_id, score, feedback')
            .eq('oral_presentation_id', prActiveId).in('student_id', ids);
        (grades || []).forEach(g => { prGrades[g.student_id] = g; });
    }
    renderGradePanel();
}

function renderGradePanel() {
    const body = document.getElementById('pr-body');

    if (prStudentIds.length === 0) {
        body.innerHTML = `
            <button class="btn btn-ghost btn-sm" style="margin-bottom:14px;" onclick="backToPrList()">← Back to presentations</button>
            <div class="empty-state"><h3>No students enrolled</h3><p>Enrol students in this course to grade them here.</p></div>`;
        return;
    }
    if (prStudents.length === 0) {
        body.innerHTML = `
            <button class="btn btn-ghost btn-sm" style="margin-bottom:14px;" onclick="backToPrList()">← Back to presentations</button>
            <div class="empty-state"><h3>No students match</h3><p>No enrolled student matches "${escapeHtml(prSearch)}".</p></div>`;
        return;
    }

    const rows = prStudents.map(s => {
        const g = prGrades[s.id];
        const score = (g && g.score != null) ? Number(g.score) : '';
        const feedback = (g && g.feedback) ? g.feedback : '';
        return `<div class="list-row pr-grade-row" id="pr-row-${s.id}">
            <div class="lr-body"><div class="lr-title">${escapeHtml(s.full_name || '—')}</div></div>
            <input type="number" class="pr-score" id="pr-score-${s.id}" min="0" max="100" step="1" placeholder="Grade %" value="${score}">
            <textarea class="pr-fb" id="pr-fb-${s.id}" rows="1" placeholder="Comment (optional) — e.g. &quot;His knowledge was solid but English skills need improvement&quot;">${escapeHtml(feedback)}</textarea>
            <div class="lr-actions" style="flex-direction:column;align-items:flex-end;gap:2px;">
                <button class="btn btn-ghost btn-sm" id="pr-save-${s.id}" onclick="saveGradeRow('${s.id}')">Save</button>
                <div class="pr-status" id="pr-status-${s.id}"></div>
            </div>
        </div>`;
    }).join('');

    const totalPages = Math.max(1, Math.ceil(prTotal / prPageSize));
    const pager = prTotal > prPageSize ? `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;flex-wrap:wrap;">
            <div style="font-size:13px;color:var(--text-muted);">Showing ${(prPage - 1) * prPageSize + 1}–${Math.min(prPage * prPageSize, prTotal)} of ${prTotal} student${prTotal === 1 ? '' : 's'}</div>
            <div style="display:flex;gap:8px;align-items:center;">
                <button class="btn btn-ghost btn-sm" onclick="changePrPage(-1)" ${prPage <= 1 ? 'disabled' : ''}>← Prev</button>
                <span style="font-size:13px;">Page ${prPage} of ${totalPages}</span>
                <button class="btn btn-ghost btn-sm" onclick="changePrPage(1)" ${prPage >= totalPages ? 'disabled' : ''}>Next →</button>
            </div>
        </div>` : '';

    body.innerHTML = `
        <button class="btn btn-ghost btn-sm" style="margin-bottom:14px;" onclick="backToPrList()">← Back to presentations</button>
        <div class="toolbar">
            <div><strong>${escapeHtml(prActiveTitle)}</strong><div class="hint" style="margin:0;">Grade is optional to leave blank; comment is always optional.</div></div>
            <div class="search-box">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input type="text" id="pr-grade-search" placeholder="Find a student by name…" oninput="onPrSearch()" value="${escapeHtml(prSearch)}">
            </div>
            <select id="pr-page-size" class="filter-select" onchange="onPrPageSize()">
                <option value="50" ${prPageSize === 50 ? 'selected' : ''}>50 / page</option>
                <option value="25" ${prPageSize === 25 ? 'selected' : ''}>25 / page</option>
                <option value="100" ${prPageSize === 100 ? 'selected' : ''}>100 / page</option>
            </select>
        </div>
        <div class="list-rows">${rows}</div>
        ${pager}`;
}

async function saveGradeRow(studentId) {
    const scoreInput = document.getElementById(`pr-score-${studentId}`);
    const fbInput = document.getElementById(`pr-fb-${studentId}`);
    const statusEl = document.getElementById(`pr-status-${studentId}`);
    const btn = document.getElementById(`pr-save-${studentId}`);
    statusEl.textContent = ''; statusEl.className = 'pr-status';

    const raw = scoreInput.value.trim();
    const feedback = fbInput.value.trim();
    const score = raw === '' ? null : parseFloat(raw);
    if (score != null && (isNaN(score) || score < 0 || score > 100)) {
        statusEl.textContent = 'Enter a grade between 0 and 100, or leave it blank.';
        statusEl.className = 'pr-status error';
        return;
    }
    if (!ensureSafe(null, [['Comment', feedback]])) {
        statusEl.textContent = 'Invalid format in the comment — scripts or code are not allowed.';
        statusEl.className = 'pr-status error';
        return;
    }

    const existing = prGrades[studentId];
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const payload = { score, feedback: feedback || null, graded_by: PR_CURRENT_UID, graded_at: new Date().toISOString() };
        let row;
        if (existing && existing.id) {
            const res = await db.from('oral_grades').update(payload).eq('id', existing.id).select('id, score, feedback').single();
            if (res.error || !res.data) throw new Error(res.error ? res.error.message : 'Save blocked (no rows updated) — check permissions and try again.');
            row = res.data;
        } else {
            const res = await db.from('oral_grades').insert({ oral_presentation_id: prActiveId, student_id: studentId, ...payload })
                .select('id, score, feedback').single();
            if (res.error || !res.data) throw new Error(res.error ? res.error.message : 'Save blocked (no row inserted) — check permissions and try again.');
            row = res.data;
        }
        prGrades[studentId] = { id: row.id, score: row.score, feedback: row.feedback };
        statusEl.textContent = 'Saved ✓';
        statusEl.className = 'pr-status ok';
    } catch (err) {
        statusEl.textContent = `Not saved — ${err.message}`;
        statusEl.className = 'pr-status error';
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}
