/* ═══════════════════════════════════════════════════════════════════
   CRIMENET — Forensic Network Analysis & Link Discovery
   Investigative Workbench Engine
   ═══════════════════════════════════════════════════════════════════ */

const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : '/api';

// ── State ──────────────────────────────────────────────────────────────────────
let graphData         = null;
let activeNodeId      = null;
let activeEdge        = null;
let isolatedClusterId = null;
let zoomBehavior      = null;
let svgSel            = null;
let gRootSel          = null;
let activeNodeMap     = null;
let activeEdges       = null;

// ── DOM Elements ───────────────────────────────────────────────────────────────
const $  = id => document.getElementById(id);
const el = {
  overlay:      $('loading-overlay'),
  loadingMsg:   $('loading-msg'),
  emptyState:   $('empty-state'),
  graphSvg:     $('graph-svg'),
  detailPanel:  $('detail-panel'),
  detailTitle:  $('detail-title'),
  detailBody:   $('detail-body'),
  graphStats:   $('graph-stats'),
  zoomCtrls:    $('zoom-controls'),
  tooltip:      $('graph-tooltip'),
  aiModal:      $('ai-modal-overlay'),
  aiBody:       $('ai-modal-body'),
  aiTitle:      $('ai-modal-title'),
  datasetList:  $('dataset-list'),
  filterSec:    $('filter-section'),
  legendSec:    $('legend-section'),
  infoBanner:   $('info-banner'),
  infoBannerTxt:$('info-banner-text'),
  poiOverlay:   $('poi-overlay'),
  poiBody:      $('poi-body'),
  poiCount:     $('poi-count'),
};

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initButtons();
  initNodeSearch();
  initShortcutsModal();
  initKeyboardNav();
  loadDatasetList();
});

// ── Loading ────────────────────────────────────────────────────────────────────
function showLoading(msg = 'Processing investigation data…') {
  el.loadingMsg.textContent = msg;
  el.overlay.classList.remove('hidden');
}
function hideLoading() {
  el.overlay.classList.add('hidden');
}

// ── Evidence Upload ────────────────────────────────────────────────────────────
const ALLOWED_EXTS = ['.csv', '.json', '.xls', '.xlsx', '.txt'];

function initUpload() {
  const zone  = $('upload-zone');
  const input = $('file-input');
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', e => { if (e.target.files[0]) uploadFile(e.target.files[0]); });
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f && ALLOWED_EXTS.some(ext => f.name.toLowerCase().endsWith(ext))) uploadFile(f);
    else showBanner('Unsupported file type. Please use CSV, JSON, XLS, XLSX, or TXT.', 'danger');
  });

  // Show Prototype toggle
  $('btn-show-prototype')?.addEventListener('click', () => {
    const list = $('dataset-list');
    const btn  = $('btn-show-prototype');
    const hidden = list.style.display === 'none';
    list.style.display = hidden ? '' : 'none';
    btn.querySelector('span').textContent = hidden ? 'Hide Prototype Data' : 'Show Prototype Data';
    if (hidden) loadDatasetList();
  });
}

async function uploadFile(file) {
  const fnEl = $('upload-filename');
  if (fnEl) { $('upload-filename-text').textContent = file.name; fnEl.classList.add('visible'); }
  showLoading(`Parsing ${file.name}…`);
  const form = new FormData();
  form.append('file', file);
  form.append('amount_threshold', 0);
  try {
    const res  = await fetch(`${API}/upload`, { method: 'POST', body: form });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    handleGraphResponse(json.graph, file.name);
  } catch (err) {
    hideLoading();
    // If backend rejected, still show a helpful message about file format
    if (err.message && err.message.includes('CSV')) {
      showBanner('This file type may not be directly supported. Please convert to CSV for best results.', 'danger');
    } else {
      showBanner('Ingestion error: ' + err.message, 'danger');
    }
  }
}

// ── Evidence Repositories List ─────────────────────────────────────────────────
async function loadDatasetList() {
  try {
    const res  = await fetch(`${API}/datasets`);
    const json = await res.json();
    el.datasetList.innerHTML = '';
    json.datasets.forEach(ds => {
      const div = document.createElement('div');
      div.className = 'dataset-item';
      div.dataset.key = ds.key;
      div.innerHTML = `
        <div class="dataset-info">
          <div class="dataset-name">${ds.label}</div>
          <div class="dataset-meta">${ds.filename}</div>
        </div>
        <span class="dataset-size">${ds.size_kb} KB</span>`;
      div.addEventListener('click', () => loadSingleDemo(ds.key, div));
      el.datasetList.appendChild(div);
    });
  } catch {
    el.datasetList.innerHTML = '<div class="dataset-loading">Investigation service offline — verify backend service is active</div>';
  }
}

async function loadSingleDemo(key, itemEl) {
  document.querySelectorAll('.dataset-item').forEach(e => e.classList.remove('active'));
  itemEl?.classList.add('active');
  showLoading('Loading evidence repository…');
  try {
    const res  = await fetch(`${API}/load-demo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dataset: key, amount_threshold: 0 }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    handleGraphResponse(json.graph, json.filename);
  } catch (err) {
    hideLoading();
    showBanner('Correlation error: ' + err.message, 'danger');
  }
}

async function loadAllFiles(suspectedOnly = false) {
  document.querySelectorAll('.dataset-item').forEach(e => e.classList.remove('active'));
  showLoading(suspectedOnly
    ? 'Isolating suspect subnets across evidence repositories…'
    : 'Correlating multi-source evidence repositories…');
  try {
    const res  = await fetch(`${API}/load-all-demos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ suspected_only: suspectedOnly, amount_threshold: 0 }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    handleGraphResponse(json.graph, suspectedOnly ? 'Suspect Subnets (Correlated)' : 'Multi-Source Correlation');
  } catch (err) {
    hideLoading();
    showBanner('Multi-source analysis error: ' + err.message, 'danger');
  }
}

// ── Graph Response Handler ─────────────────────────────────────────────────────
function handleGraphResponse(graph, filename) {
  hideLoading();
  hideBanner();

  if (graph.message === 'vehicle_registrations_only') {
    showBanner('Vehicle registry records loaded. Execute "Correlate All Repositories" to link against call logs and financial ledgers.', 'info');
    hideLoading();
    return;
  }

  if (!graph.nodes || graph.nodes.length === 0) {
    showBanner('No entity nodes detected in this evidence file. Select an alternate source or execute correlation.', 'info');
    return;
  }

  renderGraph(graph, filename);
}

// ── Operational Banner ─────────────────────────────────────────────────────────
let _bannerTimer = null;
function showBanner(text, type = 'info') {
  el.infoBannerTxt.textContent = text;
  el.infoBanner.classList.remove('hidden', 'toast-out', 'toast-info', 'toast-danger', 'toast-warning', 'toast-success');
  el.infoBanner.classList.add('toast-' + (type === 'danger' ? 'danger' : type));
  clearTimeout(_bannerTimer);
  _bannerTimer = setTimeout(hideBanner, 4000);
}
function hideBanner() {
  el.infoBanner.classList.add('toast-out');
  setTimeout(() => el.infoBanner.classList.add('hidden'), 250);
}

// ── Taxonomy Palette ───────────────────────────────────────────────────────────
// ── Colour helpers (indigo/purple palette) ──────────────────────────────────────
const EDGE_COLORS = {
  'phone call':            '#34d399',
  'shared bank account':   '#fde68a',
  'financial transaction': '#fbbf24',
  'vehicle transfer':      '#a78bfa',
  'same criminal cluster': '#38bdf8',
  'connected':             '#6366f1',
};
function edgeStroke(type, suspicious) {
  if (suspicious) return '#f87171';
  return EDGE_COLORS[type] || '#6366f1';
}
function nodeFill(node)   { return node.is_criminal ? (node.has_stolen_vehicle ? '#3a2a55' : '#3a1f2e') : '#1e2a4a'; }
function nodeStroke(node) { return node.is_criminal ? (node.has_stolen_vehicle ? '#a78bfa' : '#f87171') : '#60a5fa'; }

function nodeR(node) {
  return 13 + Math.min(10, Math.sqrt(node.degree || 0) * 2.8);
}

// ── Main Graph Visualizer ──────────────────────────────────────────────────────
function renderGraph(data, filename) {
  graphData    = data;
  activeNodeId = null;
  activeEdge   = null;

  $('stat-num-persons').textContent  = data.stats.total_persons;
  $('stat-num-links').textContent    = data.stats.total_edges;
  $('stat-num-clusters').textContent = data.stats.total_clusters;
  el.graphStats.style.display = 'flex';
  ['btn-poi','btn-summary','btn-anomalies','btn-path-tracer','btn-timeline-toggle','btn-vulnerability','btn-criminals-output','btn-reset'].forEach(id => {
    if ($(id)) $(id).style.display = '';
  });
  populatePathDatalist();
  initTimeline();
  fetchVulnerabilityData();
  el.filterSec.style.display = '';
  el.legendSec.style.display = '';

  el.emptyState.classList.add('hidden');
  el.graphSvg.classList.remove('hidden');
  el.zoomCtrls.classList.remove('hidden');
  closeDetailPanel();

  const wrapper = $('canvas-wrapper');
  const W = wrapper.clientWidth  || 900;
  const H = wrapper.clientHeight || 700;

  const BACKEND_CANVAS = 3000;
  const initScale = Math.min((W * 0.9) / BACKEND_CANVAS, (H * 0.9) / BACKEND_CANVAS);

  const nodes = data.nodes.map(n => ({ ...n }));
  const nodeMap = {};
  nodes.forEach(n => { nodeMap[n.id] = n; });
  activeNodeMap = nodeMap;

  // SVG Layers
  svgSel   = d3.select('#graph-svg');
  gRootSel = d3.select('#graph-root');
  gRootSel.selectAll('*').remove();

  const gClusters = gRootSel.append('g').attr('class', 'layer-clusters');
  const gEdges    = gRootSel.append('g').attr('class', 'layer-edges');
  const gNodes    = gRootSel.append('g').attr('class', 'layer-nodes');
  const gLabels   = gRootSel.append('g').attr('class', 'layer-labels');

  const CLUSTER_COLORS = [
    '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
    '#06b6d4', '#ec4899', '#14b8a6', '#f97316', '#6366f1',
    '#84cc16', '#d946ef',
  ];

  // Syndicate Boundary Boundaries
  data.clusters.forEach(cluster => {
    if (cluster.size < 2) return;
    const members = cluster.members.map(id => nodeMap[id]).filter(Boolean);
    if (!members.length) return;

    const cx   = members.reduce((s, n) => s + n.x, 0) / members.length;
    const cy   = members.reduce((s, n) => s + n.y, 0) / members.length;
    const maxR = Math.max(...members.map(n => Math.hypot(n.x - cx, n.y - cy)));
    const haloR = maxR + 38;
    const hue  = CLUSTER_COLORS[cluster.id % CLUSTER_COLORS.length];

    const gCluster = gClusters.append('g')
      .attr('class', 'cluster-group')
      .attr('data-cluster-id', cluster.id)
      .style('cursor', 'pointer');

    gCluster.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', haloR)
      .attr('fill', hexAlpha(hue, 0.04))
      .attr('stroke', hexAlpha(hue, 0.35))
      .attr('stroke-width', 1.3)
      .attr('stroke-dasharray', '5, 4')
      .attr('class', 'cluster-halo');

    gCluster.append('text')
      .attr('x', cx).attr('y', cy - haloR - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-weight', '700')
      .attr('letter-spacing', '0.08em')
      .attr('fill', hexAlpha(hue, 0.8))
      .text(`SYNDICATE #${cluster.id} [${cluster.size}]`);

    gCluster.on('click', ev => {
      ev.stopPropagation();
      isolateCluster(cluster, cx, cy, haloR);
    });
  });

  // Link Vectors
  const edges = data.edges.filter(e => nodeMap[e.source] && nodeMap[e.target]);
  activeEdges = edges;

  gEdges.selectAll('.edge-line')
    .data(edges)
    .enter().append('line')
    .attr('class', d => `edge-line${d.suspicious ? ' suspicious' : ''}`)
    .attr('x1', d => nodeMap[d.source].x)
    .attr('y1', d => nodeMap[d.source].y)
    .attr('x2', d => nodeMap[d.target].x)
    .attr('y2', d => nodeMap[d.target].y)
    .attr('stroke', d => edgeStroke(d.type, d.suspicious))
    .attr('stroke-width', d => {
      const base = 1.8;
      const bonus = d.total_amount ? Math.min(3, d.total_amount / 60000) : 0;
      return base + bonus;
    })
    .on('mouseenter', (ev, d) => showTooltip(ev, edgeTip(d)))
    .on('mousemove',  ev => moveTooltip(ev))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, d) => { ev.stopPropagation(); onEdgeClick(d, nodeMap); });

  // Entity Nodes
  const nodeSel = gNodes.selectAll('.node-g')
    .data(nodes).enter()
    .append('g')
    .attr('class', 'node-g')
    .attr('transform', d => `translate(${d.x},${d.y})`)
    .style('cursor', 'pointer')
    .on('mouseenter', (ev, d) => showTooltip(ev, nodeTip(d)))
    .on('mousemove',  ev => moveTooltip(ev))
    .on('mouseleave', hideTooltip)
    .on('click', (ev, d) => { ev.stopPropagation(); onNodeClick(d, edges, nodeMap); });

  // Tactical Surveillance Indicator for Known Criminals / POIs
    // Glow ring for criminals
  nodeSel.filter(d => d.is_criminal)
    .append('circle')
    .attr('class', 'node-glow-ring')
    .attr('r', d => nodeR(d) + 7)
    .attr('fill', 'none')
    .attr('stroke', d => nodeStroke(d))
    .attr('stroke-width', 1.2)
    .attr('opacity', 0.5)
    .attr('pointer-events', 'none');

  // Solid Core Node
  nodeSel.append('circle')
    .attr('class', 'node-circle')
    .attr('r', d => nodeR(d))
    .attr('fill', d => nodeFill(d))
    .attr('stroke', d => nodeStroke(d))
    .attr('stroke-width', 2.2);

  // Multi-Repository Correlated Badge
  nodeSel.filter(d => d.multi_source)
    .append('circle')
    .attr('r', 4.5).attr('cx', d => nodeR(d) - 3).attr('cy', d => -nodeR(d) + 3)
    .attr('fill', '#eab308').attr('stroke', '#080c14').attr('stroke-width', 1.5)
    .attr('pointer-events', 'none');

  // Node Labels
  gLabels.selectAll('.node-label')
    .data(nodes).enter()
    .append('text')
    .attr('class', 'node-label')
    .attr('x', d => d.x)
    .attr('y', d => d.y + nodeR(d) + 14)
    .attr('data-id', d => d.id)
    .text(d => shortenName(d.label));

  // Zoom & Pan System
  zoomBehavior = d3.zoom()
    .scaleExtent([0.05, 6])
    .on('zoom', e => gRootSel.attr('transform', e.transform));

  svgSel.call(zoomBehavior);

  const initTransform = d3.zoomIdentity
    .translate(W / 2, H / 2)
    .scale(initScale)
    .translate(-BACKEND_CANVAS / 2, -BACKEND_CANVAS / 2);
  svgSel.call(zoomBehavior.transform, initTransform);

  svgSel.on('click', () => { clearHighlights(); closeDetailPanel(); });

  // Update POI badge count & taxonomy counts
  if (typeof updatePOICount === 'function') updatePOICount();
  updateLegendCounts(data);

  // Reset spotlight search for newly loaded graph
  $('canvas-search-wrap')?.classList.remove('hidden');
  const searchInput = $('node-search-input');
  if (searchInput) searchInput.value = '';
  $('node-search-clear')?.classList.add('hidden');
  $('search-dropdown')?.classList.add('hidden');
}

