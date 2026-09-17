/* ═══════════════════════════════════════════════════════════════════
   CRIMENET — Forensic Network Analysis & Link Discovery
   Investigative Workbench Engine
   ═══════════════════════════════════════════════════════════════════ */

const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:5000/api'
  : '/api';

// ── State ──────────────────────────────────────────────────────────────────────
let graphData    = null;
let activeNodeId = null;
let activeEdge   = null;
let zoomBehavior = null;
let svgSel       = null;
let gRootSel     = null;

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
};

// ── Boot ───────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initUpload();
  initButtons();
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
    if (f?.name.endsWith('.csv')) uploadFile(f);
    else showBanner('Please provide a valid .csv evidence file', 'danger');
  });
}

async function uploadFile(file) {
  showLoading(`Ingesting ${file.name}…`);
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
    showBanner('Ingestion error: ' + err.message, 'danger');
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
function showBanner(text, type = 'info') {
  el.infoBannerTxt.textContent = text;
  el.infoBanner.classList.remove('hidden');
  el.infoBanner.style.borderColor = type === 'danger' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(59, 130, 246, 0.35)';
}
function hideBanner() {
  el.infoBanner.classList.add('hidden');
}

// ── Taxonomy Palette ───────────────────────────────────────────────────────────
const EDGE_COLORS = {
  'phone call':            '#38bdf8',
  'shared bank account':   '#eab308',
  'financial transaction': '#10b981',
  'vehicle transfer':      '#f97316',
  'same criminal cluster': '#8b5cf6',
  'connected':             '#64748b',
};

function edgeStroke(type, suspicious) {
  if (suspicious) return '#ef4444';
  return EDGE_COLORS[type] || '#64748b';
}

function nodeFill(node) {
  return node.is_criminal
    ? (node.has_stolen_vehicle ? '#450a0a' : '#581c87' === '#581c87' ? '#7f1d1d' : '#7f1d1d')
    : '#0c2444';
}

function nodeStroke(node) {
  return node.is_criminal
    ? (node.has_stolen_vehicle ? '#f97316' : '#ef4444')
    : '#38bdf8';
}

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
  ['btn-summary','btn-anomalies','btn-reset'].forEach(id => $(id).style.display = '');
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

    gClusters.append('circle')
      .attr('cx', cx).attr('cy', cy).attr('r', haloR)
      .attr('fill', hexAlpha(hue, 0.04))
      .attr('stroke', hexAlpha(hue, 0.25))
      .attr('stroke-width', 1.2)
      .attr('stroke-dasharray', '5, 4')
      .attr('class', 'cluster-halo');

    gClusters.append('text')
      .attr('x', cx).attr('y', cy - haloR - 8)
      .attr('text-anchor', 'middle')
      .attr('font-size', '10')
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('font-weight', '600')
      .attr('letter-spacing', '0.08em')
      .attr('fill', hexAlpha(hue, 0.65))
      .attr('pointer-events', 'none')
      .text(`SYNDICATE #${cluster.id}`);
  });

  // Link Vectors
  const edges = data.edges.filter(e => nodeMap[e.source] && nodeMap[e.target]);

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
  nodeSel.filter(d => d.is_criminal)
    .append('circle')
    .attr('r', d => nodeR(d) + 6)
    .attr('fill', 'none')
    .attr('stroke', d => nodeStroke(d))
    .attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '3, 2')
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
}

// ── Node Click Handler ─────────────────────────────────────────────────────────
function onNodeClick(node, edges, nodeMap) {
  activeNodeId = node.id;
  activeEdge   = null;
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

  d3.selectAll('.edge-line')
    .attr('opacity', d => (d.source === edge.source && d.target === edge.target) ? 1 : 0.05);
  d3.selectAll('.node-circle')
    .attr('opacity', d => (d.id === edge.source || d.id === edge.target) ? 1 : 0.15);

  openDetailPanel('edge', edge, [], nodeMap);
}

// ── Clear Canvas Selections ───────────────────────────────────────────────────
function clearHighlights() {
  activeNodeId = null;
  activeEdge   = null;
  d3.selectAll('.edge-line').attr('opacity', null).classed('highlighted', false);
  d3.selectAll('.node-circle').attr('opacity', null).attr('r', d => nodeR(d)).attr('stroke-width', 2.2);
  d3.selectAll('.node-label').classed('selected', false);
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

  // Correlated Connections
  if (connIds.length) {
    h += `<div class="detail-section"><div class="detail-section-title">RECORDED AFFILIATIONS (${connIds.length})</div>`;
    connIds.slice(0, 10).forEach(pid => {
      const p    = nodeMap[pid] || { id: pid };
      const edge = connEdges.find(e => e.source === pid || e.target === pid);
      const amt  = edge?.total_amount ? `<span style="color:#10b981;font-family:monospace;font-size:11px;"> ₹${Math.round(edge.total_amount).toLocaleString('en-IN')}</span>` : '';
      const cnt  = edge?.txn_count    ? `<span style="font-size:10px;color:#64748b;"> (${edge.txn_count} txns)</span>` : '';
      h += `<div class="detail-row" style="align-items:center;">
        <span class="detail-key" style="${p.is_criminal ? 'color:#f87171;' : ''}">${p.is_criminal ? '[POI] ' : ''}${pid}</span>
        <span>${badge(edge?.type || 'link', tagCls(edge?.type))}${amt}${cnt}</span>
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

// ── Workspace Reset & Multi-Source Triggers ────────────────────────────────────
function initButtons() {
  $('btn-reset').addEventListener('click', () => {
    graphData = null;
    gRootSel?.selectAll('*').remove();
    el.emptyState.classList.remove('hidden');
    el.graphSvg.classList.add('hidden');
    el.zoomCtrls.classList.add('hidden');
    el.graphStats.style.display = 'none';
    ['btn-summary','btn-anomalies','btn-reset'].forEach(id => $(id).style.display = 'none');
    el.filterSec.style.display = 'none';
    el.legendSec.style.display = 'none';
    hideBanner();
    closeDetailPanel();
    document.querySelectorAll('.dataset-item').forEach(e => e.classList.remove('active'));
  });

  $('btn-load-all').addEventListener('click', () => loadAllFiles(false));
  $('btn-suspected-only').addEventListener('click', () => loadAllFiles(true));
  $('btn-load-all-quick').addEventListener('click', () => loadAllFiles(false));
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
    d3.selectAll('.edge-line').attr('display', d => {
      if (d.suspicious && !showSusp) return 'none';
      return null;
    });
  });
});

// ── Utility Helpers ────────────────────────────────────────────────────────────
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
