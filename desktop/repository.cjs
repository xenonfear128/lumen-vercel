const {DatabaseSync}=require('node:sqlite');
function createRepository(path,safeStorage) {
  const db=new DatabaseSync(path);
  const version=db.prepare('PRAGMA user_version').get().user_version;if(version>2)throw Error('STORAGE_VERSION_UNSUPPORTED');
  db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS secrets(key TEXT PRIMARY KEY,value BLOB NOT NULL); CREATE TABLE IF NOT EXISTS files(id TEXT NOT NULL,scope TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(id,scope)); COMMIT;');
  if(version===1)db.exec('BEGIN IMMEDIATE; ALTER TABLE files RENAME TO files_v1; CREATE TABLE files(id TEXT NOT NULL,scope TEXT NOT NULL,path TEXT NOT NULL,PRIMARY KEY(id,scope)); INSERT INTO files SELECT * FROM files_v1; DROP TABLE files_v1; PRAGMA user_version=2; COMMIT;');else db.exec('PRAGMA user_version=2');
  const read=db.prepare('SELECT value FROM secrets WHERE key=?'),write=db.prepare('INSERT INTO secrets VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  const vault={get(key){const row=read.get(key);if(!row)return null;return JSON.parse(safeStorage.decryptString(Buffer.from(row.value)));},set(key,value){if(value===null){db.prepare('DELETE FROM secrets WHERE key=?').run(key);return;}if(!safeStorage.isEncryptionAvailable())throw Error('SECURE_STORAGE_UNAVAILABLE');write.run(key,safeStorage.encryptString(JSON.stringify(value)));}};
  return {db,vault,snapshot(){return Object.fromEntries(db.prepare('SELECT key,value FROM kv').all().map(r=>[r.key,r.value]));},set(key,value){if(typeof key!=='string'||!key.startsWith('lumen.')||key.length>300||typeof value!=='string'||value.length>10000000)throw Error('STORAGE_INVALID');db.prepare('INSERT INTO kv VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);},remove(key){db.prepare('DELETE FROM kv WHERE key=?').run(key);}};
}
module.exports={createRepository};