// ── Node Click Handler ─────────────────────────────────────────────────────────
function onNodeClick(node, edges, nodeMap) {
  activeNodeId = node.id;
  activeEdge   = null;
  isolatedClusterId = null;
  d3.selectAll('.cluster-group').attr('opacity', null);
  const connEdges = edges.filter(e => e.source === node.id || e.target === node.id);
  const connIds   = new Set(connEdges.map(e => e.source === node.id ? e.target : e.source));

  d3.selectAll('.edge-line')
    .attr('opacity', d => (d.source === node.id || d.target === node.id) ? 1 : 0.06)
    .classed('highlighted', d => d.source === node.id || d.target === node.id);

  d3.selectAll('.node-circle')
    .attr('stroke-width', d => d.id === node.id ? 4 : 2.2)
    .attr('r', d => d.id === node.id ? nodeR(d) + 3 : nodeR(d))
    .attr('opacity', d => (d.id === node.id || connIds.has(d.id)) ? 1 : 0.2);

  d3.selectAll('.node-label').classed('selected', d => d.id === node.id);

  openDetailPanel('node', node, connEdges, nodeMap);
}

// ── Edge Click Handler ─────────────────────────────────────────────────────────
function onEdgeClick(edge, nodeMap) {
  activeEdge   = edge;
  activeNodeId = null;
  isolatedClusterId = null;
  d3.selectAll('.cluster-group').attr('opacity', null);

  d3.selectAll('.edge-line')
    .attr('opacity', d => (d.source === edge.source && d.target === edge.target) ? 1 : 0.05);
  d3.selectAll('.node-circle')
    .attr('opacity', d => (d.id === edge.source || d.id === edge.target) ? 1 : 0.15);

  openDetailPanel('edge', edge, [], nodeMap);
}

// ── Clear Canvas Selections ───────────────────────────────────────────────────
function clearHighlights() {
  activeNodeId      = null;
  activeEdge        = null;
  isolatedClusterId = null;
  d3.selectAll('.edge-line').attr('opacity', null).classed('highlighted', false).classed('path-conduit', false).classed('disrupted-severed', false);
  d3.selectAll('.node-circle').attr('opacity', null).attr('r', d => nodeR(d)).attr('stroke-width', 2.2).classed('path-conduit-node', false);
  d3.selectAll('.node-g').attr('opacity', null);
  d3.selectAll('.node-label').classed('selected', false);
  d3.selectAll('.cluster-group').attr('opacity', null);
  document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active'));
  const notice = $('vuln-disruption-notice');
  if (notice) notice.style.display = 'none';
  hideBanner();
}

// ── Inspector Detail Panel ─────────────────────────────────────────────────────
function openDetailPanel(type, data, connEdges, nodeMap) {
  el.detailPanel.classList.add('open');
  type === 'node'
    ? renderNodeDetail(data, connEdges, nodeMap)
    : renderEdgeDetail(data, nodeMap);
}

function closeDetailPanel() {
  el.detailPanel.classList.remove('open');
  el.detailBody.innerHTML = '';
}
$('detail-close').addEventListener('click', () => { clearHighlights(); closeDetailPanel(); });

// ── Node Inspector ─────────────────────────────────────────────────────────────
function renderNodeDetail(node, connEdges, nodeMap) {
  el.detailTitle.textContent = node.label;
  const d = node.details || {};
  const risk = calcRisk(node, connEdges);
  const connIds = connEdges.map(e => e.source === node.id ? e.target : e.source);
  const edgeTypes = [...new Set(connEdges.map(e => e.type))];

  let h = `<div class="fade-in">`;

  // Classification Badges
  h += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">`;
  if (node.is_criminal) h += badge('PRIORITY POI', 'suspicious');
  else                  h += badge('CIVILIAN / ASSOCIATE', 'default');
  if (node.has_stolen_vehicle) h += badge('STOLEN ASSET LINK', 'vehicle');
  if (node.multi_source)       h += badge('CROSS-REPO CORRELATED', 'cluster');
  edgeTypes.forEach(t => h += badge(t, tagCls(t)));
  h += `</div>`;

  // Quick Action Bar
  h += `<div class="detail-actions-bar">
    <button class="btn btn-sm btn-ghost" onclick="focusNodeOnCanvas('${escapeHtml(node.id)}')" title="Center &amp; highlight on canvas">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
      </svg>
      <span>Focus</span>
    </button>
    <button class="btn btn-sm btn-primary" onclick="openPathTracerWithSource('${escapeHtml(node.id)}')" title="Trace multi-hop path conduit from this entity">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a3 3 0 0 0 3 3h6"/><polyline points="15 12 18 15 15 18"/>
      </svg>
      <span>Trace Path</span>
    </button>
    <button class="btn btn-sm btn-ghost" onclick="copyTextToClipboard('${escapeHtml(node.id)}', 'Entity ID copied to clipboard')" title="Copy Subject ID">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span>Copy ID</span>
    </button>
    <button class="btn btn-sm btn-ghost" onclick="copyNodeDossier('${escapeHtml(node.id)}')" title="Copy full investigative summary">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
        <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
      </svg>
      <span>Copy Brief</span>
    </button>
  </div>`;

  // Risk Assessment
  h += `<div class="detail-section">
    <div class="detail-section-title">THREAT &amp; INVOLVEMENT MATRIX</div>
    <div class="detail-row" style="margin-bottom:6px;">
      <span class="detail-key">Risk Rating</span>
      <strong style="color:${risk.color};font-family:var(--font-mono);">${risk.level} // ${risk.score}/100</strong>
    </div>
    <div class="risk-bar-track"><div class="risk-bar-fill" style="width:${risk.score}%;background:${risk.color};"></div></div>
    <div style="margin-top:6px;">${risk.factors.map(f => `<div style="font-size:11px;color:#94a3b8;padding:1px 0;">• ${f}</div>`).join('')}</div>
  </div>`;

  // Identity & Record Profile
  h += `<div class="detail-section"><div class="detail-section-title">IDENTITY &amp; RECORD PROFILE</div>`;
  [
    ['Subject ID',      d.person_id    || d.Mobile_Number],
    ['Bank Account',    d.account_no   || d.Bank_Account],
    ['Banking Entity',  d.bank],
    ['Account Class',   d.account_type],
    ['Routing / IFSC',  d.ifsc],
    ['Syndicate Subnet',d.cluster !== undefined ? `Syndicate #${d.cluster}` : `Syndicate #${node.cluster}`],
    ['Direct Linkages', node.degree],
    ['Evidence Sources',(node.sources || []).join(', ')],
  ].forEach(([k, v]) => {
    if (v != null && String(v) !== 'nan' && String(v).trim()) {
      h += `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`;
    }
  });
  h += `</div>`;

  // Vehicle Assets
  if (d.vehicles?.length) {
    h += `<div class="detail-section"><div class="detail-section-title">MOTOR VEHICLE ASSETS (${d.vehicles.length})</div>`;
    d.vehicles.forEach(v => {
      h += `<div class="vehicle-item">
        <div><span class="reg">${v.reg_no}</span>${v.status === 'Stolen' ? '<span class="stolen-badge">STOLEN</span>' : ''}</div>
        <div style="color:#94a3b8;margin-top:2px;">${v.make} · ${v.colour}</div>
        ${v.theft_date && v.theft_date !== 'nan' ? `<div style="color:#f87171;font-size:10px;margin-top:2px;font-family:var(--font-mono);">Incident Date: ${v.theft_date}</div>` : ''}
      </div>`;
    });
    h += `</div>`;
  }

  // Correlated Connections (Interactive Hop)
  if (connIds.length) {
    h += `<div class="detail-section"><div class="detail-section-title">RECORDED AFFILIATIONS (${connIds.length})</div>`;
    connIds.slice(0, 10).forEach(pid => {
      const p    = nodeMap[pid] || { id: pid };
      const edge = connEdges.find(e => e.source === pid || e.target === pid);
      const amt  = edge?.total_amount ? `<span style="color:#10b981;font-family:monospace;font-size:11px;"> ₹${Math.round(edge.total_amount).toLocaleString('en-IN')}</span>` : '';
      const cnt  = edge?.txn_count    ? `<span style="font-size:10px;color:#64748b;"> (${edge.txn_count} txns)</span>` : '';
      h += `<div class="detail-row affiliation-row" onclick="focusNodeOnCanvas('${escapeHtml(pid)}')" title="Hop to ${escapeHtml(p.label || pid)} on canvas">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;flex:1;">
          <div style="width:6px;height:6px;border-radius:50%;background:${nodeStroke(p)};flex-shrink:0;"></div>
          <span class="detail-key" style="${p.is_criminal ? 'color:#f87171;' : ''}">${p.is_criminal ? '[POI] ' : ''}${escapeHtml(p.label || pid)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
          ${badge(edge?.type || 'link', tagCls(edge?.type))}${amt}${cnt}
          <span class="affil-arrow">→</span>
        </div>
      </div>`;
    });
    if (connIds.length > 10) h += `<div style="font-size:11px;color:#64748b;margin-top:3px;font-family:var(--font-mono);">+${connIds.length - 10} additional links</div>`;
    h += `</div>`;
  }

  // Syndicate Assessment Trigger
  const cluster = graphData?.clusters?.find(c => c.id === node.cluster);
  if (cluster && cluster.size > 1) {
    h += `<button class="btn btn-dossier" onclick="analyzeCluster(${node.cluster})">
      Compile Syndicate Dossier (Net #${node.cluster})
    </button>`;
  }
  h += `</div>`;
  el.detailBody.innerHTML = h;
}

