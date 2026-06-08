// Shared admin layout — renders sidebar + topbar, enforces admin auth.

const NAV_ITEMS = [
    { id: 'dashboard', label: 'Dashboard', href: 'dashboard.html', icon: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>' },
    { id: 'students', label: 'Students', href: 'students.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
    { id: 'rooms', label: 'Rooms & Courses', href: 'rooms.html', icon: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>' },
    { id: 'calendar', label: 'Calendar', href: 'calendar.html', icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>' },
    { id: 'announcements', label: 'Announcements', href: 'announcements.html', icon: '<path d="M3 11l18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' }
];

function renderLayout(activeId, pageTitle, pageSub, profile) {
    const initials = (profile.full_name || 'A').trim().split(/\s+/).map(w => w[0]).slice(0,2).join('').toUpperCase();

    const navHtml = NAV_ITEMS.map(item => `
        <a href="${item.href}" class="nav-item ${item.id === activeId ? 'active' : ''}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${item.icon}</svg>
            ${item.label}
        </a>
    `).join('');

    document.getElementById('app-layout').innerHTML = `
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-logo">
                <img src="assets/images/mda-logo.png" alt="MDA">
                <div class="brand-text">
                    <strong>MDA Admin</strong>
                    <span>Office Portal</span>
                </div>
            </div>
            <nav class="nav-menu">${navHtml}</nav>
            <div class="sidebar-footer">
                <button class="logout-btn" id="logout-btn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
                    </svg>
                    Sign Out
                </button>
            </div>
        </aside>
        <div class="main">
            <header class="topbar">
                <div>
                    <h1>${pageTitle}</h1>
                    ${pageSub ? `<div class="page-sub">${pageSub}</div>` : ''}
                </div>
                <div class="topbar-user">
                    <div class="user-info">
                        <strong>${profile.full_name || 'Admin'}</strong>
                        <span>Administrator</span>
                    </div>
                    <div class="avatar">${initials}</div>
                </div>
            </header>
            <div class="content" id="page-content"></div>
        </div>
    `;

    document.getElementById('logout-btn').addEventListener('click', signOut);
}
