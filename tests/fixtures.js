// Synthetic tetrahedron used only to test the inference transport contract.
// This fixture is not an AI result and is never served by the production app.
export function fixtureGLB() {
  const vertices = new Float32Array([-.3, 0, -.3, .3, 0, -.3, 0, 0, .3, 0, .9, 0]);
  const indices = new Uint16Array([0, 2, 1, 0, 1, 3, 1, 2, 3, 2, 0, 3]);
  const binary = Buffer.concat([Buffer.from(vertices.buffer), Buffer.from(indices.buffer)]);
  const json = { asset: { version: '2.0', generator: 'RoomShift contract-test fixture, not inference' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [.4, .5, .3, 1], metallicFactor: 0, roughnessFactor: .8 }, doubleSided: true }], buffers: [{ byteLength: binary.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: vertices.byteLength }, { buffer: 0, byteOffset: vertices.byteLength, byteLength: indices.byteLength }], accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [-.3, 0, -.3], max: [.3, .9, .3] }, { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' }] };
  let jsonBuffer = Buffer.from(JSON.stringify(json)); jsonBuffer = Buffer.concat([jsonBuffer, Buffer.alloc((4 - jsonBuffer.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20); header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + jsonBuffer.length + 8 + binary.length, 8); header.writeUInt32LE(jsonBuffer.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonBuffer, binHeader, binary]);
}
