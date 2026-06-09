// Digital Booklets — global exam-simulation files, stored in the materials bucket.

const MATERIALS_BUCKET = 'materials';
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXT = ['pdf', 'ppt', 'pptx', 'doc', 'docx', 'png', 'jpg', 'jpeg'];

let allBooklets = [];
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
function fileExt(name) {
    const parts = name.split('.');
    return parts.length > 1 ? parts.pop().toLowerCase() : 'file';
}
function sanitizeName(name) { return name.replace(/[^a-zA-Z0-9._-]/g, '_'); }

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

// ── LOAD ──
async function loadBooklets() {
    const tbody = document.getElementById('booklets-tbody');
    tbody.innerHTML = `<tr><td colspan="5" class="loader">Loading booklets…</td></tr>`;

    const { data, error } = await db.from('booklets')
        .select('id, title, type, storage_path, is_visible, created_at')
        .order('created_at', { ascending: false });

    if (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader" style="color:var(--red)">Error loading booklets: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }
    allBooklets = data || [];
    applyFilters();
}

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    let list = allBooklets;
    if (q) list = list.filter(b => (b.title || '').toLowerCase().includes(q));
    renderBooklets(list);
}

function renderBooklets(list) {
    const tbody = document.getElementById('booklets-tbody');
    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader">No booklets found. Click "Upload Booklet" to add one.</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(b => `
        <tr>
            <td><strong>${escapeHtml(b.title)}</strong></td>
            <td><span class="badge badge-blue">${escapeHtml((b.type || 'file').toUpperCase())}</span></td>
            <td>
                <button class="vis-toggle ${b.is_visible ? 'visible' : 'hidden'}" onclick="toggleVisibility('${b.id}')">
                    ${b.is_visible ? EYE : EYE_OFF}
                    ${b.is_visible ? 'Visible' : 'Hidden'}
                </button>
            </td>
            <td>${formatDate(b.created_at)}</td>
            <td class="row-actions">
                <button class="btn btn-ghost btn-sm" onclick="previewBooklet('${b.id}', this)">Preview</button>
                <button class="btn btn-danger btn-sm" onclick="deleteBooklet('${b.id}')">Delete</button>
            </td>
        </tr>
    `).join('');
}

// ── VISIBILITY ──
async function toggleVisibility(id) {
    const b = allBooklets.find(x => x.id === id);
    if (!b) return;
    const { error } = await db.from('booklets').update({ is_visible: !b.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    b.is_visible = !b.is_visible;
    applyFilters();
}

// ── UPLOAD ──
function openUploadModal() {
    pickedFile = null;
    document.getElementById('upload-alert').style.display = 'none';
    document.getElementById('booklet-file').value = '';
    document.getElementById('upload-zone-text').textContent = 'Click to choose a file';
    document.getElementById('booklet-title').value = '';
    openModal('upload-modal');
}

function onFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    pickedFile = file;
    document.getElementById('upload-zone-text').textContent = file.name;
    const titleField = document.getElementById('booklet-title');
    if (!titleField.value.trim()) titleField.value = file.name.replace(/\.[^.]+$/, '');
}

async function saveUpload(e) {
    e.preventDefault();
    const btn = document.getElementById('upload-btn');
    const alert = document.getElementById('upload-alert');
    alert.style.display = 'none';

    const title = document.getElementById('booklet-title').value.trim();
    if (!pickedFile) { showModalAlert(alert, 'Please choose a file to upload.', 'error'); return; }
    if (!title) { showModalAlert(alert, 'Please enter a title.', 'error'); return; }
    if (pickedFile.size > MAX_FILE_BYTES) {
        showModalAlert(alert, `File is too large (${(pickedFile.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`, 'error');
        return;
    }
    const ext = fileExt(pickedFile.name);
    if (!ALLOWED_EXT.includes(ext)) {
        showModalAlert(alert, `Invalid file type ".${ext}". Allowed: ${ALLOWED_EXT.join(', ').toUpperCase()}.`, 'error');
        return;
    }
    if (!ensureSafe(alert, [['Title', title]])) return;

    const path = `booklets/${Date.now()}-${sanitizeName(pickedFile.name)}`;
    btn.disabled = true; btn.textContent = 'Uploading…';
    try {
        const up = await db.storage.from(MATERIALS_BUCKET).upload(path, pickedFile, {
            contentType: pickedFile.type || undefined, upsert: false
        });
        if (up.error) throw new Error(`Upload failed: ${up.error.message}`);

        const ins = await db.from('booklets').insert({ title, type: ext, storage_path: path });
        if (ins.error) {
            await db.storage.from(MATERIALS_BUCKET).remove([path]);
            throw new Error(`Saving record failed: ${ins.error.message}`);
        }
        closeModal('upload-modal');
        loadBooklets();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Upload';
    }
}

// ── PREVIEW (signed URL via backend) ──
function previewBooklet(id, btnEl) {
    const b = allBooklets.find(x => x.id === id);
    if (!b) return;
    const win = window.open('', '_blank');
    if (win) win.document.write('<!DOCTYPE html><title>Loading…</title><body style="font-family:sans-serif;padding:40px;color:#334">Loading booklet…</body>');
    const original = btnEl.textContent;
    btnEl.disabled = true; btnEl.textContent = 'Opening…';
    apiRequest('POST', '/materials/signed-url', { storage_path: b.storage_path })
        .then(res => { if (win) win.location.href = res.signed_url; else window.open(res.signed_url, '_blank', 'noopener'); })
        .catch(err => { if (win) win.close(); alert(`Could not open file: ${err.message}`); })
        .finally(() => { btnEl.disabled = false; btnEl.textContent = original; });
}

// ── DELETE ──
async function deleteBooklet(id) {
    const b = allBooklets.find(x => x.id === id);
    if (!b) return;
    const ok = await confirmDialog({
        title: 'Delete booklet?',
        message: `"${b.title}" and its file will be permanently removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const rm = await db.storage.from(MATERIALS_BUCKET).remove([b.storage_path]);
    if (rm.error) { alert(`Failed to remove file: ${rm.error.message}`); return; }
    const del = await db.from('booklets').delete().eq('id', id);
    if (del.error) { alert(`File removed but record delete failed: ${del.error.message}`); return; }
    loadBooklets();
}
