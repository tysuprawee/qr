import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makeModel } from './models.js';

export async function loadGLB(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || buffer.byteLength > 32 * 1024 ** 2 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength || view.getUint32(16, true) !== 0x4e4f534a) throw new Error('Choose a self-contained GLB 2.0 model under 32 MB.');
  const jsonLength = view.getUint32(12, true);
  if (jsonLength > buffer.byteLength - 20) throw new Error('Invalid GLB metadata.');
  const json = JSON.parse(new TextDecoder().decode(buffer.slice(20, 20 + jsonLength)));
  for (const entry of [...(json.buffers || []), ...(json.images || [])]) if (entry.uri && !entry.uri.startsWith('data:')) throw new Error('Embed all textures and buffers in the GLB before importing.');
  const manager = new T.LoadingManager();
  manager.setURLModifier(url => { if (!url.startsWith('blob:') && !url.startsWith('data:')) throw new Error('External model resources are not allowed.'); return url; });
  const gltf = await new GLTFLoader(manager).parseAsync(buffer, '');
  let count = 0; gltf.scene.traverse(child => { if (child.isMesh) { count++; child.castShadow = true; child.receiveShadow = true; } });
  if (!count) throw new Error('The model contains no mesh.');
  return gltf.scene;
}
export function dispose(object) { object.traverse(o => { o.geometry?.dispose(); const mats = Array.isArray(o.material) ? o.material : [o.material]; for (const m of mats) if (m) { for (const v of Object.values(m)) if (v?.isTexture) v.dispose(); m.dispose(); } }); }
export function normalize(object, dimensions) {
  object.updateMatrixWorld(true); const bounds = new T.Box3().setFromObject(object); const size = bounds.getSize(new T.Vector3());
  if ([size.x, size.y, size.z].some(n => !Number.isFinite(n) || n < 0.00001)) throw new Error('Model has invalid or flat bounds.');
  const wrapper = new T.Group(); wrapper.add(object);
  object.position.sub(new T.Vector3((bounds.min.x + bounds.max.x) / 2, bounds.min.y, (bounds.min.z + bounds.max.z) / 2));
  wrapper.scale.set(dimensions[0] / size.x, dimensions[1] / size.y, dimensions[2] / size.z); return wrapper;
}

