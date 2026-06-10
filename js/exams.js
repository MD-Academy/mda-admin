// General Exams — PDF papers or manual MCQ, assigned to one or more courses.

const MATERIALS_BUCKET = 'materials';
const MAX_FILE_BYTES = 50 * 1024 * 1024;

let allExams = [];
let examCourseLinks = {};   // exam_id -> [course_id]
let questionCounts = {};    // exam_id -> count
let allCourses = [];
let pickedFile = null;

let currentExam = null;        // exam open in questions modal
let currentQuestions = [];

// ── HELPERS ──
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }
function sanitizeName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_'); }
function courseName(id) { const c = allCourses.find(x => x.id === id); return c ? c.name : '—'; }

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
function visToggleHtml(id, v) {
    return `<button class="vis-toggle ${v ? 'visible' : 'hidden'}" onclick="toggleExamVis('${id}')" title="${v ? 'Visible to students — click to hide' : 'Hidden from students — click to show'}">${v ? EYE : EYE_OFF}${v ? 'Visible' : 'Hidden'}</button>`;
}

// ── LOAD ──
async function loadExams() {
    const tbody = document.getElementById('exams-tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="loader">Loading exams…</td></tr>`;

    const [exRes, courseRes, linkRes, qRes] = await Promise.all([
        db.from('exams').select('id, title, description, type, pass_threshold, storage_path, time_limit_minutes, is_visible, created_at').order('created_at', { ascending: false }),
        db.from('courses').select('id, name').order('created_at', { ascending: false }),
        db.from('exam_courses').select('exam_id, course_id'),
        db.from('exam_questions').select('id, exam_id')
    ]);

    if (exRes.error) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader" style="color:var(--red)">Error loading exams: ${escapeHtml(exRes.error.message)}</td></tr>`;
        return;
    }
    allExams = exRes.data || [];
    allCourses = courseRes.data || [];
    examCourseLinks = {};
    (linkRes.data || []).forEach(l => { (examCourseLinks[l.exam_id] = examCourseLinks[l.exam_id] || []).push(l.course_id); });
    questionCounts = {};
    (qRes.data || []).forEach(q => { questionCounts[q.exam_id] = (questionCounts[q.exam_id] || 0) + 1; });

    applyFilters();
}

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    let list = allExams;
    if (q) list = list.filter(e => (e.title || '').toLowerCase().includes(q));
    renderExams(list);
}

function coursesBadges(examId) {
    const ids = examCourseLinks[examId] || [];
    if (ids.length === 0) return '<span style="color:var(--text-muted)">— None —</span>';
    return ids.map(id => `<span class="badge badge-blue" style="margin:1px 2px;">${escapeHtml(courseName(id))}</span>`).join('');
}

function renderExams(list) {
    const tbody = document.getElementById('exams-tbody');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader">No exams yet. Click "Add Exam" to create one.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(e => {
        const isManual = e.type === 'manual';
        const typeBadge = isManual
            ? `<span class="badge badge-green">Multiple-choice</span>`
            : `<span class="badge badge-amber">PDF</span>`;
        const contentBtn = isManual
            ? `<button class="btn btn-ghost btn-sm" onclick="openQuestions('${e.id}')">Questions (${questionCounts[e.id] || 0})</button>`
            : `<button class="btn btn-ghost btn-sm" onclick="previewExam('${e.id}', this)">Preview</button>`;
        return `
            <tr>
                <td><strong>${escapeHtml(e.title)}</strong></td>
                <td>${typeBadge}</td>
                <td>${e.pass_threshold}%</td>
                <td>${coursesBadges(e.id)}</td>
                <td>${visToggleHtml(e.id, e.is_visible)}</td>
                <td class="row-actions">
                    ${contentBtn}
                    <button class="btn btn-ghost btn-sm" onclick="openExamModal('${e.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteExam('${e.id}')">Delete</button>
                </td>
            </tr>`;
    }).join('');
}

