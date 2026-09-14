package app.lumen.player
import org.junit.Test
import org.junit.Assert.*
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.*
class EqualizerProcessorTest {
 private fun rms(frequency:Double,gains:DoubleArray=DoubleArray(10),preamp:Double=0.0,enabled:Boolean=true):Double {
  val eq=EqualizerProcessor();eq.configure(AudioFormat(48000,2,C.ENCODING_PCM_16BIT));eq.flush();eq.configure(gains,preamp,enabled)
  val input=ByteBuffer.allocateDirect(48000*4).order(ByteOrder.nativeOrder())
  for(i in 0 until 48000){val s=(sin(2*PI*frequency*i/48000)*2000).toInt().toShort();input.putShort(s);input.putShort(s)};input.flip();eq.queueInput(input);val output=eq.output.order(ByteOrder.nativeOrder());var sum=0.0;var count=0
  while(output.remaining()>=4){val l=output.short.toDouble();val r=output.short.toDouble();assertEquals(l,r,0.0);if(count>24000)sum+=l*l;count++};return sqrt(sum/(count-24001))
 }
 @Test fun flatAndPreamp(){val dry=rms(1000.0);assertEquals(2000/sqrt(2.0),dry,2.0);assertEquals(-6.0,20*log10(rms(1000.0,preamp=-6.0)/dry),0.05)}
 @Test fun octaveCentersAndBypass(){for(i in 1..8){val gains=DoubleArray(10);gains[i]=6.0;val dry=rms(EqualizerProcessor.BANDS[i]);assertEquals("Band $i",6.0,20*log10(rms(EqualizerProcessor.BANDS[i],gains)/dry),0.15);assertEquals(dry,rms(EqualizerProcessor.BANDS[i],gains,enabled=false),1.0)}}
 @Test fun shelves(){val low=DoubleArray(10);low[0]=6.0;val high=DoubleArray(10);high[9]=6.0;assertTrue(rms(10.0,low)>rms(10.0)*1.8);assertTrue(rms(22000.0,high)>rms(22000.0)*1.8)}
 @Test fun analysisUsesOutput(){val eq=EqualizerProcessor();eq.configure(AudioFormat(48000,1,C.ENCODING_PCM_16BIT));eq.flush();eq.analysisEnabled=true;val input=ByteBuffer.allocateDirect(4800*2).order(ByteOrder.nativeOrder());for(i in 0 until 4800)input.putShort((sin(2*PI*1000*i/48000)*4000).toInt().toShort());input.flip();eq.queueInput(input);assertTrue(eq.waveform.maxOrNull()!!>128);val peak=eq.spectrum.indices.maxBy{eq.spectrum[it]};assertTrue(peak in 40..45)}
}
