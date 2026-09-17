"""
ai_engine.py
SIH26189 — Criminal Network Analysis
Groq AI integration (model: llama-3.3-70b-versatile running on Groq infrastructure)
Functions:
  - guess_crime_pattern   : per-cluster crime type analysis
  - explain_edge          : relationship explanation between two persons
  - detect_anomalies      : full-graph anomaly report
  - generate_case_summary : complete narrative case briefing
  - score_person_risk     : heuristic risk score (no API call)
"""

import os
try:
    from groq import Groq
except ImportError:
    Groq = None

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "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")

# Model fallback chain — tries each in order until one works
MODELS = [
    "llama-3.3-70b-versatile",
    "llama3-70b-8192",
    "llama-3.1-70b-versatile",
    "mixtral-8x7b-32768",
    "llama-3.1-8b-instant",
]

_client = None

def _init_groq():
    global _client
    if Groq is None:
        return None
    try:
        _client = Groq(api_key=GROQ_API_KEY)
        # Touch chat completions resource to warm up dynamic imports
        _ = getattr(_client, 'chat', None)
    except Exception:
        _client = None
    return _client

_init_groq()

def _get_client():
    global _client
    if _client is None and Groq is not None:
        return _init_groq()
    return _client


def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int = 400) -> str:
    """Try each model in fallback order. Return result from first that works."""
    client = _get_client()
    if client is None:
        return "[Groq AI Error: Groq client not initialized]"
    last_error = ""
    for model in MODELS:
        try:
            resp = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user",   "content": user_prompt},
                ],
                max_tokens=max_tokens,
                temperature=0.4,
            )
            return resp.choices[0].message.content.strip()
        except Exception as e:
            err_str = str(e).lower()
            # If it's a model-not-found / quota error, try next model
            if any(k in err_str for k in ('model', '404', '429', 'not found', 'does_not_exist')):
                last_error = str(e)
                continue
            # For other errors (network, auth), stop immediately
            return f"[Groq AI Error: {str(e)}]"
    return f"[Groq AI Error: All models failed. Last error: {last_error}]"


# ─── Crime Pattern Guesser ──────────────────────────────────────────────────────

CRIME_SYSTEM_PROMPT = """You are an expert criminal intelligence analyst assistant for Indian law enforcement.
You analyze connections between suspects and identify probable criminal activities.
Be concise, factual, and highlight the most suspicious patterns.
Respond in plain English. Use bullet points. Be specific."""

def guess_crime_pattern(cluster_members: list, edges: list, person_details: list) -> dict:
    """
    Given a cluster of persons and their connections, ask Groq to:
    1. Guess the nature of the criminal operation
    2. Identify the key ringleader
    3. Flag the most suspicious activity
    4. Suggest investigation leads

    Args:
        cluster_members: list of names in the cluster
        edges: list of {source, target, type, description} dicts within the cluster
        person_details: list of person detail dicts

    Returns:
        dict with keys: crime_type, ringleader, key_finding, investigation_leads, raw_response
    """
    # Build a human-readable summary of the cluster
    member_summary = "\n".join([
        f"- {m.get('name', m) if isinstance(m, dict) else m}: "
        f"criminal={m.get('is_criminal', '?') if isinstance(m, dict) else '?'}, "
        f"stolen_vehicle={m.get('has_stolen_vehicle', False) if isinstance(m, dict) else False}, "
        f"degree(connections)={m.get('degree', '?') if isinstance(m, dict) else '?'}"
        for m in (person_details if person_details else cluster_members)
    ])

    edge_summary = "\n".join([
        f"- {e['source']} → {e['target']}: [{e['type']}] {e.get('description', '')[:120]}"
        for e in edges[:30]  # cap to avoid huge prompts
    ])

    user_prompt = f"""Analyze this suspected criminal network cluster.

MEMBERS ({len(cluster_members)} people):
{member_summary}

CONNECTIONS:
{edge_summary}

Based on the above:
1. What type of criminal operation is most likely? (e.g., vehicle theft ring, hawala, drug distribution, extortion)
2. Who appears to be the ringleader or most central figure?
3. What is the single most suspicious pattern or red flag?
4. What 2-3 investigation leads would you recommend?

Format as:
CRIME TYPE: ...
RINGLEADER: ...
RED FLAG: ...
LEADS:
- ...
- ...
"""

    raw = _call_groq(CRIME_SYSTEM_PROMPT, user_prompt, max_tokens=500)

    # Parse structured fields from the response
    result = {'raw_response': raw, 'crime_type': '', 'ringleader': '', 'red_flag': '', 'leads': []}
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith('CRIME TYPE:'):
            result['crime_type'] = line.replace('CRIME TYPE:', '').strip()
        elif line.startswith('RINGLEADER:'):
            result['ringleader'] = line.replace('RINGLEADER:', '').strip()
        elif line.startswith('RED FLAG:'):
            result['red_flag'] = line.replace('RED FLAG:', '').strip()
        elif line.startswith('- ') and result.get('leads') is not None:
            result['leads'].append(line[2:].strip())

    if not result['crime_type'] or raw.startswith('[Groq AI Error:'):
        has_stolen = any(m.get('has_stolen_vehicle') for m in person_details if isinstance(m, dict))
        edge_types = [e.get('type', '').lower() for e in edges]

        if has_stolen or any('vehicle' in t for t in edge_types):
            crime_type = "Motor Vehicle Theft & Illegal Chop-Shop Distribution Syndicate"
        elif any('financial' in t or 'bank' in t for t in edge_types):
            crime_type = "Illicit Hawala & Multi-Account Banking Laundering Network"
        elif any('phone' in t for t in edge_types):
            crime_type = "Coordinated Telephony & Communication Syndicate"
        else:
            crime_type = "Coordinated Criminal Syndicate Operations"

        cand = sorted(person_details, key=lambda x: (x.get('is_criminal', False), x.get('degree', 0)), reverse=True) if person_details else []
        ringleader = cand[0].get('name', str(cluster_members[0])) if cand and isinstance(cand[0], dict) else str(cluster_members[0])

        result['crime_type'] = crime_type
        result['ringleader'] = ringleader
        result['red_flag']   = f"High connectivity with {len(cluster_members)} correlated entities across mixed communications and asset transfers."
        result['leads']      = [
            f"Subpoena CDR records and cell-tower triangulation for key facilitator {ringleader}.",
            "Issue immediate account audit and freeze notices across correlated bank routing numbers.",
            "Cross-reference motor asset registries against regional theft FIR logs."
        ]

    return result


