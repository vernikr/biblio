import json, time, urllib.request
from pathlib import Path
root = Path('/home/user/biblio-mcp-review')
head = json.loads((root / 'pr2b-push.json').read_text())['pushed_sha']
base = 'https://api.github.com/repos/vernikr/biblio-mcp'
def api(path):
    separator = '&' if '?' in path else '?'
    req = urllib.request.Request(base + path + separator + 'verify=' + str(time.time_ns()), headers={
        'User-Agent': 'Arena-Agent', 'Accept': 'application/vnd.github+json', 'Cache-Control': 'no-cache'
    })
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)
for attempt in range(20):
    runs = api('/actions/runs?branch=main&event=push&per_page=5')['workflow_runs']
    run = next((r for r in runs if r['head_sha'] == head), None)
    if run:
        jobs = api(f"/actions/runs/{run['id']}/jobs?per_page=20")['jobs']
        report = { 'id': run['id'], 'head_sha': head, 'status': run['status'], 'conclusion': run['conclusion'], 'url': run['html_url'],
                   'jobs': [{'id': j['id'], 'name': j['name'], 'status': j['status'], 'conclusion': j['conclusion'], 'url': j['html_url']} for j in jobs] }
        (root / 'pr2b-ci-final.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report), flush=True)
        if run['status'] == 'completed':
            raise SystemExit(0 if run['conclusion'] == 'success' else 1)
    time.sleep(30)
raise SystemExit('CI wait budget exhausted; inspect saved status.')
