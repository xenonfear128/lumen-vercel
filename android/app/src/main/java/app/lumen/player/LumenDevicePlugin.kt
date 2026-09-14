package app.lumen.player

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.activity.result.ActivityResult
import androidx.documentfile.provider.DocumentFile
import com.getcapacitor.*
import com.getcapacitor.annotation.*
import org.json.*
import java.util.UUID
import java.util.concurrent.Executors

@CapacitorPlugin(name="LumenDevice",permissions=[Permission(strings=[android.Manifest.permission.POST_NOTIFICATIONS],alias="notifications")])
class LumenDevicePlugin:Plugin(){
 private lateinit var repo:DeviceRepository;private lateinit var cloud:CloudTransport
 private val pendingCommands=linkedMapOf<String,JSONObject>()
 private val worker=Executors.newSingleThreadExecutor();private val main=Handler(Looper.getMainLooper())
 override fun load(){repo=DeviceRepository.get(context);cloud=CloudTransport.get(repo);PlaybackService.observer={notifyListeners("playerState",JSObject(it.toString()))}}
 private fun run(call:PluginCall,action:()->JSONObject){worker.execute{try{call.resolve(JSObject(action().toString()))}catch(e:Exception){call.reject(e.message?.takeIf{it.matches(Regex("[A-Z_]+"))}?:"REQUEST_FAILED")}}}
 @PluginMethod fun bootstrap(call:PluginCall)=run(call){JSONObject().put("values",repo.snapshot()).put("user",repo.user()?:JSONObject.NULL).put("version","0.3.0")}
 @PluginMethod fun store(call:PluginCall)=run(call){repo.put(call.getString("key")!!,call.getString("value"));JSONObject()}
 @PluginMethod fun request(call:PluginCall)=run(call){
  val before=repo.scope();val path=call.getString("path")!!
  if(path=="/auth/login"||path=="/auth/logout"||path=="/auth/password")main.post{PlaybackService.instance?.command(JSONObject().put("action","stop"))}
  if(path=="/sync/exchange")try{cloud.syncEvents(repo.scope())}catch(_:Exception){}
  val result=cloud.request(path,call.getObject("body"),call.getBoolean("music",false)!!,call.getString("expectedUser"))
  if(repo.scope()!=before)main.post{PlaybackService.instance?.command(JSONObject().put("action","stop"));notifyListeners("suspend",JSObject())};result
 }
 @PluginMethod fun files(call:PluginCall)=run(call){val owner=call.getString("scope")!!;require(owner==repo.scope()){ "AUTH_REQUIRED" };val ids=call.getArray("ids")!!;require(ids.length()<=20000);val result=JSONObject();for(i in 0 until ids.length()){val id=ids.getString(i);if(call.getBoolean("importGuest",false)==true)repo.file(id,"guest")?.let{repo.file(id,owner,it)};if(call.getBoolean("remove",false)==true)repo.removeFile(id,owner)else repo.file(id,owner)?.let{uri->try{context.contentResolver.openAssetFileDescriptor(Uri.parse(uri),"r")?.use{result.put(id,"lumen-file:$id")}}catch(_:Exception){}}};result}
 @PluginMethod fun pickFiles(call:PluginCall){
  if(call.getString("scope")!=repo.scope()){call.reject("AUTH_REQUIRED");return}
  val intent=if(call.getBoolean("folder",false)==true)Intent(Intent.ACTION_OPEN_DOCUMENT_TREE) else Intent(Intent.ACTION_OPEN_DOCUMENT).setType("audio/*").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_ALLOW_MULTIPLE,call.getString("relink")==null)
  intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);startActivityForResult(call,intent,"picked")
 }
 @ActivityCallback private fun picked(call:PluginCall?,result:ActivityResult){if(call==null)return;if(result.resultCode!=Activity.RESULT_OK){call.resolve(JSObject().put("tracks",JSArray()));return}
  run(call){val owner=call.getString("scope")!!;require(owner==repo.scope()){ "AUTH_REQUIRED" };val data=result.data!!;val tracks=JSONArray();val folder=call.getBoolean("folder",false)==true;val uris=mutableListOf<Uri>();if(data.clipData!=null){for(i in 0 until data.clipData!!.itemCount)uris.add(data.clipData!!.getItemAt(i).uri)}else data.data?.let{uris.add(it)}
   fun add(file:DocumentFile){require(tracks.length()<10000){"FILE_LIMIT"};if(file.isDirectory){file.listFiles().sortedBy{it.name}.forEach{add(it)};return};val name=file.name?:"Audio";if(file.type?.startsWith("audio/")!=true&&!name.matches(Regex(".*\\.(mp3|flac|wav|ogg|opus|m4a|aac|aiff|aif|wma|webm)",RegexOption.IGNORE_CASE)))return
    val id=call.getString("relink")?:UUID.randomUUID().toString();repo.file(id,owner,file.uri.toString());tracks.put(JSONObject().put("id",UUID.randomUUID().toString()).put("localFileId",id).put("source","local").put("file",JSONObject.NULL).put("localUrl","lumen-file:$id").put("neteaseId",JSONObject.NULL).put("path","").put("fileName",name).put("title",name.substringBeforeLast('.')).put("artist",JSONObject.NULL).put("album",JSONObject.NULL).put("duration",JSONObject.NULL).put("coverUrl",JSONObject.NULL).put("fallbackCover",0).put("metaLoaded",true))
    try {android.media.MediaMetadataRetriever().use{m->m.setDataSource(context,file.uri);val t=tracks.getJSONObject(tracks.length()-1);m.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_TITLE)?.let{t.put("title",it)};m.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ARTIST)?.let{t.put("artist",it)};m.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_ALBUM)?.let{t.put("album",it)};m.extractMetadata(android.media.MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let{t.put("duration",it/1000.0)};m.embeddedPicture?.takeIf{it.size<2000000}?.let{t.put("coverUrl","data:image/jpeg;base64,"+android.util.Base64.encodeToString(it,android.util.Base64.NO_WRAP))}}}catch(_:Exception){}
   }
   for(uri in uris){context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);(if(folder)DocumentFile.fromTreeUri(context,uri)else DocumentFile.fromSingleUri(context,uri))?.let{add(it)}};JSONObject().put("tracks",tracks).put("name",if(folder)uris.firstOrNull()?.let{DocumentFile.fromTreeUri(context,it)?.name} else JSONObject.NULL)
  }
 }
 @PluginMethod fun openExternal(call:PluginCall){val path=call.getString("path");if(path !in setOf("/","/admin","/downloads","/?account=register","/?account=reset")){call.reject("CLIENT_ROUTE_DENIED");return};activity.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(CloudTransport.ORIGIN+path)));call.resolve()}
 @PluginMethod fun settings(call:PluginCall){call.resolve(JSObject().put("closeToTray",true))}
 @PluginMethod fun player(call:PluginCall){
  if(call.getString("action")=="load"&&android.os.Build.VERSION.SDK_INT>=33&&getPermissionState("notifications") in listOf(PermissionState.PROMPT,PermissionState.PROMPT_WITH_RATIONALE)){requestPermissionForAlias("notifications",call,"notificationResult");return};dispatchPlayer(call)
 }
 @PermissionCallback private fun notificationResult(call:PluginCall){dispatchPlayer(call)}
 private fun dispatchPlayer(call:PluginCall){
  main.post{
   val action=call.getString("action")
   if(PlaybackService.instance==null&&(action=="state"||action=="stop"||action=="pause"||action=="analysis")){call.resolve(JSObject().put("playing",false).put("scope",repo.scope()));return@post}
   if(PlaybackService.instance==null&&action!="load"){
    if(action in listOf("queue","eq","volume"))pendingCommands[action!!]=JSONObject(call.data.toString());
    call.resolve(JSObject().put("playing",false).put("scope",repo.scope()));return@post
   }
   context.startService(Intent(context,PlaybackService::class.java))
   fun invoke(attempt:Int){val service=PlaybackService.instance;if(service==null){if(attempt<20)main.postDelayed({invoke(attempt+1)},100)else call.reject("PLAYER_UNAVAILABLE");return};try{for(value in pendingCommands.values)service.command(value);pendingCommands.clear();call.resolve(JSObject(service.command(call.data).toString()));if(action=="exit")activity.finishAndRemoveTask()}catch(e:Exception){call.reject(e.message?:"PLAYER_UNAVAILABLE")}}
   invoke(0)
  }
 }
 override fun handleOnResume(){PlaybackService.instance?.let{notifyListeners("playerState",JSObject(it.state().toString()))}}
 override fun handleOnPause(){PlaybackService.instance?.equalizer?.analysisEnabled=false}
 override fun handleOnDestroy(){PlaybackService.observer=null;worker.shutdown()}
}