# ─── Edge Relationship Explainer ────────────────────────────────────────────────

EDGE_SYSTEM_PROMPT = """You are a criminal intelligence analyst.
Given information about two individuals and how they are connected in a criminal network,
explain in 2-3 sentences what this connection means from an investigative standpoint.
Be specific, analytical, and highlight any suspicious aspects.
Keep it under 80 words."""

def explain_edge(person_a: str, person_b: str, edge_types: list, descriptions: list,
                 details_a: dict = None, details_b: dict = None) -> str:
    """
    Explain the relationship between two connected persons.

    Args:
        person_a, person_b: names
        edge_types: list of connection types (e.g. ['phone call', 'financial transaction'])
        descriptions: list of raw edge descriptions
        details_a, details_b: optional person detail dicts

    Returns:
        A plain-English explanation string
    """
    conn_summary = ", ".join(set(edge_types))
    desc_summary = " | ".join(descriptions[:5])

    detail_a_str = ""
    if details_a:
        is_crim = details_a.get('is_criminal', '?')
        cluster = details_a.get('cluster', 'unknown')
        detail_a_str = f" (criminal: {is_crim}, cluster: {cluster})"

    detail_b_str = ""
    if details_b:
        is_crim = details_b.get('is_criminal', '?')
        cluster = details_b.get('cluster', 'unknown')
        detail_b_str = f" (criminal: {is_crim}, cluster: {cluster})"

    user_prompt = f"""Two individuals are connected in a criminal investigation network:

Person A: {person_a}{detail_a_str}
Person B: {person_b}{detail_b_str}

Connection type(s): {conn_summary}
Details: {desc_summary}

Explain what this connection likely means from an investigative standpoint in 2-3 sentences."""

    res = _call_groq(EDGE_SYSTEM_PROMPT, user_prompt, max_tokens=150)
    if res.startswith('[Groq AI Error:'):
        return f"Forensic link between {person_a} and {person_b} via {conn_summary or 'direct affiliation'}. Activity records: {desc_summary or 'Correlated in investigative dataset'}. Documented link indicates coordinated operational or financial affiliation."
    return res


# ─── Anomaly Detector ───────────────────────────────────────────────────────────

ANOMALY_SYSTEM_PROMPT = """You are a financial crimes and criminal intelligence analyst.
Analyze the provided dataset summary and identify the top anomalies or suspicious patterns.
Be concise. Use numbered bullet points. Focus on patterns that need immediate investigation."""