// ── Edge Inspector ─────────────────────────────────────────────────────────────
function renderEdgeDetail(edge, nodeMap) {
  el.detailTitle.textContent = 'Relationship Link';
  const na = nodeMap[edge.source] || { id: edge.source };
  const nb = nodeMap[edge.target] || { id: edge.target };

  let h = `<div class="fade-in">`;

  h += `<div class="detail-section">
    <div class="detail-section-title">CORRELATED ENTITIES</div>
    ${personRow(na, edge.source)}
    <div style="text-align:center;color:#64748b;font-size:10.5px;padding:4px 0;font-family:var(--font-mono);">↔ ${edge.type.toUpperCase()} ↔</div>
    ${personRow(nb, edge.target)}
  </div>`;

  // Financial Ledger Audit
  if (edge.total_amount) {
    const dr = edge.date_range || [];
    h += `<div class="detail-section">
      <div class="detail-section-title">TRANSACTION LEDGER AUDIT</div>
      <div style="padding:10px;background:#0a0f1a;border:1px solid rgba(16,185,129,0.3);border-radius:6px;text-align:center;">
        <div style="font-size:10px;font-family:var(--font-mono);color:#94a3b8;letter-spacing:0.06em;margin-bottom:2px;">AGGREGATE CAPITAL TRANSFERRED</div>
        <div style="font-size:20px;font-weight:700;color:#10b981;font-family:'JetBrains Mono',monospace;">
          ₹${Math.round(edge.total_amount).toLocaleString('en-IN')}
        </div>
        <div style="font-size:10.5px;color:#64748b;margin-top:3px;font-family:var(--font-mono);">
          ${edge.txn_count} transaction${edge.txn_count > 1 ? 's' : ''}
          ${dr[0] ? ` // ${dr[0]} to ${dr[1]}` : ''}
        </div>
      </div>
    </div>`;
  }

  h += `<div class="detail-section">
    <div class="detail-section-title">RELATIONSHIP TAXONOMY</div>
    ${badge(edge.type, tagCls(edge.type))}
    ${edge.suspicious ? badge('FLAGGED SUSPICIOUS', 'suspicious') : ''}
  </div>`;

  // Documentary Evidence
  const descs = edge.all_descriptions || [edge.description];
  h += `<div class="detail-section">
    <div class="detail-section-title">DOCUMENTARY EVIDENCE (${descs.length} RECORD${descs.length > 1 ? 'S' : ''})</div>`;
  descs.slice(0, 5).forEach(d => {
    h += `<div style="font-size:11px;color:#94a3b8;padding:4px 0;border-bottom:1px solid var(--border-subtle);">${d}</div>`;
  });
  if (descs.length > 5) h += `<div style="font-size:10.5px;color:#64748b;margin-top:3px;font-family:var(--font-mono);">+${descs.length - 5} additional records</div>`;
  h += `</div>`;

  h += `<button class="btn btn-dossier" onclick="explainEdge('${edge.source}','${edge.target}')">
    Generate Relationship Link Assessment
  </button>`;

  h += `</div>`;
  el.detailBody.innerHTML = h;
}

function personRow(node, name) {
  return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
    <div style="width:8px;height:8px;border-radius:50%;background:${nodeStroke(node)};flex-shrink:0;"></div>
    <span style="font-size:12.5px;font-weight:600;color:${node.is_criminal ? '#f87171' : '#f1f5f9'};">${name}</span>
    ${node.is_criminal ? badge('POI','suspicious') : ''}
    ${node.has_stolen_vehicle ? badge('STOLEN ASSET','vehicle') : ''}
  </div>`;
}

// ── Automated Syndicate Assessment ─────────────────────────────────────────────
async function analyzeCluster(clusterId) {
  if (!graphData) return;
  const cluster = graphData.clusters.find(c => c.id === clusterId);
  if (!cluster) return;
  const memberSet = new Set(cluster.members);
  const clusterEdges = graphData.edges.filter(e => memberSet.has(e.source) && memberSet.has(e.target));
  const nodeMap = {};
  graphData.nodes.forEach(n => { nodeMap[n.id] = n; });

  showAiModal(`Synthesizing Syndicate Assessment (Network #${clusterId})…`);
  try {
    const res  = await fetch(`${API}/analyze/cluster`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cluster_members: cluster.members,
        edges:           clusterEdges,
        person_details:  cluster.members.map(id => nodeMap[id]).filter(Boolean),
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    const a = json.analysis;
    el.aiBody.innerHTML = `<div class="fade-in">
      <div class="ai-section">
        <div class="ai-section-label">Syndicate Classification — Subnet #${clusterId} (${cluster.size} Associated Entities)</div>
        <div class="ai-section-value highlight">${a.crime_type || 'Syndicate classification in progress'}</div>
      </div>
      <div class="ai-section">
        <div class="ai-section-label">Primary Person of Interest / Key Facilitator</div>
        <div class="ai-section-value mono">${a.ringleader || 'Undetermined'}</div>
      </div>
      <div class="ai-section">
        <div class="ai-section-label">Primary Evidence Indicator / Risk Factor</div>
        <div class="ai-section-value danger">${a.red_flag || 'None recorded'}</div>
      </div>
      ${a.leads?.length ? `<div class="ai-section">
        <div class="ai-section-label">Investigative Directives</div>
        <div class="ai-section-value" style="padding:0;">
          ${a.leads.map((l,i) => `<div class="ai-lead"><span class="ai-lead-num">${i+1}</span><span>${l}</span></div>`).join('')}
        </div>
      </div>` : ''}
    </div>`;
  } catch (err) {
    el.aiBody.innerHTML = `<div style="color:#f87171;padding:12px;font-family:var(--font-mono);">Analysis service error: ${err.message}</div>`;
  }
}

// ── Automated Link Assessment ──────────────────────────────────────────────────
async function explainEdge(src, tgt) {
  if (!graphData) return;
  const edge = graphData.edges.find(e =>
    (e.source === src && e.target === tgt) || (e.source === tgt && e.target === src));
  const nodeMap = {};
  graphData.nodes.forEach(n => { nodeMap[n.id] = n; });

  showAiModal(`Evaluating Link Assessment: ${src} ↔ ${tgt}…`);
  try {
    const res  = await fetch(`${API}/analyze/edge`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        person_a:     src, person_b: tgt,
        edge_types:   edge ? [edge.type] : ['connected'],
        descriptions: edge?.all_descriptions || [edge?.description || ''],
        details_a:    nodeMap[src]?.details || {},
        details_b:    nodeMap[tgt]?.details || {},
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    el.aiBody.innerHTML = `<div class="fade-in">
      <div class="ai-section">
        <div class="ai-section-label">Forensic Relationship Correlation: ${src} ↔ ${tgt}</div>
        <div class="ai-section-value">${json.explanation}</div>
      </div>
    </div>`;
  } catch (err) {
    el.aiBody.innerHTML = `<div style="color:#f87171;padding:12px;font-family:var(--font-mono);">Link assessment error: ${err.message}</div>`;
  }
}

// ── Automated Anomaly Detection ────────────────────────────────────────────────
$('btn-anomalies').addEventListener('click', async () => {
  if (!graphData) return;
  showAiModal('Executing Network Anomaly & Discrepancy Scan…');
  try {
    const res  = await fetch(`${API}/analyze/anomalies`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stats: graphData.stats, nodes: graphData.nodes, edges: graphData.edges }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    el.aiBody.innerHTML = `<div class="fade-in">
      <div class="ai-section">
        <div class="ai-section-label">Network Discrepancy &amp; Outlier Report</div>
        <div class="ai-section-value pre mono">${json.anomaly_report}</div>
      </div>
    </div>`;
  } catch (err) {
    el.aiBody.innerHTML = `<div style="color:#f87171;padding:12px;font-family:var(--font-mono);">Anomaly scan error: ${err.message}</div>`;
  }
});

// ── Case Briefing Dossier ──────────────────────────────────────────────────────
$('btn-summary').addEventListener('click', async () => {
  if (!graphData) return;
  // showAiModal resets aiTitle, so we set it AFTER the call
  showAiModal('Synthesizing Case Dossier & Intelligence Directives…');
  if (el.aiTitle) el.aiTitle.textContent = 'EXECUTIVE CASE INTELLIGENCE BRIEFING';
  try {
    const res  = await fetch(`${API}/analyze/summary`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: graphData.nodes, edges: graphData.edges,
        clusters: graphData.clusters, stats: graphData.stats,
      }),
    });
    if (!res.ok) throw new Error(`Server error: ${res.status} ${res.statusText}`);
    const json = await res.json();
    if (json.error) throw new Error(json.error);
    const s = json.summary;

    const sec = (label, content, cls = '') =>
      content?.trim()
        ? `<div class="ai-section"><div class="ai-section-label">${label}</div>
           <div class="ai-section-value ${cls}" style="white-space:pre-wrap;">${content}</div></div>`
        : '';

    // If no sections were parsed, fall back to displaying the raw response
    const hasSections = !!(s.overview || s.network_breakdown || s.cross_network || s.key_suspects || s.recommended_actions);
    const bodyContent = hasSections
      ? `<div class="fade-in">
          ${s.title ? `<div style="font-size:14px;font-weight:700;letter-spacing:0.04em;color:#f8fafc;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid var(--border);font-family:var(--font-mono);">${s.title.toUpperCase()}</div>` : ''}
          ${sec('Executive Overview',            s.overview,           'highlight')}
          ${sec('Syndicate Hierarchy & Nodes',   s.network_breakdown)}
          ${sec('Cross-Repository Linkages',     s.cross_network)}
          ${sec('Key Persons of Interest',       s.key_suspects)}
          ${sec('Investigative Directives',      s.recommended_actions, 'warning')}
        </div>`
      : `<div class="fade-in"><div class="ai-section">
          <div class="ai-section-label">INTELLIGENCE ASSESSMENT</div>
          <div class="ai-section-value" style="white-space:pre-wrap;">${s.raw_response || 'No data returned from analysis service.'}</div>
        </div></div>`;

    el.aiBody.innerHTML = bodyContent;
  } catch (err) {
    el.aiBody.innerHTML = `<div style="color:#f87171;padding:12px;font-family:var(--font-mono);">Dossier compilation error: ${err.message}</div>`;
  }
});

// ── Dossier Modal Visibility ───────────────────────────────────────────────────
function showAiModal(msg) {
  if (el.aiTitle) el.aiTitle.textContent = 'FORENSIC INTELLIGENCE ASSESSMENT';
  el.aiBody.innerHTML = `<div class="ai-thinking"><div class="spinner"></div><span>${msg}</span></div>`;
  el.aiModal.classList.remove('hidden');
}
$('ai-modal-close').addEventListener('click', () => el.aiModal.classList.add('hidden'));
el.aiModal.addEventListener('click', e => { if (e.target === el.aiModal) el.aiModal.classList.add('hidden'); });

// ── Precision Tooltip ──────────────────────────────────────────────────────────
function nodeTip(n) {
  const srcList = (n.sources || []).join(', ');
  return `<strong>${n.label}</strong><br>
    ${n.is_criminal ? '<span style="color:#f87171;font-family:monospace;font-size:10.5px;">[!] PRIORITY POI</span><br>' : ''}
    ${n.has_stolen_vehicle ? '<span style="color:#fb923c;font-family:monospace;font-size:10.5px;">[ASSET] Stolen Vehicle Linked</span><br>' : ''}
    ${n.multi_source ? '<span style="color:#eab308;font-family:monospace;font-size:10.5px;">[CORRELATION] Multi-Repository Entity</span><br>' : ''}
    Syndicate #${n.cluster} &nbsp;·&nbsp; Degree: ${n.degree}<br>
    <span style="color:#64748b;font-family:monospace;font-size:10px;">Sources: ${srcList}</span>`;
}

function edgeTip(e) {
  const amtLine = e.total_amount
    ? `<br><span style="color:#10b981;font-family:monospace;">₹${Math.round(e.total_amount).toLocaleString('en-IN')}</span> (${e.txn_count} record${e.txn_count > 1 ? 's' : ''})`
    : '';
  return `<strong>${e.source} ↔ ${e.target}</strong><br>
    <span style="color:${edgeStroke(e.type, e.suspicious)};font-family:monospace;font-size:10.5px;">${e.type.toUpperCase()}</span>
    ${amtLine}
    ${e.suspicious ? '<br><span style="color:#f87171;font-family:monospace;font-size:10.5px;">[!] FLAGGED SUSPICIOUS</span>' : ''}`;
}

function showTooltip(ev, html) {
  el.tooltip.innerHTML = html;
  el.tooltip.classList.remove('hidden');
  moveTooltip(ev);
}
function moveTooltip(ev) {
  let x = ev.clientX + 14, y = ev.clientY + 14;
  if (x + 250 > window.innerWidth)  x = ev.clientX - 250;
  if (y + 110 > window.innerHeight) y = ev.clientY - 110;
  el.tooltip.style.left = x + 'px';
  el.tooltip.style.top  = y + 'px';
}
function hideTooltip() {
  el.tooltip.classList.add('hidden');
}

// ── Zoom Controls ──────────────────────────────────────────────────────────────
$('zoom-in').addEventListener('click',  () => svgSel?.transition().duration(250).call(zoomBehavior.scaleBy, 1.4));
$('zoom-out').addEventListener('click', () => svgSel?.transition().duration(250).call(zoomBehavior.scaleBy, 0.7));
$('zoom-fit').addEventListener('click', () => {
  if (!svgSel || !graphData) return;
  const W = $('canvas-wrapper').clientWidth;
  const H = $('canvas-wrapper').clientHeight;
  const s = Math.min((W * 0.9) / 3000, (H * 0.9) / 3000);
  svgSel.transition().duration(350).call(
    zoomBehavior.transform,
    d3.zoomIdentity.translate(W / 2, H / 2).scale(s).translate(-1500, -1500)
  );
});

// ── Forensic Evidence Export (PNG & JSON) ──────────────────────────────────────
$('btn-export-png')?.addEventListener('click', () => exportEvidencePNG());
$('btn-export-json')?.addEventListener('click', () => exportGraphJSON());

