/* ===========================
   AUTOFLOW DASHBOARD v2 — Scripts
   =========================== */

// --- Page navigation ---
function initNav() {
  const links = document.querySelectorAll('.sb-link[data-page]');
  const pages = document.querySelectorAll('.page');
  const title = document.getElementById('page-title');

  const names = {
    overview:'Vue d\'ensemble', workflows:'Workflows', ai:'Intelligence IA',
    analytics:'Analytics', integrations:'Intégrations', leads:'Leads CRM',
    emails:'Emails', scheduler:'Planificateur', clients:'Clients', settings:'Paramètres'
  };

  links.forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const id = link.dataset.page;
      links.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      pages.forEach(p => p.classList.remove('active'));
      const p = document.getElementById('page-' + id);
      if (p) p.classList.add('active');
      if (title) title.textContent = names[id] || id;
      // close mobile sidebar
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sb-overlay')?.classList.remove('visible');
      // Reload CRM data when navigating to leads
      if (id === 'leads') {
        loadInbox();
        loadPipeline();
      }
    });
  });
}

// --- Sidebar toggle ---
function initSidebar() {
  const btn = document.getElementById('sb-toggle');
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sb-overlay');
  if (!btn || !sb) return;

  function openSb()  { sb.classList.add('open'); if (ov) ov.classList.add('visible'); }
  function closeSb() { sb.classList.remove('open'); if (ov) ov.classList.remove('visible'); }

  btn.addEventListener('click', () => sb.classList.contains('open') ? closeSb() : openSb());
  if (ov) ov.addEventListener('click', closeSb);

  document.addEventListener('click', e => {
    if (window.innerWidth <= 800 && !sb.contains(e.target) && !btn.contains(e.target))
      closeSb();
  });
}

// --- Date display ---
function initDate() {
  const el = document.getElementById('current-date');
  if (!el) return;
  const now = new Date();
  const opts = { weekday:'long', day:'numeric', month:'long', year:'numeric' };
  el.textContent = now.toLocaleDateString('fr-FR', opts);
  // Capitalize first letter
  el.textContent = el.textContent.charAt(0).toUpperCase() + el.textContent.slice(1);
}

// --- Counters ---
function initCounters() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const target = parseInt(el.dataset.count, 10);
      const dur = 1400;
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min((now - t0) / dur, 1);
        el.textContent = Math.floor(target * (1 - Math.pow(1 - p, 3))).toLocaleString('fr-FR');
        if (p < 1) requestAnimationFrame(tick);
        else el.textContent = target.toLocaleString('fr-FR');
      };
      requestAnimationFrame(tick);
      io.unobserve(el);
    });
  }, { threshold: 0.5 });
  document.querySelectorAll('[data-count]').forEach(el => io.observe(el));
}

// --- Chart tabs ---
function initTabs() {
  document.querySelectorAll('.tab-group').forEach(g => {
    g.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        g.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        document.querySelectorAll('.bar').forEach(b => {
          b.style.height = (Math.random() * 60 + 30) + '%';
        });
      });
    });
  });
}

// --- AI demo ---
function initAI() {
  const inp = document.getElementById('ai-inp');
  const btn = document.getElementById('ai-send');
  const feed = document.getElementById('ai-feed');
  if (!inp || !btn || !feed) return;

  const replies = [
    'Analyse complétée. 3 opportunités identifiées.',
    'Workflow déclenché. Équipe notifiée via Slack.',
    'Rapport généré et disponible dans Analytics.',
    'Aucune anomalie détectée dans les 24 dernières heures.',
    'Optimisation appliquée. Temps de traitement réduit de 23%.',
  ];

  function send() {
    const t = inp.value.trim();
    if (!t) return;
    const u = document.createElement('div');
    u.className = 'ai-msg user';
    u.textContent = t;
    feed.appendChild(u);
    inp.value = '';
    feed.scrollTop = feed.scrollHeight;

    setTimeout(() => {
      const b = document.createElement('div');
      b.className = 'ai-msg bot';
      const r = document.createElement('span');
      r.className = 'ai-role';
      r.textContent = 'AutoFlow IA';
      b.appendChild(r);
      b.append(replies[Math.floor(Math.random() * replies.length)]);
      feed.appendChild(b);
      feed.scrollTop = feed.scrollHeight;
    }, 600);
  }

  btn.addEventListener('click', send);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

// ===========================
// API LAYER
// ===========================
const API = `${window.location.origin}/api`;
const COMPANY_ID = 1;

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return res.json();
}

