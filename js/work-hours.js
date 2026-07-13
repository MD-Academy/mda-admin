// Staff Work Hours — tamper-proof clock in/out (server-stamped) + super-admin report.
// Writes go through the backend (/work/clock-in, /work/clock-out); reads use RLS.

let CURRENT_UID = null;
let IS_SUPER = false;
let openSession = null;
let tickTimer = null;
let REPORT_DATA = null;
let staffNames = {};

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function pad(n) { return String(n).padStart(2, '0'); }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; }
function fmtDay(iso) { return iso ? new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }) : ''; }
function hoursBetween(a, b) { return (new Date(b) - new Date(a)) / 3600000; }
function fmtHours(h) { const m = Math.round(h * 60); const H = Math.floor(m / 60), M = m % 60; return H ? `${H}h ${M}m` : `${M}m`; }
function fmtClock(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`; }

function initWorkHours() {
    const superSection = IS_SUPER ? `
        <div class="section" style="margin-top:30px;">
            <div class="section-title">📊 Hours report — all teachers</div>
            <div class="toolbar" id="report-tools" style="flex-wrap:wrap;gap:10px;">
                <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">From <input type="date" id="rep-from" style="height:38px;border:1.5px solid var(--border);border-radius:8px;padding:0 8px;font-family:inherit;"></label>
                <label style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:6px;">To <input type="date" id="rep-to" style="height:38px;border:1.5px solid var(--border);border-radius:8px;padding:0 8px;font-family:inherit;"></label>
                <select id="rep-teacher" class="filter-select"><option value="">All teachers</option></select>
                <button class="btn btn-primary btn-sm" onclick="runReport()">Run report</button>
                <button class="btn btn-ghost btn-sm" onclick="exportCsv()">⬇ CSV</button>
                <button class="btn btn-ghost btn-sm" onclick="window.print()">🖨 Print / PDF</button>
            </div>
            <div id="report-box"><p class="hint">Pick a date range and run the report.</p></div>
        </div>` : '';

    document.getElementById('page-content').innerHTML = `
        <div id="clock-box"></div>
        <div class="section" style="margin-top:30px;">
            <div class="section-title">🕑 My recent sessions</div>
            <div id="mine-box"><div class="loader">Loading…</div></div>
        </div>
        ${superSection}`;

    loadStatus();
    loadMine();
    if (IS_SUPER) initReportControls();
}

// ── CLOCK IN / OUT ──
async function loadStatus() {
    const { data } = await db.from('work_sessions').select('id, started_at, note')
        .eq('admin_id', CURRENT_UID).is('ended_at', null).order('started_at', { ascending: false }).limit(1);
    openSession = (data || [])[0] || null;
    renderClock();
}

function renderClock() {
    const box = document.getElementById('clock-box');
    if (openSession) {
        box.innerHTML = `
            <div class="wh-clock open">
                <div class="wh-status">🟢 Clocked in</div>
                <div class="wh-since">since ${fmtDateTime(openSession.started_at)}</div>
                <div class="wh-elapsed" id="wh-elapsed">0:00:00</div>
                ${openSession.note ? `<div class="wh-note">📝 ${escapeHtml(openSession.note)}</div>` : ''}
                <button class="btn btn-danger-solid" id="clock-btn" onclick="clockOut()">Clock Out</button>
            </div>`;
        startTick();
    } else {
        stopTick();
        box.innerHTML = `
            <div class="wh-clock">
                <div class="wh-status">⚪ Not clocked in</div>
                <div class="form-field" style="max-width:420px;margin:16px auto 0;text-align:left;">
                    <label>What are you working on? <span style="color:var(--text-muted);font-weight:400;">(optional)</span></label>
                    <input type="text" id="clock-note" placeholder="e.g. Biology live class" maxlength="200">
                </div>
                <button class="btn btn-primary" id="clock-btn" onclick="clockIn()" style="margin-top:16px;">Clock In</button>
            </div>`;
    }
}

function startTick() {
    stopTick();
    const upd = () => {
        const el = document.getElementById('wh-elapsed');
        if (!el || !openSession) return;
        el.textContent = fmtClock(Date.now() - new Date(openSession.started_at).getTime());
    };
    upd();
    tickTimer = setInterval(upd, 1000);
}
function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

async function clockIn() {
    const btn = document.getElementById('clock-btn');
    const note = (document.getElementById('clock-note')?.value || '').trim();
    btn.disabled = true; btn.textContent = 'Clocking in…';
    try {
        await apiRequest('POST', '/work/clock-in', { note: note || null });
        await loadStatus();
        loadMine();
    } catch (err) {
        alert('Could not clock in: ' + err.message);
        btn.disabled = false; btn.textContent = 'Clock In';
    }
}

async function clockOut() {
    const ok = await confirmDialog({
        title: 'Clock out?',
        message: 'This ends your current work session and records the time. It cannot be edited afterwards.',
        confirmText: 'Clock Out'
    });
    if (!ok) return;
    const btn = document.getElementById('clock-btn');
    btn.disabled = true; btn.textContent = 'Clocking out…';
    try {
        await apiRequest('POST', '/work/clock-out', {});
        await loadStatus();
        loadMine();
    } catch (err) {
        alert('Could not clock out: ' + err.message);
        btn.disabled = false; btn.textContent = 'Clock Out';
    }
}

// ── MY RECENT SESSIONS + TOTALS ──
async function loadMine() {
    const box = document.getElementById('mine-box');
    const since = new Date(); since.setDate(since.getDate() - 90);
    const { data, error } = await db.from('work_sessions').select('id, started_at, ended_at, note')
        .eq('admin_id', CURRENT_UID).gte('started_at', since.toISOString()).order('started_at', { ascending: false });
    if (error) { box.innerHTML = `<div class="loader" style="color:var(--red)">${escapeHtml(error.message)}</div>`; return; }
    const sessions = data || [];

    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startWeek = new Date(startToday); startWeek.setDate(startToday.getDate() - ((startToday.getDay() + 6) % 7)); // Monday
    const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const sumFrom = (from) => sessions.filter(s => s.ended_at && new Date(s.started_at) >= from).reduce((t, s) => t + hoursBetween(s.started_at, s.ended_at), 0);

    const totals = `<div class="wh-totals">
        <div class="wh-total"><div class="wh-total-n">${fmtHours(sumFrom(startToday))}</div><div class="wh-total-l">Today</div></div>
        <div class="wh-total"><div class="wh-total-n">${fmtHours(sumFrom(startWeek))}</div><div class="wh-total-l">This week</div></div>
        <div class="wh-total"><div class="wh-total-n">${fmtHours(sumFrom(startMonth))}</div><div class="wh-total-l">This month</div></div>
    </div>`;

    const rows = sessions.length ? sessions.map(s => {
        const dur = s.ended_at ? fmtHours(hoursBetween(s.started_at, s.ended_at)) : '<span style="color:var(--green);font-weight:700;">In progress</span>';
        return `<tr><td>${fmtDay(s.started_at)}</td><td>${fmtTime(s.started_at)}</td><td>${s.ended_at ? fmtTime(s.ended_at) : '—'}</td><td>${dur}</td><td>${s.note ? escapeHtml(s.note) : '<span style="color:var(--text-muted)">—</span>'}</td></tr>`;
    }).join('') : `<tr><td colspan="5" class="loader">No sessions in the last 90 days.</td></tr>`;

    box.innerHTML = totals + `<div class="panel" style="margin-top:14px;overflow-x:auto;">
        <table class="data-table"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ── SUPER-ADMIN REPORT (all teachers) ──
async function initReportControls() {
    const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth(), 1);
    document.getElementById('rep-from').value = first.toISOString().slice(0, 10);
    document.getElementById('rep-to').value = now.toISOString().slice(0, 10);
    const { data } = await db.from('profiles').select('id, full_name, role').in('role', ['admin', 'superadmin']).order('full_name', { ascending: true });
    const sel = document.getElementById('rep-teacher');
    staffNames = {};
    (data || []).forEach(p => {
        staffNames[p.id] = p.full_name || '(no name)';
        const o = document.createElement('option'); o.value = p.id; o.textContent = p.full_name || '(no name)'; sel.appendChild(o);
    });
}

