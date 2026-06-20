// Login activity report for one student — daily sessions + totals, printable to PDF.

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function fmtDur(secs) {
    secs = Math.max(0, Math.round(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    const parts = [];
    if (h) parts.push(`${h}h`);
    if (m || h) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}
function fmtTime(d) { return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }
function dayKey(d) { return new Date(d).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }); }

async function initActivity(studentId, profile) {
    const { data: student } = await db.from('profiles').select('full_name').eq('id', studentId).single();
    const name = (student && student.full_name) || 'Student';
    renderLayout('students', 'Login Activity', `Time spent in the LMS — ${escapeHtml(name)}`, profile);

    document.getElementById('page-content').innerHTML = `
        <a class="back-link no-print" href="students.html" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:var(--text-muted);text-decoration:none;margin-bottom:14px;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Back to Students
        </a>
        <div style="display:flex;justify-content:flex-end;margin-bottom:14px;" class="no-print">
            <button class="btn btn-primary" onclick="window.print()">Print / Save as PDF</button>
        </div>
        <div class="report-head">
            <img src="assets/images/mda-logo.png" alt="MDA">
            <div class="rh-text">
                <strong>Login Activity</strong>
                <div style="margin:8px 0 4px;">
                    <span style="display:inline-flex;align-items:center;gap:9px;background:#1d4ed8;color:#fff;font-weight:700;font-size:15px;padding:9px 18px;border-radius:11px;box-shadow:0 2px 8px rgba(29,78,216,.35);">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M21 8v4.5"/><circle cx="12" cy="14.5" r="2.4"/><path d="M7.6 21a4.4 4.4 0 0 1 8.8 0"/>
                        </svg>
                        ${escapeHtml(name)}
                    </span>
                </div>
                <span>Generated ${new Date().toLocaleString('en-GB')}</span>
            </div>
        </div>
        <div id="report"><div class="loader">Loading activity…</div></div>
    `;

    const { data, error } = await db.from('login_sessions')
        .select('started_at, last_seen_at, ended_at')
        .eq('student_id', studentId)
        .order('started_at', { ascending: false });

    const report = document.getElementById('report');
    if (error) { report.innerHTML = `<div class="loader" style="color:var(--red)">Error: ${escapeHtml(error.message)}</div>`; return; }

    const sessions = data || [];
    if (sessions.length === 0) {
        report.innerHTML = `<div class="empty-state"><h3>No activity yet</h3><p>This student hasn't logged into the portal yet, or sessions are still being recorded.</p></div>`;
        return;
    }

    // Group by day; per-session duration = (ended_at || last_seen_at) - started_at.
    // A session counts as "active" if it hasn't ended and was seen in the last 3 min.
    const days = {};   // dayKey -> { total, rows: [] }
    let grand = 0;
    const now = Date.now();
    sessions.forEach(s => {
        const start = new Date(s.started_at);
        const endedAt = s.ended_at ? new Date(s.ended_at) : null;
        const lastSeen = s.last_seen_at ? new Date(s.last_seen_at) : null;
        const end = endedAt || lastSeen || start;
        const active = !endedAt && (now - (lastSeen || start).getTime()) < 600000;  // seen in last 10 min
        const dur = Math.max(0, (end - start) / 1000);
        grand += dur;
        const k = dayKey(s.started_at);
        if (!days[k]) days[k] = { total: 0, rows: [], sort: start.getTime() };
        days[k].total += dur;
        days[k].sort = Math.max(days[k].sort, start.getTime());
        days[k].rows.push({ start, end, dur, active });
    });

    const ordered = Object.keys(days).sort((a, b) => days[b].sort - days[a].sort);
    const badgeActive = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#dcfce7;color:#15803d;white-space:nowrap;">● Active</span>`;
    const badgeEnded = `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;background:#fee2e2;color:#b91c1c;white-space:nowrap;">Ended</span>`;

    report.innerHTML = `
        <div class="grand"><div>Total time recorded (all days)</div><div class="g-val">${fmtDur(grand)}</div></div>
        <p class="hint no-print" style="margin:10px 2px 16px;">Each row is one login session: <strong>Started → Ended</strong>, with how long it lasted. <span style="color:#15803d;font-weight:600;">● Active</span> means the student is still in the portal.</p>
        ${ordered.map(k => {
            const d = days[k];
            d.rows.sort((a, b) => a.start - b.start);
            return `
            <div class="day-card">
                <div class="day-head"><div class="d-date">${escapeHtml(k)}</div><div class="d-total">Total: ${fmtDur(d.total)}</div></div>
                ${d.rows.map(r => {
                    const endPart = r.active
                        ? `<span style="color:#15803d;font-weight:600;">still active</span>`
                        : `<strong>Ended</strong> ${fmtTime(r.end)}`;
                    return `<div class="sess-row">
                        <span><strong>Started</strong> ${fmtTime(r.start)} <span style="color:var(--text-muted);">→</span> ${endPart}</span>
                        <span style="display:inline-flex;align-items:center;gap:12px;">
                            <span class="dur">${fmtDur(r.dur)}</span>
                            ${r.active ? badgeActive : badgeEnded}
                        </span>
                    </div>`;
                }).join('')}
            </div>`;
        }).join('')}
    `;
}
