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

// ── INIT ──
async function initRoom(roomId, profile) {
    ROOM_ID = roomId;

    const { data, error } = await db.from('rooms').select('id, name, description').eq('id', roomId).single();
    if (error || !data) {
        renderLayout('rooms', 'Subject', '', profile);
        document.getElementById('page-content').innerHTML =
            `<div class="empty-state"><h3>Subject not found</h3><p>It may have been deleted. <a href="rooms.html">Back to all subjects</a>.</p></div>`;
        return;
    }
    currentRoom = data;

    renderLayout('rooms', escapeHtml(data.name), 'Manage this subject\'s content', profile);

    document.getElementById('page-content').innerHTML = `
        <a class="back-link" href="rooms.html">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            All Subjects
        </a>
        <div class="tabs">
            <button class="tab active" data-tab="lessons" onclick="switchTab('lessons')">Lessons <span class="count-pill" id="count-lessons">0</span></button>
            <button class="tab" data-tab="zoom" onclick="switchTab('zoom')">Zoom Recordings <span class="count-pill" id="count-zoom">0</span></button>
            <button class="tab" data-tab="lecture" onclick="switchTab('lecture')">Video Lectures <span class="count-pill" id="count-lecture">0</span></button>
            <button class="tab" data-tab="materials" onclick="switchTab('materials')">Materials <span class="count-pill" id="count-materials">0</span></button>
            <button class="tab" data-tab="notes" onclick="switchTab('notes')">Additional Notes <span class="count-pill" id="count-notes">0</span></button>
            <button class="tab" data-tab="anki" onclick="switchTab('anki')">Anki Cards</button>
            <button class="tab" data-tab="quizzes" onclick="switchTab('quizzes')">Quizzes</button>
        </div>

        <div class="tab-panel active" id="panel-lessons">
            <div class="subtoolbar">
                <div class="st-title">Lessons</div>
                <button class="btn btn-primary btn-sm" onclick="openLessonForm()">+ Add Lesson</button>
            </div>
            <div id="lessons-list"><div class="loader">Loading…</div></div>
        </div>

        <div class="tab-panel" id="panel-zoom">
            <div class="subtoolbar">
                <div class="st-title">Zoom Recordings</div>
                <button class="btn btn-primary btn-sm" onclick="openRecModal('zoom')">+ Add Recording</button>
            </div>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Lesson</th><th>Professor</th><th>Date</th><th>Duration</th><th>Actions</th></tr></thead>
                <tbody id="zoom-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-lecture">
            <div class="subtoolbar">
                <div class="st-title">Video Lectures</div>
                <button class="btn btn-primary btn-sm" onclick="openRecModal('lecture')">+ Add Video Lecture</button>
            </div>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Lesson</th><th>Lecturer</th><th>Date</th><th>Duration</th><th>Actions</th></tr></thead>
                <tbody id="lecture-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-materials">
            <div class="subtoolbar">
                <div class="st-title">Study Materials</div>
                <button class="btn btn-primary btn-sm" onclick="openUploadModal()">+ Upload Material</button>
            </div>
            <div class="panel"><table class="data-table">
                <thead><tr><th>Title</th><th>Type</th><th>Lesson</th><th>Uploaded</th><th>Actions</th></tr></thead>
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
                <thead><tr><th>Title</th><th>Type</th><th>Lesson</th><th>Uploaded</th><th>Actions</th></tr></thead>
                <tbody id="notes-tbody"></tbody>
            </table></div>
        </div>

        <div class="tab-panel" id="panel-anki">
            <div class="empty-state"><h3>Anki Cards — coming soon</h3><p>Anki flashcard decks will live here once the format is decided.</p></div>
        </div>

        <div class="tab-panel" id="panel-quizzes">
            <div class="empty-state"><h3>Quizzes — coming soon</h3><p>The quiz builder will live here.</p></div>
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
        db.from('lessons').select('id, title, description, image_url, order_index').eq('room_id', ROOM_ID).order('order_index', { ascending: true }),
        db.from('recordings').select('id, lesson_id, title, professor, recorded_date, aws_url, duration_seconds, kind').eq('room_id', ROOM_ID).order('recorded_date', { ascending: false }),
        db.from('materials').select('id, lesson_id, title, type, storage_path, created_at, category').eq('room_id', ROOM_ID).order('created_at', { ascending: false })
    ]);

    lessons = lRes.data || [];
    recordings = rRes.data || [];
    materials = mRes.data || [];

    renderLessons();
    renderRecordings('zoom');
    renderRecordings('lecture');
    renderMaterials();
    renderNotes();
    updateCounts();
}

// Treat any row without an explicit category as a 'material' (older rows).
function matCategory(m) { return m.category === 'note' ? 'note' : 'material'; }

function updateCounts() {
    document.getElementById('count-lessons').textContent = lessons.length;
    document.getElementById('count-zoom').textContent = recordings.filter(r => r.kind === 'zoom').length;
    document.getElementById('count-lecture').textContent = recordings.filter(r => r.kind === 'lecture').length;
    document.getElementById('count-materials').textContent = materials.filter(m => matCategory(m) === 'material').length;
    document.getElementById('count-notes').textContent = materials.filter(m => matCategory(m) === 'note').length;
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
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', -1)" ${i === 0 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move up">↑</button>
                <button class="btn btn-ghost btn-sm" onclick="moveLesson('${l.id}', 1)" ${i === lessons.length - 1 ? 'disabled style="opacity:.4;cursor:default;"' : ''} title="Move down">↓</button>
                <button class="btn btn-ghost btn-sm" onclick="openLessonForm('${l.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteLesson('${l.id}')">Delete</button>
            </div>
        </div>`).join('')}</div>`;
}

function openLessonForm(id = null) {
    document.getElementById('lesson-alert').style.display = 'none';
    if (id) {
        const l = lessons.find(x => x.id === id);
        if (!l) return;
        document.getElementById('lesson-modal-title').textContent = 'Edit Lesson';
        document.getElementById('lesson-id').value = l.id;
        document.getElementById('lesson-title').value = l.title || '';
        document.getElementById('lesson-desc').value = l.description || '';
        document.getElementById('lesson-image').value = l.image_url || '';
    } else {
        document.getElementById('lesson-modal-title').textContent = 'Add Lesson';
        document.getElementById('lesson-id').value = '';
        document.getElementById('lesson-title').value = '';
        document.getElementById('lesson-desc').value = '';
        document.getElementById('lesson-image').value = '';
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
        description: document.getElementById('lesson-desc').value.trim() || null,
        image_url: document.getElementById('lesson-image').value.trim() || null
    };

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
    const colspan = 6;
    if (list.length === 0) {
        const label = kind === 'zoom' ? 'recordings' : 'video lectures';
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="loader">No ${label} yet.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(r => `
        <tr>
            <td><strong>${escapeHtml(r.title)}</strong></td>
            <td>${escapeHtml(lessonTitle(r.lesson_id))}</td>
            <td>${escapeHtml(r.professor)}</td>
            <td>${formatDate(r.recorded_date)}</td>
            <td>${formatDuration(r.duration_seconds)}</td>
            <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(r.aws_url)}" target="_blank" rel="noopener">Preview</a>
                <button class="btn btn-ghost btn-sm" onclick="openRecModal('${kind}', '${r.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecording('${r.id}')">Delete</button>
            </td>
        </tr>`).join('');
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

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('recordings').update(payload).eq('id', id);
        } else {
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
function materialRowHtml(m) {
    return `
        <tr>
            <td><strong>${escapeHtml(m.title)}</strong></td>
            <td><span class="badge badge-blue">${escapeHtml((m.type || 'file').toUpperCase())}</span></td>
            <td>${escapeHtml(lessonTitle(m.lesson_id))}</td>
            <td>${formatDate(m.created_at)}</td>
            <td class="row-actions">
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
        ? list.map(materialRowHtml).join('')
        : `<tr><td colspan="5" class="loader">No materials yet.</td></tr>`;
}

function renderNotes() {
    const tbody = document.getElementById('notes-tbody');
    const list = materials.filter(m => matCategory(m) === 'note');
    tbody.innerHTML = list.length
        ? list.map(materialRowHtml).join('')
        : `<tr><td colspan="5" class="loader">No notes yet.</td></tr>`;
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
    document.getElementById('material-lesson').innerHTML = lessonOptions();
    openModal('upload-modal');
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

    const path = `${ROOM_ID}/${Date.now()}-${sanitizeName(pickedFile.name)}`;

    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
        const up = await db.storage.from(MATERIALS_BUCKET).upload(path, pickedFile, {
            contentType: pickedFile.type || undefined, upsert: false
        });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

        const ins = await db.from('materials').insert({
            room_id: ROOM_ID, lesson_id, title, type: ext, storage_path: path, category
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
        message: `"${m.title}" and its file will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const rm = await db.storage.from(MATERIALS_BUCKET).remove([m.storage_path]);
    if (rm.error) { alert(`Failed to remove file: ${rm.error.message}`); return; }
    const del = await db.from('materials').delete().eq('id', id);
    if (del.error) { alert(`File removed but record delete failed: ${del.error.message}`); return; }
    await loadAll();
}
