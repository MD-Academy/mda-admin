// Room content hub — lessons, zoom recordings, video lectures, materials, quizzes.
// Everything here is scoped to a single room (no room pickers).

const MATERIALS_BUCKET = 'materials';
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

// Whitelisted file extensions per category. Anything not in the list
// (e.g. .exe, .zip, .js, .html, .bat) is rejected with a clear error.
const ALLOWED_EXT = {
    material: ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'png', 'jpg', 'jpeg'],
    note: ['pdf', 'txt', 'jpg', 'jpeg', 'png']
};
const ALLOWED_HINT = {
    material: 'PDF, PPTX, DOCX, images — up to 50 MB',
    note: 'PDF, TXT, JPG, PNG — up to 50 MB'
};
const ACCEPT_ATTR = {
    material: '.pdf,.ppt,.pptx,.doc,.docx,.png,.jpg,.jpeg',
    note: '.pdf,.txt,.png,.jpg,.jpeg'
};

let ROOM_ID = null;
let currentRoom = null;
let lessons = [];
let recordings = [];   // both kinds
let materials = [];
let pickedFile = null;

// Quizzes
const REQUIRED_QUESTIONS = 10;
let quizzes = [];               // [{id, lesson_id, time_limit_minutes, cooldown_minutes}]
let quizQuestionCounts = {};    // quiz_id -> count
let currentQuiz = null;         // quiz open in the builder
let currentQuizQuestions = [];  // its questions