async function runReport() {
    const box = document.getElementById('report-box');
    const from = document.getElementById('rep-from').value;
    const to = document.getElementById('rep-to').value;
    const teacher = document.getElementById('rep-teacher').value;
    if (!from || !to) { box.innerHTML = `<p class="hint">Pick both dates.</p>`; return; }
    box.innerHTML = `<div class="loader">Loading report…</div>`;

    let q = db.from('work_sessions').select('id, admin_id, started_at, ended_at, note')
        .gte('started_at', from).lte('started_at', to + 'T23:59:59').order('started_at', { ascending: true });
    if (teacher) q = q.eq('admin_id', teacher);
    const { data, error } = await q;
    if (error) { box.innerHTML = `<div class="loader" style="color:var(--red)">${escapeHtml(error.message)}</div>`; return; }

    const sessions = data || [];
    const byAdmin = {};
    sessions.forEach(s => { (byAdmin[s.admin_id] = byAdmin[s.admin_id] || []).push(s); });
    REPORT_DATA = { from, to, sessions, byAdmin };
    renderReport();
}

function renderReport() {
    const box = document.getElementById('report-box');
    const { from, to, byAdmin, sessions } = REPORT_DATA;
    if (!sessions.length) { box.innerHTML = `<div class="empty-state"><h3>No hours in this range</h3><p>No clock-ins between ${from} and ${to}.</p></div>`; return; }

    const blocks = Object.keys(byAdmin).sort((a, b) => (staffNames[a] || '').localeCompare(staffNames[b] || '')).map(aid => {
        const list = byAdmin[aid];
        const total = list.filter(s => s.ended_at).reduce((t, s) => t + hoursBetween(s.started_at, s.ended_at), 0);
        const openCount = list.filter(s => !s.ended_at).length;
        const rows = list.map(s => `<tr>
            <td>${fmtDay(s.started_at)}</td><td>${fmtTime(s.started_at)}</td>
            <td>${s.ended_at ? fmtTime(s.ended_at) : '<span style="color:var(--amber)">open</span>'}</td>
            <td>${s.ended_at ? fmtHours(hoursBetween(s.started_at, s.ended_at)) : '—'}</td>
            <td>${s.note ? escapeHtml(s.note) : '—'}</td></tr>`).join('');
        return `<div class="panel" style="margin-bottom:18px;overflow-x:auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 4px 12px;flex-wrap:wrap;gap:8px;">
                <div style="font-weight:800;font-size:16px;color:var(--navy-800);">${escapeHtml(staffNames[aid] || 'Unknown')}</div>
                <div style="font-weight:700;">Total: ${fmtHours(total)}${openCount ? ` · ${openCount} open` : ''}</div>
            </div>
            <table class="data-table"><thead><tr><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    }).join('');

    const grand = sessions.filter(s => s.ended_at).reduce((t, s) => t + hoursBetween(s.started_at, s.ended_at), 0);
    box.innerHTML = `<div id="report-print">
        <div style="margin:6px 0 16px;font-size:14px;"><strong>Work hours report</strong> · ${from} → ${to} · <strong>Grand total ${fmtHours(grand)}</strong></div>
        ${blocks}
    </div>`;
}

function exportCsv() {
    if (!REPORT_DATA || !REPORT_DATA.sessions.length) { alert('Run a report first.'); return; }
    const rows = [['Teacher', 'Date', 'Clock in', 'Clock out', 'Hours', 'Note']];
    REPORT_DATA.sessions.forEach(s => {
        const hrs = s.ended_at ? hoursBetween(s.started_at, s.ended_at).toFixed(2) : '';
        rows.push([staffNames[s.admin_id] || 'Unknown', fmtDay(s.started_at), fmtDateTime(s.started_at), s.ended_at ? fmtDateTime(s.ended_at) : '(open)', hrs, (s.note || '').replace(/\s+/g, ' ')]);
    });
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `work-hours_${REPORT_DATA.from}_${REPORT_DATA.to}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}