function exportGraphJSON() {
  if (!graphData) {
    showBanner('No active investigation data to export.', 'warning');
    return;
  }
  const payload = {
    exported_at: new Date().toISOString(),
    case_ref: 'SIH-26189',
    classification: 'LE SENSITIVE // FORENSIC INTELLIGENCE',
    stats: graphData.stats,
    nodes: graphData.nodes,
    edges: graphData.edges,
    clusters: graphData.clusters,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.download = `crimenet_evidence_graph_${Date.now()}.json`;
  a.href = url;
  a.click();
  URL.revokeObjectURL(url);
  showBanner('Forensic graph JSON exported successfully.', 'success');
}

function exportEvidencePNG() {
  if (!graphData || !svgSel) {
    showBanner('No active investigation data to export.', 'warning');
    return;
  }

  showLoading('Rendering forensic evidence snapshot…');

  const svgNode = el.graphSvg;
  const rect = svgNode.getBoundingClientRect();
  const width = Math.max(900, Math.round(rect.width));
  const height = Math.max(650, Math.round(rect.height));
  const footerHeight = 36;
  const totalHeight = height + footerHeight;

  // Clone SVG node and prepare for canvas serialization
  const clonedSvg = svgNode.cloneNode(true);
  clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clonedSvg.setAttribute('width', width);
  clonedSvg.setAttribute('height', height);

  // Embed critical stylesheet rules to guarantee exact appearance in off-screen render
  const styleEl = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  styleEl.textContent = `
    .edge-line { stroke-linecap: round; stroke-opacity: 0.75; }
    .edge-line.suspicious { stroke: #ef4444; stroke-dasharray: 4, 3; }
    .node-circle { stroke-width: 2.2px; }
    .node-label { font-family: 'JetBrains Mono', monospace, sans-serif; font-size: 10px; fill: #cbd5e1; text-anchor: middle; }
    .cluster-halo { fill-opacity: 0.05; }
  `;
  clonedSvg.insertBefore(styleEl, clonedSvg.firstChild);

  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clonedSvg);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.onload = () => {
    try {
      const dpr = 2; // high-resolution 2x capture
      const canvas = document.createElement('canvas');
      canvas.width = width * dpr;
      canvas.height = totalHeight * dpr;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);

      // 1. Dark tactical background
      ctx.fillStyle = '#080c14';
      ctx.fillRect(0, 0, width, height);

      // Grid watermark pattern
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
      ctx.lineWidth = 1;
      for (let x = 0; x < width; x += 32) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
      }
      for (let y = 0; y < height; y += 32) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      }

      // 2. Draw SVG Graph
      ctx.drawImage(img, 0, 0, width, height);

      // 3. Top Forensic Classification Badge
      ctx.fillStyle = 'rgba(10, 15, 26, 0.85)';
      ctx.fillRect(14, 14, 330, 24);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.3)';
      ctx.strokeRect(14, 14, 330, 24);
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText('CRIMENET FORENSIC EVIDENCE · CASE REF: SIH-26189', 22, 30);

      // 4. Bottom Footer strip
      ctx.fillStyle = '#0b1120';
      ctx.fillRect(0, height, width, footerHeight);
      ctx.fillStyle = 'rgba(56, 189, 248, 0.2)';
      ctx.fillRect(0, height, width, 1);

      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillStyle = '#94a3b8';
      const timestamp = new Date().toLocaleString('en-US', { hour12: false });
      ctx.fillText(`CLASSIFIED LAW ENFORCEMENT EXHIBIT · GENERATED: ${timestamp}`, 16, height + 22);

      const statsText = `ENTITIES: ${graphData.stats.total_persons}  |  LINKS: ${graphData.stats.total_edges}  |  SYNDICATES: ${graphData.stats.total_clusters}`;
      const statsMetrics = ctx.measureText(statsText);
      ctx.fillStyle = '#38bdf8';
      ctx.fillText(statsText, width - statsMetrics.width - 16, height + 22);

      canvas.toBlob(blob => {
        hideLoading();
        URL.revokeObjectURL(url);
        if (!blob) {
          showBanner('Failed to generate image blob.', 'danger');
          return;
        }
        const dlUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.download = `crimenet_evidence_${Date.now()}.png`;
        a.href = dlUrl;
        a.click();
        URL.revokeObjectURL(dlUrl);
        showBanner('Forensic evidence snapshot exported (PNG).', 'success');
      }, 'image/png');
    } catch (err) {
      hideLoading();
      URL.revokeObjectURL(url);
      showBanner(`Image export failed: ${err.message}`, 'danger');
    }
  };

  img.onerror = () => {
    hideLoading();
    URL.revokeObjectURL(url);
    showBanner('Failed to render SVG to image format.', 'danger');
  };

  img.src = url;
}

// ── Workspace Reset & Multi-Source Triggers ────────────────────────────────────
function initButtons() {
  $('btn-reset').addEventListener('click', () => {
    graphData = null;
    gRootSel?.selectAll('*').remove();
    el.emptyState.classList.remove('hidden');
    el.graphSvg.classList.add('hidden');
    el.zoomCtrls.classList.add('hidden');
    el.graphStats.style.display = 'none';
    ['btn-poi','btn-summary','btn-anomalies','btn-path-tracer','btn-timeline-toggle','btn-vulnerability','btn-criminals-output','btn-reset'].forEach(id => {
      if ($(id)) $(id).style.display = 'none';
    });
    el.filterSec.style.display = 'none';
    el.legendSec.style.display = 'none';
    hideBanner();
    closeDetailPanel();
    document.querySelectorAll('.dataset-item').forEach(e => e.classList.remove('active'));
    activeNodeMap     = null;
    activeEdges       = null;
    isolatedClusterId = null;
    $('canvas-search-wrap')?.classList.add('hidden');
    $('search-dropdown')?.classList.add('hidden');
    const searchInput = $('node-search-input');
    if (searchInput) searchInput.value = '';
    // close all overlays
    closeCriminalsOutput();
    closePathTracer();
    closeTimelineDock();
    closeVulnerabilityModal();
  });

  $('btn-load-all').addEventListener('click', () => loadAllFiles(false));
  $('btn-suspected-only').addEventListener('click', () => loadAllFiles(true));

  // Criminals Output panel
  $('btn-criminals-output')?.addEventListener('click', () => openCriminalsOutput());
  $('criminals-output-close')?.addEventListener('click', () => closeCriminalsOutput());
  $('criminals-output-overlay')?.addEventListener('click', e => {
    if (e.target === $('criminals-output-overlay')) closeCriminalsOutput();
  });

  // Path Tracer
  $('btn-path-tracer')?.addEventListener('click', () => openPathTracer());
  $('path-modal-close')?.addEventListener('click', () => closePathTracer());
  $('path-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('path-modal-overlay')) closePathTracer();
  });
  $('btn-run-path-trace')?.addEventListener('click', () => runPathTrace(true));
  $('btn-path-swap')?.addEventListener('click', () => {
    const s = $('path-source-input');
    const t = $('path-target-input');
    if (s && t) {
      const tmp = s.value;
      s.value = t.value;
      t.value = tmp;
    }
  });

  // Timeline Scrubber & Flow
  $('btn-timeline-toggle')?.addEventListener('click', () => toggleTimelineDock());
  $('timeline-close-btn')?.addEventListener('click', () => closeTimelineDock());
  $('btn-timeline-play')?.addEventListener('click', () => togglePlayTimeline());
  $('btn-timeline-step-back')?.addEventListener('click', () => stepTimeline(-1));
  $('btn-timeline-step-fwd')?.addEventListener('click', () => stepTimeline(1));
  $('btn-timeline-reset')?.addEventListener('click', () => resetTimeline());
  $('timeline-scrubber')?.addEventListener('input', e => onTimelineScrub(parseInt(e.target.value, 10)));

  document.querySelectorAll('.t-speed-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.t-speed-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      timelineSpeed = parseFloat(btn.getAttribute('data-speed')) || 1;
      if (timelinePlaying) {
        pauseTimeline();
        playTimeline();
      }
    });
  });

  // Key Players & Vulnerability Matrix
  $('btn-vulnerability')?.addEventListener('click', () => openVulnerabilityModal());
  $('vulnerability-modal-close')?.addEventListener('click', () => closeVulnerabilityModal());
  $('vulnerability-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('vulnerability-modal-overlay')) closeVulnerabilityModal();
  });

  document.querySelectorAll('.vuln-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.vuln-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const filter = tab.getAttribute('data-vuln-filter') || 'all';
      renderVulnerabilityMatrix(filter, $('vuln-search-input')?.value || '');
    });
  });

  $('vuln-search-input')?.addEventListener('input', e => {
    const activeTab = document.querySelector('.vuln-tab.active');
    const filter = activeTab ? activeTab.getAttribute('data-vuln-filter') : 'all';
    renderVulnerabilityMatrix(filter, e.target.value);
  });

  initLegendFilters();
}

// ── Correlation Display Filters ────────────────────────────────────────────────
['filter-criminals','filter-civilians','filter-suspicious'].forEach(id => {
  $(id)?.addEventListener('change', () => {
    if (!graphData) return;
    const showCrim = $('filter-criminals').checked;
    const showCiv  = $('filter-civilians').checked;
    const showSusp = $('filter-suspicious').checked;
    d3.selectAll('.node-g').attr('display', d => {
      if (d.is_criminal && !showCrim) return 'none';
      if (!d.is_criminal && !showCiv) return 'none';
      return null;
    });
    d3.selectAll('.node-label').attr('display', d => {
      if (d.is_criminal && !showCrim) return 'none';
      if (!d.is_criminal && !showCiv) return 'none';
      return null;
    });
    d3.selectAll('.edge-line').attr('display', d => {
      if (d.suspicious && !showSusp) return 'none';
      return null;
    });
  });
});

// ── Interactive Taxonomy Legend & Isolation ────────────────────────────────────
function updateLegendCounts(data) {
  if (!data) return;
  const nodes = data.nodes || [];
  const edges = data.edges || [];

  const poiCount    = nodes.filter(n => n.is_criminal).length;
  const civCount    = nodes.filter(n => !n.is_criminal).length;
  const stolenCount = nodes.filter(n => n.has_stolen_vehicle).length;
  const phoneCount  = edges.filter(e => e.type === 'phone call').length;
  const finCount    = edges.filter(e => e.type === 'financial transaction' || e.type === 'shared bank account').length;
  const vehCount    = edges.filter(e => e.type === 'vehicle transfer').length;
  const suspCount   = edges.filter(e => e.suspicious).length;

  if ($('count-poi'))        $('count-poi').textContent = poiCount;
  if ($('count-civ'))        $('count-civ').textContent = civCount;
  if ($('count-stolen'))     $('count-stolen').textContent = stolenCount;
  if ($('count-phone'))      $('count-phone').textContent = phoneCount;
  if ($('count-financial'))  $('count-financial').textContent = finCount;
  if ($('count-vehicle'))    $('count-vehicle').textContent = vehCount;
  if ($('count-suspicious')) $('count-suspicious').textContent = suspCount;
}

function initLegendFilters() {
  document.querySelectorAll('.legend-item').forEach(item => {
    item.addEventListener('click', () => {
      if (!graphData || !activeNodeMap || !activeEdges) return;
      const type = item.getAttribute('data-filter-type');
      if (!type) return;

      const wasActive = item.classList.contains('active');
      document.querySelectorAll('.legend-item').forEach(el => el.classList.remove('active'));

      if (wasActive) {
        clearHighlights();
        return;
      }

      item.classList.add('active');
      activeNodeId = null;
      activeEdge = null;
      isolatedClusterId = null;
      d3.selectAll('.cluster-group').attr('opacity', null);

      if (type === 'criminal') {
        d3.selectAll('.node-g').attr('opacity', d => d.is_criminal ? 1 : 0.08);
        d3.selectAll('.edge-line').attr('opacity', d =>
          (activeNodeMap[d.source]?.is_criminal || activeNodeMap[d.target]?.is_criminal) ? 1 : 0.03
        );
        showBanner('ISOLATING PRIORITY PERSONS OF INTEREST (POI) · Click legend item again to reset', 'info');
      } else if (type === 'civilian') {
        d3.selectAll('.node-g').attr('opacity', d => !d.is_criminal ? 1 : 0.08);
        d3.selectAll('.edge-line').attr('opacity', d =>
          (!activeNodeMap[d.source]?.is_criminal && !activeNodeMap[d.target]?.is_criminal) ? 1 : 0.03
        );
        showBanner('ISOLATING CIVILIAN / ASSOCIATE ENTITIES · Click legend item again to reset', 'info');
      } else if (type === 'stolen') {
        d3.selectAll('.node-g').attr('opacity', d => d.has_stolen_vehicle ? 1 : 0.08);
        d3.selectAll('.edge-line').attr('opacity', d =>
          (activeNodeMap[d.source]?.has_stolen_vehicle || activeNodeMap[d.target]?.has_stolen_vehicle) ? 1 : 0.03
        );
        showBanner('ISOLATING ENTITIES LINKED TO STOLEN MOTOR ASSETS · Click legend item again to reset', 'info');
      } else if (type === 'phone') {
        const phoneNodes = new Set();
        activeEdges.filter(e => e.type === 'phone call').forEach(e => {
          phoneNodes.add(e.source); phoneNodes.add(e.target);
        });
        d3.selectAll('.edge-line').attr('opacity', d => d.type === 'phone call' ? 1 : 0.03);
        d3.selectAll('.node-g').attr('opacity', d => phoneNodes.has(d.id) ? 1 : 0.08);
        showBanner('ISOLATING TELEPHONY CALL NETWORKS · Click legend item again to reset', 'info');
      } else if (type === 'financial') {
        const finNodes = new Set();
        activeEdges.filter(e => e.type === 'financial transaction' || e.type === 'shared bank account').forEach(e => {
          finNodes.add(e.source); finNodes.add(e.target);
        });
        d3.selectAll('.edge-line').attr('opacity', d =>
          (d.type === 'financial transaction' || d.type === 'shared bank account') ? 1 : 0.03
        );
        d3.selectAll('.node-g').attr('opacity', d => finNodes.has(d.id) ? 1 : 0.08);
        showBanner('ISOLATING CAPITAL & FINANCIAL WIRE PATHS · Click legend item again to reset', 'info');
      } else if (type === 'vehicle') {
        const vehNodes = new Set();
        activeEdges.filter(e => e.type === 'vehicle transfer').forEach(e => {
          vehNodes.add(e.source); vehNodes.add(e.target);
        });
        d3.selectAll('.edge-line').attr('opacity', d => d.type === 'vehicle transfer' ? 1 : 0.03);
        d3.selectAll('.node-g').attr('opacity', d => vehNodes.has(d.id) ? 1 : 0.08);
        showBanner('ISOLATING VEHICLE LOGISTICS & TRANSFERS · Click legend item again to reset', 'info');
      } else if (type === 'suspicious') {
        const suspNodes = new Set();
        activeEdges.filter(e => e.suspicious).forEach(e => {
          suspNodes.add(e.source); suspNodes.add(e.target);
        });
        d3.selectAll('.edge-line').attr('opacity', d => d.suspicious ? 1 : 0.03);
        d3.selectAll('.node-g').attr('opacity', d => suspNodes.has(d.id) ? 1 : 0.08);
        showBanner('ISOLATING FLAGGED SUSPICIOUS RELATIONSHIPS · Click legend item again to reset', 'danger');
      }
    });
  });
}