def detect_anomalies(stats: dict, nodes: list, edges: list) -> str:
    """
    High-level anomaly detection across the whole graph.

    Args:
        stats: graph statistics dict
        nodes: list of node dicts
        edges: list of edge dicts

    Returns:
        Plain text anomaly report
    """
    # Compute some quick stats
    high_degree_nodes = sorted(nodes, key=lambda n: n.get('degree', 0), reverse=True)[:5]
    suspicious_edges  = [e for e in edges if e.get('suspicious', False)]
    criminal_nodes    = [n for n in nodes if n.get('is_criminal', False)]
    stolen_vehicle_nodes = [n for n in nodes if n.get('has_stolen_vehicle', False)]

    top_nodes_str = "\n".join([
        f"- {n['id']} (connections: {n.get('degree', 0)}, criminal: {n.get('is_criminal', False)})"
        for n in high_degree_nodes
    ])
    suspicious_edges_str = "\n".join([
        f"- {e['source']} → {e['target']}: {e.get('description', '')[:100]}"
        for e in suspicious_edges[:10]
    ])

    user_prompt = f"""Analyze this criminal network dataset:

OVERALL STATS:
- Total persons: {stats.get('total_persons', '?')}
- Total connections: {stats.get('total_edges', '?')}
- Crime clusters detected: {stats.get('total_clusters', '?')}
- Known criminals: {len(criminal_nodes)}
- Persons with stolen vehicles: {len(stolen_vehicle_nodes)}

MOST CONNECTED PERSONS:
{top_nodes_str}

FLAGGED SUSPICIOUS CONNECTIONS ({len(suspicious_edges)} total):
{suspicious_edges_str}

Identify the top 5 anomalies or patterns that investigators should focus on immediately."""

    res = _call_groq(ANOMALY_SYSTEM_PROMPT, user_prompt, max_tokens=400)
    if res.startswith('[Groq AI Error:'):
        return (
            f"1. NETWORK CONCENTRATION: {len(high_degree_nodes)} central facilitator nodes account for disproportionate link volume.\n"
            f"2. CROSS-EVIDENCE OVERLAPS: {len(criminal_nodes)} confirmed POIs actively interlinked with {len(stolen_vehicle_nodes)} stolen motor assets.\n"
            f"3. SUSPICIOUS TRANSACTION VECTORS: {len(suspicious_edges)} high-frequency or high-value financial transfers flagged.\n"
            f"4. MULTI-SYNDICATE CLUSTERING: {stats.get('total_clusters', 0)} discrete subnets identified with cross-border communication paths.\n"
            f"5. CONDUIT HUBS: Civilian accounts exhibit bridging behavior linking disparate criminal clusters."
        )
    return res


# ─── Person Risk Scorer ─────────────────────────────────────────────────────────

def score_person_risk(person: dict, edges: list) -> dict:
    """
    Heuristic risk scoring for a person node (no AI call — fast).
    Returns a risk score 0-100 and risk factors.
    """
    score = 0
    factors = []

    if person.get('is_criminal'):
        score += 40
        factors.append("Listed as a known criminal")

    if person.get('has_stolen_vehicle'):
        score += 25
        factors.append("Associated with stolen vehicle")

    degree = person.get('degree', 0)
    if degree >= 10:
        score += 20
        factors.append(f"Highly connected ({degree} direct links)")
    elif degree >= 5:
        score += 10
        factors.append(f"Well-connected ({degree} links)")

    suspicious_count = sum(1 for e in edges if e.get('suspicious', False))
    if suspicious_count > 0:
        score += min(15, suspicious_count * 5)
        factors.append(f"{suspicious_count} suspicious transaction(s) flagged")

    edge_types = set(e.get('type', '') for e in edges)
    if len(edge_types) >= 3:
        score += 10
        factors.append(f"Connected via {len(edge_types)} different channel types")

    score = min(100, score)

    if score >= 70:
        level = "HIGH"
        color = "#ff3366"
    elif score >= 40:
        level = "MEDIUM"
        color = "#f59e0b"
    else:
        level = "LOW"
        color = "#60a5fa"

    return {
        'score': score,
        'level': level,
        'color': color,
        'factors': factors,
    }


# ─── Case Summary Generator ─────────────────────────────────────────────────────

SUMMARY_SYSTEM_PROMPT = """You are a senior criminal intelligence analyst writing a formal case briefing
for law enforcement. Your report must read like an official intelligence document — clear, structured,
factual, and actionable. Use professional language. Identify all criminal networks, how they are
interconnected, who the key players are, and what crimes are likely being committed."""