async function toggleExamVis(id) {
    const e = allExams.find(x => x.id === id);
    if (!e) return;
    const { error } = await db.from('exams').update({ is_visible: !e.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    e.is_visible = !e.is_visible;
    applyFilters();
}

// ── COURSE CHECKLIST ──
function renderExamCourseChecklist(selected = []) {
    const el = document.getElementById('exam-course-list');
    if (allCourses.length === 0) {
        el.innerHTML = `<div class="empty">No courses exist yet. Create one in the Courses section first.</div>`;
        return;
    }
    const sel = new Set(selected);
    el.innerHTML = allCourses.map(c => `
        <label class="check-row"><input type="checkbox" value="${c.id}" ${sel.has(c.id) ? 'checked' : ''}> ${escapeHtml(c.name)}</label>`).join('');
}
function checkedExamCourseIds() {
    return Array.from(document.querySelectorAll('#exam-course-list input[type="checkbox"]:checked')).map(cb => cb.value);
}

// ── TYPE / FILE ──
function onTypeChange() {
    const type = document.getElementById('exam-type').value;
    document.getElementById('pdf-field').style.display = type === 'pdf' ? 'block' : 'none';
    document.getElementById('timelimit-field').style.display = type === 'manual' ? 'block' : 'none';
}
function onExamFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    pickedFile = file;
    document.getElementById('exam-file-text').textContent = file.name;
}

// ── CREATE / EDIT ──
function openExamModal(id = null) {
    pickedFile = null;
    document.getElementById('exam-alert').style.display = 'none';
    document.getElementById('exam-file').value = '';
    document.getElementById('exam-file-text').textContent = 'Click to choose a PDF';
    document.getElementById('exam-file-current').textContent = '';

    if (id) {
        const e = allExams.find(x => x.id === id);
        if (!e) return;
        document.getElementById('exam-modal-title').textContent = 'Edit Exam';
        document.getElementById('exam-id').value = e.id;
        document.getElementById('exam-title').value = e.title || '';
        document.getElementById('exam-desc').value = e.description || '';
        document.getElementById('exam-type').value = e.type;
        document.getElementById('exam-threshold').value = e.pass_threshold ?? 70;
        document.getElementById('exam-timelimit').value = e.time_limit_minutes || '';
        if (e.type === 'pdf' && e.storage_path) {
            document.getElementById('exam-file-current').textContent = 'A PDF is already uploaded. Choose a file only to replace it.';
        }
        renderExamCourseChecklist(examCourseLinks[e.id] || []);
    } else {
        document.getElementById('exam-modal-title').textContent = 'Add Exam';
        document.getElementById('exam-id').value = '';
        document.getElementById('exam-title').value = '';
        document.getElementById('exam-desc').value = '';
        document.getElementById('exam-type').value = 'manual';
        document.getElementById('exam-threshold').value = 70;
        document.getElementById('exam-timelimit').value = '';
        renderExamCourseChecklist([]);
    }
    onTypeChange();
    openModal('exam-modal');
}

async function saveExam(ev) {
    ev.preventDefault();
    const btn = document.getElementById('exam-save-btn');
    const alert = document.getElementById('exam-alert');
    alert.style.display = 'none';

    const id = document.getElementById('exam-id').value;
    const type = document.getElementById('exam-type').value;
    const threshold = parseInt(document.getElementById('exam-threshold').value, 10);
    const timelimit = document.getElementById('exam-timelimit').value;
    const courseIds = checkedExamCourseIds();
    const existing = id ? allExams.find(x => x.id === id) : null;

    const payload = {
        title: document.getElementById('exam-title').value.trim(),
        description: document.getElementById('exam-desc').value.trim() || null,
        type,
        pass_threshold: (threshold >= 1 && threshold <= 100) ? threshold : 70,
        time_limit_minutes: (type === 'manual' && timelimit) ? parseInt(timelimit, 10) : null
    };

    if (!payload.title) { showModalAlert(alert, 'Title is required.', 'error'); return; }
    if (!ensureSafe(alert, [['Title', payload.title], ['Description', payload.description]])) return;
    if (type === 'pdf' && !pickedFile && !(existing && existing.storage_path)) {
        showModalAlert(alert, 'Please choose a PDF for a PDF exam.', 'error'); return;
    }
    if (pickedFile && pickedFile.size > MAX_FILE_BYTES) {
        showModalAlert(alert, 'PDF is too large. Maximum is 50 MB.', 'error'); return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        // Upload a new PDF if provided.
        if (type === 'pdf' && pickedFile) {
            const path = `exams/${Date.now()}-${sanitizeName(pickedFile.name)}`;
            const up = await db.storage.from(MATERIALS_BUCKET).upload(path, pickedFile, { contentType: pickedFile.type || undefined, upsert: false });
            if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
            payload.storage_path = path;
        }

        let examId = id;
        if (id) {
            const res = await db.from('exams').update(payload).eq('id', id);
            if (res.error) throw new Error(res.error.message);
        } else {
            const res = await db.from('exams').insert(payload).select('id').single();
            if (res.error) throw new Error(res.error.message);
            examId = res.data.id;
        }

        // Reset course assignments.
        await db.from('exam_courses').delete().eq('exam_id', examId);
        if (courseIds.length) {
            const linkRes = await db.from('exam_courses').insert(courseIds.map(cid => ({ exam_id: examId, course_id: cid })));
            if (linkRes.error) throw new Error(linkRes.error.message);
        }

        closeModal('exam-modal');
        loadExams();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Exam';
    }
}

async function deleteExam(id) {
    const e = allExams.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete exam?',
        message: `"${e ? e.title : ''}" and all its questions and student attempts will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete', danger: true
    });
    if (!ok) return;
    // Remove the PDF file if any.
    if (e && e.storage_path) await db.storage.from(MATERIALS_BUCKET).remove([e.storage_path]);
    const { error } = await db.from('exams').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    loadExams();
}

// ── PDF PREVIEW ──
function previewExam(id, btnEl) {
    const e = allExams.find(x => x.id === id);
    if (!e || !e.storage_path) { alert('No PDF uploaded for this exam.'); return; }
    const win = window.open('', '_blank');
    if (win) win.document.write('<!DOCTYPE html><title>Loading…</title><body style="font-family:sans-serif;padding:40px;color:#334">Loading exam…</body>');
    const original = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = 'Opening…';
    apiRequest('POST', '/materials/signed-url', { storage_path: e.storage_path })
        .then(res => { if (win) win.location.href = res.signed_url; else window.open(res.signed_url, '_blank', 'noopener'); })
        .catch(err => { if (win) win.close(); alert(`Could not open file: ${err.message}`); })
        .finally(() => { btnEl.disabled = false; btnEl.textContent = original; });
}

// ════════════ MANUAL QUESTIONS ════════════
async function openQuestions(examId) {
    currentExam = allExams.find(x => x.id === examId);
    if (!currentExam) return;
    document.getElementById('questions-modal-title').textContent = `Questions — ${currentExam.title}`;
    document.getElementById('eq-list').innerHTML = `<div class="loader">Loading…</div>`;
    openModal('questions-modal');
    await refreshQuestions();
}

async function refreshQuestions() {
    const { data, error } = await db.from('exam_questions')
        .select('id, question_text, options_json, correct_answer_index, order_index')
        .eq('exam_id', currentExam.id).order('order_index', { ascending: true });
    const el = document.getElementById('eq-list');
    if (error) { el.innerHTML = `<div class="loader" style="color:var(--red)">Error: ${escapeHtml(error.message)}</div>`; return; }
    currentQuestions = data || [];
    questionCounts[currentExam.id] = currentQuestions.length;
    document.getElementById('eq-count').textContent = currentQuestions.length;
    renderQuestions();
    applyFilters(); // refresh the count in the exams table behind
}

function renderQuestions() {
    const el = document.getElementById('eq-list');
    if (currentQuestions.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><p>No questions yet. Click "Add Question".</p></div>`;
        return;
    }
    el.innerHTML = `<div class="list-rows">${currentQuestions.map((q, i) => {
        const opts = Array.isArray(q.options_json) ? q.options_json : [];
        const correct = opts[q.correct_answer_index] || '—';
        return `
            <div class="list-row">
                <div class="lr-index">${i + 1}</div>
                <div class="lr-body">
                    <div class="lr-title">${escapeHtml(q.question_text)}</div>
                    <div class="lr-sub">Correct: ${escapeHtml(correct)}</div>
                </div>
                <div class="lr-actions">
                    <button class="btn btn-ghost btn-sm" onclick="moveQuestion('${q.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''}>↑</button>
                    <button class="btn btn-ghost btn-sm" onclick="moveQuestion('${q.id}', 1)" ${i === currentQuestions.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''}>↓</button>
                    <button class="btn btn-ghost btn-sm" onclick="openQuestionForm('${q.id}')">Edit</button>
                    <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q.id}')">Delete</button>
                </div>
            </div>`;
    }).join('')}</div>`;
}