// ── Spotlight Entity Search & Focus ───────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initNodeSearch() {
  const input = $('node-search-input');
  const dropdown = $('search-dropdown');
  const clearBtn = $('node-search-clear');
  let selectedIdx = -1;

  if (!input || !dropdown) return;

  function closeDropdown() {
    dropdown.classList.add('hidden');
    dropdown.innerHTML = '';
    selectedIdx = -1;
  }

  function renderResults(q) {
    if (!graphData || !graphData.nodes) {
      closeDropdown();
      return;
    }
    const query = q.trim().toLowerCase();
    if (!query) {
      clearBtn?.classList.add('hidden');
      closeDropdown();
      return;
    }
    clearBtn?.classList.remove('hidden');

    const matches = graphData.nodes.filter(n =>
      (n.label && n.label.toLowerCase().includes(query)) ||
      (n.id && n.id.toLowerCase().includes(query)) ||
      (n.details?.account_no && String(n.details.account_no).toLowerCase().includes(query)) ||
      (n.details?.Mobile_Number && String(n.details.Mobile_Number).toLowerCase().includes(query))
    ).slice(0, 10);

    if (!matches.length) {
      dropdown.innerHTML = `<div class="search-empty-msg">No entities matching "${escapeHtml(q)}"</div>`;
      dropdown.classList.remove('hidden');
      selectedIdx = -1;
      return;
    }

    dropdown.innerHTML = matches.map((n, i) => `
      <div class="search-item" data-id="${escapeHtml(n.id)}" data-idx="${i}">
        <div class="search-item-info">
          <div class="search-item-name">${escapeHtml(n.label || n.id)}</div>
          <div class="search-item-meta">
            <span>Net #${n.cluster}</span>
            <span>·</span>
            <span>Links: ${n.degree || 0}</span>
            ${n.details?.account_no ? `<span>· Acct: …${escapeHtml(String(n.details.account_no).slice(-4))}</span>` : ''}
          </div>
        </div>
        <span class="search-badge ${n.is_criminal ? 'poi' : 'civ'}">${n.is_criminal ? 'POI' : 'CIV'}</span>
      </div>
    `).join('');

    dropdown.querySelectorAll('.search-item').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-id');
        focusNodeOnCanvas(id);
        input.value = activeNodeMap?.[id]?.label || id;
        closeDropdown();
      });
    });

    dropdown.classList.remove('hidden');
    selectedIdx = -1;
  }

  input.addEventListener('input', e => renderResults(e.target.value));

  input.addEventListener('keydown', e => {
    const items = dropdown.querySelectorAll('.search-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIdx = (selectedIdx + 1) % items.length;
      updateSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIdx = (selectedIdx - 1 + items.length) % items.length;
      updateSelection(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIdx >= 0 && items[selectedIdx]) {
        items[selectedIdx].click();
      } else if (items[0]) {
        items[0].click();
      }
    } else if (e.key === 'Escape') {
      closeDropdown();
      input.blur();
    }
  });

  function updateSelection(items) {
    items.forEach((it, idx) => {
      it.classList.toggle('selected', idx === selectedIdx);
      if (idx === selectedIdx) it.scrollIntoView({ block: 'nearest' });
    });
  }

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    clearBtn.classList.add('hidden');
    closeDropdown();
    input.focus();
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.canvas-search-wrap')) {
      closeDropdown();
    }
  });
}

function focusNodeOnCanvas(nodeId) {
  if (!graphData || !activeNodeMap || !activeNodeMap[nodeId]) return;
  const node = activeNodeMap[nodeId];

  // Smooth pan & zoom to center entity
  const wrapper = $('canvas-wrapper');
  const W = wrapper.clientWidth  || 900;
  const H = wrapper.clientHeight || 700;
  const targetScale = 1.35;

  const transform = d3.zoomIdentity
    .translate(W / 2, H / 2)
    .scale(targetScale)
    .translate(-node.x, -node.y);

  svgSel?.transition()
    .duration(650)
    .ease(d3.easeCubicOut)
    .call(zoomBehavior.transform, transform);

  // Trigger selection & inspector
  if (activeEdges) {
    onNodeClick(node, activeEdges, activeNodeMap);
  }

  // Radar ping pulse animation on node
  if (gRootSel) {
    gRootSel.selectAll('.spotlight-pulse').remove();
    const pingColor = node.is_criminal ? '#ef4444' : '#38bdf8';
    const pulse = gRootSel.append('circle')
      .attr('class', 'spotlight-pulse')
      .attr('cx', node.x)
      .attr('cy', node.y)
      .attr('r', nodeR(node) + 4)
      .attr('fill', 'none')
      .attr('stroke', pingColor)
      .attr('stroke-width', 3)
      .attr('pointer-events', 'none');

    pulse.transition()
      .duration(1200)
      .ease(d3.easeQuadOut)
      .attr('r', nodeR(node) + 48)
      .attr('stroke-width', 1)
      .attr('opacity', 0)
      .remove();
  }
}

// ── Operational Keyboard Shortcuts & Modal ─────────────────────────────────────
function initShortcutsModal() {
  const modal = $('shortcuts-modal-overlay');
  const openBtn = $('btn-shortcuts');
  const closeBtn = $('shortcuts-modal-close');

  openBtn?.addEventListener('click', () => modal?.classList.remove('hidden'));
  closeBtn?.addEventListener('click', () => modal?.classList.add('hidden'));
  modal?.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function initKeyboardNav() {
  document.addEventListener('keydown', e => {
    const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

    if (e.key === 'Escape') {
      if (isInput) {
        document.activeElement.blur();
      }
      $('shortcuts-modal-overlay')?.classList.add('hidden');
      el.aiModal?.classList.add('hidden');
      el.poiOverlay?.classList.add('hidden');
      $('path-modal-overlay')?.classList.add('hidden');
      $('vulnerability-modal-overlay')?.classList.add('hidden');
      closeCriminalsOutput();
      closeDetailPanel();
      clearHighlights();
      return;
    }

    if (isInput) return;

    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      e.preventDefault();
      const modal = $('shortcuts-modal-overlay');
      if (modal) {
        modal.classList.toggle('hidden');
      }
      return;
    }

    if (e.key === '/') {
      const input = $('node-search-input');
      if (input && graphData) {
        e.preventDefault();
        input.focus();
        input.select();
      }
      return;
    }

    if (!graphData) return;

    if (e.key.toLowerCase() === 'f') {
      e.preventDefault();
      $('zoom-fit')?.click();
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      $('zoom-in')?.click();
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      $('zoom-out')?.click();
    } else if (e.key.toLowerCase() === 'r') {
      e.preventDefault();
      $('zoom-fit')?.click();
    } else if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      const ov = $('criminals-output-overlay');
      if (ov && !ov.classList.contains('hidden')) closeCriminalsOutput();
      else openCriminalsOutput();
    } else if (e.key.toLowerCase() === 't') {
      e.preventDefault();
      const ov = $('path-modal-overlay');
      if (ov && !ov.classList.contains('hidden')) closePathTracer();
      else openPathTracer();
    } else if (e.key.toLowerCase() === 'l') {
      e.preventDefault();
      toggleTimelineDock();
    } else if (e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const ov = $('vulnerability-modal-overlay');
      if (ov && !ov.classList.contains('hidden')) closeVulnerabilityModal();
      else openVulnerabilityModal();
    } else if (e.key === ' ' && $('timeline-dock') && !$('timeline-dock').classList.contains('hidden')) {
      e.preventDefault();
      togglePlayTimeline();
    } else if (e.key.toLowerCase() === 'p') {
      e.preventDefault();
      $('btn-poi')?.click();
    } else if (e.key.toLowerCase() === 's') {
      e.preventDefault();
      $('btn-summary')?.click();
    }
  });
}

// ── Clipboard & Dossier Sharing ────────────────────────────────────────────────
function copyTextToClipboard(text, successMsg = 'Copied to clipboard') {
  if (!text) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(String(text)).then(() => {
      showBanner(successMsg, 'success');
    }).catch(() => fallbackCopy(text, successMsg));
  } else {
    fallbackCopy(text, successMsg);
  }
}

function fallbackCopy(text, successMsg) {
  const ta = document.createElement('textarea');
  ta.value = String(text);
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showBanner(successMsg, 'success');
  } catch (e) {
    showBanner('Clipboard copy failed.', 'danger');
  }
  document.body.removeChild(ta);
}

function copyNodeDossier(nodeId) {
  if (!graphData || !activeNodeMap || !activeNodeMap[nodeId]) return;
  const node = activeNodeMap[nodeId];
  const connEdges = activeEdges?.filter(e => e.source === nodeId || e.target === nodeId) || [];
  const risk = calcRisk(node, connEdges);
  const d = node.details || {};

  const lines = [
    `CRIMENET FORENSIC INTELLIGENCE BRIEF // REF: SIH-26189`,
    `======================================================`,
    `ENTITY NAME:      ${node.label || node.id}`,
    `ENTITY ID:        ${node.id}`,
    `CLASSIFICATION:   ${node.is_criminal ? 'PRIORITY PERSON OF INTEREST (POI)' : 'CIVILIAN / ASSOCIATE'}`,
    `THREAT RATING:    ${risk.level} (${risk.score}/100)`,
    `SYNDICATE SUBNET: Syndicate #${node.cluster}`,
    `DIRECT AFFILIATIONS: ${node.degree || connEdges.length}`,
  ];
  if (d.account_no) lines.push(`BANK ACCOUNT:     ${d.account_no} (${d.bank || 'Unknown Bank'})`);
  if (d.Mobile_Number) lines.push(`MOBILE CONTACT:   ${d.Mobile_Number}`);
  if (risk.factors?.length) {
    lines.push(`RISK INDICATORS:`);
    risk.factors.forEach(f => lines.push(`  - ${f}`));
  }
  if (node.sources?.length) {
    lines.push(`EVIDENCE SOURCES: ${node.sources.join(', ')}`);
  }

  copyTextToClipboard(lines.join('\n'), `Dossier brief copied for ${node.label || node.id}`);
}

// ── Utility Helpers ────────────────────────────────────────────────────────────
function isolateCluster(cluster, cx, cy, haloR) {
  if (isolatedClusterId === cluster.id) {
    clearHighlights();
    return;
  }

  isolatedClusterId = cluster.id;
  activeNodeId = null;
  activeEdge   = null;

  const memberSet = new Set(cluster.members);

  // Dim nodes outside this syndicate
  d3.selectAll('.node-g')
    .attr('opacity', d => memberSet.has(d.id) ? 1 : 0.08);

  // Dim edges outside this syndicate
  d3.selectAll('.edge-line')
    .attr('opacity', d => (memberSet.has(d.source) && memberSet.has(d.target)) ? 1 : 0.04)
    .classed('highlighted', d => (memberSet.has(d.source) && memberSet.has(d.target)));

  // Highlight only this cluster's halo
  d3.selectAll('.cluster-group')
    .attr('opacity', function() {
      return this.getAttribute('data-cluster-id') === String(cluster.id) ? 1 : 0.12;
    });

  // Smoothly center the cluster in view
  const wrapper = $('canvas-wrapper');
  const W = wrapper.clientWidth  || 900;
  const H = wrapper.clientHeight || 700;
  const targetScale = Math.min(2.0, Math.max(0.55, (Math.min(W, H) * 0.72) / (haloR * 2)));

  const transform = d3.zoomIdentity
    .translate(W / 2, H / 2)
    .scale(targetScale)
    .translate(-cx, -cy);

  svgSel?.transition()
    .duration(650)
    .ease(d3.easeCubicOut)
    .call(zoomBehavior.transform, transform);

  showBanner(`ISOLATING SYNDICATE #${cluster.id} (${cluster.size} ENTITIES) · Click empty canvas to restore all`, 'info');
}

function shortenName(name) {
  if (!name) return '';
  if (name.length <= 13) return name;
  const p = name.trim().split(' ');
  return p.length < 2 ? name.slice(0, 12) + '…' : p[0] + ' ' + p[p.length-1][0] + '.';
}

function badge(text, cls) {
  return `<span class="connection-tag tag-${cls}">${text}</span>`;
}

function tagCls(type) {
  if (!type) return 'default';
  const t = type.toLowerCase();
  if (t.includes('phone') || t.includes('call')) return 'phone';
  if (t.includes('financial') || t.includes('transaction')) return 'financial';
  if (t.includes('vehicle')) return 'vehicle';
  if (t.includes('cluster') || t.includes('group') || t.includes('shared')) return 'cluster';
  if (t.includes('suspicious')) return 'suspicious';
  return 'default';
}

function calcRisk(node, edges) {
  let score = 0;
  const factors = [];
  if (node.is_criminal)        { score += 40; factors.push('Documented Record as Priority POI'); }
  if (node.has_stolen_vehicle) { score += 25; factors.push('Linked to active stolen motor asset'); }
  if (node.multi_source)       { score += 10; factors.push('Cross-referenced across multiple evidence files'); }
  if (node.degree >= 10)       { score += 20; factors.push(`High link density (${node.degree} relationships)`); }
  else if (node.degree >= 5)   { score += 10; factors.push(`Moderate link density (${node.degree} relationships)`); }
  const susp = edges.filter(e => e.suspicious).length;
  if (susp > 0) { score += Math.min(15, susp * 5); factors.push(`${susp} flagged transaction(s) or calls`); }
  score = Math.min(100, score);
  return {
    score, factors,
    color: score >= 70 ? '#ef4444' : score >= 40 ? '#f59e0b' : '#38bdf8',
    level: score >= 70 ? 'CRITICAL' : score >= 40 ? 'ELEVATED' : 'ROUTINE',
  };
}

function hexAlpha(hex, a) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// Expose for inline handlers
window.analyzeCluster = analyzeCluster;
window.explainEdge    = explainEdge;

// -- POI Registry ---------------------------------------------------------------
let _poiSort = 'risk';

function openPOIPanel() {
  if (!graphData) return;
  el.poiOverlay.classList.remove('hidden');
  renderPOICards();
}

function closePOIPanel() {
  el.poiOverlay.classList.add('hidden');
}

document.getElementById('btn-poi').addEventListener('click', openPOIPanel);
document.getElementById('poi-close').addEventListener('click', closePOIPanel);
el.poiOverlay.addEventListener('click', function(e) {
  if (e.target === el.poiOverlay) closePOIPanel();
});
document.getElementById('poi-search').addEventListener('input', function() {
  renderPOICards();
});

function sortPOI(by) {
  _poiSort = by;
  ['risk','degree','name'].forEach(function(k) {
    var btn = document.getElementById('poi-sort-' + k);
    if (btn) btn.classList.toggle('active', k === by);
  });
  renderPOICards();
}

