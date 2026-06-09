// Announcements — notices shown to all students.

let allAnnouncements = [];

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
function formatDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ── LOAD ──
async function loadAnnouncements() {
    const list = document.getElementById('ann-list');
    list.innerHTML = `<div class="loader">Loading announcements…</div>`;

    const { data, error } = await db
        .from('announcements')
        .select('id, title, body, posted_at, created_at')
        .order('posted_at', { ascending: false });

    if (error) {
        list.innerHTML = `<div class="loader" style="color:var(--red)">Error loading announcements: ${escapeHtml(error.message)}</div>`;
        return;
    }

    allAnnouncements = data || [];
    applyFilters();
}

function applyFilters() {
    const q = (document.getElementById('search-input')?.value || '').toLowerCase();
    let list = allAnnouncements;
    if (q) list = list.filter(a =>
        (a.title || '').toLowerCase().includes(q) ||
        (a.body || '').toLowerCase().includes(q)
    );
    renderAnnouncements(list);
}

function renderAnnouncements(list) {
    const el = document.getElementById('ann-list');
    if (list.length === 0) {
        el.innerHTML = `<div class="empty-state"><h3>No announcements</h3><p>Click "New Announcement" to post one.</p></div>`;
        return;
    }
    el.innerHTML = list.map(a => `
        <div class="ann-card">
            <div class="ann-head">
                <div class="ann-title">${escapeHtml(a.title)}</div>
                <div class="ann-date">${formatDateTime(a.posted_at || a.created_at)}</div>
            </div>
            <div class="ann-body">${escapeHtml(a.body)}</div>
            <div class="ann-actions">
                <button class="btn btn-ghost btn-sm" onclick="openAnnModal('${a.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteAnnouncement('${a.id}')">Delete</button>
            </div>
        </div>
    `).join('');
}

// ── CREATE / EDIT ──
function openAnnModal(id = null) {
    const alert = document.getElementById('ann-alert');
    alert.style.display = 'none';

    if (id) {
        const a = allAnnouncements.find(x => x.id === id);
        if (!a) return;
        document.getElementById('ann-modal-title').textContent = 'Edit Announcement';
        document.getElementById('ann-id').value = a.id;
        document.getElementById('ann-title').value = a.title || '';
        document.getElementById('ann-body').value = a.body || '';
        document.getElementById('ann-save-btn').textContent = 'Save Changes';
    } else {
        document.getElementById('ann-modal-title').textContent = 'New Announcement';
        document.getElementById('ann-id').value = '';
        document.getElementById('ann-title').value = '';
        document.getElementById('ann-body').value = '';
        document.getElementById('ann-save-btn').textContent = 'Publish';
    }
    openModal('ann-modal');
}

async function saveAnnouncement(e) {
    e.preventDefault();
    const btn = document.getElementById('ann-save-btn');
    const alert = document.getElementById('ann-alert');
    const original = btn.textContent;
    alert.style.display = 'none';

    const id = document.getElementById('ann-id').value;
    const title = document.getElementById('ann-title').value.trim();
    const body = document.getElementById('ann-body').value.trim();

    if (!title || !body) { showModalAlert(alert, 'Title and message are required.', 'error'); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) {
            res = await db.from('announcements').update({ title, body }).eq('id', id);
        } else {
            const { data: { session } } = await db.auth.getSession();
            res = await db.from('announcements').insert({
                title, body, posted_by: session ? session.user.id : null
            });
        }
        if (res.error) throw new Error(res.error.message);
        closeModal('ann-modal');
        loadAnnouncements();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = original;
    }
}

async function deleteAnnouncement(id) {
    const a = allAnnouncements.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete announcement?',
        message: `"${a ? a.title : ''}" will be removed for everyone. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('announcements').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    loadAnnouncements();
}
