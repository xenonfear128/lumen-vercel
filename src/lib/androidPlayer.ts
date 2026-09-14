import { native } from './device';
import { EQ_PRESETS } from './audioEngine';
// The DOM-shaped facade is only a compatibility adapter. It never creates an Audio element.
class NativeAudio extends EventTarget {
  paused=true;currentTimeValue=0;duration=0;src='';error:MediaError|null=null;private level=0.8;private mute=false;
  get currentTime(){return this.currentTimeValue;}
  set currentTime(value:number){this.currentTimeValue=value;void native!.player!({action:'seek',seconds:value});}
  get volume(){return this.level;}set volume(value:number){this.level=value;void native!.player!({action:'volume',volume:this.mute?0:value});}
  get muted(){return this.mute;}set muted(value:boolean){this.mute=value;this.volume=this.level;}
  play(){return native!.player!({action:'play'}).then(()=>{});}
  pause(){void native!.player!({action:'pause'});}
  removeAttribute(_name:string){}load(){}
}
export class AndroidPlayerAdapter {
  private facade=new NativeAudio();readonly audio=this.facade as unknown as HTMLAudioElement;
  private gains=EQ_PRESETS.flat.slice();private preamp=0;private enabled=true;private unsubscribe:()=>void;
  private frequency=new Uint8Array(1024);private wave=new Uint8Array(2048).fill(128);
  readonly analyserNode={frequencyBinCount:1024,fftSize:2048,getByteFrequencyData:(out:Uint8Array)=>out.set(this.frequency),getByteTimeDomainData:(out:Uint8Array)=>out.set(this.wave)};
  readonly context={sampleRate:44100};
  constructor(){this.unsubscribe=native!.onPlayer!(state=>this.receive(state));void native!.player!({action:'state'}).then(state=>this.receive(state));}
  private receive(state:any){if(state.position===undefined)return;const was=this.facade.paused;this.facade.paused=!state.playing;this.facade.src=state.id?'native:'+state.id:'';this.facade.currentTimeValue=state.position;this.facade.duration=state.duration;
    if(state.sampleRate)this.context.sampleRate=state.sampleRate;
    if(state.frequency)this.frequency.set(state.frequency);if(state.wave)this.wave.set(state.wave);
    if(was!==this.facade.paused)this.facade.dispatchEvent(new Event(state.playing?'play':'pause'));
    this.facade.dispatchEvent(new Event('timeupdate'));this.facade.dispatchEvent(new Event('durationchange'));
    window.dispatchEvent(new CustomEvent('lumen-player-state',{detail:state}));
  }
  ensureContext(){return null;}
  private eq(){void native!.player!({action:'eq',gains:this.gains,preamp:this.preamp,enabled:this.enabled});}
  setEnabled(value:boolean){this.enabled=value;this.eq();}setGains(value:number[]){this.gains=value.slice();this.eq();}setPreamp(value:number){this.preamp=value;this.eq();}setBand(index:number,value:number){this.gains[index]=value;this.eq();}
  destroy(){this.unsubscribe();}
}