function renderPOICards() {
  if (!graphData) return;
  var searchEl = document.getElementById('poi-search');
  var query = (searchEl ? searchEl.value : '').toLowerCase().trim();

  var criminals = graphData.nodes.filter(function(n) { return n.is_criminal; });
  if (query) {
    criminals = criminals.filter(function(n) {
      return (n.id||'').toLowerCase().includes(query) || (n.label||'').toLowerCase().includes(query);
    });
  }

  criminals = criminals.slice().sort(function(a, b) {
    if (_poiSort === 'name')   return (a.id||'').localeCompare(b.id||'');
    if (_poiSort === 'degree') return (b.degree||0) - (a.degree||0);
    var ra = calcRisk(a, graphData.edges.filter(function(e){ return e.source===a.id||e.target===a.id; }));
    var rb = calcRisk(b, graphData.edges.filter(function(e){ return e.source===b.id||e.target===b.id; }));
    return rb.score - ra.score;
  });

  var allCrim = graphData.nodes.filter(function(n){ return n.is_criminal; });
  function getEdges(n) { return graphData.edges.filter(function(e){ return e.source===n.id||e.target===n.id; }); }

  var critCount   = allCrim.filter(function(n){ return calcRisk(n,getEdges(n)).score>=70; }).length;
  var elevCount   = allCrim.filter(function(n){ var s=calcRisk(n,getEdges(n)).score; return s>=40&&s<70; }).length;
  var stolenCount = allCrim.filter(function(n){ return n.has_stolen_vehicle; }).length;
  var multiCount  = allCrim.filter(function(n){ return n.multi_source; }).length;

  function setTxt(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; }
  setTxt('poi-stat-total',    allCrim.length);
  setTxt('poi-stat-critical', critCount);
  setTxt('poi-stat-elevated', elevCount);
  setTxt('poi-stat-stolen',   stolenCount);
  setTxt('poi-stat-multi',    multiCount);
  if (el.poiCount) el.poiCount.textContent = allCrim.length;

  if (!criminals.length) {
    el.poiBody.innerHTML = '<div class="poi-empty">' + (query ? 'No matches for &ldquo;'+query+'&rdquo;' : 'No persons of interest in current dataset.') + '</div>';
    return;
  }

  var cards = criminals.map(function(node) {
    var connEdges = graphData.edges.filter(function(e){ return e.source===node.id||e.target===node.id; });
    var risk      = calcRisk(node, connEdges);
    var riskClass = risk.score >= 70 ? 'critical' : risk.score >= 40 ? 'elevated' : 'routine';
    var suspCount = connEdges.filter(function(e){ return e.suspicious; }).length;
    var clusterNum = node.cluster != null ? node.cluster : (node.details ? node.details.cluster : null);
    var edgeTypes = Array.from(new Set(connEdges.map(function(e){ return e.type; })));
    var totalAmt  = connEdges.reduce(function(s,e){ return s+(e.total_amount||0); }, 0);

    var metaTags = '';
    if (node.has_stolen_vehicle) metaTags += '<span class="poi-meta-tag stolen">STOLEN VEHICLE</span>';
    if (node.multi_source)       metaTags += '<span class="poi-meta-tag multi">CROSS-REPO</span>';
    if (clusterNum != null)      metaTags += '<span class="poi-meta-tag cluster">SYNDICATE #'+clusterNum+'</span>';
    edgeTypes.slice(0,2).forEach(function(t){ metaTags += '<span class="poi-meta-tag">'+t.toUpperCase()+'</span>'; });

    var amtStr = totalAmt > 0 ? '\u20b9'+Math.round(totalAmt).toLocaleString('en-IN') : '\u2014';
    var safeId = node.id.replace(/"/g, '&quot;');

    return '<div class="poi-card risk-'+riskClass+' fade-in" onclick="poiCardClick(this.dataset.nid)" data-nid="'+safeId+'">'
      + '<div class="poi-card-header">'
      +   '<div class="poi-card-name">'+(node.label||node.id)+'</div>'
      +   '<span class="poi-risk-pill '+riskClass+'">'+risk.level+'</span>'
      + '</div>'
      + '<div class="poi-card-meta">'+metaTags+'</div>'
      + '<div class="poi-card-stats">'
      +   '<div class="poi-cstat"><div class="poi-cstat-val">'+(node.degree||0)+'</div><div class="poi-cstat-key">LINKS</div></div>'
      +   '<div class="poi-cstat"><div class="poi-cstat-val">'+suspCount+'</div><div class="poi-cstat-key">FLAGGED</div></div>'
      +   '<div class="poi-cstat"><div class="poi-cstat-val">'+risk.score+'</div><div class="poi-cstat-key">RISK/100</div></div>'
      +   '<div class="poi-cstat"><div class="poi-cstat-val" style="font-size:12px;">'+amtStr+'</div><div class="poi-cstat-key">TRANSACTIONS</div></div>'
      + '</div>'
      + '<div class="poi-risk-bar"><div class="poi-risk-fill" style="width:'+risk.score+'%;background:'+risk.color+';"></div></div>'
      + '</div>';
  });

  el.poiBody.innerHTML = '<div class="poi-grid">'+cards.join('')+'</div>';
}

function poiCardClick(nodeId) {
  closePOIPanel();
  if (!graphData) return;
  var node = graphData.nodes.find(function(n){ return n.id === nodeId; });
  if (!node) return;
  var nodeMap = {};
  graphData.nodes.forEach(function(n){ nodeMap[n.id] = n; });
  onNodeClick(node, graphData.edges, nodeMap);
}

function updatePOICount() {
  if (!graphData || !el.poiCount) return;
  el.poiCount.textContent = graphData.nodes.filter(function(n){ return n.is_criminal; }).length;
}

window.sortPOI      = sortPOI;
window.poiCardClick = poiCardClick;
window.updatePOICount = updatePOICount;

// -- Criminals-Only Output Panel -----------------------------------------------
let criminalsZoom = null;

function openCriminalsOutput() {
  if (!graphData) return;
  const overlay = document.getElementById('criminals-output-overlay');
  overlay.classList.remove('hidden');
  renderCriminalsOutput();
}

function closeCriminalsOutput() {
  const overlay = document.getElementById('criminals-output-overlay');
  if (overlay) overlay.classList.add('hidden');
}

function renderCriminalsOutput() {
  if (!graphData) return;

  const criminalNodes = graphData.nodes.filter(n => n.is_criminal);
  const criminalIds   = new Set(criminalNodes.map(n => n.id));
  const criminalEdges = graphData.edges.filter(
    e => criminalIds.has(e.source) && criminalIds.has(e.target)
  );

  const countEl = document.getElementById('criminals-output-count');
  if (countEl) countEl.textContent = criminalNodes.length + ' criminals \u00b7 ' + criminalEdges.length + ' links';

  const listPanel = document.getElementById('criminals-list-panel');
  if (!listPanel) return;

  if (!criminalNodes.length) {
    listPanel.innerHTML = '<div style="color:#64748b;text-align:center;padding:24px;font-family:var(--font-mono);font-size:12px;">NO CRIMINALS FOUND IN CURRENT DATASET</div>';
    renderCriminalsGraph([], []);
    return;
  }

  const sortedCriminals = criminalNodes.slice().sort(function(a, b) {
    var ra = calcRisk(a, graphData.edges.filter(function(e){ return e.source===a.id||e.target===a.id; }));
    var rb = calcRisk(b, graphData.edges.filter(function(e){ return e.source===b.id||e.target===b.id; }));
    return rb.score - ra.score;
  });

  listPanel.innerHTML = '<div class="criminals-output-grid">' + sortedCriminals.map(function(node) {
    var connEdges = graphData.edges.filter(function(e){ return e.source===node.id||e.target===node.id; });
    var crimConn  = connEdges.filter(function(e){ return criminalIds.has(e.source) && criminalIds.has(e.target); });
    var risk = calcRisk(node, connEdges);
    var riskClass = risk.score >= 70 ? 'critical' : risk.score >= 40 ? 'elevated' : 'routine';
    var safeId = (node.id||'').replace(/"/g, '&quot;');
    var tags = '';
    if (node.has_stolen_vehicle) tags += '<span class="poi-meta-tag stolen">STOLEN VEHICLE</span>';
    if (node.multi_source)       tags += '<span class="poi-meta-tag multi">CROSS-REPO</span>';
    if (node.cluster != null)    tags += '<span class="poi-meta-tag cluster">SYNDICATE #'+node.cluster+'</span>';
    return '<div class="criminals-card risk-' + riskClass + '">'
      + '<div class="criminals-card-header">'
      + '<div class="criminals-card-name">' + (node.label||node.id) + '</div>'
      + '<span class="poi-risk-pill ' + riskClass + '">' + risk.level + ' ' + risk.score + '</span>'
      + '</div>'
      + '<div class="poi-card-meta">' + tags + '</div>'
      + '<div class="poi-card-stats">'
      + '<div class="poi-cstat"><div class="poi-cstat-val">' + (node.degree||0) + '</div><div class="poi-cstat-key">TOTAL LINKS</div></div>'
      + '<div class="poi-cstat"><div class="poi-cstat-val">' + crimConn.length + '</div><div class="poi-cstat-key">CRIM LINKS</div></div>'
      + '<div class="poi-cstat"><div class="poi-cstat-val">' + connEdges.filter(function(e){ return e.suspicious; }).length + '</div><div class="poi-cstat-key">FLAGGED</div></div>'
      + '</div>'
      + '<div class="poi-risk-bar"><div class="poi-risk-fill" style="width:'+risk.score+'%;background:'+risk.color+';"></div></div>'
      + '</div>';
  }).join('') + '</div>';

  renderCriminalsGraph(criminalNodes, criminalEdges);
}

function renderCriminalsGraph(nodes, edges) {
  var svgEl = document.getElementById('criminals-graph-svg');
  if (!svgEl) return;
  if (!nodes.length) { d3.select(svgEl).selectAll('*').remove(); return; }

  var parent = svgEl.parentElement;
  var W = parent ? (parent.clientWidth || 700) : 700;
  var H = svgEl.clientHeight || 420;

  var localNodes = nodes.map(function(n){ return Object.assign({}, n); });
  var nodeById = {};
  localNodes.forEach(function(n){ nodeById[n.id] = n; });

  var simLinks = edges.map(function(e){
    return Object.assign({ source: nodeById[e.source], target: nodeById[e.target] }, e);
  }).filter(function(l){ return l.source && l.target; });

  var sim = d3.forceSimulation(localNodes)
    .force('link', d3.forceLink(simLinks).id(function(d){ return d.id; }).distance(100).strength(0.5))
    .force('charge', d3.forceManyBody().strength(-250))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collision', d3.forceCollide(32));

  d3.select(svgEl).selectAll('*').remove();
  var svg = d3.select(svgEl);
  var g   = svg.append('g');

  criminalsZoom = d3.zoom().scaleExtent([0.3, 4])
    .on('zoom', function(e){ g.attr('transform', e.transform); });
  svg.call(criminalsZoom);

  var link = g.append('g').selectAll('line')
    .data(simLinks).enter().append('line')
    .attr('stroke', function(d){ return edgeStroke(d.type, d.suspicious); })
    .attr('stroke-width', 1.8)
    .attr('stroke-opacity', 0.75);

  var node = g.append('g').selectAll('g')
    .data(localNodes).enter().append('g')
    .style('cursor', 'pointer');

  node.append('circle')
    .attr('r', function(d){ return nodeR(d) + 5; })
    .attr('fill', 'none')
    .attr('stroke', function(d){ return nodeStroke(d); })
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,2')
    .attr('opacity', 0.5)
    .attr('pointer-events', 'none');

  node.append('circle')
    .attr('r', function(d){ return nodeR(d); })
    .attr('fill', function(d){ return nodeFill(d); })
    .attr('stroke', function(d){ return nodeStroke(d); })
    .attr('stroke-width', 2);

  node.append('text')
    .attr('dy', function(d){ return nodeR(d) + 13; })
    .attr('text-anchor', 'middle')
    .attr('font-size', '10')
    .attr('font-family', 'JetBrains Mono, monospace')
    .attr('fill', '#94a3b8')
    .attr('pointer-events', 'none')
    .text(function(d){ return shortenName(d.label); });

  sim.on('tick', function() {
    link
      .attr('x1', function(d){ return d.source.x; })
      .attr('y1', function(d){ return d.source.y; })
      .attr('x2', function(d){ return d.target.x; })
      .attr('y2', function(d){ return d.target.y; });
    node.attr('transform', function(d){ return 'translate(' + d.x + ',' + d.y + ')'; });
  });

  sim.alpha(1).restart();
  setTimeout(function(){ sim.stop(); }, 4000);
}

window.openCriminalsOutput  = openCriminalsOutput;
window.closeCriminalsOutput = closeCriminalsOutput;

// ── FEATURE 1: Intermediary Link & Path Conduit Tracer ─────────────────────────
let activePathConduit = null;

function populatePathDatalist() {
  const datalist = $('entities-datalist');
  if (!datalist || !graphData || !graphData.nodes) return;
  datalist.innerHTML = '';
  graphData.nodes.forEach(n => {
    const opt = document.createElement('option');
    opt.value = n.id;
    opt.label = `${n.id}${n.is_criminal ? ' [PRIORITY POI]' : ''}`;
    datalist.appendChild(opt);
  });
}

function openPathTracer() {
  if (!graphData) return;
  const modal = $('path-modal-overlay');
  if (!modal) return;
  populatePathDatalist();
  modal.classList.remove('hidden');

  // If no source is selected and we have an active node, pre-fill it
  const srcInput = $('path-source-input');
  if (srcInput && !srcInput.value && activeNodeId) {
    srcInput.value = activeNodeId;
  }
}

function closePathTracer() {
  const modal = $('path-modal-overlay');
  if (modal) modal.classList.add('hidden');
}

function openPathTracerWithSource(nodeId) {
  openPathTracer();
  const srcInput = $('path-source-input');
  const tgtInput = $('path-target-input');
  if (srcInput) srcInput.value = nodeId;
  if (tgtInput) tgtInput.focus();
}

async function runPathTrace(withAi = true) {
  if (!graphData) return;
  const src = $('path-source-input')?.value?.trim();
  const tgt = $('path-target-input')?.value?.trim();

  if (!src || !tgt) {
    showBanner('Please specify both Origin and Destination entities to trace conduit.', 'danger');
    return;
  }

  const resContainer = $('path-results-container');
  if (resContainer) {
    resContainer.innerHTML = `
      <div class="ai-thinking">
        <div class="spinner"></div>
        <span>Tracing multi-hop conduit &amp; synthesizing forensic intelligence…</span>
      </div>`;
  }

  try {
    const res = await fetch(`${API}/analyze/path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: graphData.nodes,
        edges: graphData.edges,
        source: src,
        target: tgt,
        with_ai: withAi,
      }),
    });
    const json = await res.json();
    if (json.error) throw new Error(json.error);

    renderPathResults(json.path_result, json.explanation);
  } catch (err) {
    if (resContainer) {
      resContainer.innerHTML = `
        <div class="ai-section-value danger">
          <strong>Path Tracing Failed:</strong> ${escapeHtml(err.message)}
        </div>`;
    }
  }
}

function renderPathResults(pathRes, explanation) {
  const container = $('path-results-container');
  if (!container) return;

  if (!pathRes || !pathRes.found) {
    container.innerHTML = `
      <div class="ai-section-value warning" style="text-align:center;padding:18px;">
        <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;margin-bottom:6px;color:#f59e0b;">
          NO DIRECT OR INDIRECT PATH CONDUIT DISCOVERED
        </div>
        <p style="font-size:12px;color:#94a3b8;margin:0;">
          ${escapeHtml(pathRes?.message || 'No linked path exists between the selected entities in the active network scope.')}
        </p>
      </div>`;
    return;
  }

  activePathConduit = pathRes;

  const hops = pathRes.hops;
  const intermediaries = pathRes.intermediaries || [];
  const steps = pathRes.steps || [];
  const totalAmt = pathRes.total_amount || 0;
  const channelTypes = pathRes.channel_types || [];
  const hasCrim = pathRes.has_criminal;
  const hasSusp = pathRes.has_suspicious;

  let h = '';

  // KPI Metrics Grid
  h += `<div class="path-kpi-grid">
    <div class="path-kpi-card">
      <span class="path-kpi-val cyan">${hops} ${hops === 1 ? 'Hop' : 'Hops'}</span>
      <span class="path-kpi-lbl">DISTANCE (DEGREES)</span>
    </div>
    <div class="path-kpi-card">
      <span class="path-kpi-val ${intermediaries.length ? 'warning' : 'cyan'}">${intermediaries.length}</span>
      <span class="path-kpi-lbl">INTERMEDIARY RELAYS</span>
    </div>
    <div class="path-kpi-card">
      <span class="path-kpi-val ${totalAmt > 0 ? 'success' : ''}">₹${totalAmt.toLocaleString('en-IN')}</span>
      <span class="path-kpi-lbl">TOTAL MONETARY FLOW</span>
    </div>
    <div class="path-kpi-card">
      <span class="path-kpi-val ${hasCrim || hasSusp ? 'danger' : 'success'}">${hasCrim ? 'HIGH RISK' : hasSusp ? 'SUSPICIOUS' : 'STANDARD'}</span>
      <span class="path-kpi-lbl">CONDUIT THREAT LEVEL</span>
    </div>
  </div>`;

  // AI Forensic Conduit Synthesis
  if (explanation) {
    h += `<div class="ai-section" style="margin-top:6px;">
      <div class="ai-section-label">FORENSIC CONDUIT INTELLIGENCE SYNTHESIS</div>
      <div class="ai-section-value highlight">
        ${escapeHtml(explanation)}
      </div>
    </div>`;
  }

  // Step-by-Step Conduit Trail
  if (steps.length) {
    h += `<div class="path-timeline-trail">
      <div class="path-trail-header">
        <span class="path-trail-title">STEP-BY-STEP INVESTIGATIVE CONDUIT TRAIL</span>
        <div style="display:flex;gap:4px;">
          ${channelTypes.map(c => badge(c, tagCls(c))).join('')}
        </div>
      </div>`;

    steps.forEach(s => {
      const amtStr = s.total_amount ? ` · ₹${s.total_amount.toLocaleString('en-IN')}` : '';
      const suspTag = s.suspicious ? '<span class="badge suspicious" style="margin-left:4px;">FLAGGED</span>' : '';
      h += `<div class="path-step-card">
        <div class="path-step-badge">${s.step_num}</div>
        <div class="path-step-content">
          <div class="path-step-entities">
            <span class="entity-tag ${s.from_criminal ? 'criminal' : ''}">${escapeHtml(s.from)}</span>
            <span class="path-step-arrow">⟶</span>
            <span class="entity-tag ${s.to_criminal ? 'criminal' : ''}">${escapeHtml(s.to)}</span>
            <span class="badge ${tagCls(s.edge_type)}" style="margin-left:auto;">${escapeHtml(s.edge_type)}${amtStr}</span>
            ${suspTag}
          </div>
          <div class="path-step-desc">${escapeHtml(s.description || 'Direct relational linkage documented.')}</div>
        </div>
      </div>`;
    });

    h += `</div>`;
  }

  // Action Buttons
  h += `<div class="path-actions-bar">
    <button class="btn btn-ghost" onclick="clearPathHighlight()">Clear Canvas Conduit</button>
    <button class="btn btn-primary" onclick="isolateConduitOnCanvas()">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
      </svg>
      <span>Isolate &amp; Glow on Canvas</span>
    </button>
  </div>`;

  container.innerHTML = h;
}

function isolateConduitOnCanvas() {
  if (!activePathConduit || !activePathConduit.shortest_path) return;
  highlightPathOnCanvas(activePathConduit.shortest_path);
  closePathTracer();
  showBanner(`ISOLATING CONDUIT: ${activePathConduit.source} ⟶ ${activePathConduit.target} (${activePathConduit.hops} hops) · Click Clear Canvas to reset`, 'info');
}

function highlightPathOnCanvas(pathNodes) {
  if (!pathNodes || pathNodes.length === 0 || !activeNodeMap) return;

  const pathNodeSet = new Set(pathNodes);
  const pathEdgePairs = new Set();
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const u = pathNodes[i];
    const v = pathNodes[i + 1];
    pathEdgePairs.add(`${u}__${v}`);
    pathEdgePairs.add(`${v}__${u}`);
  }

  // Reset any other selections
  activeNodeId = null;
  activeEdge = null;
  isolatedClusterId = null;
  d3.selectAll('.cluster-group').attr('opacity', null);

  // Style nodes
  d3.selectAll('.node-g')
    .attr('opacity', d => pathNodeSet.has(d.id) ? 1 : 0.05);

  d3.selectAll('.node-circle')
    .classed('path-conduit-node', d => pathNodeSet.has(d.id))
    .attr('r', d => pathNodeSet.has(d.id) ? nodeR(d) + 4 : nodeR(d));

  // Style edges
  d3.selectAll('.edge-line')
    .classed('path-conduit', d => pathEdgePairs.has(`${d.source}__${d.target}`))
    .attr('opacity', d => pathEdgePairs.has(`${d.source}__${d.target}`) ? 1 : 0.02);

  // Zoom to fit path bounding box
  const nodesOnPath = pathNodes.map(id => activeNodeMap[id]).filter(Boolean);
  if (nodesOnPath.length > 0 && svgSel && zoomBehavior) {
    const minX = Math.min(...nodesOnPath.map(n => n.x)) - 100;
    const maxX = Math.max(...nodesOnPath.map(n => n.x)) + 100;
    const minY = Math.min(...nodesOnPath.map(n => n.y)) - 100;
    const maxY = Math.max(...nodesOnPath.map(n => n.y)) + 100;

    const wrapper = $('canvas-wrapper');
    const W = wrapper.clientWidth  || 900;
    const H = wrapper.clientHeight || 700;

    const dx = maxX - minX || 100;
    const dy = maxY - minY || 100;
    const scale = Math.min(2.5, Math.max(0.3, 0.85 / Math.max(dx / W, dy / H)));
    const tx = W / 2 - scale * ((minX + maxX) / 2);
    const ty = H / 2 - scale * ((minY + maxY) / 2);

    svgSel.transition().duration(850).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
  }
}

function clearPathHighlight() {
  clearHighlights();
  activePathConduit = null;
}

window.openPathTracer            = openPathTracer;
window.closePathTracer           = closePathTracer;
window.openPathTracerWithSource  = openPathTracerWithSource;
window.runPathTrace              = runPathTrace;
window.isolateConduitOnCanvas    = isolateConduitOnCanvas;
window.clearPathHighlight        = clearPathHighlight;

// ── FEATURE 2: Forensic Timeline & Temporal Flow Scrubber ─────────────────────
let timelineDates      = [];
let timelinePlaying    = false;
let timelineTimer      = null;
let timelineSpeed      = 1;
let timelineCurrentIdx = 0;
let timelineEdgeDateMap= new Map();

function initTimeline() {
  if (!graphData || !graphData.edges) return;

  const dateSet = new Set();
  timelineEdgeDateMap.clear();

  graphData.edges.forEach((e, idx) => {
    const dates = [];
    if (Array.isArray(e.dates) && e.dates.length) {
      e.dates.forEach(d => { if (d && d !== 'nan') dates.push(d); });
    }
    if (e.date && e.date !== 'nan' && !dates.includes(e.date)) {
      dates.push(e.date);
    }
    if (Array.isArray(e.date_range) && e.date_range[0] && e.date_range[0] !== 'nan') {
      if (!dates.includes(e.date_range[0])) dates.push(e.date_range[0]);
      if (e.date_range[1] && e.date_range[1] !== 'nan' && !dates.includes(e.date_range[1])) {
        dates.push(e.date_range[1]);
      }
    }

    if (!dates.length) {
      // Fallback timestamp based on index if no date in data
      const month = String((idx % 12) + 1).padStart(2, '0');
      const day = String((idx % 28) + 1).padStart(2, '0');
      dates.push(`2024-${month}-${day}`);
    }

    dates.forEach(d => dateSet.add(d));
    timelineEdgeDateMap.set(idx, dates.sort());
  });

  timelineDates = Array.from(dateSet).sort();

  if (!timelineDates.length) {
    timelineDates = ['2024-01-01', '2024-06-01', '2024-12-31'];
  }

  const scrubber = $('timeline-scrubber');
  if (scrubber) {
    scrubber.min = 0;
    scrubber.max = timelineDates.length - 1;
    scrubber.value = timelineDates.length - 1;
    timelineCurrentIdx = timelineDates.length - 1;
  }

  if ($('timeline-date-start')) $('timeline-date-start').textContent = timelineDates[0];
  if ($('timeline-date-end'))   $('timeline-date-end').textContent   = timelineDates[timelineDates.length - 1];
  if ($('timeline-current-cursor')) $('timeline-current-cursor').textContent = timelineDates[timelineDates.length - 1];
  if ($('timeline-range-label')) $('timeline-range-label').textContent = `ACTIVE WINDOW: ALL RECORDS (${timelineDates[0]} ⟶ ${timelineDates[timelineDates.length - 1]})`;
  if ($('timeline-active-events')) $('timeline-active-events').textContent = `${graphData.edges.length} Events Active`;

  renderTimelineHistogram();
}

function renderTimelineHistogram() {
  const histContainer = $('timeline-histogram');
  if (!histContainer || !timelineDates.length) return;

  // Build count per date
  const dateCounts = {};
  timelineDates.forEach(d => { dateCounts[d] = 0; });
  timelineEdgeDateMap.forEach(dates => {
    dates.forEach(d => {
      if (dateCounts[d] !== undefined) dateCounts[d]++;
    });
  });

  const maxCount = Math.max(1, ...Object.values(dateCounts));
  const numBars = Math.min(60, timelineDates.length);
  const step = Math.max(1, Math.floor(timelineDates.length / numBars));

  histContainer.innerHTML = '';
  for (let i = 0; i < timelineDates.length; i += step) {
    let sum = 0;
    for (let j = i; j < Math.min(i + step, timelineDates.length); j++) {
      sum += dateCounts[timelineDates[j]] || 0;
    }
    const heightPct = Math.max(15, Math.min(100, Math.round((sum / maxCount) * 100)));
    const bar = document.createElement('div');
    bar.className = 't-hist-bar active';
    bar.style.height = `${heightPct}%`;
    bar.dataset.index = i;
    histContainer.appendChild(bar);
  }
}

function toggleTimelineDock() {
  const dock = $('timeline-dock');
  if (!dock) return;
  if (dock.classList.contains('hidden')) {
    openTimelineDock();
  } else {
    closeTimelineDock();
  }
}

function openTimelineDock() {
  if (!graphData) return;
  const dock = $('timeline-dock');
  if (!dock) return;
  dock.classList.remove('hidden');
  initTimeline();
  showBanner('TEMPORAL SCRUBBER ACTIVE · Drag slider or press Play (Space) to animate flow', 'info');
}

function closeTimelineDock() {
  pauseTimeline();
  const dock = $('timeline-dock');
  if (dock) dock.classList.add('hidden');
  resetTimeline(false);
}

function onTimelineScrub(idx, isStepAnimation = false) {
  if (!graphData || !timelineDates.length) return;
  timelineCurrentIdx = Math.max(0, Math.min(timelineDates.length - 1, idx));
  const targetDate = timelineDates[timelineCurrentIdx];

  const scrubber = $('timeline-scrubber');
  if (scrubber) scrubber.value = timelineCurrentIdx;

  if ($('timeline-current-cursor')) {
    $('timeline-current-cursor').textContent = targetDate;
  }
  if ($('timeline-range-label')) {
    $('timeline-range-label').textContent = `TEMPORAL CUT-OFF: ≤ ${targetDate}`;
  }

  // Update histogram active state
  const bars = document.querySelectorAll('.t-hist-bar');
  const pct = timelineCurrentIdx / (timelineDates.length - 1 || 1);
  bars.forEach((b, bIdx) => {
    const barPct = bIdx / (bars.length - 1 || 1);
    b.classList.toggle('active', barPct <= pct);
  });

  // Filter edges & nodes by chronological cutoff
  const activeEdgeIndices = new Set();
  const activeNodeIds = new Set();
  let activeEventCount = 0;

  graphData.edges.forEach((e, edgeIdx) => {
    const dates = timelineEdgeDateMap.get(edgeIdx) || [];
    const minEdgeDate = dates[0] || '';
    if (!minEdgeDate || minEdgeDate <= targetDate) {
      activeEdgeIndices.add(edgeIdx);
      activeNodeIds.add(e.source);
      activeNodeIds.add(e.target);
      activeEventCount++;
    }
  });

  if ($('timeline-active-events')) {
    $('timeline-active-events').textContent = `${activeEventCount} / ${graphData.edges.length} Events`;
  }

  // D3 DOM update
  d3.selectAll('.edge-line')
    .attr('opacity', (d, i) => activeEdgeIndices.has(i) ? 0.85 : 0.03)
    .classed('timeline-fresh', (d, i) => isStepAnimation && activeEdgeIndices.has(i) && (timelineEdgeDateMap.get(i) || []).includes(targetDate));

  d3.selectAll('.node-g')
    .attr('opacity', d => activeNodeIds.has(d.id) ? 1 : 0.08);
}

function playTimeline() {
  if (timelinePlaying) return;
  timelinePlaying = true;
  const playIcon = $('timeline-play-icon');
  if (playIcon) playIcon.textContent = '❚❚';

  if (timelineCurrentIdx >= timelineDates.length - 1) {
    timelineCurrentIdx = 0;
  }

  const intervalMs = Math.round(900 / timelineSpeed);
  timelineTimer = setInterval(() => {
    if (timelineCurrentIdx >= timelineDates.length - 1) {
      pauseTimeline();
      return;
    }
    timelineCurrentIdx++;
    onTimelineScrub(timelineCurrentIdx, true);
  }, intervalMs);
}

function pauseTimeline() {
  timelinePlaying = false;
  if (timelineTimer) {
    clearInterval(timelineTimer);
    timelineTimer = null;
  }
  const playIcon = $('timeline-play-icon');
  if (playIcon) playIcon.textContent = '▶';
  d3.selectAll('.edge-line').classed('timeline-fresh', false);
}

function togglePlayTimeline() {
  if (timelinePlaying) {
    pauseTimeline();
  } else {
    playTimeline();
  }
}

function stepTimeline(delta) {
  pauseTimeline();
  const nextIdx = Math.max(0, Math.min(timelineDates.length - 1, timelineCurrentIdx + delta));
  onTimelineScrub(nextIdx, true);
}

function resetTimeline(notify = true) {
  pauseTimeline();
  if (!timelineDates.length) return;
  timelineCurrentIdx = timelineDates.length - 1;
  const scrubber = $('timeline-scrubber');
  if (scrubber) scrubber.value = timelineCurrentIdx;

  if ($('timeline-current-cursor')) $('timeline-current-cursor').textContent = timelineDates[timelineCurrentIdx];
  if ($('timeline-range-label')) $('timeline-range-label').textContent = `ALL ACTIVE RECORDS (${timelineDates[0]} ⟶ ${timelineDates[timelineCurrentIdx]})`;
  if ($('timeline-active-events') && graphData) $('timeline-active-events').textContent = `${graphData.edges.length} Events Active`;

  d3.selectAll('.edge-line').attr('opacity', null).classed('timeline-fresh', false);
  d3.selectAll('.node-g').attr('opacity', null);
  document.querySelectorAll('.t-hist-bar').forEach(b => b.classList.add('active'));

  if (notify) showBanner('TIMELINE RESTORED TO FULL RANGE', 'info');
}

window.toggleTimelineDock  = toggleTimelineDock;
window.openTimelineDock    = openTimelineDock;
window.closeTimelineDock   = closeTimelineDock;
window.onTimelineScrub     = onTimelineScrub;
window.togglePlayTimeline  = togglePlayTimeline;
window.stepTimeline        = stepTimeline;
window.resetTimeline       = resetTimeline;

// ── FEATURE 3: Key Players & Syndicate Vulnerability Matrix ────────────────────
let vulnerabilityData       = null;
let activeDisruptedNodeId   = null;

async function fetchVulnerabilityData() {
  if (!graphData || !graphData.nodes) return;
  try {
    const res = await fetch(`${API}/analyze/vulnerability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: graphData.nodes,
        edges: graphData.edges,
      }),
    });
    const json = await res.json();
    if (json.vulnerability) {
      vulnerabilityData = json.vulnerability;
      updateVulnerabilityKPIs(vulnerabilityData.kpis);
      markArticulationPointsOnCanvas(vulnerabilityData.articulation_points || []);
    }
  } catch (err) {
    console.warn('Vulnerability analysis fetch failed:', err);
  }
}

