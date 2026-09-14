package app.lumen.player

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.FormBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.net.URI
import java.util.concurrent.TimeUnit

class CloudTransport(private val repo:DeviceRepository){
 companion object {
  @Volatile private var shared:CloudTransport?=null
  fun get(repo:DeviceRepository):CloudTransport=shared?:synchronized(this){shared?:CloudTransport(repo).also{shared=it}}
  const val ORIGIN="https://lumen.rupa.best"
  private val jsonRoutes=setOf("/auth/login","/auth/session","/auth/logout","/auth/password","/sync/exchange","/client/capabilities")
  private val musicRoutes=setOf("/cloudsearch","/song/url/v1","/playlist/detail","/song/detail","/user/playlist","/login/qr/key","/login/qr/create","/login/qr/check","/login/status","/logout")
  fun mediaUrl(value:String):String {val u=URI(value);require(u.scheme=="https"&&u.rawUserInfo==null&&u.port==-1&&(u.host=="music.126.net"||u.host?.endsWith(".music.126.net")==true)){"MEDIA_HOST_DENIED"};return value}
 }
 private var compatibleUntil=0L
 private val http=OkHttpClient.Builder().callTimeout(25,TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false).build()
 @Synchronized fun request(path:String,body:JSONObject?=null,music:Boolean=false,expectedUser:String?=null):JSONObject {
  require((if(music)musicRoutes else jsonRoutes).contains(path)){"CLIENT_ROUTE_DENIED"}
  require(expectedUser==null||repo.scope()==expectedUser){"AUTH_REQUIRED"}
  if(path!="/client/capabilities"&&path!="/auth/logout"&&compatibleUntil<System.currentTimeMillis()){
   val caps=request("/client/capabilities");val cap=caps.getJSONObject("body");require(caps.getInt("status")==200&&cap.optInt("minProtocol",999)<=1&&cap.optInt("protocol")>=1){"CLIENT_UPDATE_REQUIRED"};compatibleUntil=System.currentTimeMillis()+300000
  }
  val token=repo.secret("token")
  if(path=="/auth/session"&&token==null)return guest()
  val endpoint=if(!music&&path.startsWith("/auth/"))"/client$path" else path
  val req=Request.Builder().url("$ORIGIN/api$endpoint").header("X-Lumen-Request","1")
  if(token!=null)req.header("Authorization","Bearer $token")
  if(expectedUser!=null)req.header("X-Lumen-User",expectedUser)
  if(body!=null){
   if(music){val form=FormBody.Builder();body.keys().forEach{if(it!="cookie")form.add(it,body.get(it).toString())};if(path!="/song/url/v1")repo.secret("personal")?.let{form.add("cookie",it)};req.post(form.build())}
   else req.post(body.toString().toRequestBody("application/json".toMediaType()))
  }
  try {http.newCall(req.build()).execute().use{response->
   val result=JSONObject(response.body?.string()?:"{}");val code=response.code
   if(code==401&&path!="/auth/login")repo.setSession(null,null)
   if(response.isSuccessful&&path=="/auth/login"){repo.setSession(result.getString("token"),result.getJSONObject("user"));result.remove("token");result.put("csrf",JSONObject.NULL)}
   if(response.isSuccessful&&(path=="/auth/logout"||path=="/auth/password"))repo.setSession(null,null)
   if(response.isSuccessful&&path=="/auth/session")repo.secret("user",result.optJSONObject("user")?.toString())
   if(music&&path=="/login/qr/check"&&result.optInt("code")==803){repo.secret("personal",result.getString("cookie"));result.put("cookie","native-managed")}
   if(music&&path=="/logout")repo.secret("personal",null)
   if(code==401&&path=="/auth/session")return guest()
   return JSONObject().put("status",code).put("body",result)
  }}catch(e:java.io.IOException){if(path=="/auth/logout")repo.setSession(null,null);throw IllegalStateException("NETWORK_UNAVAILABLE")}
 }
 private fun guest()=JSONObject().put("status",200).put("body",JSONObject().put("configured",true).put("initialized",true).put("user",JSONObject.NULL).put("csrf",JSONObject.NULL))
 fun resolve(id:Long,owner:String):String? {val result=request("/song/url/v1",JSONObject().put("id",id).put("level","exhigh"),true,owner);if(result.getInt("status")!=200)throw IllegalStateException(result.getJSONObject("body").optString("error","SOURCE_UNAVAILABLE"));val row=result.getJSONObject("body").getJSONArray("data").optJSONObject(0);return if(row==null||row.isNull("url"))null else mediaUrl(row.getString("url").replace(Regex("^http:",RegexOption.IGNORE_CASE),"https:"))}
 fun syncEvents(owner:String){if(owner=="guest"||repo.scope()!=owner)return;
  val cache=repo.value("lumen.user.$owner.lumen.cloud.v1")?.let{JSONObject(it)}
  val pending=cache?.optJSONArray("pending")
  if(pending!=null&&(0 until pending.length()).any{pending.getJSONObject(it).optString("type")=="stats.clear"})return;
val events=repo.events(owner);if(events.length()==0)return;val result=request("/sync/exchange",JSONObject().put("cursor",0).put("operations",events),false,owner);if(result.getInt("status")==200)repo.acknowledge(owner,result.getJSONObject("body").getJSONArray("acknowledged"))}
}