// ── HELPERS ──
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) {
    el.className = `alert ${type}`;
    el.textContent = msg;
    el.style.display = 'block';
}
function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
function formatDuration(seconds) {
    if (!seconds) return '—';
    const m = Math.round(seconds / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
}
function lessonTitle(id) {
    if (!id) return '—';
    const l = lessons.find(x => x.id === id);
    return l ? l.title : '—';
}
function fileExt(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}
function sanitizeName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_'); }

// ── VISIBILITY TOGGLE ──
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function visToggleHtml(fnName, id, isVisible) {
    return `<button class="vis-toggle ${isVisible ? 'visible' : 'hidden'}" onclick="${fnName}('${id}')" title="${isVisible ? 'Visible to students — click to hide' : 'Hidden from students — click to show'}">${isVisible ? EYE : EYE_OFF}${isVisible ? 'Visible' : 'Hidden'}</button>`;
}

async function _setVisible(table, id, current) {
    const { error } = await db.from(table).update({ is_visible: !current }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    await loadAll();
}
function toggleLessonVis(id)   { const x = lessons.find(l => l.id === id);     if (x) _setVisible('lessons', id, x.is_visible); }
function toggleRecVis(id)      { const x = recordings.find(r => r.id === id);  if (x) _setVisible('recordings', id, x.is_visible); }
function toggleMaterialVis(id) { const x = materials.find(m => m.id === id);   if (x) _setVisible('materials', id, x.is_visible); }
function toggleQuizVis(id)     { const x = quizzes.find(q => q.id === id);     if (x) _setVisible('quizzes', id, x.is_visible); }

// ── INIT ──
async function initRoom(roomId, profile) {
    ROOM_ID = roomId;

    const { data, error } = await db.from('rooms').select('id, name, description').eq('id', roomId).single();
    if (error || !data) {
        renderLayout('subjects', 'Subject', '', profile);
        document.getElementById('page-content').innerHTML =
            `<div class="empty-state"><h3>Subject not found</h3><p>It may have been deleted. <a href="subjects.html">Back to all subjects</a>.</p></div>`;
        return;
    }
    currentRoom = data;

    renderLayout('subjects', escapeHtml(data.name), 'Manage this subject\'s content', profile);

    document.getElementById('page-content').innerHTML = `
        <a class="back-link" href="subjects.html">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            All Subjects
        </a>
        <div class="tabs">
            <button class="tab active" data-tab="lessons" onclick="switchTab('lessons')">Lessons <span class="count-pill" id="count-lessons">0</span></button>
            <button class="tab" data-tab="lecture" onclick="switchTab('lecture')">Video Lectures <span class="count-pill" id="count-lecture">0</span></button>
            <button class="tab" data-tab="materials" onclick="switchTab('materials')">Materials <span class="count-pill" id="count-materials">0</span></button>
            <button class="tab" data-tab="notes" onclick="switchTab('notes')">Additional Notes <span class="count-pill" id="count-notes">0</span></button>
            <button class="tab" data-tab="anki" onclick="switchTab('anki')">Anki Cards</button>
            <button class="tab" data-tab="quizzes" onclick="switchTab('quizzes')">Quizzes <span class="count-pill" id="count-quizzes">0</span></button>
        </div>

        <div class="tab-panel active" id="panel-lessons">
            <div class="subtoolbar">
                <div class="st-title">Lessons</div>
                <button class="btn btn-primary btn-sm" onclick="openLessonForm()">+ Add Lesson</button>
            </div>
            <div id="lessons-list"><div class="loader">Loading…</div></div>
        </div>

        <div class="tab-panel" id="panel-lecture">
            <div class="subtoolbar">
                <div class="st-title">Video Lectures</div>
                <button class="btn btn-primary btn-sm" onclick="openRecModal('lecture')">+ Add Video Lecture</button>
            </div>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Lesson</th><th>Lecturer</th><th>Date</th><th>Duration</th><th>Visible</th><th>Actions</th></tr></thead>
                <tbody id="lecture-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-materials">
            <div class="subtoolbar">
                <div class="st-title">Study Materials</div>
                <button class="btn btn-primary btn-sm" onclick="openUploadModal()">+ Upload Material</button>
            </div>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Type</th><th>Lesson</th><th>Uploaded</th><th>Visible</th><th>Actions</th></tr></thead>
                <tbody id="materials-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-notes">
            <div class="subtoolbar">
                <div class="st-title">Additional Notes</div>
                <button class="btn btn-primary btn-sm" onclick="openUploadModal('note')">+ Add Note</button>
            </div>
            <p class="hint" style="margin:-6px 0 16px;">Extra summaries, study plans or recommendations. Accepts PDF, TXT, JPG, PNG.</p>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Type</th><th>Lesson</th><th>Uploaded</th><th>Visible</th><th>Actions</th></tr></thead>
                <tbody id="notes-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-anki">
            <div class="empty-state"><h3>Anki Cards — coming soon</h3><p>Anki flashcard decks will live here once the format is decided.</p></div>
        </div>

        <div class="tab-panel" id="panel-quizzes">
            <div class="subtoolbar">
                <div class="st-title">Quizzes</div>
            </div>
            <p class="hint" style="margin:-6px 0 16px;">Each lesson can have one quiz of exactly 10 questions. A student must answer all 10 correctly to pass.</p>
            <div id="quizzes-list"><div class="loader">Loading…</div></div>
        </div>
    `;

    await loadAll();
}

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
}

async function loadAll() {
    const [lRes, rRes, mRes] = await Promise.all([
        db.from('lessons').select('id, title, description, image_url, order_index, is_visible').eq('room_id', ROOM_ID).order('order_index', { ascending: true }),
        db.from('recordings').select('id, lesson_id, title, professor, recorded_date, aws_url, duration_seconds, kind, is_visible, order_index, created_at').eq('room_id', ROOM_ID).eq('kind', 'lecture').order('order_index', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true }),
        db.from('materials').select('id, lesson_id, title, type, storage_path, external_url, created_at, category, is_visible, order_index').eq('room_id', ROOM_ID).order('order_index', { ascending: true, nullsFirst: false }).order('created_at', { ascending: true })
    ]);

    lessons = lRes.data || [];
    recordings = rRes.data || [];
    materials = mRes.data || [];

    // Quizzes belong to lessons; load them + their question counts.
    quizzes = [];
    quizQuestionCounts = {};
    const lessonIds = lessons.map(l => l.id);
    if (lessonIds.length) {
        const qRes = await db.from('quizzes').select('id, lesson_id, time_limit_minutes, cooldown_minutes, is_visible').in('lesson_id', lessonIds);
        quizzes = qRes.data || [];
        const quizIds = quizzes.map(q => q.id);
        if (quizIds.length) {
            const qqRes = await db.from('quiz_questions').select('id, quiz_id').in('quiz_id', quizIds);
            (qqRes.data || []).forEach(q => { quizQuestionCounts[q.quiz_id] = (quizQuestionCounts[q.quiz_id] || 0) + 1; });
        }
    }

    renderLessons();
    renderRecordings('lecture');
    renderMaterials();
    renderNotes();
    renderQuizzes();
    updateCounts();
}

// Treat any row without an explicit category as a 'material' (older rows).
function matCategory(m) { return m.category === 'note' ? 'note' : 'material'; }

function updateCounts() {
    document.getElementById('count-lessons').textContent = lessons.length;
    document.getElementById('count-lecture').textContent = recordings.filter(r => r.kind === 'lecture').length;
    document.getElementById('count-materials').textContent = materials.filter(m => matCategory(m) === 'material').length;
    document.getElementById('count-notes').textContent = materials.filter(m => matCategory(m) === 'note').length;
    document.getElementById('count-quizzes').textContent = quizzes.length;
}

// ── LESSON SELECT POPULATION ──
function lessonOptions(selectedId = '') {
    return `<option value="">— None —</option>` +
        lessons.map(l => `<option value="${l.id}" ${l.id === selectedId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`).join('');
}

