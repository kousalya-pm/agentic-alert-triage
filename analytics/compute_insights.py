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
                    investigations.append(row)
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
    mode_stats = defaultdict(lambda: {'correct': 0, 'total': 0, 'times': []})

    for inv in investigations:
        mode = inv.get('mode', 'unknown').lower()
        if not mode or mode == 'unknown':
            continue

        if inv.get('accuracy_flag'):
            mode_stats[mode]['total'] += 1
            if inv['accuracy_flag'] == 'correct':
                mode_stats[mode]['correct'] += 1

        if inv.get('investigation_time_sec'):
            try:
                mode_stats[mode]['times'].append(float(inv['investigation_time_sec']))
            except ValueError:
                pass

    # Format results
    performance = {}
    for mode in ['standard', 'adaptive', 'parallel', 'chain']:
        stats = mode_stats.get(mode, {})
        total = stats.get('total', 0)
        correct = stats.get('correct', 0)
        times = stats.get('times', [])

        accuracy = round(correct / total, 2) if total > 0 else None
        avg_time = round(sum(times) / len(times), 1) if times else None

        performance[mode] = {
            'accuracy': accuracy,
            'avg_time_sec': avg_time,
            'total_runs': total,
            'verified_runs': correct
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


def find_similar_investigations(investigations: List[Dict], alert_id: str) -> Dict[str, List[Dict]]:
    """
    For each investigation, find similar past investigations.
    Similarity based on: kill_chain_tactics, asset_criticality, data_sensitivity
    """
    similar_cases = defaultdict(list)

    # Find target investigation
    target = next((inv for inv in investigations if inv.get('alert_id') == alert_id), None)
    if not target:
        return {}

    target_tactics = set(target.get('kill_chain_tactics', '').split('|')) if target.get('kill_chain_tactics') else set()
    target_criticality = target.get('asset_criticality', '')
    target_sensitivity = target.get('data_sensitivity', '')

    # Find similar cases
    candidates = []
    for inv in investigations:
        if inv.get('alert_id') == alert_id:
            continue

        inv_tactics = set(inv.get('kill_chain_tactics', '').split('|')) if inv.get('kill_chain_tactics') else set()
        inv_criticality = inv.get('asset_criticality', '')
        inv_sensitivity = inv.get('data_sensitivity', '')

        # Calculate similarity score
        similarity_score = 0

        # Tactic overlap (0-0.5 points)
        if target_tactics and inv_tactics:
            overlap = len(target_tactics & inv_tactics) / len(target_tactics | inv_tactics)
            similarity_score += overlap * 0.5

        # Criticality match (0-0.25 points)
        if target_criticality == inv_criticality:
            similarity_score += 0.25

        # Sensitivity match (0-0.25 points)
        if target_sensitivity == inv_sensitivity:
            similarity_score += 0.25

        if similarity_score > 0.5:  # Threshold for similarity
            candidates.append({
                'alert_id': inv.get('alert_id', ''),
                'similarity': round(similarity_score, 2),
                'verdict': inv.get('verdict', ''),
                'tactics': inv.get('kill_chain_tactics', ''),
                'criticality': inv_criticality,
                'sensitivity': inv_sensitivity
            })

    # Sort by similarity and limit to top 5
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
