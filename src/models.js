import * as T from 'three';

const material = (color, roughness = 0.85) => new T.MeshStandardMaterial({ color, roughness });
const fabric = material('#dedbca'), green = material('#73816a'), wood = material('#806047'), dark = material('#41463c');
function box(group, size, position, mat, radius = 0) {
  const mesh = new T.Mesh(new T.BoxGeometry(...size), mat); mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
}
function cylinder(group, rt, rb, height, pos, mat) { const mesh = new T.Mesh(new T.CylinderGeometry(rt, rb, height, 28), mat); mesh.position.set(...pos); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh; }
function cushion(group, size, pos, mat) {
  const mesh = box(group, size, pos, mat); mesh.geometry.dispose();
  // A subdivided, rounded box gives the sample furniture a soft upholstered silhouette.
  const geometry = new T.BoxGeometry(...size, 8, 6, 8); const p = geometry.attributes.position; const v = new T.Vector3();
  const r = Math.min(...size) * 0.22;
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const inner = v.clone().clamp(new T.Vector3(-size[0] / 2 + r, -size[1] / 2 + r, -size[2] / 2 + r), new T.Vector3(size[0] / 2 - r, size[1] / 2 - r, size[2] / 2 - r)); v.sub(inner).normalize().multiplyScalar(r).add(inner); p.setXYZ(i, v.x, v.y, v.z); }
  geometry.computeVertexNormals(); mesh.geometry = geometry; return mesh;
}
export function makeModel(type) {
  const g = new T.Group();
  if (type === 'sofa') {
    for (const x of [-0.95, 0.95]) for (const z of [-0.32, 0.32]) box(g, [.07, .18, .07], [x, .09, z], wood);
    cushion(g, [2.3, .28, .91], [0, .3, 0], fabric);
    cushion(g, [2.3, .55, .2], [0, .65, -.39], fabric);
    for (const x of [-1.05, 1.05]) cushion(g, [.22, .5, .95], [x, .53, 0], fabric);
    for (const x of [-.51, .51]) { cushion(g, [.97, .16, .71], [x, .49, .06], fabric); const pillow = cushion(g, [.9, .4, .17], [x, .72, -.24], fabric); pillow.rotation.x = -.12; }
    const pillow = cushion(g, [.38, .38, .15], [-.72, .72, -.1], green); pillow.rotation.z = .22;
  } else if (type === 'chair') {
    for (const x of [-.3, .3]) for (const z of [-.29, .29]) { const leg = box(g, [.045, .42, .045], [x, .21, z], wood); leg.rotation.z = x > 0 ? -.07 : .07; }
    cushion(g, [.7, .14, .68], [0, .43, .02], green);
    const back = cushion(g, [.7, .52, .15], [0, .72, -.3], green); back.rotation.x = -.12;
    for (const x of [-.36, .36]) { box(g, [.055, .33, .055], [x, .53, .23], wood); box(g, [.065, .065, .74], [x, .69, 0], wood); }
  } else if (type === 'table') {
    const top = cylinder(g, .65, .65, .065, [0, .42, 0], wood); top.scale.z = .72;
    for (const x of [-.38, .38]) for (const z of [-.22, .22]) cylinder(g, .035, .045, .39, [x, .195, z], dark);
    box(g, [.27, .035, .2], [-.18, .475, -.06], material('#ccc6b1'));
    box(g, [.23, .03, .17], [-.17, .505, -.04], material('#85918b'));
    cylinder(g, .055, .045, .095, [.25, .5, .06], material('#ded7c8'));
  } else if (type === 'plant') {
    cylinder(g, .23, .16, .38, [0, .19, 0], material('#c8b6a0'));
    cylinder(g, .21, .21, .015, [0, .385, 0], material('#443c2f'));
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.399; const height = .65 + (i % 4) * .15;
      const stem = cylinder(g, .009, .009, height - .35, [Math.cos(angle) * .07, (height + .35) / 2, Math.sin(angle) * .07], material('#5a6649'));
      stem.rotation.z = Math.cos(angle) * .2;
      const leaf = new T.Mesh(new T.SphereGeometry(1, 12, 8), material(i % 2 ? '#66764c' : '#435d43'));
      leaf.scale.set(.12, .29, .035); leaf.position.set(Math.cos(angle) * .19, height, Math.sin(angle) * .19); leaf.rotation.set(.4, angle, Math.cos(angle) * -.75); leaf.castShadow = true; g.add(leaf);
    }
  } else throw new Error('Unknown demo furniture type.');
  return g;
}
export const demos = [
  { id: 'sofa', name: 'Linen two-seater', category: 'SOFA', dimensions: [2.3, .93, .95] },
  { id: 'chair', name: 'Olive lounge chair', category: 'ARMCHAIR', dimensions: [.79, 1, .81] },
  { id: 'table', name: 'Low walnut table', category: 'COFFEE TABLE', dimensions: [1.3, .55, .94] },
  { id: 'plant', name: 'A little greenery', category: 'PLANT', dimensions: [.6, 1.4, .6] },
];
export function thumbnail(type) {
  const paths = {
    sofa: '<path d="M27 49 76 26 132 46 83 71Z" fill="#c9c7b6"/><path d="M27 49v25l56 26V71Z" fill="#b9b7a5"/><path d="m83 71 49-25v28l-49 26Z" fill="#dedccc"/><path d="m35 48 40-19v18L35 67Z" fill="#e6e3d6"/><path d="m35 67 40-20 48 20-40 22Z" fill="#eeecdf"/><path d="m27 50 8-4 9 5v25l-9 5-8-4Z" fill="#dad8c9"/><path d="m117 64 8-5 9 5v18l-9 5-8-4Z" fill="#d2d0bf"/><path d="m56 48 12-6 7 17-11 6Z" fill="#7e8b72"/><path d="M36 81v11m87-5v10m-40 3v9" stroke="#74624b" stroke-width="4"/>',
    chair: '<path d="m52 36 33-16 30 17-33 17Z" fill="#8e9a80"/><path d="m52 36 30 18v34L52 70Z" fill="#667653"/><path d="m82 54 33-17v34L82 88Z" fill="#a2ad90"/><path d="m50 73 32-16 34 19-32 17Z" fill="#859475"/><path d="m49 68 33 20 36-18M49 68v31m33-11v24m36-42v26" fill="none" stroke="#80664b" stroke-width="5" stroke-linejoin="round"/><path d="m48 60 17-8m38 6 18 10" stroke="#80664b" stroke-width="5"/>',
    table: '<path d="M45 67v32m64-32v30M76 79v32" stroke="#565345" stroke-width="5"/><ellipse cx="80" cy="61" rx="48" ry="23" fill="#805f43"/><ellipse cx="80" cy="57" rx="48" ry="23" fill="#a27c56"/><path d="m54 53 20-9 18 8-20 10Z" fill="#d5d1bc"/><path d="m57 48 17-7 16 7-17 8Z" fill="#82958c"/><ellipse cx="101" cy="54" rx="6" ry="4" fill="#e8dfc7"/>',
    plant: '<path d="m62 79 6 27q12 10 25 0l6-27" fill="#c5b095"/><ellipse cx="80" cy="79" rx="19" ry="8" fill="#a28d73"/><path d="M80 80V34m0 31L59 43m21 15 22-22" stroke="#66774d" stroke-width="3"/><ellipse cx="63" cy="45" rx="9" ry="18" fill="#6e8051" transform="rotate(-40 63 45)"/><ellipse cx="96" cy="37" rx="9" ry="18" fill="#839163" transform="rotate(36 96 37)"/><ellipse cx="78" cy="28" rx="9" ry="18" fill="#536b46"/><ellipse cx="95" cy="62" rx="8" ry="16" fill="#5f754a" transform="rotate(48 95 62)"/>',
  };
  return `<svg viewBox="0 0 160 125" role="img" aria-label="${type} demo model"><ellipse cx="80" cy="107" rx="44" ry="8" fill="#deded3" opacity=".55"/>${paths[type] || paths.chair}</svg>`;
}
