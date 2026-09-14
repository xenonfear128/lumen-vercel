package app.lumen.player

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class DeviceRepository private constructor(context: Context): SQLiteOpenHelper(context,"lumen-client.sqlite",null,1) {
 companion object {
  @Volatile private var instance:DeviceRepository?=null
  fun get(context:Context):DeviceRepository=instance?:synchronized(this){instance?:DeviceRepository(context.applicationContext).also{instance=it}}
 }
 init { setWriteAheadLoggingEnabled(true) }
 override fun onCreate(db:SQLiteDatabase){
  db.execSQL("CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
  db.execSQL("CREATE TABLE secrets(key TEXT PRIMARY KEY,value TEXT NOT NULL)")
  db.execSQL("CREATE TABLE files(id TEXT NOT NULL,scope TEXT NOT NULL,uri TEXT NOT NULL,PRIMARY KEY(id,scope))")
  db.execSQL("CREATE TABLE events(id TEXT PRIMARY KEY,scope TEXT NOT NULL,value TEXT NOT NULL)")
 }
 override fun onUpgrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("STORAGE_VERSION_UNSUPPORTED")}
 override fun onDowngrade(db:SQLiteDatabase,oldVersion:Int,newVersion:Int){error("STORAGE_VERSION_UNSUPPORTED")}
 @Synchronized fun snapshot():JSONObject {val result=JSONObject();readableDatabase.rawQuery("SELECT key,value FROM kv",null).use{while(it.moveToNext())result.put(it.getString(0),it.getString(1))};return result}
 @Synchronized fun value(key:String):String?=readableDatabase.rawQuery("SELECT value FROM kv WHERE key=?",arrayOf(key)).use{if(it.moveToFirst())it.getString(0) else null}
 @Synchronized fun put(key:String,value:String?){require(key.startsWith("lumen.")&&key.length<=300&&(value==null||value.length<=10000000)){"STORAGE_INVALID"};if(value==null)writableDatabase.delete("kv","key=?",arrayOf(key)) else writableDatabase.execSQL("INSERT OR REPLACE INTO kv VALUES(?,?)",arrayOf(key,value))}
 private fun key():SecretKey {val ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);(ks.getKey("lumen-device-v1",null) as? SecretKey)?.let{return it};val gen=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");gen.init(KeyGenParameterSpec.Builder("lumen-device-v1",KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());return gen.generateKey()}
 @Synchronized fun secret(name:String):String? {
  val raw=readableDatabase.rawQuery("SELECT value FROM secrets WHERE key=?",arrayOf(name)).use{if(it.moveToFirst())it.getString(0) else null}?:return null
  val parts=raw.split(':');val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));return cipher.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)).toString(Charsets.UTF_8)
 }
 @Synchronized fun secret(name:String,value:String?){
  if(value==null){writableDatabase.delete("secrets","key=?",arrayOf(name));return}
  val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key());val encrypted=Base64.encodeToString(cipher.iv,Base64.NO_WRAP)+":"+Base64.encodeToString(cipher.doFinal(value.toByteArray()),Base64.NO_WRAP)
  writableDatabase.execSQL("INSERT OR REPLACE INTO secrets VALUES(?,?)",arrayOf(name,encrypted))
 }
 @Synchronized fun setSession(token:String?,user:JSONObject?){val db=writableDatabase;db.beginTransaction();try{secret("token",token);secret("user",user?.toString());secret("personal",null);db.setTransactionSuccessful()}finally{db.endTransaction()}}
 fun user():JSONObject?=secret("user")?.let{JSONObject(it)}
 fun scope():String=user()?.optString("id")?:"guest"
 @Synchronized fun file(id:String,scope:String):String?=readableDatabase.rawQuery("SELECT uri FROM files WHERE id=? AND scope=?",arrayOf(id,scope)).use{if(it.moveToFirst())it.getString(0) else null}
 @Synchronized fun file(id:String,scope:String,uri:String){writableDatabase.execSQL("INSERT OR REPLACE INTO files VALUES(?,?,?)",arrayOf(id,scope,uri))}
 @Synchronized fun removeFile(id:String,scope:String){writableDatabase.delete("files","id=? AND scope=?",arrayOf(id,scope))}
 @Synchronized fun event(scope:String,event:JSONObject){writableDatabase.execSQL("INSERT OR IGNORE INTO events VALUES(?,?,?)",arrayOf(event.getString("id"),scope,event.toString()))}
 @Synchronized fun events(scope:String):JSONArray {val list=JSONArray();readableDatabase.rawQuery("SELECT value FROM events WHERE scope=? ORDER BY rowid LIMIT 10",arrayOf(scope)).use{while(it.moveToNext())list.put(JSONObject(it.getString(0)))};return list}
 @Synchronized fun acknowledge(scope:String,ids:JSONArray){val db=writableDatabase;db.beginTransaction();try{for(i in 0 until ids.length())db.delete("events","id=? AND scope=?",arrayOf(ids.getString(i),scope));db.setTransactionSuccessful()}finally{db.endTransaction()}}
 @Synchronized fun guestStats(data:JSONObject){
  val stats=value("lumen.stats.v1")?.let{JSONObject(it)}?:JSONObject().put("totalMs",0).put("days",JSONObject()).put("artists",JSONObject()).put("tracks",JSONObject())
  val ms=data.getLong("ms");val day=data.getString("day");val artist=data.getString("artist");val id=data.getString("key")
  stats.put("totalMs",stats.optLong("totalMs")+ms)
  for(pair in listOf("days" to day,"artists" to artist)){val map=stats.optJSONObject(pair.first)?:JSONObject();map.put(pair.second,map.optLong(pair.second)+ms);stats.put(pair.first,map)}
  val tracks=stats.optJSONObject("tracks")?:JSONObject();val track=tracks.optJSONObject(id)?:JSONObject().put("key",id).put("title",data.getString("title")).put("artist",artist).put("ms",0).put("plays",0)
  track.put("ms",track.optLong("ms")+ms).put("plays",track.optInt("plays")+data.getInt("plays")).put("lastPlayed",data.getLong("lastPlayed"));tracks.put(id,track);stats.put("tracks",tracks);put("lumen.stats.v1",stats.toString())
 }

}
