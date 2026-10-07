/** Browser QA against built files. Node 24 and Chrome/Chromium; no npm browser dependency. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const output = resolve('artifacts/visual-feedback/after');
const prefix = '/aichallenge-web-viewer/';
const mime = { '.js':'text/javascript', '.css':'text/css', '.html':'text/html', '.json':'application/json', '.mcap':'application/octet-stream' };
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const relative = path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(1);
    const target = resolve('dist', relative || 'index.html');
    if (!target.startsWith(resolve('dist') + '/')) { res.writeHead(403); res.end(); return; }
    const bytes = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[extname(target)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
const delay = (ms) => new Promise(r => setTimeout(r, ms));
let chrome, socket, profile;
const pending = new Map(); let seq = 0, session;
const errors = [];
try {
  await mkdir(output, { recursive: true });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const appUrl = `http://127.0.0.1:${server.address().port}${prefix}`;
  profile = await mkdtemp(join(tmpdir(), 'ksk-viewer-qa-'));
  chrome = spawn(process.env.CHROME_BIN || 'google-chrome', ['--headless','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`], {stdio:['ignore','ignore','pipe']});
  let stderr = '', launchError;
  chrome.stderr.on('data', b => { stderr += b; }); chrome.on('error', e => { launchError = e; });
  let port;
  for (let i = 0; i < 80; i++) {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null) throw new Error(`Chrome could not start:\n${stderr}`);
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); }
  }
  assert(port, `Chrome did not become ready:\n${stderr}`);
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((yes, no) => { socket.onopen = yes; socket.onerror = no; });
  socket.onmessage = ({data}) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); if (!request) return;
      pending.delete(message.id); clearTimeout(request.timer);
      message.error ? request.no(new Error(JSON.stringify(message.error))) : request.yes(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
  };
  const send = (method, params = {}, target = session) => new Promise((yes, no) => {
    const id = ++seq; const timer = setTimeout(() => { pending.delete(id); no(new Error(`CDP timed out: ${method}`)); }, 15000);
    pending.set(id, {yes,no,timer}); socket.send(JSON.stringify({id,method,params,...(target ? {sessionId:target} : {})}));
  });
  const {targetId} = await send('Target.createTarget', {url:'about:blank'}, null);
  session = (await send('Target.attachToTarget', {targetId,flatten:true}, null)).sessionId;
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', {expression,awaitPromise:true,returnByValue:true});
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`UI did not become ready: ${expression}`);
  };
  const capture = async name => {
    await evaluate('document.fonts.ready'); await delay(400);
    assert.equal(await evaluate('document.documentElement.scrollWidth > innerWidth + 1'), false, `${name}: horizontal overflow`);
    assert.deepEqual(errors, [], `${name}: runtime exception`);
    const metrics = await send('Page.getLayoutMetrics');
    const {data} = await send('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:metrics.cssContentSize.width,height:metrics.cssContentSize.height,scale:1}});
    await writeFile(join(output, `${name}.png`), Buffer.from(data,'base64'));
    console.log(`PASS ${name}`);
  };
  for (const [name,width,height,mobile] of [['desktop',1440,1000,false],['mobile',390,844,true]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,mobile,deviceScaleFactor:1});
    await send('Page.navigate', {url:appUrl}); await waitFor('!!document.querySelector(".welcome")');
    await capture(`01-entry-${name}`);
    await send('Page.navigate', {url:appUrl+'?bag=demo.mcap'}); await waitFor('!!document.querySelector(".playback-bar")');
    await evaluate("for(let i=0;i<12;i++)window.dispatchEvent(new KeyboardEvent('keydown',{code:'ArrowRight',shiftKey:true,bubbles:true}))");
    await delay(200);
    assert(await evaluate(`(()=>{const c=document.querySelector('.track-canvas');const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;const colors=new Set();for(let i=0;i<b.length;i+=16)colors.add(b[i]+','+b[i+1]+','+b[i+2]);return colors.size>5})()`), 'map must draw data');
    await capture(`02-replay-${name}`);
    await evaluate("document.querySelector('.playback-controls button:nth-of-type(2)').click()"); await delay(300);
    assert(await evaluate("document.querySelector('.playback-controls').textContent.includes('一時停止')"), 'play must start');
    await send('Page.navigate', {url:appUrl}); await waitFor('!!document.querySelector("input[type=file]")');
    await evaluate("(()=>{const dt=new DataTransfer();dt.items.add(new File(['broken'],'invalid.mcap'));const el=document.querySelector('input[type=file]');el.files=dt.files;el.dispatchEvent(new Event('change',{bubbles:true}));})()");
    await waitFor('!!document.querySelector(".bag-error")'); await capture(`03-error-${name}`);
    await evaluate("document.querySelector('.demo-button').click()"); await waitFor('!!document.querySelector(".playback-bar")');
    assert.equal(await evaluate('!!document.querySelector(".bag-error")'), false, 'valid recording must recover from invalid file');
  }
  await writeFile(join(output,'checks.json'), JSON.stringify({passed:true,viewports:2,screenshots:6,runtimeExceptions:errors},null,2));
} catch (error) { console.error(error); process.exitCode = 1; }
finally {
  socket?.close(); chrome?.kill(); server.close();
  for (const request of pending.values()) clearTimeout(request.timer);
  if (profile) { await delay(300); await rm(profile,{recursive:true,force:true}).catch(()=>{}); }
}