export class RoomScene {
  constructor(container, onSelect, onChange, preview = false) {
    this.container = container; this.onSelect = onSelect; this.onChange = onChange; this.objects = new Map(); this.preview = preview;
    this.scene = new T.Scene(); this.scene.background = new T.Color(preview ? '#eeeee7' : '#e9eae3');
    this.camera = new T.PerspectiveCamera(36, 1, .05, 150); this.camera.position.set(preview ? 2.6 : 8.4, preview ? 1.9 : 7.4, preview ? 3 : 9.6);
    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false }); this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = T.PCFSoftShadowMap; this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    container.append(this.renderer.domElement); this.renderer.domElement.setAttribute('aria-label', preview ? '3D asset preview. Drag to orbit.' : '3D room editor. Select furniture to move or rotate.');
    this.controls = new OrbitControls(this.camera, this.renderer.domElement); this.controls.target.set(0, preview ? .5 : .35, 0); this.controls.enableDamping = true; this.controls.maxPolarAngle = Math.PI / 2.05; this.controls.minDistance = preview ? .5 : 3; this.controls.maxDistance = 30;
    this.scene.add(new T.HemisphereLight('#fffcf0', '#a9afa0', 2.3));
    const sun = new T.DirectionalLight('#fff4db', 3.2); sun.position.set(4, 8, 5); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .1, far: 30 }); sun.shadow.normalBias = .035; this.scene.add(sun);
    if (!preview) {
      this.transform = new TransformControls(this.camera, this.renderer.domElement); this.transform.setSize(.8); this.transform.showY = false; this.scene.add(this.transform.getHelper());
      this.transform.addEventListener('dragging-changed', event => { this.controls.enabled = !event.value; if (!event.value && this.selected) this.onChange?.(this.selected, this.readTransform()); });
      this.transform.addEventListener('objectChange', () => { this.selectionBox?.setFromObject(this.objects.get(this.selected)); });
      let start;
      this.renderer.domElement.addEventListener('pointerdown', e => { start = [e.clientX, e.clientY]; });
      this.renderer.domElement.addEventListener('pointerup', e => {
        if (!start || Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 5 || this.transform.axis) return;
        const rect = this.renderer.domElement.getBoundingClientRect(); const ray = new T.Raycaster(); ray.setFromCamera(new T.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), this.camera);
        const hits = ray.intersectObjects([...this.objects.values()], true);
        let object = hits[0]?.object; while (object && !object.userData.instanceId) object = object.parent;
        this.select(object?.userData.instanceId || null); this.onSelect?.(this.selected);
      });
    }
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(container);
    this.renderer.setAnimationLoop(() => { this.controls.update(); this.renderer.render(this.scene, this.camera); }); this.resize();
  }
  resize() { const w = this.container.clientWidth, h = this.container.clientHeight; if (w && h) { this.renderer.setSize(w, h); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); } }
  setRoom(room) {
    if (this.room) { this.scene.remove(this.room); dispose(this.room); }
    this.room = new T.Group(); this.scene.add(this.room);
    const { width: w, depth: d, height: h } = room;
    const add = (size, pos, color) => { const mesh = new T.Mesh(new T.BoxGeometry(...size), new T.MeshStandardMaterial({ color, roughness: .9 })); mesh.position.set(...pos); mesh.receiveShadow = true; this.room.add(mesh); return mesh; };
    add([w + .12, .14, d + .12], [0, -.09, 0], '#bbb29d');
    for (let i = 0; i < Math.ceil(w / .32); i++) { const width = Math.min(.317, w - i * .32); if (width <= 0) continue; add([width, .025, d], [-w / 2 + i * .32 + width / 2, -.007, 0], ['#cfbf9f', '#d4c6a9', '#cbbd9e', '#d0c2a5'][i % 4]); }
    if (room.surfaces?.length) {
      for (const surface of room.surfaces) {
        const color = surface.kind === 'window' ? '#bdd5d4' : surface.kind === 'door' ? '#bda98b' : '#dedfd4';
        const mesh = add(surface.dimensions.map(n => Math.max(n, .04)), surface.position, color); mesh.rotation.y = surface.rotation || 0;
        if (surface.kind !== 'wall') { mesh.material.transparent = true; mesh.material.opacity = .65; }
      }
      for (const reference of room.objectLocations || []) {
        const mesh = new T.Mesh(new T.BoxGeometry(...reference.dimensions.map(n => Math.max(n, .04))), new T.MeshBasicMaterial({ color: '#78936c', wireframe: true, transparent: true, opacity: .55 }));
        mesh.position.set(...reference.position); mesh.rotation.y = reference.rotation || 0; mesh.userData.roomPlanReference = true; this.room.add(mesh);
      }
    } else {
      add([w + .1, h, .1], [0, h / 2, -d / 2], '#dedfd4');
      add([.1, h, d], [-w / 2, h / 2, 0], '#e9e8de');
      add([w, .085, .04], [0, .042, -d / 2 + .07], '#f0efe6'); add([.04, .085, d], [-w / 2 + .07, .042, 0], '#f0efe6');
      // Sample wall art and a recessed window make the starter room easy to orient.
      add([.84, 1.02, .055], [-.6, 1.65, -d / 2 + .08], '#8b7457'); add([.76, .94, .01], [-.6, 1.65, -d / 2 + .113], '#eee9db'); add([.27, .44, .015], [-.69, 1.59, -d / 2 + .124], '#8b977d'); add([.25, .22, .018], [-.43, 1.82, -d / 2 + .126], '#c0a680');
      add([.065, 1.35, 1.6], [-w / 2 + .07, 1.7, -.4], '#f5f1e5'); add([.07, 1.19, 1.43], [-w / 2 + .11, 1.7, -.4], '#c4d7d3'); add([.075, 1.22, .045], [-w / 2 + .15, 1.7, -.4], '#f7f4e7'); add([.075, .045, 1.45], [-w / 2 + .15, 1.7, -.4], '#f7f4e7');
    }
    if (!room.surfaces?.length) {
      const rug = add([Math.min(3.35, w * .65), .015, Math.min(2.5, d * .65)], [0, .017, .35], '#e3dfcc');
      for (let i = -14; i <= 14; i++) add([Math.min(3.3, w * .64), .003, .007], [0, .027, .35 + i * Math.min(.08, d / 42)], '#d4d0bd');
    }
  }
  async add(instance, asset, prepared) {
    const source = prepared || (asset.source === 'demo' ? makeModel(asset.type) : await loadGLB(asset.buffer.slice(0)));
    const object = normalize(source, instance.dimensions); object.userData.instanceId = instance.id;
    object.position.set(...instance.position); object.rotation.y = instance.rotation;
    this.objects.set(instance.id, object); this.scene.add(object); return object;
  }
  remove(id) { const object = this.objects.get(id); if (!object) return; if (id === this.selected) this.select(null); this.scene.remove(object); dispose(object); this.objects.delete(id); }
  select(id) {
    this.selected = id; this.transform?.detach(); if (this.selectionBox) { this.scene.remove(this.selectionBox); this.selectionBox.geometry.dispose(); this.selectionBox.material.dispose(); this.selectionBox = null; }
    const object = this.objects.get(id);
    if (object && this.transform) { this.transform.attach(object); this.selectionBox = new T.BoxHelper(object, '#638573'); this.scene.add(this.selectionBox); }
  }
  readTransform() { const object = this.objects.get(this.selected); return object ? { position: object.position.toArray(), rotation: object.rotation.y } : null; }
  update(instance) { const object = this.objects.get(instance.id); if (!object) return; object.rotation.y = 0; object.updateMatrixWorld(true); const size = new T.Box3().setFromObject(object).getSize(new T.Vector3()); object.scale.multiply(new T.Vector3(instance.dimensions[0] / size.x, instance.dimensions[1] / size.y, instance.dimensions[2] / size.z)); object.position.set(...instance.position); object.rotation.y = instance.rotation; object.updateMatrixWorld(true); this.selectionBox?.setFromObject(object); }
  setMode(mode) { this.transform.setMode(mode); this.transform.showX = mode === 'translate'; this.transform.showZ = mode === 'translate'; this.transform.showY = mode === 'rotate'; }
  view(top = false) { this.camera.position.set(top ? .001 : 8.4, top ? 12 : 7.4, top ? .001 : 9.6); this.controls.target.set(0, .3, 0); this.controls.update(); }
  destroy() { this.renderer.setAnimationLoop(null); this.observer.disconnect(); this.controls.dispose(); this.transform?.dispose(); dispose(this.scene); this.renderer.dispose(); this.renderer.domElement.remove(); }
}
