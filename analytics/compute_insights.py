#!/usr/bin/env python3
"""
v1.1 Analytics Service - Compute insights from investigation history
Reads investigation_history.csv and generates insights.json

Usage:
  python3 analytics/compute_insights.py
"""

import csv
import json
from pathlib import Path
from collections import defaultdict
from typing import List, Dict, Tuple

DATA_DIR = Path('data')
CSV_FILE = DATA_DIR / 'investigation_history.csv'
INSIGHTS_FILE = DATA_DIR / 'insights.json'


def load_investigations() -> List[Dict]:
    """Load investigations from CSV."""
    if not CSV_FILE.exists():
        return []

    investigations = []
    try:
        with open(CSV_FILE, 'r') as f:
            reader = csv.DictReader(f)
            for row in reader:
                if row and any(row.values()):  # Skip empty rows
                    # Normalize None values (DictReader fills missing columns with None)
                    normalized = {k: (v if v is not None else '') for k, v in row.items()}
                    investigations.append(normalized)
    except Exception as e:
        print(f"Error reading CSV: {e}")
        return []

    return investigations


def compute_tool_effectiveness(investigations: List[Dict]) -> Dict[str, float]:
    """
    Compute effectiveness of each tool.
    Returns: { tool_name: accuracy_percentage }
    """
    tool_stats = defaultdict(lambda: {'tp': 0, 'total': 0})

    for inv in investigations:
        if not inv.get('accuracy_flag') or inv['accuracy_flag'] == 'pending':
            continue

        is_correct = inv['accuracy_flag'] == 'correct'
        tools = inv.get('tools_used', '').split('|') if inv.get('tools_used') else []

        for tool in tools:
            tool = tool.strip()
            if tool:
                tool_stats[tool]['total'] += 1
                if is_correct:
                    tool_stats[tool]['tp'] += 1

    # Calculate accuracy
    effectiveness = {}
    for tool, stats in sorted(tool_stats.items()):
        if stats['total'] > 0:
            effectiveness[tool] = round(stats['tp'] / stats['total'], 2)

    return effectiveness


def compute_mode_performance(investigations: List[Dict]) -> Dict[str, Dict]:
    """
    Compute performance metrics per mode.
    Returns: { mode: { accuracy, avg_time, total_runs } }
    """
    mode_stats = defaultdict(lambda: {'correct': 0, 'verified': 0, 'total_runs': 0, 'times': []})

    for inv in investigations:
        mode = inv.get('mode', 'unknown').lower()
        if not mode or mode == 'unknown':
            continue

        mode_stats[mode]['total_runs'] += 1

        if inv.get('investigation_time_sec'):
            try:
                mode_stats[mode]['times'].append(float(inv['investigation_time_sec']))
            except ValueError:
                pass

        if inv.get('accuracy_flag') and inv['accuracy_flag'] in ('correct', 'incorrect'):
            mode_stats[mode]['verified'] += 1
            if inv['accuracy_flag'] == 'correct':
                mode_stats[mode]['correct'] += 1

    # Format results
    performance = {}
    for mode in ['standard', 'adaptive', 'parallel', 'chain']:
        stats = mode_stats.get(mode, {})
        total_runs = stats.get('total_runs', 0)
        verified = stats.get('verified', 0)
        correct = stats.get('correct', 0)
        times = stats.get('times', [])

        accuracy = round(correct / verified, 2) if verified > 0 else None
        avg_time = round(sum(times) / len(times), 1) if times else None

        performance[mode] = {
            'accuracy': accuracy,
            'avg_time_sec': avg_time,
            'total_runs': total_runs,
            'verified_runs': verified
        }

    return performance


def compute_verdict_accuracy(investigations: List[Dict]) -> Tuple[float, int]:
    """
    Compute overall accuracy (how often AI was correct).
    Returns: (accuracy_percentage, total_verified_investigations)
    """
    verified = [inv for inv in investigations if inv.get('accuracy_flag') and inv['accuracy_flag'] != 'pending']
    if not verified:
        return None, 0

    correct = sum(1 for inv in verified if inv['accuracy_flag'] == 'correct')
    accuracy = round(correct / len(verified), 2)

    return accuracy, len(verified)


