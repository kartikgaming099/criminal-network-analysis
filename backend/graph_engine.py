"""
graph_engine.py  v3
SIH26189 — Criminal Network Analysis
- Fixed cluster layout (no overlaps, generous spacing)
- Bank transactions: single aggregated edge per person-pair
- Multi-file combined graph engine
- Cross-file person linking by name
- Suspected-network filter helper
"""

import pandas as pd
import networkx as nx
import math
import re
from io import StringIO

try:
    import community as community_louvain
except ImportError:
    community_louvain = None

# ── Column type detection ──────────────────────────────────────────────────────

def detect_schema(df: pd.DataFrame) -> str:
    cols = set(df.columns.str.lower())
    if 'mobile_number' in cols and 'call_logs' in cols:
        return 'call_records'
    if 'person_id' in cols and 'is_criminal' in cols:
        return 'bank_accounts'
    if 'txn_id' in cols and 'from_account_no' in cols:
        return 'bank_transactions'
    if 'vehicle_id' in cols and 'chassis_no' in cols:
        return 'vehicle_registrations'
    if 'transfer_id' in cols and 'from_owner' in cols:
        return 'vehicle_ownership_transfers'
    return 'generic'


# ── Parsers ────────────────────────────────────────────────────────────────────

def parse_call_records(df: pd.DataFrame, G: nx.Graph, persons: dict):
    phone_to_person = {}
    for _, row in df.iterrows():
        name   = str(row.get('Name', '')).strip()
        mobile = str(row.get('Mobile_Number', '')).strip()
        if name and mobile and name != 'nan':
            phone_to_person[mobile] = name
            _ensure_person(G, persons, name, row.to_dict(), 'call_records')

    for _, row in df.iterrows():
        name     = str(row.get('Name', '')).strip()
        logs_raw = str(row.get('Call_Logs', '')).strip()
        if not name or name == 'nan':
            continue
        logs = [l.strip() for l in logs_raw.split(',') if l.strip()]
        for phone in logs:
            target = phone_to_person.get(phone)
            if target and target != name:
                _add_edge(G, name, target, 'phone call', f"Call log: {phone}")

    # Shared bank account
    acc_map = {}
    for _, row in df.iterrows():
        name = str(row.get('Name', '')).strip()
        acc  = str(row.get('Bank_Account', '')).strip()
        if name and acc and name != 'nan' and acc not in ('nan', ''):
            acc_map.setdefault(acc, []).append(name)
    for acc, names in acc_map.items():
        names = list(set(names))
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                _add_edge(G, names[i], names[j], 'shared bank account',
                          f"Both linked to account {acc}")


def parse_bank_accounts(df: pd.DataFrame, G: nx.Graph, persons: dict):
    cluster_map = {}
    for _, row in df.iterrows():
        name = str(row.get('name', '')).strip()
        if not name or name == 'nan':
            continue
        _ensure_person(G, persons, name, row.to_dict(), 'bank_accounts')
        cluster = str(row.get('cluster', '')).strip()
        if cluster and cluster != 'nan':
            cluster_map.setdefault(cluster, []).append(name)

    for cluster, names in cluster_map.items():
        for i in range(len(names)):
            for j in range(i + 1, len(names)):
                _add_edge(G, names[i], names[j], 'same criminal cluster',
                          f"Both in criminal cluster {cluster}")