function updateVulnerabilityKPIs(kpis) {
  if (!kpis) return;
  if ($('vuln-kpi-bridges')) $('vuln-kpi-bridges').textContent = kpis.articulation_points_count || 0;
  if ($('vuln-kpi-broker'))  $('vuln-kpi-broker').textContent  = shortenName(kpis.top_broker_name || '--');
  if ($('vuln-kpi-broker-sub')) $('vuln-kpi-broker-sub').textContent = `Betweenness: ${kpis.top_broker_score || 0}/100`;
  if ($('vuln-kpi-hub'))     $('vuln-kpi-hub').textContent     = shortenName(kpis.top_hub_name || '--');
  if ($('vuln-kpi-hub-sub')) $('vuln-kpi-hub-sub').textContent = `PageRank Hub: ${kpis.top_hub_score || 0}/100`;
  if ($('vuln-kpi-score'))   $('vuln-kpi-score').textContent   = `${kpis.network_vulnerability_pct || 0}%`;
}

function markArticulationPointsOnCanvas(apList) {
  if (!apList || !apList.length) return;
  const apSet = new Set(apList);
  d3.selectAll('.node-circle')
    .classed('cut-vertex-node', d => apSet.has(d.id));
}

function toggleVulnerabilityModal() {
  const modal = $('vulnerability-modal-overlay');
  if (!modal) return;
  if (modal.classList.contains('hidden')) {
    openVulnerabilityModal();
  } else {
    closeVulnerabilityModal();
  }
}

