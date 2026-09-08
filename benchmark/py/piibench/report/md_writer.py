import os

def write_md_report(report_data, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, 'metrics_report.md')
    
    lines = [
        "# BrowseShield PIIBench Report",
        f"**Run ID:** `{report_data.get('run_id', 'unknown')}`",
        f"**Date:** {report_data.get('generated_at')}",
        "",
        "## Summary",
        f"**Passed:** {report_data.get('summary', {}).get('datasets_passed', 0)} / {report_data.get('summary', {}).get('datasets_total', 0)}",
        "",
        "| Dataset | Metric | Score | Threshold | Pass | Coverage % |",
        "|---|---|---|---|---|---|"
    ]
    
    for ds_name, ds_info in report_data.get('datasets', {}).items():
        metric = ds_info['threshold']['metric']
        threshold = ds_info['threshold']['value']
        score = ds_info['measured'].get(metric, 0)
        passed = "✅" if ds_info.get('pass') else "❌"
        cov = f"{ds_info['measured'].get('coverage_pct', 0) * 100:.1f}%"
        
        lines.append(f"| {ds_name} | {metric} | {score:.3f} | >= {threshold:.2f} | {passed} | {cov} |")
        
    with open(path, 'w', encoding='utf-8') as f:
        f.write("\n".join(lines) + "\n")
        
    print(f"Markdown report saved to {path}")