def parse_bank_transactions(df: pd.DataFrame, G: nx.Graph, persons: dict,
                             min_txn_count: int = 1, amount_threshold: float = 0):
    """
    Aggregate ALL transactions between each person-pair into a SINGLE edge.
    An edge is created only if there are >= min_txn_count transactions between them.
    """
    # First pass: accumulate per-pair data
    pair_data: dict = {}   # (a, b) → {total, count, modes, dates}

    for _, row in df.iterrows():
        from_name = str(row.get('from_account_name', '')).strip()
        to_name   = str(row.get('to_account_name',   '')).strip()
        amount    = float(row.get('amount', 0) or 0)
        mode      = str(row.get('mode', '')).strip()
        date      = str(row.get('date', '')).strip()

        # Skip external / merchant / employer accounts
        skip_keywords = ('EXT', 'Employer', 'Merchant', 'Payment Gateway', 'Salary')
        if any(k in from_name for k in skip_keywords): continue
        if any(k in to_name   for k in skip_keywords): continue
        if not from_name or not to_name: continue
        if from_name == 'nan' or to_name == 'nan': continue
        if from_name == to_name: continue
        if amount < amount_threshold: continue

        # Canonical pair key (alphabetical so A→B and B→A merge)
        key = tuple(sorted([from_name, to_name]))
        if key not in pair_data:
            pair_data[key] = {
                'total': 0, 'count': 0,
                'modes': set(), 'dates': [],
                'from': from_name, 'to': to_name,
            }
        pair_data[key]['total']  += amount
        pair_data[key]['count']  += 1
        pair_data[key]['modes'].add(mode)
        pair_data[key]['dates'].append(date)

    # Second pass: create one edge per pair
    for (a, b), info in pair_data.items():
        if info['count'] < min_txn_count:
            continue
        _ensure_person(G, persons, a, {}, 'bank_transactions')
        _ensure_person(G, persons, b, {}, 'bank_transactions')

        modes_str = ', '.join(info['modes'])
        dates_sorted = sorted(info['dates'])
        first_date = dates_sorted[0] if dates_sorted else ''
        last_date  = dates_sorted[-1] if dates_sorted else ''

        description = (
            f"₹{info['total']:,.0f} total across {info['count']} transaction(s). "
            f"Mode(s): {modes_str}. "
            f"Period: {first_date} to {last_date}."
        )

        # Flag if high frequency or large amounts (suspicious)
        suspicious = info['count'] >= 10 or info['total'] >= 100000

        _add_edge(G, a, b, 'financial transaction', description,
                  weight=info['total'], suspicious=suspicious,
                  extra={'txn_count': info['count'], 'total_amount': info['total'],
                         'modes': list(info['modes']), 'date_range': [first_date, last_date],
                         'dates': dates_sorted, 'date': first_date})


def parse_vehicle_registrations(df: pd.DataFrame, G: nx.Graph, persons: dict):
    """
    Vehicle registrations only ENRICH person nodes — no network edges created.
    Persons already in the graph get vehicle info attached.
    """
    for _, row in df.iterrows():
        owner  = str(row.get('owner_name', '')).strip()
        reg    = str(row.get('reg_no', '')).strip()
        status = str(row.get('status', '')).strip()
        if not owner or owner == 'nan':
            continue
        # Only enrich persons already known OR add them with no edges
        _ensure_person(G, persons, owner, {}, 'vehicle_registrations')
        p = persons[owner]
        vehicles = p.setdefault('vehicles', [])
        vehicles.append({
            'reg_no':     reg,
            'status':     status,
            'make':       str(row.get('make_model', '')),
            'colour':     str(row.get('colour', '')),
            'theft_date': str(row.get('theft_date', '')),
        })
        if status == 'Stolen':
            p['has_stolen_vehicle'] = True
            G.nodes[owner]['has_stolen_vehicle'] = True


def parse_vehicle_transfers(df: pd.DataFrame, G: nx.Graph, persons: dict):
    """Vehicle ownership transfer chains (often illegal — chop-shop operations)."""
    for _, row in df.iterrows():
        from_name = str(row.get('from_owner', '')).strip()
        to_name   = str(row.get('to_owner',   '')).strip()
        reg       = str(row.get('reg_no', '')).strip()
        note      = str(row.get('note', '')).strip()
        ttype     = str(row.get('transfer_type', '')).strip()
        date      = str(row.get('date', '')).strip()

        if not from_name or not to_name or from_name == 'nan' or to_name == 'nan':
            continue

        _ensure_person(G, persons, from_name, {}, 'vehicle_transfers')
        _ensure_person(G, persons, to_name,   {}, 'vehicle_transfers')

        suspicious = 'illegal' in ttype.lower() or 'chop' in note.lower()
        _add_edge(G, from_name, to_name, 'vehicle transfer',
                  f"Vehicle {reg} on {date}. {note}",
                  suspicious=suspicious,
                  extra={'date': date if date and date != 'nan' else None,
                         'date_range': [date, date] if date and date != 'nan' else None,
                         'dates': [date] if date and date != 'nan' else []})


