package app.lumen.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.AudioProcessor.UnhandledAudioFormatException
import androidx.media3.common.audio.BaseAudioProcessor
import java.nio.ByteBuffer
import kotlin.math.*

/** RBJ biquads matching Web Audio's shelves and Q=sqrt(2) peaking bands. */
@androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
class EqualizerProcessor:BaseAudioProcessor(){
 companion object {val BANDS=doubleArrayOf(31.5,63.0,125.0,250.0,500.0,1000.0,2000.0,4000.0,8000.0,16000.0)}
 @Volatile var analysisEnabled=false
 @Volatile var waveform=IntArray(2048){128};private set
 @Volatile var spectrum=IntArray(1024);private set
 private var gains=DoubleArray(10);private var preamp=0.0;private var enabled=true
 private var coefficients=Array(10){doubleArrayOf(1.0,0.0,0.0,0.0,0.0)}
 private var states=Array(10){Array(2){DoubleArray(2)}}
 private var ring=DoubleArray(2048);private var ringIndex=0;private var analysisSamples=0
 @Synchronized fun configure(gain:DoubleArray,db:Double,on:Boolean){require(gain.size==10&&gain.all{it.isFinite()&&it in -12.0..12.0}&&db.isFinite()&&db in -24.0..12.0);gains=gain.copyOf();preamp=db;enabled=on;rebuild()}
 override fun onConfigure(input:AudioFormat):AudioFormat {if(input.encoding!=C.ENCODING_PCM_16BIT)throw UnhandledAudioFormatException(input);return input}
 @Synchronized override fun onFlush(){states=Array(10){Array(inputAudioFormat.channelCount.coerceAtLeast(1)){DoubleArray(2)}};ring.fill(0.0);ringIndex=0;rebuild()}
 private fun rebuild(){val rate=inputAudioFormat.sampleRate;if(rate<=0)return;coefficients=Array(10){i->coeff(i,if(enabled)gains[i] else 0.0,rate.toDouble())}}
 private fun coeff(i:Int,gain:Double,rate:Double):DoubleArray {
  val a=10.0.pow(gain/40);val w=2*PI*min(BANDS[i],rate*0.499)/rate;val c=cos(w);val s=sin(w);val alpha=s/(2*sqrt(2.0));var b0:Double;var b1:Double;var b2:Double;var a0:Double;var a1:Double;var a2:Double
  if(i==0||i==9){val beta=2*sqrt(a)*(s/sqrt(2.0));if(i==0){b0=a*((a+1)-(a-1)*c+beta);b1=2*a*((a-1)-(a+1)*c);b2=a*((a+1)-(a-1)*c-beta);a0=(a+1)+(a-1)*c+beta;a1=-2*((a-1)+(a+1)*c);a2=(a+1)+(a-1)*c-beta}
   else{b0=a*((a+1)+(a-1)*c+beta);b1=-2*a*((a-1)+(a+1)*c);b2=a*((a+1)+(a-1)*c-beta);a0=(a+1)-(a-1)*c+beta;a1=2*((a-1)-(a+1)*c);a2=(a+1)-(a-1)*c-beta}}
  else{b0=1+alpha*a;b1=-2*c;b2=1-alpha*a;a0=1+alpha/a;a1=-2*c;a2=1-alpha/a}
  return doubleArrayOf(b0/a0,b1/a0,b2/a0,a1/a0,a2/a0)
 }
 @Synchronized override fun queueInput(input:ByteBuffer){
  val output=replaceOutputBuffer(input.remaining());val channels=inputAudioFormat.channelCount;val gain=if(enabled)10.0.pow(preamp/20) else 1.0
  while(input.remaining()>=channels*2){var mono=0.0;for(ch in 0 until channels){var sample=input.short/32768.0*gain;for(i in 0..9){val c=coefficients[i];val z=states[i][ch];val y=c[0]*sample+z[0];z[0]=c[1]*sample-c[3]*y+z[1];z[1]=c[2]*sample-c[4]*y;sample=y};sample=sample.coerceIn(-1.0,0.999969);output.putShort((sample*32768).toInt().toShort());mono+=sample/channels}
   if(analysisEnabled){ring[ringIndex]=mono;ringIndex=(ringIndex+1)%2048;analysisSamples++;if(analysisSamples>=inputAudioFormat.sampleRate/20){analysisSamples=0;analyze()}}
  };output.flip()
 }
 private fun analyze(){
  val real=DoubleArray(2048);val imag=DoubleArray(2048);val wave=IntArray(2048)
  for(i in real.indices){val value=ring[(ringIndex+i)%2048];wave[i]=((value+1)*128).toInt().coerceIn(0,255);real[i]=value*(0.5-0.5*cos(2*PI*i/2047))}
  var j=0;for(i in 1 until 2048){var bit=1024;while(j and bit!=0){j=j xor bit;bit=bit shr 1};j=j xor bit;if(i<j){val tmp=real[i];real[i]=real[j];real[j]=tmp}}
  var len=2;while(len<=2048){val angle=-2*PI/len;for(start in 0 until 2048 step len){for(k in 0 until len/2){val wr=cos(angle*k);val wi=sin(angle*k);val odd=start+k+len/2;val even=start+k;val tr=real[odd]*wr-imag[odd]*wi;val ti=real[odd]*wi+imag[odd]*wr;real[odd]=real[even]-tr;imag[odd]=imag[even]-ti;real[even]+=tr;imag[even]+=ti}};len*=2}
  val previous=spectrum;spectrum=IntArray(1024){i->val db=20*log10(hypot(real[i],imag[i])/512+1e-10);(previous[i]*0.82+((db+90)/80*255).coerceIn(0.0,255.0)*0.18).toInt()};waveform=wave
 }
}