def compute_accuracy_trend(investigations: List[Dict]) -> List[Dict]:
    """
    Compute cumulative AI accuracy over chronological investigation order.
    Only includes investigations that have analyst feedback (correct/incorrect).
    Returns a list of {index, date, cumulative_accuracy, verified, correct}.
    """
    verified_invs = sorted(
        [inv for inv in investigations if inv.get('accuracy_flag') in ('correct', 'incorrect')],
        key=lambda x: x.get('timestamp', '')
    )

    result = []
    correct = 0
    for i, inv in enumerate(verified_invs):
        correct += 1 if inv['accuracy_flag'] == 'correct' else 0
        result.append({
            'index': i + 1,
            'date': inv.get('timestamp', '')[:10],
            'cumulative_accuracy': round(correct / (i + 1), 2),
            'verified': i + 1,
            'correct': correct,
        })

    return result


def compute_tools_by_category(investigations: List[Dict]) -> Dict[str, Dict]:
    """
    Compute tool usage frequency per alert category.
    Each tool is counted once per investigation (deduped within a run).
    Returns: { category: { tool: usage_count } }
    """
    cat_tools = defaultdict(lambda: defaultdict(int))

    for inv in investigations:
        category = inv.get('alert_category', '').strip()
        if not category:
            continue

        tools = inv.get('tools_used', '').split('|') if inv.get('tools_used') else []
        seen = set()
        for tool in tools:
            tool = tool.strip()
            if tool and tool not in seen:
                cat_tools[category][tool] += 1
                seen.add(tool)

    result = {}
    for cat, tools in sorted(cat_tools.items()):
        result[cat] = dict(sorted(tools.items(), key=lambda x: x[1], reverse=True)[:6])

    return result


def compute_category_performance(investigations: List[Dict]) -> Dict[str, Dict]:
    """
    Compute accuracy and run counts per alert category.
    Returns: { category: { total_runs, verified_runs, accuracy } }
    """
    cat_stats = defaultdict(lambda: {'correct': 0, 'verified': 0, 'total_runs': 0})

    for inv in investigations:
        category = inv.get('alert_category', '').strip()
        if not category:
            continue

        cat_stats[category]['total_runs'] += 1

        if inv.get('accuracy_flag') and inv['accuracy_flag'] in ('correct', 'incorrect'):
            cat_stats[category]['verified'] += 1
            if inv['accuracy_flag'] == 'correct':
                cat_stats[category]['correct'] += 1

    result = {}
    for cat, stats in sorted(cat_stats.items()):
        verified = stats['verified']
        result[cat] = {
            'total_runs': stats['total_runs'],
            'verified_runs': verified,
            'accuracy': round(stats['correct'] / verified, 2) if verified > 0 else None
        }

    return result


def _safe_float(val, default=0.0):
    try:
        return float(val) if val not in (None, '', 'None') else default
    except (ValueError, TypeError):
        return default


def _safe_int(val, default=0):
    try:
        return int(float(val)) if val not in (None, '', 'None') else default
    except (ValueError, TypeError):
        return default


def _cache_hit_pct(inv: Dict) -> float:
    inp = _safe_int(inv.get('total_input_tokens'))
    cached = _safe_int(inv.get('cache_read_tokens'))
    total = inp + cached
    return round(cached / total * 100, 1) if total > 0 else 0.0


