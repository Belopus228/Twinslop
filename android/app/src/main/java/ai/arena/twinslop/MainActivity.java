package ai.arena.twinslop;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * Обёртка приложения: WebView со страницей из assets/www.
 *
 * Разрешения INTERNET в манифесте нет — сети у приложения нет вообще.
 * Диалог выбора файла нужен для разбора APK: страница читает выбранный файл
 * локально, ничего никуда не отправляя.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILE = 1001;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setTextZoom(100);

        web.setBackgroundColor(0xFF060A12);
        web.setWebViewClient(new WebViewClient());
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);

        // мостик в страницу: открыть ссылку во внешнем браузере (без сети внутри приложения)
        web.addJavascriptInterface(new Bridge(), "TwinslopApp");

        // выбор файла из <input type="file"> — для локального разбора APK
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = callback;
                try {
                    Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                    intent.addCategory(Intent.CATEGORY_OPENABLE);
                    intent.setType("*/*");
                    startActivityForResult(Intent.createChooser(intent, "Выбери APK"), REQ_FILE);
                    return true;
                } catch (Exception e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        setContentView(web);
        web.loadUrl("file:///android_asset/www/index.html");

        hideSystemUi();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                fileCallback.onReceiveValue(result);
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    /**
     * Мостик в страницу.
     *  openUrl(url)       — открыть ссылку во внешнем браузере (сети у нас нет)
     *  listApps()         — установленные приложения (label, package, разрешения)
     *  launch(packageName) — запустить приложение системным интентом
     */
    public class Bridge {
        @JavascriptInterface
        public void openUrl(String url) {
            try {
                if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
            } catch (Exception ignored) {
                // браузера может не быть — молча выходим
            }
        }

        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String listApps() {
            JSONArray out = new JSONArray();
            try {
                PackageManager pm = getPackageManager();
                Intent launcher = new Intent(Intent.ACTION_MAIN);
                launcher.addCategory(Intent.CATEGORY_LAUNCHER);
                List<ResolveInfo> resolved = pm.queryIntentActivities(launcher, 0);

                for (ResolveInfo ri : resolved) {
                    ApplicationInfo ai = ri.activityInfo == null ? null : ri.activityInfo.applicationInfo;
                    if (ai == null) continue;
                    try {
                        JSONObject o = new JSONObject();
                        o.put("package", ai.packageName);
                        o.put("label", String.valueOf(pm.getApplicationLabel(ai)));
                        o.put("system", (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0);
                        o.put("targetSdk", ai.targetSdkVersion);

                        PackageInfo pi = pm.getPackageInfo(ai.packageName, PackageManager.GET_PERMISSIONS);
                        JSONArray perms = new JSONArray();
                        if (pi.requestedPermissions != null) {
                            for (String perm : pi.requestedPermissions) perms.put(perm);
                        }
                        o.put("permissions", perms);
                        out.put(o);
                    } catch (Exception ignored) {
                        // одно приложение не прочиталось — список не рушим
                    }
                }
            } catch (Exception ignored) {
                return "[]";
            }
            return out.toString();
        }

        @JavascriptInterface
        public boolean launch(String packageName) {
            try {
                Intent intent = getPackageManager().getLaunchIntentForPackage(packageName);
                if (intent == null) return false;
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(intent);
                return true;
            } catch (Exception e) {
                return false;
            }
        }
    }

    private void hideSystemUi() {
        View decor = getWindow().getDecorView();
        int flags = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION;
        decor.setSystemUiVisibility(flags);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (web != null) web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
        hideSystemUi();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}
