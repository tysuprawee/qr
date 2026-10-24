import { api, connectSession, uploadPhoto } from './api.js';
import { $, icon, escape, refreshIcons, toast, guarded } from './ui.js';

export async function start() {
  document.body.classList.add('mobile-app');
  let session, stopSocket, stream, mode = 'furniture', busy = false, retakeId = null;
  let photos = [];
  let invitation = location.hash.slice(1);
  history.replaceState(null, '', '/capture');
  $('#app').innerHTML = `<header class="mobile-header"><a href="/" class="brand">${icon('box')}RoomShift<span class="brand-dot">®</span></a><span class="pill">PHONE CAPTURE</span></header>
  <main class="mobile-main"><div id="pair-screen"><div class="eyebrow">A NEW PERSPECTIVE</div><h1>Your room.<br>Your phone.<br>All connected.</h1><p class="muted">Capture the pieces you love and bring them into your room.</p><div class="mobile-pair-card"><h2>Connect to your desktop</h2><p>Open <strong>Scan with Phone</strong> in the desktop editor. Scan its QR code or enter the pairing code below.</p><form id="pair-form"><label>Phone name<input id="phone-name" maxlength="40" value="My phone" autocomplete="off"></label>${invitation ? '<p class="success-note">Invitation received. Ready to pair.</p>' : '<label>Pairing code<input id="pair-code" placeholder="ABCD EFGH" maxlength="9" autocomplete="off" autocapitalize="characters" required></label>'}<button class="button primary full" type="submit">${icon('link')}Request desktop approval</button></form><p id="pair-error" class="error-text" role="alert"></p></div></div>
  <div id="capture-screen" hidden><div class="mobile-status"><span class="status-dot"></span><span id="phone-status">Waiting for desktop approval</span></div><div id="approval"><h1>One quick check.</h1><p>Match this number on your desktop, then approve this phone.</p><div id="verification" class="verification"></div></div>
  <div id="approved" hidden><div class="eyebrow">BRING YOUR SPACE WITH YOU</div><h1 id="capture-title">Capture furniture</h1><div class="segmented"><button id="furniture-mode" class="active">${icon('armchair')}Capture Furniture</button><button id="room-mode">${icon('scan')}Room Scan</button></div><p id="mode-help" class="muted">Photograph one piece from the front, sides, and back. Keep the whole object in frame.</p>
  <div class="camera-frame"><video id="camera" autoplay muted playsinline hidden></video><div id="camera-placeholder">${icon('camera')}<h3>A new angle on your space</h3><p>Your camera opens only when you’re ready.</p><button id="open-camera" class="button primary">${icon('camera')}Open rear camera</button></div><button id="shutter" aria-label="Take photo" hidden><span></span></button><button id="stop-camera" class="icon-button" aria-label="Close camera" hidden>${icon('x')}</button></div>
  <label class="button full photo-picker">${icon('image-plus')}Choose photos or use phone camera<input id="phone-files" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple></label><p class="fine-print">JPEG, PNG or WebP · up to 8 MB each · 24 photos per session</p>
  <div class="section-title"><h2>Review your captures</h2><span id="photo-count" class="muted">0 photos</span></div><div id="phone-photos" class="phone-photos"></div><button id="upload-selected" class="button primary full" disabled>${icon('upload')}Upload selected photos</button><div id="upload-status" class="upload-status" role="status"></div><div id="phone-job"></div><p class="privacy-note">${icon('shield-check')}Photos are private to this pairing. Unused captures expire after 30 minutes; the session ends after one hour.</p></div></div></main>`;
  refreshIcons();
  function stopCamera() { stream?.getTracks().forEach(t => t.stop()); stream = null; $('#camera').srcObject = null; $('#camera').hidden = true; $('#camera-placeholder').hidden = false; $('#shutter').hidden = true; $('#stop-camera').hidden = true; }
  function connection(status) { $('#phone-status').textContent = status === 'connected' ? session?.phone?.status === 'approved' ? 'Connected to your desktop' : 'Waiting for desktop approval' : 'Reconnecting to desktop…'; }
  function ended(message) { stopCamera(); sessionStorage.removeItem('roomshift-phone'); session = null; $('#approved').hidden = true; $('#approval').hidden = false; $('#approval').innerHTML = `<h1>Session ended</h1><p>${escape(message)}</p><a class="button primary" href="/capture">Pair again</a>`; $('#phone-status').textContent = 'Disconnected'; }
  function update(data) {
    session = data;
    $('#pair-screen').hidden = true; $('#capture-screen').hidden = false;
    $('#verification').textContent = data.phone?.verification || '';
    const approved = data.phone?.status === 'approved';
    if (data.phone && ['disconnected', 'rejected'].includes(data.phone.status)) { ended('Your desktop disconnected this phone.'); return; }
    $('#approval').hidden = approved; $('#approved').hidden = !approved;
    $('#phone-status').textContent = approved ? 'Connected to your desktop' : 'Waiting for desktop approval';
    const existing = new Set(data.captures.map(p => p.id));
    photos = photos.filter(p => { if (p.remoteId && !existing.has(p.remoteId)) { URL.revokeObjectURL(p.url); return false; } return true; });
    // Rehydrated server photos survive a phone page refresh while the pairing is active.
    for (const p of data.captures) if (!photos.some(x => x.remoteId === p.id)) photos.push({ id: p.id, remoteId: p.id, url: p.url, mode: p.mode, selected: false });
    renderPhotos();
    const job = data.job;
    $('#phone-job').innerHTML = job ? `<div class="notice ${job.status === 'failed' ? 'warning' : ''}"><strong>${job.status === 'succeeded' ? 'Your 3D asset is ready' : job.status === 'failed' ? 'Reconstruction unavailable' : 'Reconstruction in progress'}</strong><p>${escape(job.message || job.stage)}</p>${job.status === 'succeeded' ? '<p>Confirm dimensions and add it to your room on the desktop.</p>' : ''}</div>` : '';
  }
  function attach(data) { stopSocket?.(); update(data); sessionStorage.setItem('roomshift-phone', data.id); stopSocket = connectSession(data.id, update, connection, ended); }
  $('#pair-form').onsubmit = event => { event.preventDefault(); guarded(async () => {
    const button = $('#pair-form button'); button.disabled = true; $('#pair-error').textContent = '';
    try { const data = await api('/pair', { method: 'POST', body: JSON.stringify({ invitation: invitation || undefined, code: $('#pair-code')?.value, name: $('#phone-name').value }) }); invitation = ''; attach(data); }
    catch (e) { $('#pair-error').textContent = e.message; } finally { button.disabled = false; }
  }); };
  const previous = sessionStorage.getItem('roomshift-phone');
  if (previous && !invitation) { try { attach(await api(`/sessions/${previous}`)); } catch { sessionStorage.removeItem('roomshift-phone'); } }
  function setMode(value) { mode = value; $('#furniture-mode').classList.toggle('active', mode === 'furniture'); $('#room-mode').classList.toggle('active', mode === 'room'); $('#capture-title').textContent = mode === 'furniture' ? 'Capture furniture' : 'Room Scan'; $('#mode-help').textContent = mode === 'furniture' ? 'Photograph one piece from the front, sides, and back. Keep the whole object in frame.' : 'Phase 1: capture room reference photos. Browser photos do not produce a metrically accurate 3D room scan. Enter measured room dimensions on your desktop.'; }
  $('#furniture-mode').onclick = () => setMode('furniture'); $('#room-mode').onclick = () => setMode('room');
  async function openCamera() {
    if (stream) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) throw new Error('Live camera requires HTTPS. Use a trusted HTTPS link, or choose an existing photo.');
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } }); }
    catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access in browser settings, or choose a photo below.' : 'Could not open the rear camera. Choose a photo below or try again.'); }
    $('#camera').srcObject = stream; $('#camera').hidden = false; $('#camera-placeholder').hidden = true; $('#shutter').hidden = false; $('#stop-camera').hidden = false;
    await $('#camera').play();
  }
  $('#open-camera').onclick = () => guarded(openCamera); $('#stop-camera').onclick = stopCamera;
  async function addPhoto(file) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8 * 1024 ** 2) throw new Error('Choose JPEG, PNG or WebP photos under 8 MB. For HEIC, export as JPEG first.');
    if (retakeId) { const old = photos.find(p => p.id === retakeId); if (old) { URL.revokeObjectURL(old.url); photos = photos.filter(p => p !== old); } retakeId = null; }
    if (photos.length >= 24) throw new Error('You can keep up to 24 captures. Delete a photo before adding more.');
    photos.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file), selected: true, mode }); renderPhotos();
  }
  $('#phone-files').onchange = event => guarded(async () => { for (const file of event.target.files) await addPhoto(file); event.target.value = ''; });
  $('#shutter').onclick = () => guarded(async () => {
    const video = $('#camera'); if (!video.videoWidth) throw new Error('Wait for the camera to be ready.');
    const canvas = document.createElement('canvas'); canvas.width = video.videoWidth; canvas.height = video.videoHeight; canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9)); await addPhoto(new File([blob], `capture-${Date.now()}.jpg`, { type: 'image/jpeg' })); toast('Photo captured. Review it below.');
  });
  function renderPhotos() {
    $('#photo-count').textContent = `${photos.length} photo${photos.length === 1 ? '' : 's'}`;
    $('#phone-photos').innerHTML = photos.length ? photos.map(p => `<article class="phone-photo"><img src="${escape(p.url)}" alt="${p.mode === 'room' ? 'Room reference' : 'Furniture'} capture"><div><span class="pill">${p.remoteId ? 'UPLOADED' : p.mode.toUpperCase()}</span>${!p.remoteId ? `<label class="photo-select"><input type="checkbox" data-select="${p.id}" ${p.selected ? 'checked' : ''} ${busy ? 'disabled' : ''}>Select</label>` : ''}<div class="photo-actions">${!p.remoteId ? `<button data-retake="${p.id}" ${busy ? 'disabled' : ''}>Retake</button>` : ''}<button data-delete="${p.id}" ${busy ? 'disabled' : ''}>Delete</button></div></div></article>`).join('') : '<div class="empty-photos">Your photos will appear here. A few clear angles make a good starting point.</div>';
    document.querySelectorAll('[data-select]').forEach(el => el.onchange = () => { photos.find(p => p.id === el.dataset.select).selected = el.checked; renderPhotos(); });
    document.querySelectorAll('[data-delete]').forEach(el => el.onclick = () => guarded(async () => { const p = photos.find(p => p.id === el.dataset.delete); if (p.remoteId) await api(`/sessions/${session.id}/photos/${p.remoteId}`, { method: 'DELETE' }); photos = photos.filter(x => x !== p); URL.revokeObjectURL(p.url); renderPhotos(); }));
    document.querySelectorAll('[data-retake]').forEach(el => el.onclick = () => guarded(async () => { retakeId = el.dataset.retake; await openCamera(); $('.camera-frame').scrollIntoView({ behavior: 'smooth' }); }));
    $('#upload-selected').disabled = busy || !photos.some(p => p.selected && !p.remoteId);
  }
  $('#upload-selected').onclick = () => guarded(async () => {
    if (!session || busy) return; busy = true; renderPhotos();
    const pending = photos.filter(p => p.selected && !p.remoteId);
    try {
      for (let i = 0; i < pending.length; i++) {
        const p = pending[i];
        const result = await uploadPhoto(session.id, p.file, p.mode, percent => { $('#upload-status').innerHTML = `<p>Uploading photo ${i + 1} of ${pending.length} · ${percent}%</p><progress max="100" value="${percent}"></progress>`; });
        // A WebSocket snapshot may arrive before the HTTP response. Remove its temporary duplicate.
        photos = photos.filter(x => x === p || x.remoteId !== result.id); p.remoteId = result.id; p.file = null; p.selected = false; renderPhotos();
      }
      $('#upload-status').textContent = 'Uploaded. Your photos are now on your desktop.';
    } finally { busy = false; renderPhotos(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', () => { stopCamera(); stopSocket?.(); photos.forEach(p => URL.revokeObjectURL(p.url)); });
  renderPhotos();
}
