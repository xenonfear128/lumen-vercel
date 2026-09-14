package app.lumen.player

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.content.Intent
import androidx.media3.common.*
import androidx.media3.exoplayer.*
import androidx.media3.exoplayer.audio.*
import androidx.media3.session.*
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import okhttp3.OkHttpClient
import org.json.*
import java.util.UUID
import java.util.concurrent.Executors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class PlaybackService:MediaSessionService(){
 companion object { @Volatile var instance:PlaybackService?=null;var observer:((JSONObject)->Unit)?=null }
 private lateinit var player:ExoPlayer;private var mediaSession:MediaSession?=null
 private lateinit var repo:DeviceRepository;private lateinit var cloud:CloudTransport
 val equalizer=EqualizerProcessor();private val handler=Handler(Looper.getMainLooper());private val worker=Executors.newSingleThreadExecutor()
 private var queue=JSONArray();private var current=-1;private var mode="repeat-all";private var owner="guest";private var epoch="initial";private var generation=0
 private var idleSince=0L
 private var error:String?=null;private var resolving=false;private var dead=0;private var counted=false;private var previousTick=0L;private var accumulated=0L;private var lastPosition=0L
 override fun onCreate(){super.onCreate();instance=this;repo=DeviceRepository.get(this);cloud=CloudTransport.get(repo)
  val renderers=object:DefaultRenderersFactory(this){override fun buildAudioSink(context:android.content.Context,enableFloatOutput:Boolean,enableAudioTrackPlaybackParams:Boolean):AudioSink=DefaultAudioSink.Builder(context).setAudioProcessors(arrayOf(equalizer)).setEnableFloatOutput(false).build()}
  val cdn=OkHttpClient.Builder().followRedirects(false).followSslRedirects(false).addInterceptor { chain -> CloudTransport.mediaUrl(chain.request().url.toString());chain.proceed(chain.request()) }.build()
  val sources=DefaultMediaSourceFactory(DefaultDataSource.Factory(this,OkHttpDataSource.Factory(cdn)))
  player=ExoPlayer.Builder(this,renderers).setMediaSourceFactory(sources).build();player.setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(),true);player.setHandleAudioBecomingNoisy(true);player.setWakeMode(C.WAKE_MODE_LOCAL)
  player.addListener(object:Player.Listener{
   override fun onIsPlayingChanged(isPlaying:Boolean){tick();if(isPlaying){previousTick=SystemClock.elapsedRealtime();lastPosition=player.currentPosition;if(!counted){dead=0;counted=record(0,1)}}else{flush();previousTick=0};emit()}
   override fun onPositionDiscontinuity(oldPosition:Player.PositionInfo,newPosition:Player.PositionInfo,reason:Int){flush();lastPosition=player.currentPosition;previousTick=if(player.isPlaying)SystemClock.elapsedRealtime() else 0}
   override fun onPlaybackStateChanged(state:Int){if(state==Player.STATE_ENDED){flush();advance(1,true)};emit()}
   override fun onPlayerError(e:PlaybackException){flush();player.pause();dead++;error=if(track()?.optString("source")=="local")"LOCAL_FILE_MISSING" else "PLAYBACK_FAILED";if(dead<queue.length())advance(1);emit()}
  })
  val controls=object:ForwardingPlayer(player){
   override fun getAvailableCommands():Player.Commands=super.getAvailableCommands().buildUpon().add(Player.COMMAND_SEEK_TO_NEXT).add(Player.COMMAND_SEEK_TO_PREVIOUS).add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM).add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM).build()
   override fun isCommandAvailable(command:Int):Boolean=getAvailableCommands().contains(command)
   override fun hasNextMediaItem()=queue.length()>0
   override fun hasPreviousMediaItem()=queue.length()>0
   override fun seekToNext(){dead=0;advance(1)}
   override fun seekToNextMediaItem(){seekToNext()}
   override fun seekToPrevious(){dead=0;advance(-1)}
   override fun seekToPreviousMediaItem(){seekToPrevious()}
  }
  mediaSession=MediaSession.Builder(this,controls).setCallback(object:MediaSession.Callback{
   override fun onConnect(session:MediaSession,controller:MediaSession.ControllerInfo):MediaSession.ConnectionResult {
    if(controller.packageName!=packageName&&!controller.isTrusted)return MediaSession.ConnectionResult.reject()
    return super.onConnect(session,controller)
   }
  }).build()
  handler.post(ticker)
 }
 override fun onGetSession(controllerInfo:MediaSession.ControllerInfo)=mediaSession
 private val ticker=object:Runnable{override fun run(){tick();emit();if(!player.isPlaying&&!resolving&&observer==null){if(idleSince==0L)idleSince=SystemClock.elapsedRealtime();if(SystemClock.elapsedRealtime()-idleSince>30000){stopSelf();return}}else idleSince=0;handler.postDelayed(this,if(equalizer.analysisEnabled&&observer!=null)50 else 500)}}
 private fun track():JSONObject?=queue.optJSONObject(current)
 private fun tick(){val now=SystemClock.elapsedRealtime();if(previousTick>0){val elapsed=(now-previousTick).coerceAtLeast(0);val progressed=(player.currentPosition-lastPosition).coerceAtLeast(0);accumulated+=minOf(elapsed,progressed);if(accumulated>=15000)flush()};previousTick=if(player.isPlaying)now else 0;lastPosition=player.currentPosition}
 private fun flush(){while(accumulated>0){val part=minOf(accumulated,60000L);if(!record(part,0))return;accumulated-=part}}
 private fun record(ms:Long,plays:Int):Boolean {val tr=track()?:return false;val title=if(tr.isNull("title"))tr.optString("fileName","Unknown")else tr.getString("title");val artist=if(tr.isNull("artist"))"Unknown" else tr.getString("artist");val album=if(tr.isNull("album"))"Unknown" else tr.getString("album");val key="$artist::$album::$title";val data=JSONObject().put("key",key).put("title",title).put("artist",artist).put("day",SimpleDateFormat("yyyy-MM-dd",Locale.US).format(Date())).put("ms",ms).put("plays",plays).put("lastPlayed",System.currentTimeMillis());try{if(owner=="guest")repo.guestStats(data)else repo.event(owner,JSONObject().put("id",UUID.randomUUID().toString()).put("type","stats.add").put("epoch",epoch).put("data",data))}catch(_:Exception){error="STORAGE_UNAVAILABLE";emit();return false};val captured=owner;worker.execute{try{cloud.syncEvents(captured)}catch(_:Exception){}};return true}
 fun command(args:JSONObject):JSONObject{
  when(args.getString("action")){
   "queue"->{val requested=args.getString("scope");require(requested==repo.scope()){ "AUTH_REQUIRED" };if(owner!=requested){stop();owner=requested};val id=track()?.optString("id");queue=args.getJSONArray("tracks");require(queue.length()<=20000);mode=args.optString("mode","repeat-all");val nextEpoch=args.optString("epoch","initial");if(nextEpoch!=epoch){tick();flush();epoch=nextEpoch};if(id!=null){current=(0 until queue.length()).firstOrNull{queue.getJSONObject(it).optString("id")==id}?:-1;if(current<0)stop()}}
   "load"->{require(args.getString("scope")==owner&&owner==repo.scope());val id=args.getString("id");val index=(0 until queue.length()).firstOrNull{queue.getJSONObject(it).getString("id")==id}?:error("TRACK_UNAVAILABLE");dead=0;load(index,args.optBoolean("autoplay",true))}
   "play"->player.play()
   "pause"->{tick();player.pause();flush()}
   "stop"->stop()
   "next"->{dead=0;advance(1)}
   "previous"->{dead=0;advance(-1)}
   "seek"->{tick();flush();player.seekTo((args.getDouble("seconds")*1000).toLong().coerceAtLeast(0));lastPosition=player.currentPosition}
   "volume"->player.volume=args.getDouble("volume").toFloat().coerceIn(0f,1f)
   "eq"->{val gains=args.getJSONArray("gains");equalizer.configure(DoubleArray(10){gains.getDouble(it)},args.getDouble("preamp"),args.getBoolean("enabled"))}
   "analysis"->equalizer.analysisEnabled=args.getBoolean("enabled")
   "exit"->{stop();stopSelf()}
   "clearGuestStats"->{if(owner=="guest"){tick();accumulated=0;repo.put("lumen.stats.v1",null)}}
   "state"->{}
   else->error("PLAYER_COMMAND_DENIED")
  };return state()
 }
 private fun stop(){generation++;resolving=false;tick();player.pause();flush();player.clearMediaItems();current=-1;error=null}
 private fun load(index:Int,autoplay:Boolean){
  tick();player.pause();flush();player.clearMediaItems();current=index;counted=false;resolving=true;error=null;val seq=++generation;val tr=track()!!;val account=owner
  worker.execute{try{val url=if(tr.optString("source")=="local")repo.file(tr.optString("localFileId",tr.getString("id")),account) else cloud.resolve(tr.getLong("neteaseId"),account)
   handler.post{if(seq!=generation||account!=repo.scope())return@post;resolving=false;if(url==null){dead++;error=if(tr.optString("source")=="local")"LOCAL_FILE_MISSING" else "TRACK_UNAVAILABLE";if(dead<queue.length())advance(1)else player.pause();emit();return@post}
    val metadata=MediaMetadata.Builder().setTitle(tr.optString("title",tr.optString("fileName"))).setArtist(tr.optString("artist")).setAlbumTitle(tr.optString("album")).build()
    player.setMediaItem(MediaItem.Builder().setMediaId(tr.getString("id")).setUri(url).setMediaMetadata(metadata).build());player.prepare();player.playWhenReady=autoplay;emit()
   }
  }catch(e:Exception){handler.post{if(seq==generation){resolving=false;error=e.message?.takeIf{it.matches(Regex("[A-Z_]+"))}?:"SOURCE_UNAVAILABLE";player.pause();emit()}}}}
 }
 private fun advance(direction:Int,automatic:Boolean=false){if(queue.length()==0)return;val index=if(mode=="repeat-one"&&automatic&&direction==1&&dead==0)current else if(mode=="shuffle"&&queue.length()>1){var n=(0 until queue.length()).random();if(n==current)n=(n+1)%queue.length();n}else Math.floorMod(current+direction,queue.length());load(index,true)}
 fun state(includeGuest:Boolean=true):JSONObject=JSONObject().put("id",track()?.optString("id")?:JSONObject.NULL).put("scope",owner).put("playing",player.isPlaying).put("position",player.currentPosition/1000.0).put("duration",player.duration.coerceAtLeast(0)/1000.0).put("sampleRate",equalizer.sampleRate).put("resolving",resolving).put("error",error?:JSONObject.NULL).also{if(owner=="guest"&&includeGuest)repo.value("lumen.stats.v1")?.let{s->it.put("guestStats",JSONObject(s))};if(equalizer.analysisEnabled){it.put("wave",JSONArray(equalizer.waveform.toList()));it.put("frequency",JSONArray(equalizer.spectrum.toList()))}}
 private var lastGuestEmit=0L
 private fun emit(){val now=SystemClock.elapsedRealtime();val include=now-lastGuestEmit>1000;if(include)lastGuestEmit=now;observer?.invoke(state(include))}
 override fun onTaskRemoved(rootIntent:Intent?){equalizer.analysisEnabled=false;if(!player.playWhenReady){stop();stopSelf()}}
 override fun onDestroy(){tick();flush();generation++;handler.removeCallbacksAndMessages(null);player.release();mediaSession?.release();worker.shutdown();instance=null;super.onDestroy()}
}
