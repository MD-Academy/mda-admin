// Global Zoom Recordings — date-organised, assigned to one or more COURSES.

let allRecordings = [];
let recCourses = [];          // [{id, name}]
let recCourseLinks = {};      // recording_id -> [course_id, ...]

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
    const h = Math.floor(m / 60); const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
}
function courseName(id) {
    const c = recCourses.find(x => x.id === id);
    return c ? c.name : '—';
}
function courseNamesFor(recId) {
    const ids = recCourseLinks[recId] || [];
    if (ids.length === 0) return '<span style="color:var(--text-muted)">— Unassigned —</span>';
    return `<div style="display:flex;flex-direction:column;gap:4px;align-items:flex-start;">${ids.map(id =>
        `<span class="badge badge-blue">${escapeHtml(courseName(id))}</span>`).join('')}</div>`;
}

const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

function visToggleHtml(id, isVisible) {
    return `<button class="vis-toggle ${isVisible ? 'visible' : 'hidden'}" onclick="toggleVisibility('${id}')" title="${isVisible ? 'Visible to students — click to hide' : 'Hidden from students — click to show'}">${isVisible ? EYE : EYE_OFF}${isVisible ? 'Visible' : 'Hidden'}</button>`;
}

// ── FILTER / PAGINATION STATE ──
let currentPage = 1, pageSize = 25, totalCount = 0;
let searchQuery = '', courseFilter = '', dateFrom = '', dateTo = '', searchTimer = null;

async function loadCourseOptions() {
    const { data, error } = await db.from('courses').select('id, name').order('name', { ascending: true });
    if (error) { console.error('[recordings] could not load courses:', error); return; }
    recCourses = data || [];
    const sel = document.getElementById('course-filter');
    recCourses.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id; opt.textContent = c.name;
        sel.appendChild(opt);
    });
}