def parse_generic(df: pd.DataFrame, G: nx.Graph, persons: dict):
    """
    Intelligent fallback for user-uploaded custom datasets in CSV/JSON/Excel/TXT format.
    Automatically detects pairs of connected entities or entity groups and creates relational edges.
    """
    cols = list(df.columns)
    if not cols:
        return

    lower_map = {str(c).lower().strip(): c for c in cols}

    src_candidates = ['source', 'from', 'caller', 'caller_id', 'sender', 'person1', 'person_1', 'person_a', 'user_a', 'entity1', 'origin', 'from_owner', 'from_account_name']
    tgt_candidates = ['target', 'to', 'receiver', 'receiver_id', 'recipient', 'person2', 'person_2', 'person_b', 'user_b', 'entity2', 'destination', 'to_owner', 'to_account_name']

    src_col = None
    tgt_col = None

    for sc in src_candidates:
        if sc in lower_map:
            src_col = lower_map[sc]
            break

    for tc in tgt_candidates:
        if tc in lower_map:
            tgt_col = lower_map[tc]
            break

    # If not explicitly named, check if first two text columns can form edges
    if not (src_col and tgt_col):
        text_cols = [c for c in cols if df[c].dtype == 'object' or str(df[c].dtype).startswith('str')]
        if len(text_cols) >= 2:
            src_col, tgt_col = text_cols[0], text_cols[1]

    if src_col and tgt_col and src_col != tgt_col:
        for _, row in df.iterrows():
            a = str(row.get(src_col, '')).strip()
            b = str(row.get(tgt_col, '')).strip()
            if not a or not b or a in ('nan', 'None', '') or b in ('nan', 'None', ''):
                continue
            _ensure_person(G, persons, a, row.to_dict(), 'custom_upload')
            _ensure_person(G, persons, b, row.to_dict(), 'custom_upload')

            desc = f"Connected link between {a} and {b}"
            _add_edge(G, a, b, 'connected', desc)
    else:
        # Single entity table: add persons and link shared clusters/categories if present
        name_col = cols[0]
        cluster_col = None
        for c in cols[1:]:
            if any(k in str(c).lower() for k in ('cluster', 'group', 'category', 'gang', 'syndicate')):
                cluster_col = c
                break

        cluster_map = {}
        for _, row in df.iterrows():
            name = str(row.get(name_col, '')).strip()
            if not name or name in ('nan', 'None', ''):
                continue
            _ensure_person(G, persons, name, row.to_dict(), 'custom_upload')
            if cluster_col:
                grp = str(row.get(cluster_col, '')).strip()
                if grp and grp not in ('nan', 'None', ''):
                    cluster_map.setdefault(grp, []).append(name)

        if cluster_map:
            for grp, members in cluster_map.items():
                members = list(set(members))
                for i in range(len(members)):
                    for j in range(i + 1, len(members)):
                        _add_edge(G, members[i], members[j], 'same criminal cluster', f"Both in group {grp}")


# ── Graph helpers ──────────────────────────────────────────────────────────────

def _ensure_person(G: nx.Graph, persons: dict, name: str, row_data: dict, source: str):
    if not G.has_node(name):
        G.add_node(name, type='person', has_stolen_vehicle=False)
    p = persons.setdefault(name, {'name': name, 'sources': set()})
    p['sources'].add(source)
    skip = {'name', 'owner_name', 'from_account_name', 'to_account_name'}
    for k, v in row_data.items():
        if k.lower() in skip:
            continue
        if pd.notna(v) and str(v).strip() not in ('', 'nan', 'None', 'NaT'):
            existing = p.get(k)
            if existing is None:
                p[k] = v
            elif isinstance(existing, list):
                if v not in existing:
                    existing.append(v)
            elif existing != v:
                p[k] = [existing, v]


def _add_edge(G: nx.Graph, a: str, b: str, edge_type: str, description: str,
              weight: float = 1.0, suspicious: bool = False, extra: dict = None):
    if a == b:
        return
    if G.has_edge(a, b):
        ed = G[a][b]
        ed['weight']       = ed.get('weight', 0) + weight
        ed['descriptions'] = ed.get('descriptions', [ed.get('description', '')])
        if description not in ed['descriptions']:
            ed['descriptions'].append(description)
        if suspicious:
            ed['suspicious'] = True
        if extra:
            for k, v in extra.items():
                ed[k] = v
    else:
        G.add_edge(a, b,
                   type=edge_type,
                   description=description,
                   descriptions=[description],
                   weight=weight,
                   suspicious=suspicious,
                   **(extra or {}))