function initials(name) {
  return (name || '??').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function timeAgo(dateStr) {
  let dStr = dateStr;
  if (dStr && !dStr.includes('T')) {
    dStr = dStr.replace(' ', 'T') + 'Z';
  }
  const diff = Date.now() - new Date(dStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "À l'instant";
  if (m < 60) return `Il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Il y a ${h}h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'Hier';
  return `Il y a ${d}j`;
}

function scoreClass(score) {
  if (score >= 80) return 'high';
  if (score >= 50) return 'mid';
  if (score >= 20) return 'low';
  return 'none';
}

// ===========================
// CRM MODULE (API-driven)
// ===========================
async function initCRM() {
  // Tab switching
  const tabs   = document.querySelectorAll('.crm-tab');
  const panels = document.querySelectorAll('.crm-panel');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      panels.forEach(p => p.classList.remove('active'));
      const target = document.getElementById('crm-' + tab.dataset.crm);
      if (target) target.classList.add('active');
      if (window.lucide) lucide.createIcons();
    });
  });

  // Contact panel close
  const panel  = document.getElementById('contact-panel');
  const closer = document.getElementById('cp-close');
  if (closer && panel) {
    closer.addEventListener('click', () => panel.classList.remove('open'));
  }

  // Load all CRM data from API
  await Promise.all([
    loadInbox(),
    loadPipeline(),
    loadConfig(),
  ]);
}

// ===========================
// INBOX (API-driven)
// ===========================
async function loadInbox(tagFilter) {
  const url = tagFilter && tagFilter !== 'all'
    ? `/companies/${COMPANY_ID}/emails?tag=${tagFilter}`
    : `/companies/${COMPANY_ID}/emails`;
  const emails = await api(url);

  const list = document.querySelector('.inbox-list');
  if (!list) return;
  list.innerHTML = '';

  emails.forEach(em => {
    const isHot = em.tag === 'lead' && em.score >= 80;
    const item = document.createElement('div');
    item.className = `inbox-item${isHot ? ' lead-hot' : ''}${em.read ? ' read' : ''}${em.tag === 'spam' ? ' spam' : ''}`;
    item.dataset.emailId = em.id;

    item.innerHTML = `
      <div class="inbox-check"><input type="checkbox"></div>
      <div class="inbox-sender">
        <div class="inbox-avatar">${initials(em.from_name)}</div>
        <div>
          <div class="inbox-name">${em.from_name}</div>
          <div class="inbox-company">${em.from_email}</div>
        </div>
      </div>
      <div class="inbox-preview">
        <div class="inbox-subject">${em.subject}</div>
        <div class="inbox-snippet">${em.snippet || ''}</div>
      </div>
      <div class="inbox-meta">
        <span class="ia-score ${scoreClass(em.score)}">Score ${em.score}</span>
        <span class="ia-tag ${em.tag === 'lead' ? 'lead' : em.tag === 'support' ? 'support' : 'spam-tag'}">${em.tag}</span>
        <span class="inbox-time">${timeAgo(em.created_at)}</span>
      </div>
    `;

    // Click to open contact panel with matching lead
    item.addEventListener('click', () => openContactByEmail(em));
    list.appendChild(item);
  });

  // Update filter counts
  const allEmails = await api(`/companies/${COMPANY_ID}/emails`);
  const counts = { all: allEmails.length, lead: 0, support: 0, spam: 0 };
  allEmails.forEach(e => { if (counts[e.tag] !== undefined) counts[e.tag]++; });

  const filters = document.querySelectorAll('.inbox-filter');
  const filterKeys = ['all', 'lead', 'support', 'spam'];
  filters.forEach((f, i) => {
    const key = filterKeys[i];
    const fc = f.querySelector('.fcount');
    if (fc) fc.textContent = counts[key] || 0;

    // Rebind click
    f.onclick = () => {
      filters.forEach(x => x.classList.remove('active'));
      f.classList.add('active');
      loadInbox(key);
    };
  });

  // Search
  const searchInput = document.querySelector('.inbox-search input');
  if (searchInput && !searchInput.dataset.bound) {
    searchInput.dataset.bound = '1';
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      document.querySelectorAll('.inbox-item').forEach(item => {
        const text = item.textContent.toLowerCase();
        item.style.display = text.includes(q) ? '' : 'none';
      });
    });
  }
}

// ===========================
// PIPELINE (API-driven)
// ===========================
async function loadPipeline() {
  const leads = await api(`/companies/${COMPANY_ID}/leads`);
  const stages = { new: [], qualified: [], contacted: [], converted: [] };
  leads.forEach(l => { if (stages[l.stage]) stages[l.stage].push(l); });

  const cols = document.querySelectorAll('.kanban-col');
  const stageKeys = ['new', 'qualified', 'contacted', 'converted'];

  cols.forEach((col, i) => {
    const key = stageKeys[i];
    if (!stages[key]) return;
    const cardsContainer = col.querySelector('.kanban-cards');
    const countEl = col.querySelector('.kanban-count');
    if (!cardsContainer) return;
    cardsContainer.innerHTML = '';
    if (countEl) countEl.textContent = stages[key].length;

    stages[key].forEach(lead => {
      const isHot = lead.score >= 80 && key === 'qualified';
      const isSuccess = key === 'converted';
      const card = document.createElement('div');
      card.className = `kanban-card${isHot ? ' hot' : ''}${isSuccess ? ' success' : ''}`;
      card.dataset.leadId = lead.id;

      let badge = '';
      if (isHot) badge = '<div class="kc-badge">Lead chaud</div>';
      if (isSuccess) badge = '<div class="kc-badge success">Converti</div>';

      let bottom = '';
      if (key === 'converted' && lead.plan) {
        bottom = `<span class="kc-plan">${lead.plan}</span>`;
      } else {
        bottom = `<span class="kc-time">${timeAgo(lead.created_at)}</span>`;
      }

      card.innerHTML = `
        ${badge}
        <div class="kc-name">${lead.name}</div>
        <div class="kc-co">${lead.company_name || ''} · ${lead.city || ''}</div>
        <div class="kc-row">
          <span class="ia-score ${scoreClass(lead.score)}">${lead.score}</span>
          ${bottom}
        </div>
      `;

      card.addEventListener('click', () => openContactPanel(lead));
      cardsContainer.appendChild(card);
    });
  });

  if (window.lucide) lucide.createIcons();
}

// ===========================
// CONTACT PANEL (API-driven)
// ===========================
async function openContactPanel(lead) {
  const panel = document.getElementById('contact-panel');
  if (!panel) return;

  // Fetch full lead detail with activity
  let fullLead;
  try {
    fullLead = await api(`/companies/${COMPANY_ID}/leads/${lead.id}`);
  } catch { fullLead = lead; }

  panel.querySelector('.cp-avatar').textContent = initials(lead.name);
  panel.querySelector('.cp-name').textContent = lead.name;
  panel.querySelector('.cp-company').textContent = `${lead.company_name || ''} · ${lead.city || ''}`;
  panel.querySelector('.cp-score').innerHTML = `<span class="ia-score ${scoreClass(lead.score)}">Score ${lead.score}</span>`;

  // Contact info
  const section = panel.querySelector('.cp-section');
  const rows = section.querySelectorAll('.cp-row');
  if (rows[0]) rows[0].innerHTML = `<i data-lucide="mail"></i> ${lead.email || 'N/A'}`;
  if (rows[1]) rows[1].innerHTML = `<i data-lucide="phone"></i> ${lead.phone || 'N/A'}`;
  if (rows[2]) rows[2].innerHTML = `<i data-lucide="building-2"></i> ${lead.company_name || 'N/A'}`;
  if (rows[3]) rows[3].innerHTML = `<i data-lucide="map-pin"></i> ${lead.city || 'N/A'}`;

  // Activity timeline
  const timeline = panel.querySelector('.cp-timeline');
  if (timeline && fullLead.activity && fullLead.activity.length) {
    timeline.innerHTML = fullLead.activity.map(a => `
      <div class="cp-event">
        <div class="cp-ev-dot ${a.action.includes('notif') ? 'green' : 'blue'}"></div>
        <div class="cp-ev-body"><strong>${a.action.replace(/_/g, ' ')}</strong> · ${a.detail || ''}<br><span>${timeAgo(a.created_at)}</span></div>
      </div>
    `).join('');
  }

  if (window.lucide) lucide.createIcons();
  panel.classList.add('open');
}

async function openContactByEmail(email) {
  // Find the lead matching this email
  const leads = await api(`/companies/${COMPANY_ID}/leads`);
  const match = leads.find(l => l.email === email.from_email);
  if (match) {
    openContactPanel(match);
  } else {
    // Show email info as a pseudo-lead
    openContactPanel({
      id: null, name: email.from_name, email: email.from_email,
      company_name: '', city: '', score: email.score, phone: ''
    });
  }
}

// ===========================
// CONFIG (API-driven)
// ===========================
async function loadConfig() {
  const company = await api(`/companies/${COMPANY_ID}`);
  const config = company.config || {};

  // Gmail connection status
  try {
    const gmail = await api(`/companies/${COMPANY_ID}/gmail-status`);
    const statusEl = document.getElementById('gmail-status');
    if (statusEl) {
      if (gmail.connected) {
        statusEl.innerHTML = `<span style="color:#34c759">● Connecté</span> — ${gmail.email} <button id="gmail-disconnect" style="margin-left:8px;background:none;border:1px solid #d1d1d6;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:12px;color:#86868b">Déconnecter</button>`;
        document.getElementById('gmail-disconnect')?.addEventListener('click', async () => {
          await api(`/companies/${COMPANY_ID}/gmail-disconnect`, { method: 'POST' });
          loadConfig();
        });
      } else {
        statusEl.innerHTML = `<span style="color:#ff9500">● Non connecté</span> <a href="/auth/gmail?company=${COMPANY_ID}" style="margin-left:8px;display:inline-block;background:#0071e3;color:white;border-radius:8px;padding:6px 16px;text-decoration:none;font-size:13px;font-weight:500">Connecter Gmail</a>`;
      }
    }
  } catch (e) { console.log('Gmail status check failed:', e); }

  // Email provider select
  const providerSelect = document.querySelector('.config-card:nth-child(1) select');
  if (providerSelect) {
    const providers = { gmail: 0, outlook: 1, imap: 2 };
    providerSelect.selectedIndex = providers[config.email_provider] || 0;
  }

  // Email address input
  const emailInput = document.querySelector('.config-card:nth-child(1) input[type="email"]');
  if (emailInput) emailInput.value = config.email_address || '';

  // Hot threshold range
  const ranges = document.querySelectorAll('.config-range');
  const rangeVals = document.querySelectorAll('.range-val');
  if (ranges[0]) { ranges[0].value = config.hot_threshold || 80; if (rangeVals[0]) rangeVals[0].textContent = ranges[0].value; }
  if (ranges[1]) { ranges[1].value = config.warm_threshold || 50; if (rangeVals[1]) rangeVals[1].textContent = ranges[1].value; }

  // Live range update
  ranges.forEach(range => {
    const val = range.closest('.range-row')?.querySelector('.range-val');
    if (val) range.addEventListener('input', () => val.textContent = range.value);
  });

  // Keywords
  const tagList = document.querySelector('.tag-list');
  const tagInput = document.querySelector('.tag-input');
  if (tagList && config.keywords) {
    // Clear existing tags, keep input
    tagList.querySelectorAll('.tag').forEach(t => t.remove());
    config.keywords.forEach(kw => addTagElement(tagList, tagInput, kw));
  }

  // Tag add
  if (tagInput && !tagInput.dataset.bound) {
    tagInput.dataset.bound = '1';
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter' && tagInput.value.trim()) {
        addTagElement(tagList, tagInput, tagInput.value.trim());
        tagInput.value = '';
      }
    });
  }

  // Notification toggles
  const toggles = document.querySelectorAll('.config-toggle-row input[type="checkbox"]');
  const notifKeys = ['slack', 'email', 'sms', 'teams'];
  toggles.forEach((t, i) => {
    t.checked = config.notifications?.[notifKeys[i]] || false;
  });

  // CRM destination
  const crmSelect = document.querySelector('.config-card:nth-child(4) select:nth-of-type(1)');
  if (crmSelect) {
    const crms = { autoflow: 0, hubspot: 1, salesforce: 2, pipedrive: 3 };
    crmSelect.selectedIndex = crms[config.crm_destination] || 0;
  }

  // Save button → send config to API
  const saveBtn = document.querySelector('.config-save');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const providers = ['gmail', 'outlook', 'imap'];
      const crms = ['autoflow', 'hubspot', 'salesforce', 'pipedrive'];
      const hotActions = ['ticket_and_notify', 'ticket_only', 'notify_only'];
      const coldActions = ['archive_weekly', 'ignore', 'queue'];

      const newConfig = {
        email_provider: providers[providerSelect?.selectedIndex || 0],
        email_address: emailInput?.value || '',
        hot_threshold: parseInt(ranges[0]?.value) || 80,
        warm_threshold: parseInt(ranges[1]?.value) || 50,
        keywords: [...tagList.querySelectorAll('.tag')].map(t => t.childNodes[0].textContent.trim()),
        notifications: {},
        crm_destination: crms[crmSelect?.selectedIndex || 0],
        hot_action: hotActions[document.querySelector('.config-card:nth-child(4) select:nth-of-type(2)')?.selectedIndex || 0],
        cold_action: coldActions[document.querySelector('.config-card:nth-child(4) select:nth-of-type(3)')?.selectedIndex || 0],
      };
      notifKeys.forEach((k, i) => { newConfig.notifications[k] = toggles[i]?.checked || false; });

      await api(`/companies/${COMPANY_ID}/config`, { method: 'PUT', body: newConfig });

      // Visual feedback
      const orig = saveBtn.innerHTML;
      saveBtn.innerHTML = '<i data-lucide="check"></i> Sauvegardé !';
      saveBtn.style.background = '#34c759';
      if (window.lucide) lucide.createIcons();
      setTimeout(() => {
        saveBtn.innerHTML = orig;
        saveBtn.style.background = '';
        if (window.lucide) lucide.createIcons();
      }, 1500);
    };
  }
}

function addTagElement(tagList, tagInput, text) {
  const tag = document.createElement('span');
  tag.className = 'tag';
  tag.textContent = text;
  const rm = document.createElement('button');
  rm.textContent = '×';
  rm.addEventListener('click', () => tag.remove());
  tag.appendChild(rm);
  if (tagInput) tagList.insertBefore(tag, tagInput);
  else tagList.appendChild(tag);
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  initNav();
  initSidebar();
  initCounters();
  initTabs();
  initAI();
  initDate();
  initCRM();
  // Render Lucide icons
  if (window.lucide) lucide.createIcons();
});