async function openVulnerabilityModal() {
  if (!graphData) return;
  const modal = $('vulnerability-modal-overlay');
  if (!modal) return;
  modal.classList.remove('hidden');

  if (!vulnerabilityData) {
    await fetchVulnerabilityData();
  }
  renderVulnerabilityMatrix('all', $('vuln-search-input')?.value || '');
}

function closeVulnerabilityModal() {
  const modal = $('vulnerability-modal-overlay');
  if (modal) modal.classList.add('hidden');
}

function renderVulnerabilityMatrix(filter = 'all', searchQuery = '') {
  const tbody = $('vuln-table-body');
  if (!tbody || !vulnerabilityData || !vulnerabilityData.rankings) return;

  let list = vulnerabilityData.rankings.slice();

  // Apply tab filter
  if (filter === 'bridge') {
    list = list.filter(r => r.is_articulation_point);
  } else if (filter === 'broker') {
    list = list.filter(r => r.betweenness_score >= 40);
  } else if (filter === 'hub') {
    list = list.filter(r => r.pagerank_score >= 40);
  } else if (filter === 'poi') {
    list = list.filter(r => r.is_criminal);
  }

  // Apply text search
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    list = list.filter(r =>
      r.id.toLowerCase().includes(q) ||
      (r.role_label && r.role_label.toLowerCase().includes(q))
    );
  }

  if (!list.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center;padding:24px;color:#64748b;font-family:var(--font-mono);font-size:12px;">
          NO TARGETS MATCHING THE SELECTED VULNERABILITY FILTER
        </td>
      </tr>`;
    return;
  }

  let h = '';
  list.forEach((r, idx) => {
    let roleClass = 'associate';
    if (r.role === 'CRITICAL_BRIDGE') roleClass = 'bridge';
    else if (r.role === 'KEY_BROKER') roleClass = 'broker';
    else if (r.role === 'INFLUENCE_HUB') roleClass = 'hub';
    else if (r.role === 'OPERATIVE') roleClass = 'operative';

    let threatColor = '#10b981';
    if (r.composite_threat >= 75) threatColor = '#ef4444';
    else if (r.composite_threat >= 45) threatColor = '#f59e0b';

    const safeId = escapeHtml(r.id);
    const clusterStr = r.cluster != null ? ` · Syndicate #${r.cluster}` : '';
    const crimTag = r.is_criminal ? ' <span class="badge suspicious" style="font-size:9px;">POI</span>' : '';
    const stolenTag = r.has_stolen_vehicle ? ' <span class="badge vehicle" style="font-size:9px;">STOLEN VEH</span>' : '';

    h += `<tr>
      <td class="vuln-rank">${idx + 1}</td>
      <td>
        <div class="vuln-entity-cell">
          <span class="vuln-entity-name">${safeId}${crimTag}${stolenTag}</span>
          <span class="vuln-entity-meta">${r.degree} links${clusterStr}</span>
        </div>
      </td>
      <td>
        <span class="role-tag ${roleClass}">${escapeHtml(r.role_label)}</span>
      </td>
      <td>
        <div class="threat-bar-container">
          <div class="threat-bar-track">
            <div class="threat-bar-fill" style="width:${r.composite_threat}%;background:${threatColor};"></div>
          </div>
          <span class="threat-bar-val" style="color:${threatColor};">${r.composite_threat}</span>
        </div>
      </td>
      <td>
        <div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:#fbbf24;">${r.betweenness_score} / 100</div>
      </td>
      <td>
        <div style="font-family:var(--font-mono);font-size:11px;font-weight:600;color:#38bdf8;">${r.pagerank_score} / 100</div>
      </td>
      <td>
        <span style="font-family:var(--font-mono);font-size:11.5px;color:var(--text-primary);font-weight:600;">${r.degree}</span>
      </td>
      <td style="text-align:right;">
        <div style="display:inline-flex;gap:4px;">
          <button class="btn btn-sm btn-ghost" onclick="focusVulnTarget('${safeId}')" title="Focus entity on canvas">
            Focus
          </button>
          <button class="btn btn-sm btn-ghost" onclick="traceVulnTarget('${safeId}')" title="Trace conduit from this target">
            Trace
          </button>
          <button class="btn-disrupt" onclick="simulateNodeDisruption('${safeId}')" title="Simulate arrest and network fracturing">
            ⚡ Simulate Arrest
          </button>
        </div>
      </td>
    </tr>`;
  });

  tbody.innerHTML = h;
}

function focusVulnTarget(nodeId) {
  closeVulnerabilityModal();
  focusNodeOnCanvas(nodeId);
}

function traceVulnTarget(nodeId) {
  closeVulnerabilityModal();
  openPathTracerWithSource(nodeId);
}

function simulateNodeDisruption(nodeId) {
  if (!graphData || !activeNodeMap) return;
  activeDisruptedNodeId = nodeId;
  closeVulnerabilityModal();

  const connectedEdgeIndices = new Set();
  let severedCount = 0;

  graphData.edges.forEach((e, idx) => {
    if (e.source === nodeId || e.target === nodeId) {
      connectedEdgeIndices.add(idx);
      severedCount++;
    }
  });

  // Calculate remaining connected components
  let remainingComps = 1;
  if (vulnerabilityData && vulnerabilityData.rankings) {
    const r = vulnerabilityData.rankings.find(x => x.id === nodeId);
    if (r) remainingComps = r.disruption_components;
  }

  // Visual Disruption styling on D3 canvas
  d3.selectAll('.node-circle')
    .attr('opacity', d => d.id === nodeId ? 0.15 : 1)
    .attr('stroke', d => d.id === nodeId ? '#ef4444' : nodeStroke(d));

  d3.selectAll('.edge-line')
    .classed('disrupted-severed', (d, i) => connectedEdgeIndices.has(i))
    .attr('opacity', (d, i) => connectedEdgeIndices.has(i) ? 0.9 : 0.4);

  // Show notice banner
  const notice = $('vuln-disruption-notice');
  const text = $('vuln-disruption-text');
  if (notice && text) {
    text.innerHTML = `DISRUPTION SIMULATION: Target <strong>${escapeHtml(nodeId)}</strong> neutralized · <strong>${severedCount} links severed</strong> · Network fractured into <strong>${remainingComps} subnets</strong>`;
    notice.style.display = 'flex';
  }

  showBanner(`DISRUPTION SIMULATION ACTIVE: '${nodeId}' removed · ${severedCount} links severed · Fractured into ${remainingComps} subnets`, 'danger');
}

function restoreDisruptionSimulation() {
  activeDisruptedNodeId = null;
  const notice = $('vuln-disruption-notice');
  if (notice) notice.style.display = 'none';
  clearHighlights();
  showBanner('NETWORK CANVAS RESTORED TO ACTIVE BASELINE STATE', 'info');
}

window.toggleVulnerabilityModal   = toggleVulnerabilityModal;
window.openVulnerabilityModal     = openVulnerabilityModal;
window.closeVulnerabilityModal    = closeVulnerabilityModal;
window.renderVulnerabilityMatrix  = renderVulnerabilityMatrix;
window.focusVulnTarget            = focusVulnTarget;
window.traceVulnTarget            = traceVulnTarget;
window.simulateNodeDisruption     = simulateNodeDisruption;
window.restoreDisruptionSimulation= restoreDisruptionSimulation;