# ── Single-file entry point ────────────────────────────────────────────────────

def build_graph_from_csv(csv_text: str, filename: str = '',
                         amount_threshold: float = 0) -> dict:
    df = pd.read_csv(StringIO(csv_text))
    df.columns = df.columns.str.strip()
    schema = detect_schema(df)

    # Vehicle registrations alone → no network to show
    if schema == 'vehicle_registrations':
        return {
            'nodes': [], 'edges': [], 'clusters': [],
            'schema': schema, 'stats': {},
            'message': 'vehicle_registrations_only',
        }

    G = nx.Graph()
    persons: dict = {}

    _dispatch(schema, df, G, persons, amount_threshold)
    return _finalise(G, persons, schema)


# ── Multi-file combined entry point ────────────────────────────────────────────

def build_combined_graph(file_dict: dict, amount_threshold: float = 0,
                         suspected_only: bool = False) -> dict:
    """
    file_dict: {schema_key: csv_text_string}
    All files share the same graph — persons matching by name are auto-merged.
    Cross-file links emerge naturally (same person node gains data from each file).
    """
    G = nx.Graph()
    persons: dict = {}

    ORDER = [
        'call_records',
        'bank_accounts',
        'vehicle_registrations',   # enrichment only
        'bank_transactions',
        'vehicle_ownership_transfers',
    ]

    loaded_schemas = []
    for schema in ORDER:
        csv_text = file_dict.get(schema)
        if not csv_text:
            continue
        df = pd.read_csv(StringIO(csv_text))
        df.columns = df.columns.str.strip()
        _dispatch(schema, df, G, persons, amount_threshold)
        loaded_schemas.append(schema)

    result = _finalise(G, persons, '+'.join(loaded_schemas))

    # Add cross-file flag to persons that appear in multiple sources
    nodeMap = {n['id']: n for n in result['nodes']}
    for n in result['nodes']:
        sources = n.get('sources', [])
        n['multi_source'] = len(sources) > 1

    if suspected_only:
        result = _filter_suspected(result)

    result['loaded_schemas'] = loaded_schemas
    return result


def _dispatch(schema, df, G, persons, amount_threshold):
    if schema == 'call_records':
        parse_call_records(df, G, persons)
    elif schema == 'bank_accounts':
        parse_bank_accounts(df, G, persons)
    elif schema == 'bank_transactions':
        parse_bank_transactions(df, G, persons,
                                 min_txn_count=1,
                                 amount_threshold=amount_threshold)
    elif schema == 'vehicle_registrations':
        parse_vehicle_registrations(df, G, persons)
    elif schema == 'vehicle_ownership_transfers':
        parse_vehicle_transfers(df, G, persons)
    else:
        parse_generic(df, G, persons)


def _filter_suspected(result: dict) -> dict:
    """Keep only nodes that have criminal indicators or stolen vehicles."""
    sus_ids = {
        n['id'] for n in result['nodes']
        if n.get('is_criminal') or n.get('has_stolen_vehicle') or n.get('multi_source')
    }
    # Also include neighbours of criminals (one hop)
    neighbour_ids = set()
    for e in result['edges']:
        if e['source'] in sus_ids:
            neighbour_ids.add(e['target'])
        if e['target'] in sus_ids:
            neighbour_ids.add(e['source'])
    keep = sus_ids | neighbour_ids

    result['nodes'] = [n for n in result['nodes'] if n['id'] in keep]
    result['edges'] = [e for e in result['edges']
                       if e['source'] in keep and e['target'] in keep]
    # Re-compute clusters (re-detect from subgraph)
    return result


# ── Graph finalisation (community + layout + serialise) ───────────────────────

