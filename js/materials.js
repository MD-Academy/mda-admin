// Study Materials management — direct upload to the private 'materials' bucket.

const MATERIALS_BUCKET = 'materials';
const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

let allMaterials = [];
let matRooms = [];
let matLessons = [];
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
function roomName(id) {
    const r = matRooms.find(x => x.id === id);
    return r ? r.name : '—';
}
function lessonTitle(id) {
    if (!id) return '—';
    const l = matLessons.find(x => x.id === id);
    return l ? l.title : '—';
}
function fileExt(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}
function sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

// ── LOAD ──
async function loadMaterials() {
    const tbody = document.getElementById('materials-tbody');
    tbody.innerHTML = `<tr><td colspan="6" class="loader">Loading materials…</td></tr>`;

    const [matRes, roomsRes, lessonsRes] = await Promise.all([
        db.from('materials').select('id, room_id, lesson_id, title, type, storage_path, created_at').order('created_at', { ascending: false }),
        db.from('rooms').select('id, name').order('order_index', { ascending: true }),
        db.from('lessons').select('id, room_id, title').order('order_index', { ascending: true })
    ]);

    if (matRes.error) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader" style="color:var(--red)">Error loading materials: ${escapeHtml(matRes.error.message)}</td></tr>`;
        return;
    }

    allMaterials = matRes.data || [];
    matRooms = roomsRes.data || [];
    matLessons = lessonsRes.data || [];

    const filter = document.getElementById('room-filter');
    if (filter && filter.options.length <= 1) {
        matRooms.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.id; opt.textContent = r.name;
            filter.appendChild(opt);
        });
    }

    applyMaterialFilters();
}

function applyMaterialFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    const roomId = document.getElementById('room-filter')?.value || '';
    let list = allMaterials;
    if (roomId) list = list.filter(m => m.room_id === roomId);
    if (q) list = list.filter(m => (m.title || '').toLowerCase().includes(q));
    renderMaterials(list);
}

function renderMaterials(list) {
    const tbody = document.getElementById('materials-tbody');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader">No materials found. Click "Upload Material" to add one.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(m => `
        <tr>
            <td><strong>${escapeHtml(m.title)}</strong></td>
            <td><span class="badge badge-blue">${escapeHtml((m.type || 'file').toUpperCase())}</span></td>
            <td>${escapeHtml(roomName(m.room_id))}</td>
            <td>${escapeHtml(lessonTitle(m.lesson_id))}</td>
            <td>${formatDate(m.created_at)}</td>
            <td class="row-actions">
                <button class="btn btn-ghost btn-sm" onclick="previewMaterial('${m.id}', this)">Preview</button>
                <button class="btn btn-ghost btn-sm" onclick="openMaterialEdit('${m.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteMaterial('${m.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// ── ROOM/LESSON SELECTS ──
function fillRoomSelect(selectEl, selectedRoomId = '') {
    selectEl.innerHTML = `<option value="" disabled ${selectedRoomId ? '' : 'selected'}>Select a room…</option>` +
        matRooms.map(r => `<option value="${r.id}" ${r.id === selectedRoomId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`).join('');
}
function fillLessonSelect(selectEl, roomId, selectedLessonId = '') {
    const lessons = matLessons.filter(l => l.room_id === roomId);
    selectEl.innerHTML = `<option value="">— None —</option>` +
        lessons.map(l => `<option value="${l.id}" ${l.id === selectedLessonId ? 'selected' : ''}>${escapeHtml(l.title)}</option>`).join('');
}
function onMaterialRoomChange() {
    fillLessonSelect(document.getElementById('material-lesson'), document.getElementById('material-room').value);
}
function onMeditRoomChange() {
    fillLessonSelect(document.getElementById('medit-lesson'), document.getElementById('medit-room').value);
}

// ── UPLOAD ──
function openUploadModal() {
    pickedFile = null;
    document.getElementById('upload-alert').style.display = 'none';
    document.getElementById('material-file').value = '';
    document.getElementById('upload-zone-text').textContent = 'Click to choose a file';
    document.getElementById('material-title').value = '';
    fillRoomSelect(document.getElementById('material-room'), '');
    fillLessonSelect(document.getElementById('material-lesson'), '');
    openModal('upload-modal');
}

function onFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    pickedFile = file;
    document.getElementById('upload-zone-text').textContent = file.name;
    // Auto-fill the title from the filename if the title is empty.
    const titleField = document.getElementById('material-title');
    if (!titleField.value.trim()) {
        titleField.value = file.name.replace(/\.[^.]+$/, '');
    }
}

