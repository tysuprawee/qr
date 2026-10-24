let db;
async function database() {
  if (db) return db;
  db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('roomshift', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('project');
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  return db;
}
export async function readProject() {
  const conn = await database();
  return new Promise((resolve, reject) => { const r = conn.transaction('project').objectStore('project').get('current'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
export async function saveProject(project) {
  const conn = await database();
  return new Promise((resolve, reject) => { const tx = conn.transaction('project', 'readwrite'); tx.objectStore('project').put(project, 'current'); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
}