def _finalise(G: nx.Graph, persons: dict, schema: str) -> dict:
    if G.number_of_nodes() == 0:
        return {'nodes': [], 'edges': [], 'clusters': [], 'schema': schema,
                'stats': {'total_persons': 0, 'total_edges': 0, 'total_clusters': 0,
                          'schema_detected': schema}}

    # ── Community detection ────────────────────────────────────────────────────
    partition = None
    if community_louvain is not None:
        try:
            partition = community_louvain.best_partition(G)
        except Exception:
            partition = None

    if partition is None:
        try:
            comms = list(nx.community.greedy_modularity_communities(G))
            partition = {}
            for cid, comm in enumerate(comms):
                for node in comm:
                    partition[node] = cid
        except Exception:
            partition = {n: i for i, n in enumerate(G.nodes())}

    # ── Layout ────────────────────────────────────────────────────────────────
    positions = _compute_cluster_layout(G, partition)

    # ── Serialise nodes ────────────────────────────────────────────────────────
    nodes_out = []
    for node in G.nodes():
        p      = persons.get(node, {})
        srcs   = p.get('sources', set())
        is_crim = str(p.get('is_criminal', p.get('Criminal', 'False'))).strip().lower() in (
            'true', '1', 'yes')
        has_stolen = bool(p.get('has_stolen_vehicle', False) or
                          G.nodes[node].get('has_stolen_vehicle', False))
        nodes_out.append({
            'id':               node,
            'label':            node,
            'cluster':          partition.get(node, 0),
            'x':                positions[node][0],
            'y':                positions[node][1],
            'is_criminal':      is_crim,
            'has_stolen_vehicle': has_stolen,
            'degree':           G.degree(node),
            'sources':          list(srcs) if isinstance(srcs, set) else srcs,
            'details':          _safe_dict(p),
        })

    # ── Serialise edges ────────────────────────────────────────────────────────
    edges_out = []
    for u, v, data in G.edges(data=True):
        edges_out.append({
            'source':           u,
            'target':           v,
            'type':             data.get('type', 'connected'),
            'description':      data.get('descriptions', [data.get('description', '')])[0],
            'all_descriptions': data.get('descriptions', [data.get('description', '')]),
            'weight':           data.get('weight', 1),
            'suspicious':       data.get('suspicious', False),
            'txn_count':        data.get('txn_count', None),
            'total_amount':     data.get('total_amount', None),
            'date_range':       data.get('date_range', None),
            'dates':            data.get('dates', []),
            'date':             data.get('date', None),
        })

    # ── Edge reduction — keep only meaningful edges to reduce visual clutter ───
    person_node_map = {n['id']: n for n in nodes_out}

    def _edge_priority(e):
        """Higher is more important — keep edge if score >= threshold."""
        score = 0
        if e.get('suspicious'):
            score += 100          # always keep flagged edges
        amt = e.get('total_amount') or 0
        if amt >= 100000:
            score += 60
        elif amt >= 10000:
            score += 30
        cnt = e.get('txn_count') or 0
        if cnt >= 5:
            score += 20
        elif cnt >= 2:
            score += 10
        n_src = person_node_map.get(e['source'], {})
        n_tgt = person_node_map.get(e['target'], {})
        if n_src.get('is_criminal') or n_tgt.get('is_criminal'):
            score += 40           # always keep criminal-linked edges
        if n_src.get('multi_source') or n_tgt.get('multi_source'):
            score += 20
        if e.get('type') in ('phone call', 'financial transaction', 'vehicle transfer'):
            score += 10
        return score

    EDGE_THRESHOLD = 30  # edges below this score are pruned

    # Always keep edges for nodes with degree ≤ 2 (otherwise they'd be isolated)
    low_degree_nodes = {n['id'] for n in nodes_out if (n.get('degree') or 0) <= 2}

    edges_out = [
        e for e in edges_out
        if _edge_priority(e) >= EDGE_THRESHOLD
           or e['source'] in low_degree_nodes
           or e['target'] in low_degree_nodes
    ]

    # ── Cluster summaries ──────────────────────────────────────────────────────
    cluster_groups: dict = {}
    for node, cid in partition.items():
        cluster_groups.setdefault(cid, []).append(node)

    clusters_out = [
        {
            'id':      cid,
            'members': members,
            'size':    len(members),
            'center':  _cluster_center(members, positions),
        }
        for cid, members in sorted(cluster_groups.items())
    ]

    return {
        'nodes':    nodes_out,
        'edges':    edges_out,
        'clusters': clusters_out,
        'schema':   schema,
        'stats': {
            'total_persons':   G.number_of_nodes(),
            'total_edges':     G.number_of_edges(),
            'total_clusters':  len(cluster_groups),
            'schema_detected': schema,
        },
    }


