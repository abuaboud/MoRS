# Summarize a claude stream-json transcript: tool calls, results, text. usage: python3 tools/follow.py runs/claude-run.jsonl [lastN]
import json, sys
rows = []
for l in open(sys.argv[1]):
    try: e = json.loads(l)
    except Exception: continue
    if e.get('type') == 'system' and e.get('subtype') == 'init':
        rows.append('INIT mcp=' + ','.join(s['name'] + ':' + s['status'] for s in e.get('mcp_servers', [])))
    if e.get('type') == 'assistant':
        for c in e['message']['content']:
            if c['type'] == 'tool_use': rows.append('CALL ' + c['name'].split('__')[-1] + ' ' + json.dumps(c['input'])[:400])
            elif c['type'] == 'text' and c['text'].strip(): rows.append('SAY  ' + c['text'][:400].replace('\n', ' '))
    if e.get('type') == 'user':
        for c in e['message'].get('content', []):
            if isinstance(c, dict) and c.get('type') == 'tool_result':
                out = c['content'] if isinstance(c['content'], str) else ' '.join(x.get('text', '[image]') for x in c['content'])
                rows.append('  -> ' + out[-300:].replace('\n', ' | '))
    if e.get('type') == 'result': rows.append(f"RESULT {e.get('subtype')} turns={e.get('num_turns')} cost=${e.get('total_cost_usd')}")
n = int(sys.argv[2]) if len(sys.argv) > 2 else 40
print('\n'.join(rows[-n:]))
