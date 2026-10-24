export async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { ...options, headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}
export function connectSession(id, onSnapshot, onConnection, onEnd) {
  let ws, timer, stopped = false, attempts = 0;
  function connect() {
    if (stopped) return;
    onConnection('connecting');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?session=${encodeURIComponent(id)}`);
    ws.onopen = () => { attempts = 0; onConnection('connected'); };
    ws.onmessage = event => { if (stopped) return; const data = JSON.parse(event.data); if (data.type === 'snapshot') onSnapshot(data); if (data.type === 'expired') { stopped = true; onEnd('Session ended. Start a new session on the desktop.'); } };
    ws.onerror = () => onConnection('reconnecting');
    ws.onclose = async event => {
      if (stopped) return;
      if ([4001, 4003].includes(event.code)) { stopped = true; onEnd(event.reason); return; }
      onConnection('reconnecting');
      // Revalidate permission after a dropped connection; revoked credentials must not retry forever.
      try { const state = await api(`/sessions/${id}`); onSnapshot(state); }
      catch (e) { stopped = true; onEnd(e.message); return; }
      timer = setTimeout(connect, Math.min(1000 * 2 ** attempts++, 15000));
    };
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
export function uploadPhoto(session, file, mode, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/sessions/${session}/photos`);
    xhr.timeout = 60_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onload = () => { let result; try { result = JSON.parse(xhr.responseText); } catch { reject(new Error('Upload service returned an invalid response.')); return; } if (xhr.status >= 200 && xhr.status < 300) resolve(result); else reject(new Error(result.error || 'Upload failed.')); };
    xhr.onerror = () => reject(new Error('Connection lost. Your photo is still on this phone. Retry the upload.'));
    xhr.ontimeout = () => reject(new Error('Upload timed out. Try again.'));
    const data = new FormData(); data.append('photo', file, file.name || 'capture.jpg'); data.append('mode', mode); xhr.send(data);
  });
}