# ── Layout ─────────────────────────────────────────────────────────────────────

def _compute_cluster_layout(G: nx.Graph, partition: dict) -> dict:
    """
    Place cluster centers on a large outer circle.
    Within each cluster, arrange nodes in a circle with spacing that
    GUARANTEES no node overlaps (based on actual node count).
    Uses 3000×3000 canvas units — D3 zoom handles navigation.
    """
    cluster_groups: dict = {}
    for node, cid in partition.items():
        cluster_groups.setdefault(cid, []).append(node)

    num_clusters = len(cluster_groups)
    CANVAS  = 3000
    cx, cy  = CANVAS / 2, CANVAS / 2

    # Outer ring radius — scales with cluster count so clusters never touch
    OUTER_R = max(400, min(CANVAS * 0.38, 120 * num_clusters))

    positions = {}

    for idx, (cid, members) in enumerate(sorted(cluster_groups.items())):
        n = len(members)

        # Cluster center on outer circle
        if num_clusters == 1:
            ccx, ccy = cx, cy
        else:
            angle = (2 * math.pi * idx) / num_clusters - math.pi / 2
            ccx   = cx + OUTER_R * math.cos(angle)
            ccy   = cy + OUTER_R * math.sin(angle)

        if n == 1:
            positions[members[0]] = (ccx, ccy)
            continue

        # Inner radius: each node needs arc-spacing of at least 60px
        # arc_per_node = 2π * r / n ≥ 60  →  r ≥ 60n / (2π) ≈ 9.55 * n
        MIN_SPACING = 70   # px between node centres
        inner_r = max(90, int(MIN_SPACING * n / (2 * math.pi)) + 40)

        # Cap so clusters don't physically overlap each other
        # Distance between adjacent cluster centres ≈ 2*OUTER_R*sin(π/num_clusters)
        if num_clusters > 1:
            inter_dist = 2 * OUTER_R * math.sin(math.pi / num_clusters)
            max_inner  = int(inter_dist / 2.2)
            inner_r    = min(inner_r, max_inner)

        for i, member in enumerate(members):
            a = (2 * math.pi * i) / n - math.pi / 2
            positions[member] = (
                ccx + inner_r * math.cos(a),
                ccy + inner_r * math.sin(a),
            )

    return positions


def _cluster_center(members: list, positions: dict) -> dict:
    if not members:
        return {'x': 1500, 'y': 1500}
    xs = [positions[m][0] for m in members if m in positions]
    ys = [positions[m][1] for m in members if m in positions]
    return {'x': sum(xs) / len(xs), 'y': sum(ys) / len(ys)}


def _safe_dict(p: dict) -> dict:
    out = {}
    for k, v in p.items():
        if k == 'sources':
            out[k] = list(v) if isinstance(v, set) else v
        elif isinstance(v, (str, int, float, bool, list, dict, type(None))):
            out[k] = v
        else:
            out[k] = str(v)
    return out


# ── Path & Intermediary Link Tracer ───────────────────────────────────────────