// ════════════ LESSONS ════════════
function renderLessons() {
    const list = document.getElementById('lessons-list');
    if (lessons.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding:36px 24px;"><h3>No lessons yet</h3><p>Click "Add Lesson" to create the first one.</p></div>`;
        return;
    }
    list.innerHTML = `<div class="list-rows">${lessons.map((l, i) => `
        <div class="list-row">
            <div class="lr-index">${i + 1}</div>
            <div class="lr-body">
                <div class="lr-title">${escapeHtml(l.title)}</div>
                ${l.description ? `<div class="lr-sub">${escapeHtml(l.description)}</div>` : ''}
            </div>
            <div class="lr-actions">
                ${visToggleHtml('toggleLessonVis', l.id, l.is_visible)}
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', 1)" ${i === lessons.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" onclick="openLessonForm('${l.id}')">Edit details</button>
                <button class="btn btn-danger btn-sm" onclick="deleteLesson('${l.id}')">Delete</button>
            </div>
        </div>`).join('')}</div>`;
}

function openLessonForm(id = null) {
    document.getElementById('lesson-alert').style.display = 'none';
    if (id) {
        const l = lessons.find(x => x.id === id);
        if (!l) return;
        document.getElementById('lesson-modal-title').textContent = 'Edit Lesson Details';
        document.getElementById('lesson-id').value = l.id;
        document.getElementById('lesson-title').value = l.title || '';
        document.getElementById('lesson-desc').value = l.description || '';
    } else {
        document.getElementById('lesson-modal-title').textContent = 'Add Lesson';
        document.getElementById('lesson-id').value = '';
        document.getElementById('lesson-title').value = '';
        document.getElementById('lesson-desc').value = '';
    }
    openModal('lesson-modal');
}