async function saveUpload(e) {
    e.preventDefault();
    const btn = document.getElementById('upload-btn');
    const alert = document.getElementById('upload-alert');
    alert.style.display = 'none';

    const title = document.getElementById('material-title').value.trim();
    const room_id = document.getElementById('material-room').value;
    const lesson_id = document.getElementById('material-lesson').value || null;

    if (!pickedFile) { showModalAlert(alert, 'Please choose a file to upload.', 'error'); return; }
    if (!title) { showModalAlert(alert, 'Please enter a title.', 'error'); return; }
    if (!room_id) { showModalAlert(alert, 'Please select a room.', 'error'); return; }
    if (pickedFile.size > MAX_FILE_BYTES) {
        showModalAlert(alert, `File is too large (${(pickedFile.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`, 'error');
        return;
    }

    const ext = fileExt(pickedFile.name);
    const path = `${room_id}/${Date.now()}-${sanitizeName(pickedFile.name)}`;

    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
        // 1. Upload the file to the private bucket.
        const up = await db.storage.from(MATERIALS_BUCKET).upload(path, pickedFile, {
            contentType: pickedFile.type || undefined,
            upsert: false
        });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

        // 2. Save the metadata row.
        const ins = await db.from('materials').insert({
            room_id, lesson_id, title, type: ext, storage_path: path
        });
        if (ins.error) {
            // Roll back the uploaded file so we don't leave an orphan.
            await db.storage.from(MATERIALS_BUCKET).remove([path]);
            throw new Error(`Saving record failed: ${ins.error.message}`);
        }

        closeModal('upload-modal');
        loadMaterials();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Upload';
    }
}

// ── PREVIEW (signed URL via backend) ──
async function previewMaterial(id, btnEl) {
    const m = allMaterials.find(x => x.id === id);
    if (!m) return;
    const original = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = 'Opening…';
    try {
        const res = await apiRequest('POST', '/materials/signed-url', { storage_path: m.storage_path });
        window.open(res.signed_url, '_blank', 'noopener');
    } catch (err) {
        alert(`Could not open file: ${err.message}`);
    } finally {
        btnEl.disabled = false; btnEl.textContent = original;
    }
}

// ── EDIT METADATA ──
function openMaterialEdit(id) {
    const m = allMaterials.find(x => x.id === id);
    if (!m) return;
    document.getElementById('medit-alert').style.display = 'none';
    document.getElementById('medit-id').value = m.id;
    document.getElementById('medit-title').value = m.title || '';
    fillRoomSelect(document.getElementById('medit-room'), m.room_id);
    fillLessonSelect(document.getElementById('medit-lesson'), m.room_id, m.lesson_id || '');
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
        room_id: document.getElementById('medit-room').value,
        lesson_id: document.getElementById('medit-lesson').value || null
    };
    if (!payload.title || !payload.room_id) {
        showModalAlert(alert, 'Title and room are required.', 'error');
        return;
    }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const res = await db.from('materials').update(payload).eq('id', id);
        if (res.error) throw new Error(res.error.message);
        closeModal('medit-modal');
        loadMaterials();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Changes';
    }
}

// ── DELETE ──
async function deleteMaterial(id) {
    const m = allMaterials.find(x => x.id === id);
    if (!m) return;
    if (!confirm(`Delete "${m.title}"? The file will be permanently removed. This cannot be undone.`)) return;

    // Remove the file first, then the row.
    const rm = await db.storage.from(MATERIALS_BUCKET).remove([m.storage_path]);
    if (rm.error) { alert(`Failed to remove file: ${rm.error.message}`); return; }

    const del = await db.from('materials').delete().eq('id', id);
    if (del.error) { alert(`File removed but record delete failed: ${del.error.message}`); return; }
    loadMaterials();
}