def find_path_conduit(nodes: list, edges: list, source: str, target: str) -> dict:
    """
    Find shortest forensic conduit path(s) between source and target entities.
    Returns structured step-by-step hops, intermediary nodes, transaction totals,
    and channel classifications.
    """
    if not source or not target:
        return {'found': False, 'error': 'Source and Target are required.'}

    if source == target:
        return {
            'found': True,
            'source': source,
            'target': target,
            'hops': 0,
            'shortest_path': [source],
            'all_paths': [[source]],
            'intermediaries': [],
            'steps': [],
            'total_amount': 0,
            'channel_types': [],
            'has_criminal': False,
            'has_suspicious': False,
        }

    G = nx.Graph()
    node_map = {n['id']: n for n in nodes}
    for n in nodes:
        G.add_node(n['id'], **n)

    edge_lookup = {}
    for e in edges:
        src = e['source']
        tgt = e['target']
        G.add_edge(src, tgt, **e)
        key = tuple(sorted([src, tgt]))
        edge_lookup.setdefault(key, []).append(e)

    if source not in G or target not in G:
        return {
            'found': False,
            'error': f"Entity not found in active canvas: '{source if source not in G else target}'."
        }

    if not nx.has_path(G, source, target):
        return {
            'found': False,
            'source': source,
            'target': target,
            'message': f"No connected pathway exists between '{source}' and '{target}' in the current network scope."
        }

    try:
        raw_paths = list(nx.all_shortest_paths(G, source=source, target=target))
    except Exception:
        try:
            raw_paths = [nx.shortest_path(G, source=source, target=target)]
        except Exception as e:
            return {'found': False, 'error': str(e)}

    primary_path = raw_paths[0]
    intermediaries = primary_path[1:-1]
    hops = len(primary_path) - 1

    steps = []
    total_amount = 0
    channel_types = set()
    has_suspicious = False
    has_criminal = any(node_map.get(m, {}).get('is_criminal', False) for m in intermediaries)

    for i in range(len(primary_path) - 1):
        u = primary_path[i]
        v = primary_path[i + 1]
        pair_key = tuple(sorted([u, v]))
        conn_edges = edge_lookup.get(pair_key, [])
        primary_edge = conn_edges[0] if conn_edges else {}

        edge_type = primary_edge.get('type', 'connected')
        channel_types.add(edge_type)
        desc = primary_edge.get('description', '')
        amt = primary_edge.get('total_amount') or 0
        total_amount += amt
        if primary_edge.get('suspicious', False):
            has_suspicious = True

        u_node = node_map.get(u, {})
        v_node = node_map.get(v, {})

        steps.append({
            'step_num': i + 1,
            'from': u,
            'to': v,
            'from_criminal': bool(u_node.get('is_criminal', False)),
            'to_criminal': bool(v_node.get('is_criminal', False)),
            'edge_type': edge_type,
            'description': desc,
            'total_amount': amt,
            'txn_count': primary_edge.get('txn_count'),
            'suspicious': bool(primary_edge.get('suspicious', False)),
        })

    return {
        'found': True,
        'source': source,
        'target': target,
        'hops': hops,
        'shortest_path': primary_path,
        'all_paths': raw_paths[:5],
        'intermediaries': intermediaries,
        'intermediary_details': [node_map.get(m, {'id': m}) for m in intermediaries],
        'steps': steps,
        'total_amount': total_amount,
        'channel_types': list(channel_types),
        'has_criminal': has_criminal,
        'has_suspicious': has_suspicious,
    }


# ── FEATURE 3: Key Player & Network Vulnerability Analytics ────────────────────