async function saveLesson(e) {
    e.preventDefault();
    const btn = document.getElementById('lesson-save-btn');
    const alert = document.getElementById('lesson-alert');
    alert.style.display = 'none';

    const id = document.getElementById('lesson-id').value;
    const title = document.getElementById('lesson-title').value.trim();
    if (!title) { showModalAlert(alert, 'Lesson title is required.', 'error'); return; }

    const payload = {
        title,
        description: document.getElementById('lesson-desc').value.trim() || null
    };
    if (!ensureSafe(alert, [['Lesson Title', payload.title], ['Description', payload.description]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('lessons').update(payload).eq('id', id);
        } else {
            const nextOrder = lessons.length ? Math.max(...lessons.map(l => l.order_index || 0)) + 1 : 1;
            res = await db.from('lessons').insert({ ...payload, room_id: ROOM_ID, order_index: nextOrder });
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('lesson-modal');
        await loadAll();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Lesson';
    }
}

async function deleteLesson(id) {
    const l = lessons.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete lesson?',
        message: `"${l ? l.title : ''}" will be removed, along with any recordings, materials and quizzes attached to it. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;

    // Remove this lesson's material files from storage before the row cascade,
    // otherwise the files would be orphaned in the bucket.
    const { data: mats, error: matErr } = await db.from('materials').select('storage_path').eq('lesson_id', id);
    if (matErr) { alert(`Could not check lesson files: ${matErr.message}`); return; }
    if (mats && mats.length) {
        const { error: rmErr } = await db.storage.from(MATERIALS_BUCKET).remove(mats.map(m => m.storage_path));
        if (rmErr) { alert(`Could not remove lesson files: ${rmErr.message}. Lesson not deleted.`); return; }
    }

    const { error } = await db.from('lessons').delete().eq('id', id);
    if (error) { alert(`Failed to delete lesson: ${error.message}`); return; }
    await loadAll();
}

async function moveLesson(id, direction) {
    const idx = lessons.findIndex(l => l.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= lessons.length) return;
    const a = lessons[idx], b = lessons[target];
    const [r1, r2] = await Promise.all([
        db.from('lessons').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('lessons').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) { alert(`Failed to reorder: ${(r1.error || r2.error).message}`); return; }
    await loadAll();
}

// ════════════ RECORDINGS & LECTURES (shared) ════════════
function renderRecordings(kind) {
    const tbody = document.getElementById(`${kind}-tbody`);
    const list = recordings.filter(r => r.kind === kind);
    const colspan = 7;
    if (list.length === 0) {
        const label = kind === 'zoom' ? 'recordings' : 'video lectures';
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="loader">No ${label} yet.</td></tr>`;
        return;
    }
    const reorder = kind === 'lecture';   // lectures are manually orderable; zoom is by date
    tbody.innerHTML = list.map((r, i) => `
        <tr>
            <td><strong>${escapeHtml(r.title)}</strong></td>
            <td>${escapeHtml(lessonTitle(r.lesson_id))}</td>
            <td>${escapeHtml(r.professor)}</td>
            <td>${formatDate(r.recorded_date)}</td>
            <td>${formatDuration(r.duration_seconds)}</td>
            <td>${visToggleHtml('toggleRecVis', r.id, r.is_visible)}</td>
            <td class="row-actions">
                ${reorder ? `<button class="btn btn-ghost btn-sm" onclick="moveRecording('${r.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" onclick="moveRecording('${r.id}', 1)" ${i === list.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>` : ''}
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(r.aws_url)}" target="_blank" rel="noopener">Preview</a>
                <button class="btn btn-ghost btn-sm" onclick="openRecModal('${kind}', '${r.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecording('${r.id}')">Delete</button>
            </td>
        </tr>`).join('');
}

async function moveRecording(id, direction) {
    const list = recordings.filter(r => r.kind === 'lecture');
    const idx = list.findIndex(r => r.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const a = list[idx], b = list[target];
    const [r1, r2] = await Promise.all([
        db.from('recordings').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('recordings').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) { alert(`Failed to reorder: ${(r1.error || r2.error).message}`); return; }
    await loadAll();
}

function openRecModal(kind, id = null) {
    const alert = document.getElementById('rec-alert');
    alert.style.display = 'none';
    document.getElementById('rec-kind').value = kind;
    const isLecture = kind === 'lecture';

    document.getElementById('rec-prof-label').textContent = isLecture ? 'Lecturer' : 'Professor';
    document.getElementById('rec-lesson').innerHTML = lessonOptions();

    if (id) {
        const r = recordings.find(x => x.id === id);
        if (!r) return;
        document.getElementById('rec-modal-title').textContent = isLecture ? 'Edit Video Lecture' : 'Edit Recording';
        document.getElementById('rec-id').value = r.id;
        document.getElementById('rec-title').value = r.title || '';
        document.getElementById('rec-lesson').innerHTML = lessonOptions(r.lesson_id || '');
        document.getElementById('rec-professor').value = r.professor || '';
        document.getElementById('rec-date').value = r.recorded_date || '';
        document.getElementById('rec-url').value = r.aws_url || '';
        document.getElementById('rec-duration').value = r.duration_seconds ? Math.round(r.duration_seconds / 60) : '';
    } else {
        document.getElementById('rec-modal-title').textContent = isLecture ? 'Add Video Lecture' : 'Add Recording';
        document.getElementById('rec-id').value = '';
        document.getElementById('rec-title').value = '';
        document.getElementById('rec-professor').value = '';
        document.getElementById('rec-date').value = '';
        document.getElementById('rec-url').value = '';
        document.getElementById('rec-duration').value = '';
    }
    openModal('rec-modal');
}

async function saveRecording(e) {
    e.preventDefault();
    const btn = document.getElementById('rec-save-btn');
    const alert = document.getElementById('rec-alert');
    alert.style.display = 'none';

    const id = document.getElementById('rec-id').value;
    const kind = document.getElementById('rec-kind').value;
    const durationMin = document.getElementById('rec-duration').value;

    const payload = {
        room_id: ROOM_ID,
        kind,
        lesson_id: document.getElementById('rec-lesson').value || null,
        title: document.getElementById('rec-title').value.trim(),
        professor: document.getElementById('rec-professor').value.trim(),
        recorded_date: document.getElementById('rec-date').value,
        aws_url: document.getElementById('rec-url').value.trim(),
        duration_seconds: durationMin ? parseInt(durationMin, 10) * 60 : null
    };

    if (!payload.title || !payload.professor || !payload.recorded_date || !payload.aws_url) {
        showModalAlert(alert, 'Please fill in all required fields.', 'error');
        return;
    }
    if (!ensureSafe(alert, [['Title', payload.title], ['Lecturer', payload.professor], ['Video URL', payload.aws_url]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('recordings').update(payload).eq('id', id);
        } else {
            const lectures = recordings.filter(r => r.kind === 'lecture');
            payload.order_index = lectures.length ? Math.max(...lectures.map(r => r.order_index || 0)) + 1 : 1;
            res = await db.from('recordings').insert(payload);
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('rec-modal');
        await loadAll();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save';
    }
}

async function deleteRecording(id) {
    const r = recordings.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete this video?',
        message: `"${r ? r.title : ''}" will be removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('recordings').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    await loadAll();
}

// ════════════ MATERIALS ════════════
function materialRowHtml(m, i, n) {
    return `
        <tr>
            <td><strong>${escapeHtml(m.title)}</strong>${m.external_url ? ' <span title="External link">🔗</span>' : ''}</td>
            <td><span class="badge badge-blue">${escapeHtml((m.type || 'file').toUpperCase())}</span></td>
            <td>${escapeHtml(lessonTitle(m.lesson_id))}</td>
            <td>${formatDate(m.created_at)}</td>
            <td>${visToggleHtml('toggleMaterialVis', m.id, m.is_visible)}</td>
            <td class="row-actions">
                <button class="btn btn-ghost btn-sm" onclick="moveMaterial('${m.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" onclick="moveMaterial('${m.id}', 1)" ${i === n - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" onclick="previewMaterial('${m.id}', this)">Preview</button>
                <button class="btn btn-ghost btn-sm" onclick="openMaterialEdit('${m.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteMaterial('${m.id}')">Delete</button>
            </td>
        </tr>`;
}

function renderMaterials() {
    const tbody = document.getElementById('materials-tbody');
    const list = materials.filter(m => matCategory(m) === 'material');
    tbody.innerHTML = list.length
        ? list.map((m, i) => materialRowHtml(m, i, list.length)).join('')
        : `<tr><td colspan="6" class="loader">No materials yet.</td></tr>`;
}

function renderNotes() {
    const tbody = document.getElementById('notes-tbody');
    const list = materials.filter(m => matCategory(m) === 'note');
    tbody.innerHTML = list.length
        ? list.map((m, i) => materialRowHtml(m, i, list.length)).join('')
        : `<tr><td colspan="6" class="loader">No notes yet.</td></tr>`;
}

async function moveMaterial(id, direction) {
    const m = materials.find(x => x.id === id);
    if (!m) return;
    const cat = matCategory(m);
    const list = materials.filter(x => matCategory(x) === cat);
    const idx = list.findIndex(x => x.id === id);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= list.length) return;
    const a = list[idx], b = list[target];
    const [r1, r2] = await Promise.all([
        db.from('materials').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('materials').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) { alert(`Failed to reorder: ${(r1.error || r2.error).message}`); return; }
    await loadAll();
}

// Next order_index for a new material within this room+category (so it lands at the bottom).
function nextMaterialOrder(category) {
    const list = materials.filter(m => matCategory(m) === (category === 'note' ? 'note' : 'material'));
    return list.length ? Math.max(...list.map(m => m.order_index || 0)) + 1 : 1;
}

function openUploadModal(category = 'material') {
    pickedFile = null;
    document.getElementById('upload-category').value = category;
    document.getElementById('upload-modal-title').textContent = category === 'note' ? 'Add Note' : 'Upload Material';
    document.getElementById('upload-allowed-hint').textContent = ALLOWED_HINT[category];
    const fileInput = document.getElementById('material-file');
    fileInput.setAttribute('accept', ACCEPT_ATTR[category]);
    fileInput.value = '';
    document.getElementById('upload-alert').style.display = 'none';
    document.getElementById('upload-zone-text').textContent = 'Click to choose a file';
    document.getElementById('material-title').value = '';
    document.getElementById('material-url').value = '';
    document.getElementById('material-lesson').innerHTML = lessonOptions();
    setUploadSource('file');
    openModal('upload-modal');
}

// Toggle the Upload Material modal between a file upload and an external AWS link.
function setUploadSource(src) {
    const isLink = src === 'link';
    document.getElementById('upload-source').value = isLink ? 'link' : 'file';
    document.getElementById('src-file').style.display = isLink ? 'none' : '';
    document.getElementById('src-link').style.display = isLink ? '' : 'none';
    document.getElementById('src-btn-file').className = `btn btn-sm ${isLink ? 'btn-ghost' : 'btn-primary'}`;
    document.getElementById('src-btn-link').className = `btn btn-sm ${isLink ? 'btn-primary' : 'btn-ghost'}`;
    document.getElementById('upload-btn').textContent = isLink ? 'Save Link' : 'Upload';
}

function isHttpUrl(u) {
    try { const x = new URL(u); return x.protocol === 'http:' || x.protocol === 'https:'; }
    catch (e) { return false; }
}

function onFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    pickedFile = file;
    document.getElementById('upload-zone-text').textContent = file.name;
    const titleField = document.getElementById('material-title');
    if (!titleField.value.trim()) titleField.value = file.name.replace(/\.[^.]+$/, '');
}

async function saveUpload(e) {
    e.preventDefault();
    const btn = document.getElementById('upload-btn');
    const alert = document.getElementById('upload-alert');
    alert.style.display = 'none';

    const category = document.getElementById('upload-category').value || 'material';
    const title = document.getElementById('material-title').value.trim();
    const lesson_id = document.getElementById('material-lesson').value || null;
    const source = document.getElementById('upload-source').value || 'file';

    // ── AWS link path (no file upload) ──
    if (source === 'link') {
        const url = document.getElementById('material-url').value.trim();
        if (!title) { showModalAlert(alert, 'Please enter a title.', 'error'); return; }
        if (!isHttpUrl(url)) { showModalAlert(alert, 'Please paste a valid link starting with https://', 'error'); return; }
        if (!ensureSafe(alert, [['Title', title], ['Link', url]])) return;
        const extMatch = url.split(/[?#]/)[0].match(/\.([a-z0-9]{2,5})$/i);
        const linkType = extMatch ? extMatch[1].toLowerCase() : 'link';
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            const ins = await db.from('materials').insert({
                room_id: ROOM_ID, lesson_id, title, type: linkType, storage_path: null, external_url: url, category,
                order_index: nextMaterialOrder(category)
            });
            if (ins.error) throw new Error(`Saving record failed: ${ins.error.message}`);
            closeModal('upload-modal');
            await loadAll();
        } catch (err) {
            showModalAlert(alert, err.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = 'Save Link';
        }
        return;
    }

    if (!pickedFile) { showModalAlert(alert, 'Please choose a file to upload.', 'error'); return; }
    if (!title) { showModalAlert(alert, 'Please enter a title.', 'error'); return; }
    if (pickedFile.size > MAX_FILE_BYTES) {
        showModalAlert(alert, `File is too large (${(pickedFile.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`, 'error');
        return;
    }

    // Reject anything outside the whitelist (e.g. .exe, .zip, .js, .html).
    const ext = fileExt(pickedFile.name);
    const allowed = ALLOWED_EXT[category] || ALLOWED_EXT.material;
    if (!allowed.includes(ext)) {
        showModalAlert(alert, `Invalid file type ".${ext}". Allowed types: ${allowed.join(', ').toUpperCase()}.`, 'error');
        return;
    }
    if (!ensureSafe(alert, [['Title', title]])) return;

    const path = `${ROOM_ID}/${Date.now()}-${sanitizeName(pickedFile.name)}`;

    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
        const up = await db.storage.from(MATERIALS_BUCKET).upload(path, pickedFile, {
            contentType: pickedFile.type || undefined, upsert: false
        });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

        const ins = await db.from('materials').insert({
            room_id: ROOM_ID, lesson_id, title, type: ext, storage_path: path, category,
            order_index: nextMaterialOrder(category)
        });
        if (ins.error) {
            await db.storage.from(MATERIALS_BUCKET).remove([path]);
            throw new Error(`Saving record failed: ${ins.error.message}`);
        }
        closeModal('upload-modal');
        await loadAll();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Upload';
    }
}

function previewMaterial(id, btnEl) {
    const m = materials.find(x => x.id === id);
    if (!m) return;

    // External AWS links open directly — no signed URL needed.
    if (m.external_url) { window.open(m.external_url, '_blank', 'noopener'); return; }

    // Open the tab synchronously (inside the click) so the browser does not
    // block it as a popup. We redirect it once the signed URL is ready.
    const win = window.open('', '_blank');
    if (win) {
        win.document.write('<!DOCTYPE html><title>Loading…</title><body style="font-family:sans-serif;padding:40px;color:#334">Loading material…</body>');
    }

    const original = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = 'Opening…';

    apiRequest('POST', '/materials/signed-url', { storage_path: m.storage_path })
        .then(res => {
            if (win) win.location.href = res.signed_url;
            else window.open(res.signed_url, '_blank', 'noopener'); // popup was blocked; try anyway
        })
        .catch(err => {
            if (win) win.close();
            alert(`Could not open file: ${err.message}`);
        })
        .finally(() => {
            btnEl.disabled = false; btnEl.textContent = original;
        });
}

function openMaterialEdit(id) {
    const m = materials.find(x => x.id === id);
    if (!m) return;
    document.getElementById('medit-alert').style.display = 'none';
    document.getElementById('medit-id').value = m.id;
    document.getElementById('medit-title').value = m.title || '';
    document.getElementById('medit-lesson').innerHTML = lessonOptions(m.lesson_id || '');
    openModal('medit-modal');
}

async function saveMaterialEdit(e) {
    e.preventDefault();
    const btn = document.getElementById('medit-save-btn');
    const alert = document.getElementById('medit-alert');
    alert.style.display = 'none';

    const id = document.getElementById('medit-id').value;
    const payload = {
        title: document.getElementById('medit-title').value.trim(),
        lesson_id: document.getElementById('medit-lesson').value || null
    };
    if (!payload.title) { showModalAlert(alert, 'Title is required.', 'error'); return; }
    if (!ensureSafe(alert, [['Title', payload.title]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const res = await db.from('materials').update(payload).eq('id', id);
        if (res.error) throw new Error(res.error.message);
        closeModal('medit-modal');
        await loadAll();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Changes';
    }
}

async function deleteMaterial(id) {
    const m = materials.find(x => x.id === id);
    if (!m) return;
    const ok = await confirmDialog({
        title: 'Delete material?',
        message: m.external_url
            ? `"${m.title}" (external link) will be permanently removed. The original file is not affected. This cannot be undone.`
            : `"${m.title}" and its file will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    // Link-only materials have no stored file to remove.
    if (m.storage_path) {
        const rm = await db.storage.from(MATERIALS_BUCKET).remove([m.storage_path]);
        if (rm.error) { alert(`Failed to remove file: ${rm.error.message}`); return; }
    }
    const del = await db.from('materials').delete().eq('id', id);
    if (del.error) { alert(`File removed but record delete failed: ${del.error.message}`); return; }
    await loadAll();
}

// ════════════ QUIZZES ════════════
function renderQuizzes() {
    const list = document.getElementById('quizzes-list');
    if (!list) return;
    if (lessons.length === 0) {
        list.innerHTML = `<div class="empty-state" style="padding:36px 24px;"><h3>No lessons yet</h3><p>Add a lesson first — a quiz attaches to a lesson.</p></div>`;
        return;
    }
    list.innerHTML = `<div class="list-rows">${lessons.map(l => {
        const quiz = quizzes.find(q => q.lesson_id === l.id);
        const count = quiz ? (quizQuestionCounts[quiz.id] || 0) : 0;
        let statusHtml, actionsHtml;
        if (!quiz) {
            statusHtml = `<span class="quiz-status none">No quiz</span>`;
            actionsHtml = `<button class="btn btn-primary btn-sm" onclick="createQuizForLesson('${l.id}')">Create Quiz</button>`;
        } else {
            const ready = count === REQUIRED_QUESTIONS;
            statusHtml = ready
                ? `<span class="quiz-status ready">✓ ${count}/${REQUIRED_QUESTIONS} questions — ready</span>`
                : `<span class="quiz-status partial">${count}/${REQUIRED_QUESTIONS} questions — incomplete</span>`;
            actionsHtml = `
                ${visToggleHtml('toggleQuizVis', quiz.id, quiz.is_visible)}
                <button class="btn btn-primary btn-sm" onclick="openQuizBuilder('${quiz.id}')">Manage Quiz</button>
                <button class="btn btn-danger btn-sm" onclick="deleteQuiz('${quiz.id}')">Delete</button>`;
        }
        return `
            <div class="list-row">
                <div class="lr-body">
                    <div class="lr-title">${escapeHtml(l.title)}</div>
                    <div class="lr-sub">${statusHtml}</div>
                </div>
                <div class="lr-actions">${actionsHtml}</div>
            </div>`;
    }).join('')}</div>`;
}

async function createQuizForLesson(lessonId) {
    const { data, error } = await db.from('quizzes')
        .insert({ lesson_id: lessonId })
        .select('id, lesson_id, time_limit_minutes, cooldown_minutes')
        .single();
    if (error) { alert(`Could not create quiz: ${error.message}`); return; }
    quizzes.push(data);
    quizQuestionCounts[data.id] = 0;
    renderQuizzes();
    updateCounts();
    openQuizBuilder(data.id);
}

async function openQuizBuilder(quizId) {
    currentQuiz = quizzes.find(q => q.id === quizId);
    if (!currentQuiz) return;
    const lesson = lessons.find(l => l.id === currentQuiz.lesson_id);
    document.getElementById('quiz-modal-title').textContent = `Quiz — ${lesson ? lesson.title : ''}`;
    document.getElementById('quiz-time').value = currentQuiz.time_limit_minutes ?? 60;
    document.getElementById('quiz-cooldown').value = currentQuiz.cooldown_minutes ?? 5;
    document.getElementById('quiz-alert').style.display = 'none';
    document.getElementById('quiz-questions-list').innerHTML = `<div class="loader">Loading…</div>`;
    openModal('quiz-modal');
    await refreshQuizQuestions();
}

async function refreshQuizQuestions() {
    const { data, error } = await db.from('quiz_questions')
        .select('id, question_text, options_json, correct_answer_index, order_index')
        .eq('quiz_id', currentQuiz.id)
        .order('order_index', { ascending: true });
    const el = document.getElementById('quiz-questions-list');
    if (error) {
        el.innerHTML = `<div class="loader" style="color:var(--red)">Error: ${escapeHtml(error.message)}</div>`;
        return;
    }
    currentQuizQuestions = data || [];
    quizQuestionCounts[currentQuiz.id] = currentQuizQuestions.length;
    renderQuizQuestions();
    updateQuizCountLabel();
    renderQuizzes(); // keep lesson-list status in sync
    updateCounts();
}

function renderQuizQuestions() {
    const el = document.getElementById('quiz-questions-list');
    if (currentQuizQuestions.length === 0) {
        el.innerHTML = `<div class="empty-state" style="padding:30px 20px;"><p>No questions yet. Click "Add Question".</p></div>`;
    } else {
        el.innerHTML = `<div class="list-rows">${currentQuizQuestions.map((q, i) => {
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
                        <button class="btn btn-ghost btn-sm" onclick="moveQuestion('${q.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                        <button class="btn btn-ghost btn-sm" onclick="moveQuestion('${q.id}', 1)" ${i === currentQuizQuestions.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>
                        <button class="btn btn-ghost btn-sm" onclick="openQuestionForm('${q.id}')">Edit</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q.id}')">Delete</button>
                    </div>
                </div>`;
        }).join('')}</div>`;
    }
    const addBtn = document.getElementById('add-question-btn');
    if (currentQuizQuestions.length >= REQUIRED_QUESTIONS) {
        addBtn.disabled = true; addBtn.style.opacity = '0.5'; addBtn.style.cursor = 'default';
        addBtn.textContent = '10 questions reached';
    } else {
        addBtn.disabled = false; addBtn.style.opacity = ''; addBtn.style.cursor = '';
        addBtn.textContent = '+ Add Question';
    }
}

function updateQuizCountLabel() {
    const c = currentQuizQuestions.length;
    const el = document.getElementById('quiz-qcount');
    el.textContent = `${c} / ${REQUIRED_QUESTIONS}`;
    el.style.color = c === REQUIRED_QUESTIONS ? 'var(--green)' : (c > REQUIRED_QUESTIONS ? 'var(--red)' : 'var(--text-muted)');
}

async function saveQuizSettings() {
    const alert = document.getElementById('quiz-alert');
    alert.style.display = 'none';
    const time = parseInt(document.getElementById('quiz-time').value, 10);
    const cd = parseInt(document.getElementById('quiz-cooldown').value, 10);
    if (!time || time < 1) { showModalAlert(alert, 'Time limit must be at least 1 minute.', 'error'); return; }
    const payload = { time_limit_minutes: time, cooldown_minutes: isNaN(cd) ? 0 : cd };
    const res = await db.from('quizzes').update(payload).eq('id', currentQuiz.id);
    if (res.error) { showModalAlert(alert, res.error.message, 'error'); return; }
    Object.assign(currentQuiz, payload);
    const q = quizzes.find(x => x.id === currentQuiz.id);
    if (q) Object.assign(q, payload);
    showModalAlert(alert, 'Settings saved.', 'success');
}

async function deleteQuiz(quizId) {
    const quiz = quizzes.find(q => q.id === quizId);
    const lesson = quiz ? lessons.find(l => l.id === quiz.lesson_id) : null;
    const ok = await confirmDialog({
        title: 'Delete quiz?',
        message: `The quiz for "${lesson ? lesson.title : 'this lesson'}" and all its questions will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete Quiz',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('quizzes').delete().eq('id', quizId);
    if (error) { alert(`Failed to delete quiz: ${error.message}`); return; }
    await loadAll();
}

// ── QUESTION EDITOR ──
function openQuestionForm(id = null) {
    document.getElementById('question-alert').style.display = 'none';
    const optionsList = document.getElementById('options-list');
    optionsList.innerHTML = '';

    if (id) {
        const q = currentQuizQuestions.find(x => x.id === id);
        if (!q) return;
        document.getElementById('question-modal-title').textContent = 'Edit Question';
        document.getElementById('question-id').value = q.id;
        document.getElementById('question-text').value = q.question_text || '';
        const opts = Array.isArray(q.options_json) ? q.options_json : [];
        if (opts.length) opts.forEach((opt, i) => addOptionRow(opt, i === q.correct_answer_index));
        else { addOptionRow(); addOptionRow(); }
    } else {
        if (currentQuizQuestions.length >= REQUIRED_QUESTIONS) return;
        document.getElementById('question-modal-title').textContent = 'Add Question';
        document.getElementById('question-id').value = '';
        document.getElementById('question-text').value = '';
        addOptionRow(); addOptionRow(); addOptionRow(); addOptionRow(); // 4 blank options
    }
    openModal('question-modal');
}

function addOptionRow(value = '', checked = false) {
    const list = document.getElementById('options-list');
    if (list.querySelectorAll('.option-row').length >= 6) return; // max 6
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
    if (list.querySelectorAll('.option-row').length <= 2) return; // keep at least 2
    btn.closest('.option-row').remove();
}

async function saveQuestion(e) {
    e.preventDefault();
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
    if (options.some(o => !o)) { showModalAlert(alert, 'Please fill in every option, or remove the empty ones.', 'error'); return; }
    if (correctIdx < 0) { showModalAlert(alert, 'Please mark which option is the correct answer.', 'error'); return; }
    if (!ensureSafe(alert, [['Question', text], ...options.map((o, i) => [`Option ${i + 1}`, o])])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('quiz_questions').update({
                question_text: text, options_json: options, correct_answer_index: correctIdx
            }).eq('id', id);
        } else {
            const nextOrder = currentQuizQuestions.length ? Math.max(...currentQuizQuestions.map(q => q.order_index || 0)) + 1 : 1;
            res = await db.from('quiz_questions').insert({
                quiz_id: currentQuiz.id, question_text: text, options_json: options,
                correct_answer_index: correctIdx, order_index: nextOrder
            });
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('question-modal');
        await refreshQuizQuestions();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Question';
    }
}

async function deleteQuestion(id) {
    const ok = await confirmDialog({
        title: 'Delete question?',
        message: 'This question will be removed from the quiz. This cannot be undone.',
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('quiz_questions').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    await refreshQuizQuestions();
}

async function moveQuestion(id, dir) {
    const idx = currentQuizQuestions.findIndex(q => q.id === id);
    const t = idx + dir;
    if (idx < 0 || t < 0 || t >= currentQuizQuestions.length) return;
    const a = currentQuizQuestions[idx], b = currentQuizQuestions[t];
    const [r1, r2] = await Promise.all([
        db.from('quiz_questions').update({ order_index: b.order_index }).eq('id', a.id),
        db.from('quiz_questions').update({ order_index: a.order_index }).eq('id', b.id)
    ]);
    if (r1.error || r2.error) { alert(`Failed to reorder: ${(r1.error || r2.error).message}`); return; }
    await refreshQuizQuestions();
}
