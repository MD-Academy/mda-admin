// Student support tickets — list, respond, set status.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function openModal(id) { document.getElementById(id).style.display = 'flex'; }
function closeModal(id) { document.getElementById(id).style.display = 'none'; }
function showModalAlert(el, msg, type) { el.className = `alert ${type}`; el.textContent = msg; el.style.display = 'block'; }

const STATUS_LABEL = { open: 'Open', in_progress: 'In Progress', completed: 'Completed' };
const STATUSES = ['open', 'in_progress', 'completed'];
const SHOT_BUCKET = 'ticket-uploads';

let allTickets = [];          // [{id,title,status,updated_at,created_at,student_id,student_name}]
let currentTicket = null;     // id open in the modal

function badge(status) { return `<span class="badge ${escapeHtml(status)}">${escapeHtml(STATUS_LABEL[status] || status)}</span>`; }
function fmt(ts) { try { return new Date(ts).toLocaleString(); } catch (e) { return ''; } }

async function loadTickets() {
    const tbody = document.getElementById('tickets-tbody');
    const { data, error } = await db.from('tickets')
        .select('id, title, status, created_at, updated_at, student_id')
        .order('updated_at', { ascending: false });
    if (error) { tbody.innerHTML = `<tr><td colspan="5" class="loader">Couldn't load: ${escapeHtml(error.message)}</td></tr>`; return; }
    allTickets = data || [];

    // Resolve student names in one query.
    const ids = [...new Set(allTickets.map(t => t.student_id))];
    if (ids.length) {
        const { data: profs } = await db.from('profiles').select('id, full_name').in('id', ids);
        const nameById = {};
        (profs || []).forEach(p => { nameById[p.id] = p.full_name; });
        allTickets.forEach(t => { t.student_name = nameById[t.student_id] || '—'; });
    }
    applyFilters();
}

function applyFilters() {
    const status = document.getElementById('status-filter').value;
    const term = (document.getElementById('search-input').value || '').trim().toLowerCase();
    let rows = allTickets;
    if (status) rows = rows.filter(t => t.status === status);
    if (term) rows = rows.filter(t =>
        (t.title || '').toLowerCase().includes(term) || (t.student_name || '').toLowerCase().includes(term));

    const tbody = document.getElementById('tickets-tbody');
    if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="5" class="loader">No tickets${status || term ? ' match' : ' yet'}.</td></tr>`;
        return;
    }
    tbody.innerHTML = rows.map(t => `
        <tr>
            <td><strong>${escapeHtml(t.student_name || '—')}</strong></td>
            <td>${escapeHtml(t.title)}</td>
            <td>${badge(t.status)}</td>
            <td style="white-space:nowrap;color:var(--text-muted);font-size:13px;">${fmt(t.updated_at)}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="openTicket('${t.id}')">Open</button></td>
        </tr>`).join('');
}

async function openTicket(id) {
    currentTicket = id;
    document.getElementById('t-alert').style.display = 'none';
    document.getElementById('t-reply').value = '';
    document.getElementById('t-thread').innerHTML = `<div class="loader">Loading…</div>`;
    openModal('ticket-modal');

    const t = allTickets.find(x => x.id === id);
    const { data: full } = await db.from('tickets').select('title, status, screenshot_path').eq('id', id).single();
    const ticket = full || t || {};
    document.getElementById('t-title').innerHTML = escapeHtml(ticket.title || 'Ticket');
    renderStatusRow(ticket.status);

    const { data: msgs } = await db.from('ticket_messages')
        .select('author_role, body, created_at').eq('ticket_id', id).order('created_at', { ascending: true });

    let shotHtml = '';
    if (ticket.screenshot_path) {
        const { data: pub } = db.storage.from(SHOT_BUCKET).getPublicUrl(ticket.screenshot_path);
        if (pub && pub.publicUrl) shotHtml = `<div class="shot"><a href="${escapeHtml(pub.publicUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(pub.publicUrl)}" alt="screenshot"></a></div>`;
    }
    const who = r => (r === 'staff' ? 'Office' : (t && t.student_name) || 'Student');
    const thread = (msgs || []).map((m, i) => `
        <div class="msg ${escapeHtml(m.author_role)}">
            <div class="who">${escapeHtml(who(m.author_role))}</div>
            <div class="body">${escapeHtml(m.body)}</div>
            ${i === 0 ? shotHtml : ''}
            <div class="when">${fmt(m.created_at)}</div>
        </div>`).join('');
    document.getElementById('t-thread').innerHTML = thread || '<p class="hint">No messages.</p>';
}

function renderStatusRow(active) {
    document.getElementById('t-status-row').innerHTML = STATUSES.map(s =>
        `<button class="sbtn ${s} ${s === active ? 'active' : ''}" onclick="setStatus('${s}')">${escapeHtml(STATUS_LABEL[s])}</button>`
    ).join('');
}

async function setStatus(status) {
    const alert = document.getElementById('t-alert');
    alert.style.display = 'none';
    renderStatusRow(status); // optimistic
    try {
        await apiRequest('POST', '/tickets/status', { ticket_id: currentTicket, status });
        const t = allTickets.find(x => x.id === currentTicket);
        if (t) t.status = status;
        applyFilters();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    }
}

async function sendReply() {
    const ta = document.getElementById('t-reply');
    const text = ta.value.trim();
    const alert = document.getElementById('t-alert');
    alert.style.display = 'none';
    if (!text) { showModalAlert(alert, 'Write a response first.', 'error'); return; }
    const btn = document.getElementById('t-send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
        await apiRequest('POST', '/tickets/reply', { ticket_id: currentTicket, body: text });
        ta.value = '';
        await openTicket(currentTicket);
        loadTickets();
    } catch (err) {
        showModalAlert(alert, err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Send response';
    }
}