def analyze_network_vulnerability(nodes: list, edges: list) -> dict:
    """
    Perform graph-theoretic centrality and structural vulnerability analysis.
    Identifies articulation points (cut-vertices), key brokers (betweenness),
    influence hubs (PageRank), and network disruption impact.
    """
    if not nodes:
        return {'kpis': {}, 'rankings': [], 'articulation_points': []}

    G = nx.Graph()
    node_map = {n['id']: n for n in nodes}
    for n in nodes:
        G.add_node(n['id'], **n)

    for e in edges:
        G.add_edge(e['source'], e['target'], **e)

    # 1. Centrality Computations
    try:
        betweenness = nx.betweenness_centrality(G)
    except Exception:
        betweenness = {n: 0.0 for n in G.nodes()}

    try:
        degree_cent = nx.degree_centrality(G)
    except Exception:
        degree_cent = {n: G.degree(n) / max(1, G.number_of_nodes() - 1) for n in G.nodes()}

    try:
        closeness = nx.closeness_centrality(G)
    except Exception:
        closeness = {n: 0.0 for n in G.nodes()}

    try:
        pagerank = nx.pagerank(G, max_iter=200)
    except Exception:
        pagerank = {n: 1.0 / max(1, G.number_of_nodes()) for n in G.nodes()}

    # 2. Articulation Points (Cut-Vertices) & Bridges
    articulation_pts = set()
    bridges = []
    # For disconnected graphs, iterate over connected components
    for comp in nx.connected_components(G):
        subG = G.subgraph(comp)
        if len(comp) > 2:
            try:
                for ap in nx.articulation_points(subG):
                    articulation_pts.add(ap)
            except Exception:
                pass
            try:
                for b in nx.bridges(subG):
                    bridges.append(list(b))
            except Exception:
                pass

    # 3. Scale and normalize scores (0-100)
    max_bet = max(betweenness.values()) if betweenness and max(betweenness.values()) > 0 else 1.0
    max_deg = max(degree_cent.values()) if degree_cent and max(degree_cent.values()) > 0 else 1.0
    max_pr  = max(pagerank.values()) if pagerank and max(pagerank.values()) > 0 else 1.0

    rankings = []
    for nid, node_data in node_map.items():
        raw_bet = betweenness.get(nid, 0.0)
        raw_deg = degree_cent.get(nid, 0.0)
        raw_clo = closeness.get(nid, 0.0)
        raw_pr  = pagerank.get(nid, 0.0)

        score_bet = round((raw_bet / max_bet) * 100, 1)
        score_deg = round((raw_deg / max_deg) * 100, 1)
        score_pr  = round((raw_pr  / max_pr)  * 100, 1)

        is_ap = nid in articulation_pts
        is_crim = bool(node_data.get('is_criminal', False))
        stolen = bool(node_data.get('has_stolen_vehicle', False))

        # Composite Strategic Impact Score
        composite = (score_bet * 0.45) + (score_pr * 0.35) + (score_deg * 0.20)
        if is_ap:
            composite += 25  # High bonus for bridge cut-vertices
        if is_crim:
            composite += 15
        if stolen:
            composite += 10
        composite = min(100.0, round(composite, 1))

        # Role Classification
        if is_ap:
            role = 'CRITICAL_BRIDGE'
            role_label = 'Critical Bridge (Cut-Vertex)'
        elif score_bet >= 60:
            role = 'KEY_BROKER'
            role_label = 'Key Broker / Cutout'
        elif score_pr >= 60:
            role = 'INFLUENCE_HUB'
            role_label = 'Syndicate Hub'
        elif is_crim:
            role = 'OPERATIVE'
            role_label = 'Criminal Operative'
        else:
            role = 'ASSOCIATE'
            role_label = 'Network Associate'

        # Disruption simulation: if node is removed, how many components are created?
        G_temp = G.copy()
        G_temp.remove_node(nid)
        frag_components = nx.number_connected_components(G_temp) if G_temp.number_of_nodes() > 0 else 0
        severed_links = G.degree(nid)

        rankings.append({
            'id': nid,
            'label': node_data.get('label', nid),
            'is_criminal': is_crim,
            'has_stolen_vehicle': stolen,
            'cluster': node_data.get('cluster', None),
            'degree': G.degree(nid),
            'betweenness_score': score_bet,
            'pagerank_score': score_pr,
            'degree_centrality_score': score_deg,
            'closeness_score': round(raw_clo * 100, 1),
            'composite_threat': composite,
            'is_articulation_point': is_ap,
            'role': role,
            'role_label': role_label,
            'disruption_components': frag_components,
            'severed_links': severed_links,
            'sources': node_data.get('sources', []),
        })

    rankings.sort(key=lambda x: x['composite_threat'], reverse=True)

    top_broker = next((r for r in sorted(rankings, key=lambda x: x['betweenness_score'], reverse=True)), None)
    top_hub = next((r for r in sorted(rankings, key=lambda x: x['pagerank_score'], reverse=True)), None)

    # Vulnerability Rating: proportion of nodes that act as cut-vertices or major brokers
    vuln_score = min(100, round((len(articulation_pts) / max(1, len(nodes))) * 250 + (len(bridges) * 3), 1))

    return {
        'kpis': {
            'total_entities': len(nodes),
            'total_connections': len(edges),
            'articulation_points_count': len(articulation_pts),
            'bridges_count': len(bridges),
            'network_vulnerability_pct': vuln_score,
            'top_broker_name': top_broker['id'] if top_broker else 'N/A',
            'top_broker_score': top_broker['betweenness_score'] if top_broker else 0,
            'top_hub_name': top_hub['id'] if top_hub else 'N/A',
            'top_hub_score': top_hub['pagerank_score'] if top_hub else 0,
        },
        'articulation_points': list(articulation_pts),
        'bridges': bridges,
        'rankings': rankings,
    }


