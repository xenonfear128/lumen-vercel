package app.lumen.player;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
public class MainActivity extends BridgeActivity {
 @Override public void onCreate(Bundle savedInstanceState) {
  registerPlugin(LumenDevicePlugin.class); super.onCreate(savedInstanceState);
  getOnBackPressedDispatcher().addCallback(this,new androidx.activity.OnBackPressedCallback(true) {
   @Override public void handleOnBackPressed() {
    bridge.getWebView().evaluateJavascript("(function(){const dialog=document.querySelector('[role=dialog]');if(dialog){window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true}));return true}return false})()", value -> {if(!"true".equals(value))moveTaskToBack(true);});
   }
  });
 }
}