function openQuestionForm(id = null) {
    document.getElementById('question-alert').style.display = 'none';
    const optionsList = document.getElementById('options-list');
    optionsList.innerHTML = '';
    if (id) {
        const q = currentQuestions.find(x => x.id === id);
        if (!q) return;
        document.getElementById('question-modal-title').textContent = 'Edit Question';
        document.getElementById('question-id').value = q.id;
        document.getElementById('question-text').value = q.question_text || '';
        const opts = Array.isArray(q.options_json) ? q.options_json : [];
        if (opts.length) opts.forEach((o, i) => addOptionRow(o, i === q.correct_answer_index));
        else { addOptionRow(); addOptionRow(); }
    } else {
        document.getElementById('question-modal-title').textContent = 'Add Question';
        document.getElementById('question-id').value = '';
        document.getElementById('question-text').value = '';
        addOptionRow(); addOptionRow(); addOptionRow(); addOptionRow();
    }
    openModal('question-modal');
}

function addOptionRow(value = '', checked = false) {
    const list = document.getElementById('options-list');
    if (list.querySelectorAll('.option-row').length >= 6) return;
    const row = document.createElement('div');
    row.className = 'option-row';
    row.innerHTML = `
        <input type="radio" name="correct-option" ${checked ? 'checked' : ''}>
        <input type="text" placeholder="Option text" value="${escapeHtml(value)}">
        <button type="button" class="opt-remove" onclick="removeOptionRow(this)" title="Remove">&times;</button>`;
    list.appendChild(row);
}
function removeOptionRow(btn) {
    const list = document.getElementById('options-list');
    if (list.querySelectorAll('.option-row').length <= 2) return;
    btn.closest('.option-row').remove();
}