function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
        searchQuery = (document.getElementById('search-input').value || '').trim();
        currentPage = 1; loadRecordings();
    }, 300);
}
function onFilterChange() {
    courseFilter = document.getElementById('course-filter').value || '';
    dateFrom = document.getElementById('date-from').value || '';
    dateTo = document.getElementById('date-to').value || '';
    pageSize = parseInt(document.getElementById('page-size').value, 10) || 25;
    currentPage = 1; loadRecordings();
}
function changePage(delta) {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const n = currentPage + delta;
    if (n < 1 || n > totalPages) return;
    currentPage = n; loadRecordings(); window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── LOAD (server-side: search + course + date range + pagination) ──
async function loadRecordings() {
    const tbody = document.getElementById('rec-tbody');
    tbody.innerHTML = `<tr><td colspan="7" class="loader">Loading recordings…</td></tr>`;

    let idFilter = null;
    if (courseFilter) {
        const { data: links, error } = await db.from('recording_courses').select('recording_id').eq('course_id', courseFilter);
        if (error) { tbody.innerHTML = `<tr><td colspan="7" class="loader" style="color:var(--red)">Couldn't filter by course: ${escapeHtml(error.message)}</td></tr>`; return; }
        idFilter = [...new Set((links || []).map(l => l.recording_id))];
        if (idFilter.length === 0) { allRecordings = []; totalCount = 0; recCourseLinks = {}; renderRecordings([]); renderPager(); return; }
    }

    const from = (currentPage - 1) * pageSize, to = from + pageSize - 1;
    let q = db.from('recordings')
        .select('id, title, professor, recorded_date, aws_url, duration_seconds, is_visible', { count: 'exact' })
        .eq('kind', 'zoom');
    if (idFilter) q = q.in('id', idFilter);
    const term = searchQuery.replace(/[%,()]/g, ' ').trim();
    if (term) q = q.or(`title.ilike.%${term}%,professor.ilike.%${term}%`);
    if (dateFrom) q = q.gte('recorded_date', dateFrom);
    if (dateTo) q = q.lte('recorded_date', dateTo);
    q = q.order('recorded_date', { ascending: false }).range(from, to);

    const { data, error, count } = await q;
    if (error) { tbody.innerHTML = `<tr><td colspan="7" class="loader" style="color:var(--red)">Error loading recordings: ${escapeHtml(error.message)}</td></tr>`; return; }

    allRecordings = data || [];
    totalCount = count || 0;

    // Course links for just this page.
    recCourseLinks = {};
    const ids = allRecordings.map(r => r.id);
    if (ids.length) {
        const { data: links } = await db.from('recording_courses').select('recording_id, course_id').in('recording_id', ids);
        (links || []).forEach(l => { (recCourseLinks[l.recording_id] = recCourseLinks[l.recording_id] || []).push(l.course_id); });
    }
    renderRecordings(allRecordings);
    renderPager();
}

function renderPager() {
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    if (currentPage > totalPages) currentPage = totalPages;
    const cr = document.getElementById('count-recordings');
    if (cr) cr.textContent = totalCount;
    const info = document.getElementById('pager-info');
    if (!info) return;
    if (totalCount === 0) info.textContent = 'No recordings match.';
    else {
        const start = (currentPage - 1) * pageSize + 1, end = Math.min(currentPage * pageSize, totalCount);
        info.textContent = `Showing ${start}–${end} of ${totalCount} recording${totalCount === 1 ? '' : 's'}`;
    }
    document.getElementById('page-label').textContent = `Page ${currentPage} of ${totalPages}`;
    const prev = document.getElementById('prev-btn'), next = document.getElementById('next-btn');
    prev.disabled = currentPage <= 1; next.disabled = currentPage >= totalPages;
    prev.style.opacity = prev.disabled ? '.4' : '1'; next.style.opacity = next.disabled ? '.4' : '1';
}

function renderRecordings(list) {
    const tbody = document.getElementById('rec-tbody');
    if (list.length === 0) {
        const any = searchQuery || courseFilter || dateFrom || dateTo;
        tbody.innerHTML = `<tr><td colspan="7" class="loader">${any ? 'No recordings match your filters.' : 'No recordings yet. Click "Add Recording" to create one.'}</td></tr>`;
        return;
    }
    tbody.innerHTML = list.map(r => `
        <tr>
            <td>${formatDate(r.recorded_date)}</td>
            <td><strong>${escapeHtml(r.title)}</strong></td>
            <td>${courseNamesFor(r.id)}</td>
            <td>${escapeHtml(r.professor)}</td>
            <td>${formatDuration(r.duration_seconds)}</td>
            <td>${visToggleHtml(r.id, r.is_visible)}</td>
            <td class="row-actions">
                <a class="btn btn-ghost btn-sm" href="${escapeHtml(r.aws_url)}" target="_blank" rel="noopener">Preview</a>
                <button class="btn btn-ghost btn-sm" onclick="openRecModal('${r.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteRecording('${r.id}')">Delete</button>
                <span class="row-menu-wrap">
                    <button class="row-dots" onclick="toggleCardMenu(event, '${r.id}')" aria-label="More options" title="More">⋯</button>
                    <div class="card-menu" id="menu-${r.id}">
                        <button onclick="duplicateRecording('${r.id}')">
                            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                            Duplicate recording
                        </button>
                    </div>
                </span>
            </td>
        </tr>
    `).join('');
}

// ── ROW ⋯ MENU ──
function toggleCardMenu(e, id) {
    e.stopPropagation();
    const menu = document.getElementById(`menu-${id}`);
    const open = menu.classList.contains('open');
    document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open'));
    if (!open) menu.classList.add('open');
}
document.addEventListener('click', () => document.querySelectorAll('.card-menu.open').forEach(m => m.classList.remove('open')));

// ── VISIBILITY ──
async function toggleVisibility(id) {
    const r = allRecordings.find(x => x.id === id);
    if (!r) return;
    const { error } = await db.from('recordings').update({ is_visible: !r.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    r.is_visible = !r.is_visible;
    renderRecordings(allRecordings);
}

// Recording→course assignment now lives in the Course editor (Courses → open a course → Recordings).

// ── CREATE / EDIT ──
function openRecModal(id = null) {
    const alert = document.getElementById('rec-alert');
    alert.style.display = 'none';

    if (id) {
        const r = allRecordings.find(x => x.id === id);
        if (!r) return;
        document.getElementById('rec-modal-title').textContent = 'Edit Recording';
        document.getElementById('rec-id').value = r.id;
        document.getElementById('rec-title').value = r.title || '';
        document.getElementById('rec-professor').value = r.professor || '';
        document.getElementById('rec-date').value = r.recorded_date || '';
        document.getElementById('rec-url').value = r.aws_url || '';
        document.getElementById('rec-duration').value = r.duration_seconds ? Math.round(r.duration_seconds / 60) : '';
    } else {
        document.getElementById('rec-modal-title').textContent = 'Add Recording';
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
    const durationMin = document.getElementById('rec-duration').value;

    const payload = {
        kind: 'zoom',
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
    if (!ensureSafe(alert, [['Title', payload.title], ['Professor', payload.professor], ['Video URL', payload.aws_url]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        if (id) {
            const res = await db.from('recordings').update(payload).eq('id', id);
            if (res.error) throw new Error(res.error.message);
        } else {
            const res = await db.from('recordings').insert(payload).select('id').single();
            if (res.error) throw new Error(res.error.message);
        }
        closeModal('rec-modal');
        loadRecordings();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save Recording';
    }
}

async function duplicateRecording(id) {
    const r = allRecordings.find(x => x.id === id);
    if (!r) return;
    try {
        const ins = await db.from('recordings').insert({
            kind: 'zoom',
            title: `Copy of ${r.title}`,
            professor: r.professor,
            recorded_date: r.recorded_date,
            aws_url: r.aws_url,
            duration_seconds: r.duration_seconds,
            is_visible: r.is_visible
        }).select('id').single();
        if (ins.error) throw new Error(ins.error.message);
        // Copy its course assignments.
        const links = recCourseLinks[id] || [];
        if (links.length) {
            const rows = links.map(cid => ({ recording_id: ins.data.id, course_id: cid }));
            const li = await db.from('recording_courses').insert(rows);
            if (li.error) throw new Error(li.error.message);
        }
        loadRecordings();
    } catch (err) {
        alert(`Could not duplicate the recording: ${err.message}`);
    }
}

async function deleteRecording(id) {
    const r = allRecordings.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete recording?',
        message: `"${r ? r.title : ''}" will be removed. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('recordings').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    loadRecordings();
}

// ════════════ LIVE CLASS LINKS (Zoom join links, per course) ════════════
let meetingLinks = [];

function switchTab(name) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
}

function visLinkToggleHtml(id, isVisible) {
    return `<button class="vis-toggle ${isVisible ? 'visible' : 'hidden'}" onclick="toggleLinkVis('${id}')" title="${isVisible ? 'Visible to students — click to hide' : 'Hidden from students — click to show'}">${isVisible ? EYE : EYE_OFF}${isVisible ? 'Visible' : 'Hidden'}</button>`;
}

async function loadMeetingLinks() {
    const tbody = document.getElementById('links-tbody');
    const { data, error } = await db.from('meeting_links')
        .select('id, course_id, title, host_name, url, is_visible, order_index, created_at')
        .order('order_index', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false });
    if (error) {
        console.error('[recordings] links load failed:', error);
        if (tbody) tbody.innerHTML = `<tr><td colspan="6" class="loader" style="color:var(--red)">Couldn't load links: ${escapeHtml(error.message)}</td></tr>`;
        return;
    }
    meetingLinks = data || [];
    renderMeetingLinks();
}

function renderMeetingLinks() {
    const cnt = document.getElementById('count-links');
    if (cnt) cnt.textContent = meetingLinks.length;
    const tbody = document.getElementById('links-tbody');
    if (!tbody) return;
    if (!meetingLinks.length) {
        tbody.innerHTML = `<tr><td colspan="6" class="loader">No live class links yet. Click "Add link" to create one.</td></tr>`;
        return;
    }
    const last = meetingLinks.length - 1;
    tbody.innerHTML = meetingLinks.map((l, i) => `
        <tr data-id="${l.id}">
            <td>
                <div style="display:flex;align-items:center;gap:4px;">
                    <div style="display:flex;flex-direction:column;">
                        <button class="btn btn-ghost btn-sm reorder-btn" title="Move up" onclick="moveLink('${l.id}',-1)" ${i === 0 ? 'disabled style="opacity:.3;cursor:default;"' : ''}>▲</button>
                        <button class="btn btn-ghost btn-sm reorder-btn" title="Move down" onclick="moveLink('${l.id}',1)" ${i === last ? 'disabled style="opacity:.3;cursor:default;"' : ''}>▼</button>
                    </div>
                    <strong>${escapeHtml(l.title)}</strong>
                </div>
            </td>
            <td><span class="badge badge-blue">${escapeHtml(courseName(l.course_id))}</span></td>
            <td>${escapeHtml(l.host_name)}</td>
            <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="color:var(--blue-500);word-break:break-all;">${escapeHtml(l.url)}</a></td>
            <td>${visLinkToggleHtml(l.id, l.is_visible)}</td>
            <td class="row-actions">
                <button class="btn btn-ghost btn-sm" onclick="openLinkModal('${l.id}')">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteLink('${l.id}')">Delete</button>
            </td>
        </tr>`).join('');
}

// Move a live link up/down and persist the new order.
async function moveLink(id, dir) {
    const i = meetingLinks.findIndex(x => x.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= meetingLinks.length) return;
    const arr = meetingLinks;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    renderMeetingLinks();
    // Renumber every row that changed, so order is stable regardless of prior nulls.
    try {
        for (let k = 0; k < arr.length; k++) {
            if (arr[k].order_index !== k) {
                arr[k].order_index = k;
                await db.from('meeting_links').update({ order_index: k }).eq('id', arr[k].id);
            }
        }
    } catch (e) { console.error('[recordings] reorder failed:', e); }
}

async function toggleLinkVis(id) {
    const l = meetingLinks.find(x => x.id === id);
    if (!l) return;
    const { error } = await db.from('meeting_links').update({ is_visible: !l.is_visible }).eq('id', id);
    if (error) { alert(`Failed to update visibility: ${error.message}`); return; }
    l.is_visible = !l.is_visible;
    renderMeetingLinks();
}

function openLinkModal(id = null) {
    const alert = document.getElementById('link-alert');
    alert.style.display = 'none';
    const sel = document.getElementById('link-course');
    sel.innerHTML = `<option value="">— Select a course —</option>` +
        recCourses.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

    if (id) {
        const l = meetingLinks.find(x => x.id === id);
        if (!l) return;
        document.getElementById('link-modal-title').textContent = 'Edit live class link';
        document.getElementById('link-id').value = l.id;
        sel.value = l.course_id;
        document.getElementById('link-title').value = l.title || '';
        document.getElementById('link-host').value = l.host_name || '';
        document.getElementById('link-url').value = l.url || '';
    } else {
        document.getElementById('link-modal-title').textContent = 'Add live class link';
        document.getElementById('link-id').value = '';
        sel.value = '';
        document.getElementById('link-title').value = '';
        document.getElementById('link-host').value = '';
        document.getElementById('link-url').value = '';
    }
    openModal('link-modal');
}

async function saveLink(e) {
    e.preventDefault();
    const btn = document.getElementById('link-save-btn');
    const alert = document.getElementById('link-alert');
    alert.style.display = 'none';

    const id = document.getElementById('link-id').value;
    const payload = {
        course_id: document.getElementById('link-course').value,
        title: document.getElementById('link-title').value.trim(),
        host_name: document.getElementById('link-host').value.trim(),
        url: document.getElementById('link-url').value.trim()
    };
    if (!payload.course_id) { showModalAlert(alert, 'Please choose a course.', 'error'); return; }
    if (!payload.title || !payload.host_name || !payload.url) { showModalAlert(alert, 'Please fill in every field.', 'error'); return; }
    if (!/^https?:\/\//i.test(payload.url)) { showModalAlert(alert, 'The link must start with http:// or https://', 'error'); return; }
    if (!ensureSafe(alert, [['Title', payload.title], ['Host', payload.host_name], ['Link', payload.url]])) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        let res;
        if (id) res = await db.from('meeting_links').update(payload).eq('id', id);
        else res = await db.from('meeting_links').insert(payload);
        if (res.error) throw new Error(res.error.message);
        closeModal('link-modal');
        await loadMeetingLinks();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Save link';
    }
}

async function deleteLink(id) {
    const l = meetingLinks.find(x => x.id === id);
    const ok = await confirmDialog({
        title: 'Delete this link?',
        message: `"${l ? l.title : 'This link'}" will be removed for students. This cannot be undone.`,
        confirmText: 'Delete',
        danger: true
    });
    if (!ok) return;
    const { error } = await db.from('meeting_links').delete().eq('id', id);
    if (error) { alert(`Failed to delete: ${error.message}`); return; }
    await loadMeetingLinks();
}
