// Screenshot only our acceptance tab. Never close the user's browser.
const fs = require('fs');
const path = require('path');
(async () => {
  const activePort = fs.readFileSync(path.join(process.env.LOCALAPPDATA,
    'Google/Chrome/User Data/DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
  const ws = new WebSocket(`ws://127.0.0.1:${activePort[0]}${activePort[1]}`);
  const pending = new Map();
  let sequence = 0;
  const timeout = setTimeout(() => { ws.close(); process.exitCode = 2; }, 20000);
  ws.onmessage = e => {
    const message = JSON.parse(e.data);
    if (pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id);
      pending.delete(message.id);
      message.error ? reject(new Error(message.error.message)) : resolve(message.result);
    }
  };
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, {resolve, reject});
      ws.send(JSON.stringify({id, method, params, ...(sessionId ? {sessionId} : {})}));
    });
  }
  try {
    const {sessionId} = await send('Target.attachToTarget', {targetId: '4E859A7903B9CF677D5DC2DE546191B5', flatten: true});
    const location = await send('Runtime.evaluate', {expression: 'location.href', returnByValue: true}, sessionId);
    if (!location.result.value.startsWith('http://127.0.0.1:5173/')) throw new Error('Unexpected tab URL');
    await send('Page.bringToFront', {}, sessionId);
    const screenshot = await send('Page.captureScreenshot', {format: 'png', fromSurface: true}, sessionId);
    const output = path.join(__dirname, new Date().toISOString().replace(/[:.]/g, '-') + '-manual-page.png');
    fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
    console.log(JSON.stringify({saved: output}));
    await send('Target.detachFromTarget', {sessionId});
  } finally {
    clearTimeout(timeout);
    ws.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