def compute_token_totals(investigations: List[Dict]) -> Dict:
    """Aggregate token and cost totals across all investigations that have trace data."""
    totals = {'total_input_tokens': 0, 'total_output_tokens': 0,
              'cache_creation_tokens': 0, 'cache_read_tokens': 0}
    total_cost = 0.0
    total_savings = 0.0
    traced = 0

    for inv in investigations:
        if not inv.get('estimated_cost_usd'):
            continue
        traced += 1
        for key in totals:
            totals[key] += _safe_int(inv.get(key))
        total_cost += _safe_float(inv.get('estimated_cost_usd'))
        total_savings += _safe_float(inv.get('cache_savings_usd'))

    billable = totals['total_input_tokens'] + totals['cache_read_tokens']
    cache_hit_pct = round(totals['cache_read_tokens'] / billable * 100, 1) if billable > 0 else 0.0

    return {
        **totals,
        'total_cost_usd': round(total_cost, 6),
        'total_savings_usd': round(total_savings, 6),
        'overall_cache_hit_pct': cache_hit_pct,
        'traced_investigations': traced,
    }


def compute_cost_by_mode(investigations: List[Dict]) -> Dict:
    """Average and total cost per investigation mode."""
    from collections import defaultdict
    mode_costs = defaultdict(list)

    for inv in investigations:
        mode = (inv.get('mode') or '').lower()
        cost = inv.get('estimated_cost_usd', '')
        if mode and cost:
            mode_costs[mode].append(_safe_float(cost))

    result = {}
    for mode in ['standard', 'adaptive', 'parallel', 'chain']:
        costs = mode_costs.get(mode, [])
        if costs:
            result[mode] = {
                'avg_cost_usd': round(sum(costs) / len(costs), 6),
                'total_cost_usd': round(sum(costs), 6),
                'count': len(costs),
            }
    return result


def compute_cost_over_time(investigations: List[Dict]) -> List[Dict]:
    """Per-run cost ordered chronologically — for the cost trend chart."""
    result = []
    for inv in sorted(investigations, key=lambda x: x.get('timestamp', '')):
        cost = inv.get('estimated_cost_usd', '')
        if not cost:
            continue
        result.append({
            'date': inv.get('timestamp', '')[:10],
            'alert_id': inv.get('alert_id', ''),
            'mode': inv.get('mode', ''),
            'cost_usd': round(_safe_float(cost), 6),
            'cache_hit_pct': _cache_hit_pct(inv),
        })
    return result


def compute_accuracy_by_model(investigations: List[Dict]) -> Dict:
    """
    Compute accuracy and cost metrics per model tier.
    Returns: { model_id: { accuracy, avg_cost_usd, total_runs, verified_runs, total_cost_usd } }
    Legacy rows without model_used default to claude-sonnet-4-6.
    """
    from collections import defaultdict
    model_stats = defaultdict(lambda: {'correct': 0, 'verified': 0, 'total_runs': 0, 'total_cost': 0.0})

    for inv in investigations:
        model = (inv.get('model_used') or '').strip() or 'claude-sonnet-4-6'
        model_stats[model]['total_runs'] += 1
        try:
            model_stats[model]['total_cost'] += float(inv.get('estimated_cost_usd') or 0)
        except (ValueError, TypeError):
            pass
        if inv.get('accuracy_flag') and inv['accuracy_flag'] != 'pending':
            model_stats[model]['verified'] += 1
            if inv['accuracy_flag'] == 'correct':
                model_stats[model]['correct'] += 1

    result = {}
    for model, stats in sorted(model_stats.items()):
        verified = stats['verified']
        runs = stats['total_runs']
        result[model] = {
            'total_runs': runs,
            'verified_runs': verified,
            'accuracy': round(stats['correct'] / verified, 2) if verified > 0 else None,
            'avg_cost_usd': round(stats['total_cost'] / runs, 6) if runs > 0 else 0,
            'total_cost_usd': round(stats['total_cost'], 4),
        }
    return result