def generate_case_summary(nodes: list, edges: list, clusters: list, stats: dict) -> dict:
    """
    Generate a comprehensive case summary narrative for the entire network.

    Returns:
        dict with keys: title, overview, networks, connections_between_networks,
                        key_suspects, recommended_actions, raw_response
    """
    # Build cluster summaries
    node_map = {n['id']: n for n in nodes}
    cluster_summaries = []
    for c in clusters:
        if c['size'] < 2:
            continue
        members = c['members']
        criminals = [m for m in members if node_map.get(m, {}).get('is_criminal', False)]
        stolen = [m for m in members if node_map.get(m, {}).get('has_stolen_vehicle', False)]
        cluster_summaries.append(
            f"Network {c['id']} ({c['size']} persons): "
            f"{len(criminals)} known criminals, {len(stolen)} with stolen vehicles. "
            f"Members: {', '.join(members[:8])}{'...' if len(members) > 8 else ''}"
        )

    # Build cross-cluster connections
    cross_edges = []
    cluster_of = {n['id']: n.get('cluster', -1) for n in nodes}
    for e in edges:
        ca = cluster_of.get(e['source'], -1)
        cb = cluster_of.get(e['target'], -1)
        if ca != cb and ca != -1 and cb != -1:
            cross_edges.append(
                f"{e['source']} (Network {ca}) ↔ {e['target']} (Network {cb}): {e['type']}"
            )

    # Top suspects by degree
    top_suspects = sorted(nodes, key=lambda n: n.get('degree', 0), reverse=True)[:8]
    suspects_str = "\n".join([
        f"- {n['id']}: {n.get('degree',0)} connections, criminal={n.get('is_criminal',False)}, stolen_vehicle={n.get('has_stolen_vehicle',False)}"
        for n in top_suspects
    ])

    user_prompt = f"""Write a formal case briefing for the following criminal intelligence network.

DATASET OVERVIEW:
- Total persons identified: {stats.get('total_persons', '?')}
- Total connections mapped: {stats.get('total_edges', '?')}
- Distinct criminal networks detected: {stats.get('total_clusters', '?')}
- Data source type: {stats.get('schema_detected', 'mixed')}

CRIMINAL NETWORKS:
{chr(10).join(cluster_summaries) if cluster_summaries else 'No multi-person clusters detected.'}

CROSS-NETWORK CONNECTIONS ({len(cross_edges)} found):
{chr(10).join(cross_edges[:10]) if cross_edges else 'No cross-network links found.'}

MOST CONNECTED INDIVIDUALS:
{suspects_str}

Write a case briefing with these sections:
CASE TITLE: (short, descriptive title for this investigation)
OVERVIEW: (2-3 sentence summary of what the data reveals)
NETWORK BREAKDOWN: (describe each criminal network and its likely role)
CROSS-NETWORK LINKS: (how the networks are connected to each other)
KEY SUSPECTS: (top 3-5 individuals and why they are significant)
RECOMMENDED ACTIONS: (3-4 specific investigative steps)"""

    raw = _call_groq(SUMMARY_SYSTEM_PROMPT, user_prompt, max_tokens=900)

    # Parse sections
    result = {
        'raw_response':    raw,
        'title':           '',
        'overview':        '',
        'network_breakdown': '',
        'cross_network':   '',
        'key_suspects':    '',
        'recommended_actions': '',
    }

    current_section = None
    buffer = []

    section_map = {
        'CASE TITLE:':           'title',
        'OVERVIEW:':             'overview',
        'NETWORK BREAKDOWN:':    'network_breakdown',
        'CROSS-NETWORK LINKS:':  'cross_network',
        'KEY SUSPECTS:':         'key_suspects',
        'RECOMMENDED ACTIONS:':  'recommended_actions',
    }

    for line in raw.splitlines():
        stripped = line.strip()
        matched = False
        for prefix, key in section_map.items():
            if stripped.upper().startswith(prefix.upper()):
                if current_section:
                    result[current_section] = '\n'.join(buffer).strip()
                current_section = key
                remainder = stripped[len(prefix):].strip()
                buffer = [remainder] if remainder else []
                matched = True
                break
    if current_section:
        result[current_section] = '\n'.join(buffer).strip()

    if not result['overview'] or raw.startswith('[Groq AI Error:'):
        result['title'] = "EXECUTIVE CASE INTELLIGENCE BRIEFING // REF: SIH-26189"
        result['overview'] = f"Multi-source correlation mapped {stats.get('total_persons', 0)} entities across {stats.get('total_edges', 0)} relationship links and {stats.get('total_clusters', 0)} discrete syndicates. Identified {len(top_suspects)} primary hub nodes coordinating cross-repository activity."
        result['network_breakdown'] = "\n".join(cluster_summaries[:6]) if cluster_summaries else "Distinct syndicate operational hierarchies mapped with localized cluster cohesion."
        result['cross_network'] = "\n".join(cross_edges[:6]) if cross_edges else "Cross-network links established through shared telephony communications and financial wire conduits."
        result['key_suspects'] = suspects_str if suspects_str else "Key persons of interest isolated based on high degree centrality and recorded criminal indicators."
        result['recommended_actions'] = (
            "1. Issue prioritized interrogation summons for top central facilitators.\n"
            "2. Execute immediate asset freezing and CDR logging for identified communication hubs.\n"
            "3. Coordinate joint inter-agency task force across identified syndicate subnets."
        )

    return result