async function saveQuestion(ev) {
    ev.preventDefault();
    const btn = document.getElementById('question-save-btn');
    const alert = document.getElementById('question-alert');
    alert.style.display = 'none';

    const id = document.getElementById('question-id').value;
    const text = document.getElementById('question-text').value.trim();
    const rows = Array.from(document.querySelectorAll('#options-list .option-row'));
    const options = rows.map(r => r.querySelector('input[type="text"]').value.trim());
    const correctIdx = rows.findIndex(r => r.querySelector('input[type="radio"]').checked);

    if (!text) { showModalAlert(alert, 'Please enter the question.', 'error'); return; }
    if (options.length < 2) { showModalAlert(alert, 'Add at least two options.', 'error'); return; }
    if (options.some(o => !o)) { showModalAlert(alert, 'Please fill in every option, or remove empty ones.', 'error'); return; }
    if (correctIdx < 0) { showModalAlert(alert, 'Please mark the correct answer.', 'error'); return; }
    if (!ensureSafe(alert, [['Question', text], ...options.map((o, i) => [`Option ${i + 1}`, o])])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('exam_questions').update({ question_text: text, options_json: options, correct_answer_index: correctIdx }).eq('id', id);
        } else {
            const nextOrder = currentQuestions.length ? Math.max(...currentQuestions.map(q => q.order_index || 0)) + 1 : 1;
            res = await db.from('exam_questions').insert({ exam_id: currentExam.id, question_text: text, options_json: options, correct_answer_index: correctIdx, order_index: nextOrder });
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('question-modal');
        await refreshQuestions();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Question';
    }
}

async function deleteQuestion(id) {
    const ok = await confirmDialog({ title: 'Delete question?', message: 'This question will be removed from the exam.', confirmText: 'Delete', danger: true });
    if (!ok) return;
    const { error } = await db.from('exam_questions').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    await refreshQuestions();
}

async function moveQuestion(id, dir) {
    const idx = currentQuestions.findIndex(q => q.id === id);
    const t = idx + dir;
    if (idx < 0 || t < 0 || t >= currentQuestions.length) return;
    const a = currentQuestions[idx], b = currentQuestions[t];
    const [r1, r2] = await Promise.all([
        db.from('exam_questions').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('exam_questions').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) { alert(`Failed to reorder: ${(r1.error || r2.error).message}`); return; }
    await refreshQuestions();
}
