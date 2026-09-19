// Stale saves must be rejected, fresh ones accepted. Run: npm test
const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('stale save gets 409, fresh save wins', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dumbkan-'));
    const port = 3900 + Math.floor(Math.random() * 90);
    const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
        cwd: dir, env: { ...process.env, PORT: port, DUMBKAN_PIN: '1234' }, stdio: 'ignore',
    });
    t.after(() => srv.kill());
    const url = `http://127.0.0.1:${port}/data/tasks.json`;
    const h = { 'X-Pin': '1234', 'Content-Type': 'application/json' };
    for (let i = 0; i < 50; i++) { try { await fetch(url, { headers: h }); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

    const load = async () => { const r = await fetch(url, { headers: h }); return [r.headers.get('X-Rev'), await r.json()]; };
    const save = (rev, body) => fetch(url, { method: 'POST', headers: { ...h, 'X-Rev-Match': rev }, body: JSON.stringify(body) });

    const [revA, tabA] = await load();          // browser tab loads
    const [revB, cli] = await load();           // board CLI loads the same revision
    cli.boards.work.columns.done.tasks.push('done by CLI');
    assert.strictEqual((await save(revB, cli)).status, 200);

    tabA.boards.work.name = 'stale edit';      // tab saves on top of old data
    assert.strictEqual((await save(revA, tabA)).status, 409);
    assert.strictEqual((await fetch(url, { method: 'POST', headers: h, body: '{}' })).status, 428);

    const [revC, bad] = await load();
    bad.boards.work.columns.todo.tasks.push({ title: 'not a string' });
    assert.strictEqual((await save(revC, bad)).status, 400);

    const [, final] = await load();
    assert.strictEqual(final.boards.work.columns.done.tasks[0], 'done by CLI');
    assert.strictEqual(final.boards.work.name, 'Work');
    assert.strictEqual((await fetch(url, { method: 'POST', headers: { ...h, 'X-Rev-Match': 'x' }, body: '{}' })).status, 409);
});