def find_similar_investigations(investigations: List[Dict], alert_id: str) -> Dict[str, List[Dict]]:
    """
    For each investigation, find similar past investigations.
    Similarity based on: alert_category (primary), mode (secondary), feedback present (bonus).
    """
    similar_cases = defaultdict(list)

    target = next((inv for inv in investigations if inv.get('alert_id') == alert_id), None)
    if not target:
        return {}

    target_category = target.get('alert_category', '').strip()
    target_mode = target.get('mode', '')

    candidates = []
    for inv in investigations:
        if inv.get('alert_id') == alert_id:
            continue
        if not inv.get('analyst_decision'):
            continue  # only show decided cases

        similarity_score = 0

        # Category match — primary signal
        if target_category and inv.get('alert_category', '').strip() == target_category:
            similarity_score += 0.6

        # Mode match — secondary signal
        if target_mode and inv.get('mode', '') == target_mode:
            similarity_score += 0.2

        # Analyst feedback confirmed — prefer these
        if inv.get('accuracy_flag') in ('correct', 'incorrect'):
            similarity_score += 0.2

        if similarity_score >= 0.6:
            candidates.append({
                'alert_id': inv.get('alert_id', ''),
                'similarity': round(similarity_score, 2),
                'verdict': inv.get('verdict', ''),
                'analyst_decision': inv.get('analyst_decision', ''),
                'accuracy_flag': inv.get('accuracy_flag', ''),
                'mode': inv.get('mode', ''),
                'alert_category': inv.get('alert_category', ''),
                'timestamp': inv.get('timestamp', ''),
            })

    candidates.sort(key=lambda x: x['similarity'], reverse=True)
    similar_cases[alert_id] = candidates[:5]

    return dict(similar_cases)


def main():
    """Compute all insights and save to JSON."""
    investigations = load_investigations()

    if not investigations:
        print("No investigations found in CSV")
        return

    print(f"Processing {len(investigations)} investigations...")

    # Compute all insights
    tool_effectiveness = compute_tool_effectiveness(investigations)
    mode_performance = compute_mode_performance(investigations)
    overall_accuracy, verified_total = compute_verdict_accuracy(investigations)
    category_performance = compute_category_performance(investigations)
    accuracy_trend = compute_accuracy_trend(investigations)
    tools_by_category = compute_tools_by_category(investigations)
    token_totals = compute_token_totals(investigations)
    cost_by_mode = compute_cost_by_mode(investigations)
    cost_over_time = compute_cost_over_time(investigations)
    accuracy_by_model = compute_accuracy_by_model(investigations)

    # Build similar cases for each unique alert
    alert_ids = set(inv.get('alert_id', '') for inv in investigations if inv.get('alert_id'))
    similar_cases = {}
    for alert_id in alert_ids:
        similar_cases.update(find_similar_investigations(investigations, alert_id))

    # Get top tools by effectiveness
    top_tools = sorted(
        [(tool, acc) for tool, acc in tool_effectiveness.items()],
        key=lambda x: x[1],
        reverse=True
    )[:5]

    # Build final insights
    insights = {
        'timestamp': Path('data/insights.json').stat().st_mtime if INSIGHTS_FILE.exists() else None,
        'total_investigations': len(investigations),
        'overall_accuracy': overall_accuracy,
        'verified_investigations': verified_total,
        'tool_effectiveness': tool_effectiveness,
        'top_tools': [{'tool': t, 'accuracy': acc} for t, acc in top_tools],
        'mode_performance': mode_performance,
        'category_performance': category_performance,
        'accuracy_trend': accuracy_trend,
        'tools_by_category': tools_by_category,
        'token_totals': token_totals,
        'cost_by_mode': cost_by_mode,
        'cost_over_time': cost_over_time,
        'accuracy_by_model': accuracy_by_model,
        'similar_cases': similar_cases
    }

    # Save insights
    DATA_DIR.mkdir(exist_ok=True)
    with open(INSIGHTS_FILE, 'w') as f:
        json.dump(insights, f, indent=2)

    print(f"✅ Insights saved to {INSIGHTS_FILE}")
    print(f"   Total investigations: {insights['total_investigations']}")
    print(f"   Overall accuracy: {insights['overall_accuracy']}")
    print(f"   Tool effectiveness: {len(tool_effectiveness)} tools tracked")
    print(f"   Modes with data: {sum(1 for m in mode_performance.values() if m['total_runs'] > 0)}/4")


if __name__ == '__main__':
    main()
